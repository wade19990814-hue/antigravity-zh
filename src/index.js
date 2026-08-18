const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
    resolveAppPaths,
    stopAntigravityProcesses,
    launchAntigravity,
    readState,
    writeState
} = require('./detector');
const {
    DEFAULT_LOCALE,
    buildMenuFragment,
    buildPreloadFragment,
    listLocales,
    loadLocale
} = require('./locale');

// Markers injected by our patch fragments. Presence of any of these inside the
// packed archive means a Chinese patch is installed.
// Any of these inside the packed archive means a localization patch is present.
// installLocalePatch is emitted by the current engine; installZhCNPatch and
// zhCNText are legacy markers from pre-locale versions.
const PATCH_MARKERS = [
    'installLocalePatch',
    'installZhCNPatch',
    'const zhCNText = new Map([',
    'function translateMenu(menu)'
];

// Sentinels wrapping every injected block. Fragments carry them, so a re-run can
// excise the previous block exactly instead of guessing its bounds.
const BLOCK_BEGIN = '/* antigravity-zh:begin */';
const BLOCK_END = '/* antigravity-zh:end */';

// Fallback start markers for blocks injected before sentinels existed. Matching
// on a code identifier cannot see the fragment's leading comment, so these are
// only used when no sentinel is present.
const LEGACY_ENGINE_START_MARKERS = ['const AG_LOCALE = ', 'const zhCNText = new Map(['];
const LEGACY_MENU_START_MARKER = 'function translateMenu(menu)';

// The engine must run before the preload script exposes its bridges, so a fresh
// injection goes immediately above this declaration.
const UPDATER_ANCHOR = 'const updaterAPI = {';

/**
 * Remove a previously injected block so the new one replaces it exactly.
 *
 * Re-running the patch must not stack copies. The sentinel pair is authoritative
 * and every sentinel-delimited block is removed, which also repairs a file that
 * already accumulated duplicates. Legacy blocks (written before sentinels
 * existed) are located by a code marker, so their extent has to be supplied:
 * `legacy.endMarker` bounds the block, and its absence means it ran to EOF.
 *
 * Whitespace around the removed block is collapsed to a single newline so that
 * re-injecting is byte-stable: without this, every run leaves one more blank
 * line and app.asar keeps changing even though the patch is identical.
 *
 * @param {string} source
 * @param {object} legacy
 * @param {string[]} legacy.startMarkers
 * @param {string} [legacy.endMarker]
 * @returns {{ head: string, tail: string, replaced: boolean }} The source split
 *   at the block's position, with surrounding whitespace normalized.
 */
function splitAtInjectedBlock(source, legacy = {}) {
    let cleaned = source;
    let head = null;

    // Remove every sentinel-delimited block, so a file that already accumulated
    // duplicates is repaired instead of merely not made worse. The first block's
    // position is where the replacement goes.
    for (;;) {
        const begin = cleaned.indexOf(BLOCK_BEGIN);
        if (begin < 0) break;
        const end = cleaned.indexOf(BLOCK_END, begin);
        if (end < 0) break;
        const before = cleaned.slice(0, begin);
        const after = cleaned.slice(end + BLOCK_END.length);
        if (head === null) {
            head = before;
        }
        cleaned = before + after;
    }
    if (head !== null) {
        return { head: head.replace(/\s+$/, ''), tail: cleaned.slice(head.length).replace(/^\s+/, ''), replaced: true };
    }

    for (const marker of legacy.startMarkers || []) {
        const index = cleaned.indexOf(marker);
        if (index < 0) {
            continue;
        }
        const endIndex = legacy.endMarker ? cleaned.indexOf(legacy.endMarker, index) : -1;
        const cutTo = endIndex > index ? endIndex : cleaned.length;
        return {
            head: cleaned.slice(0, index).replace(/\s+$/, ''),
            tail: cleaned.slice(cutTo).replace(/^\s+/, ''),
            replaced: true
        };
    }
    return { head: cleaned, tail: '', replaced: false };
}

/**
 * Insert a fragment into a file, replacing any block a previous run injected.
 *
 * @param {string} source
 * @param {string} fragment
 * @param {object} [legacy]
 * @param {string} [fallbackAnchor] Anchor to insert before when nothing was
 *   previously injected. Appended at EOF when the anchor is absent.
 * @returns {string}
 */
