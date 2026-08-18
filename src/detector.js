const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

// Name of the state marker written next to app.asar. It records what this tool
// last did, so language detection never has to guess from archive internals.
const STATE_MARKER_NAME = 'antigravity-zh-state.json';

// How long Antigravity is given to close on its own before it is force-killed.
const GRACEFUL_TIMEOUT_MS = 20000;
const GRACEFUL_POLL_INTERVAL_MS = 500;

function getPossibleAppDirs() {
    const platform = os.platform();
    const homedir = os.homedir();
    const dirs = [];

    // 1. Environment variable override
    if (process.env.ANTIGRAVITY_APP_DIR) {
        dirs.push(process.env.ANTIGRAVITY_APP_DIR);
    }

    if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

        dirs.push(
            path.join(localAppData, 'Programs', 'antigravity'),
            path.join(programFiles, 'Antigravity'),
            path.join(programFilesX86, 'Antigravity')
        );
    } else if (platform === 'darwin') {
        dirs.push(
            '/Applications/Antigravity.app/Contents/Resources',
            path.join(homedir, 'Applications', 'Antigravity.app', 'Contents', 'Resources')
        );
    } else {
        // Linux
        dirs.push(
            path.join(homedir, '.local', 'share', 'antigravity'),
            '/opt/antigravity',
            '/usr/lib/antigravity',
            '/usr/share/antigravity',
            path.join(homedir, 'antigravity')
        );
    }

    return dirs;
}

function resolveAppPaths(customAppDir) {
    let appDir = customAppDir;

    if (!appDir) {
        const candidateDirs = getPossibleAppDirs();
        for (const candidate of candidateDirs) {
            if (fs.existsSync(candidate)) {
                // Check if resources/app.asar or app.asar directly exists
                if (fs.existsSync(path.join(candidate, 'resources', 'app.asar')) ||
                    fs.existsSync(path.join(candidate, 'app.asar'))) {
                    appDir = candidate;
                    break;
                }
            }
        }
    }

    if (!appDir || !fs.existsSync(appDir)) {
        throw new Error(
            `Could not locate Antigravity installation. Please specify the path using --app-dir <path> or set ANTIGRAVITY_APP_DIR environment variable.`
        );
    }

    let asarPath = path.join(appDir, 'resources', 'app.asar');
    if (!fs.existsSync(asarPath) && fs.existsSync(path.join(appDir, 'app.asar'))) {
        asarPath = path.join(appDir, 'app.asar');
    }

    const resourcesDir = path.dirname(asarPath);
    const cleanBackupPath = path.join(resourcesDir, 'app.asar.clean-backup');

    return {
        appDir,
        resourcesDir,
        asarPath,
        cleanBackupPath,
        statePath: path.join(resourcesDir, STATE_MARKER_NAME)
    };
}

/**
 * Read the state marker written by a previous run. Returns null when the marker
 * is absent or unreadable, which callers must treat as "unknown", not "English".
 *
 * @param {string} statePath
 * @returns {{ language: string, patchedAt?: string, asarSize?: number, version?: string }|null}
 */
