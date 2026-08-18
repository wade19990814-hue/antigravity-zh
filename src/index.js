const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
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

// Start-of-block markers for an injected engine. The current builder emits
// AG_LOCALE; the zhCNText form is kept so installs patched by earlier versions
// are still recognised and cleanly replaced rather than duplicated.
const ENGINE_START_MARKERS = ['const AG_LOCALE = ', 'const zhCNText = new Map(['];

/**
 * Locate a previously injected translation engine inside preload.js.
 *
 * @param {string} preload
 * @returns {number} Index of the injected block, or -1 when absent.
 */
function findInjectedEngineStart(preload) {
    for (const marker of ENGINE_START_MARKERS) {
        const index = preload.indexOf(marker);
        if (index >= 0) {
            return index;
        }
    }
    return -1;
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function extractAsar(asarPath, destDir) {
    try {
        const asar = require('@electron/asar');
        asar.extractAll(asarPath, destDir);
    } catch {
        execSync(`npx --yes @electron/asar extract "${asarPath}" "${destDir}"`, { stdio: 'inherit' });
    }
}

function packAsar(srcDir, destAsarPath) {
    try {
        const asar = require('@electron/asar');
        asar.createPackageWithOptions(srcDir, destAsarPath, {
            unpackDir: 'node_modules/chrome-devtools-mcp'
        });
    } catch {
        execSync(`npx --yes @electron/asar pack --unpack-dir "node_modules/chrome-devtools-mcp" "${srcDir}" "${destAsarPath}"`, { stdio: 'inherit' });
    }
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

function switchToChinese(options = {}) {
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

        // 2. Patch menu.js (inject menu translations)
        console.log('Injecting menu translations into menu.js...');
        let menu = readUtf8(menuPath);
        if (!menu.includes('translateMenu(menu);')) {
            menu = menu.replace(/(\s*)\/\/\s*Re-apply the menu so the change takes effect\./, '$1translateMenu(menu);\n$1// Re-apply the menu so the change takes effect.');
        }
        if (!menu.includes('function translateMenu(menu)')) {
            menu = menu.trimEnd() + '\n\n' + menuFragment + '\n';
        }
        writeUtf8(menuPath, menu);

        // 3. Patch preload.js (inject DOM translation engine)
        console.log('Injecting DOM translation engine into preload.js...');
        let preload = readUtf8(preloadPath);
        // Replace a previously injected block when present, so re-running the
        // patch (or switching locale) never stacks two translation engines.
        const existingStart = findInjectedEngineStart(preload);
        const updaterStart = preload.indexOf('const updaterAPI = {');

        if (existingStart >= 0 && updaterStart > existingStart) {
            preload = preload.substring(0, existingStart) + preloadFragment + '\n' + preload.substring(updaterStart);
        } else if (updaterStart > 0) {
            preload = preload.substring(0, updaterStart) + preloadFragment + '\n' + preload.substring(updaterStart);
        } else {
            preload = preload + '\n\n' + preloadFragment + '\n';
        }
        writeUtf8(preloadPath, preload);

        // 4. Syntax verification
        console.log('Checking JavaScript syntax...');
        execSync(`node --check "${mainPath}"`);
        execSync(`node --check "${menuPath}"`);
        execSync(`node --check "${preloadPath}"`);

        // 5. Repack asar
        console.log('Packing patched app.asar...');
        packAsar(extractDir, packedPath);

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
    switchToEnglish
};