function injectFragment(source, fragment, legacy = {}, fallbackAnchor) {
    const split = splitAtInjectedBlock(source, legacy);
    if (split.replaced) {
        return split.tail
            ? `${split.head}\n\n${fragment}\n\n${split.tail}`
            : `${split.head}\n\n${fragment}\n`;
    }

    const anchorAt = fallbackAnchor ? source.indexOf(fallbackAnchor) : -1;
    if (anchorAt >= 0) {
        const head = source.slice(0, anchorAt).replace(/\s+$/, '');
        const tail = source.slice(anchorAt);
        return `${head}\n\n${fragment}\n\n${tail}`;
    }
    return `${source.replace(/\s+$/, '')}\n\n${fragment}\n`;
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function extractAsar(asarPath, destDir) {
    const asar = require('@electron/asar');
    asar.extractAll(asarPath, destDir);
}

async function packAsar(srcDir, destAsarPath) {
    const asar = require('@electron/asar');
    // createPackageWithOptions returns a Promise; without awaiting it the
    // archive copy below would read the file before it is written.
    await asar.createPackageWithOptions(srcDir, destAsarPath, {
        unpackDir: 'node_modules/chrome-devtools-mcp'
    });
}

function getFormatTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Close Antigravity before app.asar is rewritten, preferring a clean exit.
 *
 * Rewriting the archive in place requires the app to be stopped, but a silent
 * force-kill throws away unsaved work, so the user is told what happened and
 * a forced kill is reported explicitly.
 *
 * @param {object} options
 * @throws {Error} When the app is still running and cannot be stopped.
 */
function closeAntigravityOrThrow(options = {}) {
    console.log('Requesting Antigravity to close (waiting for it to save state)...');
    const result = stopAntigravityProcesses({ force: options.force === true });

    if (!result.wasRunning) {
        console.log('  Antigravity was not running.');
        return;
    }
    if (!result.stopped) {
        throw new Error(
            'Antigravity is still running and could not be stopped. '
            + 'Close it manually and re-run, or pass --no-kill if you have already closed it.'
        );
    }
    if (result.forced) {
        console.log('  ! Antigravity did not exit in time and was force-closed; unsaved state may be lost.');
    } else {
        console.log('  Antigravity closed cleanly.');
    }
}

/**
 * Scan the whole archive for patch markers.
 *
 * Reading a fixed prefix of app.asar is unreliable because asar does not
 * guarantee where a given file lands inside the archive, so the injected
 * preload can sit well past any fixed offset. This streams the file in chunks
 * with an overlap so a marker split across a chunk boundary is still found.
 *
 * @param {string} asarPath
 * @returns {boolean|null} true/false, or null when the archive is unreadable.
 */
function detectPatchInArchive(asarPath) {
    const CHUNK_SIZE = 1024 * 1024;
    const longestMarker = Math.max(...PATCH_MARKERS.map((m) => m.length));
    let fd;
    try {
        fd = fs.openSync(asarPath, 'r');
    } catch {
        return null;
    }

    try {
        const buffer = Buffer.alloc(CHUNK_SIZE);
        let carry = '';
        let position = 0;

        for (;;) {
            const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, position);
            if (bytesRead <= 0) break;
            position += bytesRead;

            const text = carry + buffer.toString('latin1', 0, bytesRead);
            if (PATCH_MARKERS.some((marker) => text.includes(marker))) {
                return true;
            }
            // Keep a tail so a marker spanning two chunks is still detected.
            carry = text.slice(-longestMarker);
        }
        return false;
    } catch {
        return null;
    } finally {
        try {
            fs.closeSync(fd);
        } catch {
            // Nothing actionable.
        }
    }
}

function getStatus(options = {}) {
    const { appDir, asarPath, cleanBackupPath, statePath } = resolveAppPaths(options.appDir);
    const hasCleanBackup = fs.existsSync(cleanBackupPath);

    const detected = detectPatchInArchive(asarPath);
    const state = readState(statePath);

    // The archive itself is the source of truth. The marker only supplies extra
    // context, and is reported as stale when the two disagree (which happens
    // when an Antigravity update replaces app.asar behind our back).
    let currentLanguage;
    if (detected === true) {
        currentLanguage = 'zh';
    } else if (detected === false) {
        currentLanguage = 'en';
    } else {
        currentLanguage = state ? state.language : 'unknown';
    }

    const stateIsStale = Boolean(state) && detected !== null && state.language !== currentLanguage;

    return {
        appDir,
        asarPath,
        currentLanguage,
        hasCleanBackup,
        statePath,
        lastPatchedAt: state ? state.patchedAt || null : null,
        stateIsStale
    };
}