function readState(statePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return parsed && typeof parsed.language === 'string' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Record what language this tool just applied. The asar size is stored so a
 * later run can notice that Antigravity replaced app.asar behind our back
 * (for example after an app update) and fall back to content detection.
 *
 * @param {string} statePath
 * @param {string} language - 'zh' or 'en'
 * @param {string} asarPath
 */
function writeState(statePath, language, asarPath) {
    let asarSize = null;
    try {
        asarSize = fs.statSync(asarPath).size;
    } catch {
        // Size is a best-effort staleness hint only.
    }

    const payload = {
        language,
        patchedAt: new Date().toISOString(),
        asarSize,
        toolVersion: getToolVersion()
    };

    try {
        fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    } catch {
        // A missing marker degrades detection but must never fail the patch.
    }
}

function getToolVersion() {
    try {
        return require('../package.json').version || null;
    } catch {
        return null;
    }
}

/**
 * Report whether any Antigravity process is still running.
 *
 * @returns {boolean}
 */
function isAntigravityRunning() {
    try {
        if (os.platform() === 'win32') {
            const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });
            return /antigravity\.exe/i.test(out);
        }
        // -x matches the executable name only, so this never matches our own
        // command line (which contains the string "antigravity-zh").
        execSync('pgrep -x Antigravity || pgrep -x antigravity', {
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return true;
    } catch {
        return false;
    }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Ask Antigravity to close, then wait for it to exit before escalating.
 *
 * Patching rewrites app.asar in place, so the app genuinely must not be running.
 * But an unconditional force-kill discards unsaved editor state and in-flight
 * agent work, so a graceful request is always attempted first and a forced kill
 * only happens if the app is still alive after GRACEFUL_TIMEOUT_MS.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Skip the graceful phase entirely.
 * @param {number} [options.timeoutMs]
 * @returns {{ wasRunning: boolean, stopped: boolean, forced: boolean }}
 */
function stopAntigravityProcesses(options = {}) {
    const platform = os.platform();
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : GRACEFUL_TIMEOUT_MS;

    if (!isAntigravityRunning()) {
        return { wasRunning: false, stopped: true, forced: false };
    }

    if (!options.force) {
        // Phase 1: request a normal shutdown so the app can persist its state.
        try {
            if (platform === 'win32') {
                // No /F: this posts a close request to the window.
                execSync('taskkill /IM Antigravity.exe', { stdio: 'ignore' });
            } else if (platform === 'darwin') {
                execSync('osascript -e \'quit app "Antigravity"\'', { stdio: 'ignore' });
            } else {
                execSync('pkill -TERM -x Antigravity || pkill -TERM -x antigravity', { stdio: 'ignore' });
            }
        } catch {
            // The app may refuse or have no window; the wait below decides.
        }

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!isAntigravityRunning()) {
                return { wasRunning: true, stopped: true, forced: false };
            }
            sleepSync(GRACEFUL_POLL_INTERVAL_MS);
        }
    }

    // Phase 2: the app ignored the close request, so force it. Without this the
    // in-place app.asar rewrite would fail on a locked file.
    try {
        if (platform === 'win32') {
            execSync('taskkill /F /IM Antigravity.exe /IM language_server.exe', { stdio: 'ignore' });
        } else {
            execSync('pkill -9 -x Antigravity || pkill -9 -x antigravity || true', { stdio: 'ignore' });
            execSync('pkill -9 -x language_server || true', { stdio: 'ignore' });
        }
    } catch {
        // Ignore errors if the process exited between the check and the kill.
    }

    return { wasRunning: true, stopped: !isAntigravityRunning(), forced: true };
}

function launchAntigravity(appDir) {
    const platform = os.platform();
    try {
        if (platform === 'win32') {
            const exePath = path.join(appDir, 'Antigravity.exe');
            if (fs.existsSync(exePath)) {
                const child = spawn(exePath, [], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
            }
        } else if (platform === 'darwin') {
            const appBundle = appDir.includes('.app') ? appDir.substring(0, appDir.indexOf('.app') + 4) : '/Applications/Antigravity.app';
            execSync(`open -a "${appBundle}"`, { stdio: 'ignore' });
        } else {
            // Linux
            const binPath = path.join(appDir, 'antigravity');
            if (fs.existsSync(binPath)) {
                const child = spawn(binPath, [], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
            } else {
                execSync('antigravity &', { stdio: 'ignore' });
            }
        }
    } catch {
        // Ignore launch errors
    }
}

module.exports = {
    getPossibleAppDirs,
    resolveAppPaths,
    stopAntigravityProcesses,
    launchAntigravity,
    isAntigravityRunning,
    readState,
    writeState,
    STATE_MARKER_NAME
};