/**
 * Find an unpatched archive among the timestamped backups.
 *
 * Installs that were patched by an older version (or had their clean backup
 * deleted) can still hold a pristine copy in app.asar.bak-*. Each candidate is
 * verified rather than trusted by name, since some backups were themselves
 * taken after patching.
 *
 * @param {string} resourcesDir
 * @returns {string|null} Absolute path to a verified-clean archive.
 */
function findPristineArchive(resourcesDir) {
    let names;
    try {
        names = fs.readdirSync(resourcesDir)
            .filter((f) => f.startsWith('app.asar.bak-'))
            // Backup names embed yyyyMMdd-HHmmss, so a descending sort is newest
            // first. The newest clean archive is preferred because an older one can
            // belong to a previous Antigravity release and would silently downgrade
            // app.asar out of sync with app.asar.unpacked and native modules.
            .sort()
            .reverse();
    } catch {
        return null;
    }

    for (const name of names) {
        const candidate = path.join(resourcesDir, name);
        if (detectPatchInArchive(candidate) === false) {
            return candidate;
        }
    }
    return null;
}

async function switchToChinese(options = {}) {
    const { appDir, resourcesDir, asarPath, cleanBackupPath, statePath } = resolveAppPaths(options.appDir);
    // Locale data is validated before anything is modified, so a malformed
    // locale fails fast instead of producing a broken UI after the rewrite.
    const localeCode = options.locale || DEFAULT_LOCALE;
    const locale = loadLocale(localeCode);
    const preloadFragment = buildPreloadFragment(locale);
    const menuFragment = buildMenuFragment(locale);

    if (!options.noKill) {
        closeAntigravityOrThrow(options);
    }

    // Ensure clean backup exists
    if (!fs.existsSync(cleanBackupPath)) {
        // Only a pristine archive may become the clean backup. If the current
        // app.asar is already patched (backup deleted, or patched by an older
        // version), copying it here would silently poison the restore path and
        // make `en` restore a Chinese build forever.
        if (detectPatchInArchive(asarPath) === true) {
            // An earlier run may still have left a pristine timestamped backup.
            const pristine = findPristineArchive(resourcesDir);
            if (!pristine) {
                throw new Error(
                    'app.asar is already patched and no pristine copy was found, so the original '
                    + 'English build cannot be preserved. Reinstall or update Antigravity to restore '
                    + 'a clean app.asar, then run this tool again.'
                );
            }
            console.log(`Recovered pristine archive from ${path.basename(pristine)}`);
            fs.copyFileSync(pristine, cleanBackupPath);
        } else {
            console.log(`Creating original clean backup: ${cleanBackupPath}`);
            fs.copyFileSync(asarPath, cleanBackupPath);
        }
    }

    // Also create timestamped backup
    const stamp = getFormatTimestamp();
    const backupPath = path.join(resourcesDir, `app.asar.bak-${stamp}`);
    fs.copyFileSync(asarPath, backupPath);

    const tmpRoot = path.join(os.tmpdir(), `antigravity-zh-patch-${stamp}`);
    const extractDir = path.join(tmpRoot, 'app');
    const packedPath = path.join(tmpRoot, 'app.asar');

    try {
        fs.mkdirSync(extractDir, { recursive: true });
        console.log(`Extracting ${asarPath}...`);
        extractAsar(asarPath, extractDir);

        const mainPath = path.join(extractDir, 'dist', 'main.js');
        const menuPath = path.join(extractDir, 'dist', 'menu.js');
        const preloadPath = path.join(extractDir, 'dist', 'preload.js');

        // 1. Patch main.js (set lang switch)
        console.log('Injecting language switch into main.js...');
        let main = readUtf8(mainPath);
        if (!main.includes("appendSwitch('lang'")) {
            const needle = /if\s*\(!electron_1\.app\.commandLine\.hasSwitch\('remote-debugging-port'\)\)\s*\{\s*electron_1\.app\.commandLine\.appendSwitch\('remote-debugging-port',\s*'0'\);\s*\}/;
            const langPatch = `if (!electron_1.app.commandLine.hasSwitch('remote-debugging-port')) {
    electron_1.app.commandLine.appendSwitch('remote-debugging-port', '0');
}
if (!electron_1.app.commandLine.hasSwitch('lang')) {
    electron_1.app.commandLine.appendSwitch('lang', 'zh-CN');
}`;
            if (needle.test(main)) {
                main = main.replace(needle, langPatch);
                writeUtf8(mainPath, main);
            }
        }
        if (!main.includes("appendSwitch('lang'")) {
            throw new Error(
                'Could not apply the language switch to main.js: the expected code pattern was not found. '
                + 'Antigravity was likely updated to a build this patch does not recognise; '
                + 'report this so the anchor can be updated.'
            );
        }

        // 2. Patch menu.js (inject menu translations)
        console.log('Injecting menu translations into menu.js...');
        let menu = readUtf8(menuPath);
        // Replace a previously injected block when present so re-running the
        // patch (or switching locale) refreshes menu data instead of keeping
        // stale labels injected by an older build. A legacy menu block was always
        // appended last, so it ran to EOF.
        menu = injectFragment(menu, menuFragment, { startMarkers: [LEGACY_MENU_START_MARKER] });
        if (!menu.includes('translateMenu(menu);')) {
            menu = menu.replace(/(\s*)\/\/\s*Re-apply the menu so the change takes effect\./, '$1translateMenu(menu);\n$1// Re-apply the menu so the change takes effect.');
        }
        if (!menu.includes('translateMenu(menu);')) {
            throw new Error(
                'Could not wire translateMenu into menu.js: the "Re-apply the menu" anchor was not found. '
                + 'Antigravity was likely updated to a build this patch does not recognise; '
                + 'report this so the anchor can be updated.'
            );
        }
        writeUtf8(menuPath, menu);

        // 3. Patch preload.js (inject DOM translation engine)
        console.log('Injecting DOM translation engine into preload.js...');
        let preload = readUtf8(preloadPath);
        // Replace a previously injected block when present, so re-running the
        // patch (or switching locale) never stacks two translation engines. A
        // legacy engine block ended where updaterAPI began.
        preload = injectFragment(
            preload,
            preloadFragment,
            { startMarkers: LEGACY_ENGINE_START_MARKERS, endMarker: UPDATER_ANCHOR },
            UPDATER_ANCHOR
        );
        writeUtf8(preloadPath, preload);

        // 4. Syntax verification
        console.log('Checking JavaScript syntax...');
        // process.execPath and array arguments keep this shell-free, so a temp
        // path with shell metacharacters cannot execute anything.
        for (const file of [mainPath, menuPath, preloadPath]) {
            execFileSync(process.execPath, ['--check', file], { stdio: 'inherit', shell: false });
        }

        // 5. Repack asar
        console.log('Packing patched app.asar...');
        await packAsar(extractDir, packedPath);

        fs.copyFileSync(packedPath, asarPath);
        writeState(statePath, 'zh', asarPath);
        console.log(`✓ Successfully switched to Chinese! (app.asar updated)`);
        console.log(`  Backup saved at: ${backupPath}`);

        if (options.restart !== false) {
            console.log('Restarting Antigravity...');
            launchAntigravity(appDir);
        }
    } finally {
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
            // Ignore tmp cleanup error
        }
    }
}

function switchToEnglish(options = {}) {
    const { appDir, resourcesDir, asarPath, cleanBackupPath, statePath } = resolveAppPaths(options.appDir);

    if (!fs.existsSync(cleanBackupPath)) {
        // Fall back to a timestamped backup, but only one that is verified to be
        // unpatched. Picking the alphabetically first backup could restore a
        // Chinese build, leaving the user stuck with no way back to English.
        const pristine = findPristineArchive(resourcesDir);
        if (!pristine) {
            throw new Error(
                'No pristine English app.asar was found (app.asar.clean-backup is missing and '
                + 'no unpatched app.asar.bak-* exists). Reinstall or update Antigravity to restore '
                + 'the official build.'
            );
        }
        console.log(`Using verified original backup: ${path.basename(pristine)}`);
        fs.copyFileSync(pristine, cleanBackupPath);
    }

    if (!options.noKill) {
        closeAntigravityOrThrow(options);
    }

    // Create a safety backup of current state
    const stamp = getFormatTimestamp();
    const backupPath = path.join(resourcesDir, `app.asar.bak-before-restore-${stamp}`);
    fs.copyFileSync(asarPath, backupPath);

    console.log('Restoring original clean app.asar...');
    fs.copyFileSync(cleanBackupPath, asarPath);
    writeState(statePath, 'en', asarPath);
    console.log('✓ Successfully switched back to official English version!');

    if (options.restart !== false) {
        console.log('Restarting Antigravity...');
        launchAntigravity(appDir);
    }
}

module.exports = {
    getStatus,
    switchToChinese,
    switchToEnglish,
    // Exported for tests: re-patching must be byte-stable, which is easier to
    // assert directly than by repacking a real archive.
    injectFragment,
    BLOCK_BEGIN,
    BLOCK_END,
    LEGACY_ENGINE_START_MARKERS,
    LEGACY_MENU_START_MARKER,
    UPDATER_ANCHOR
};
