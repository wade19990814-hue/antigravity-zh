const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'locales');
const PATCHES_DIR = path.join(__dirname, 'patches');
const DEFAULT_LOCALE = 'zh-CN';

/**
 * List the locale codes shipped with this package.
 *
 * @returns {string[]}
 */
function listLocales() {
    try {
        return fs.readdirSync(LOCALES_DIR)
            .filter((name) => name.endsWith('.json') && !name.startsWith('locale.schema'))
            .map((name) => name.replace(/\.json$/, ''))
            .sort();
    } catch {
        return [];
    }
}

/**
 * Load and validate a locale definition.
 *
 * @param {string} [code=DEFAULT_LOCALE]
 * @returns {object}
 * @throws {Error} When the locale is missing or structurally invalid.
 */
function loadLocale(code = DEFAULT_LOCALE) {
    const file = path.join(LOCALES_DIR, `${code}.json`);
    if (!fs.existsSync(file)) {
        const available = listLocales().join(', ') || 'none';
        throw new Error(`Unknown locale '${code}'. Available locales: ${available}`);
    }

    let locale;
    try {
        locale = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`Locale '${code}' is not valid JSON: ${err.message}`);
    }

    validateLocale(code, locale);
    return locale;
}

/**
 * Reject malformed locale data before it is injected into the app.
 *
 * A bad regex or a template referencing a missing capture group would only
 * surface as a broken UI after app.asar had already been rewritten, so every
 * pattern is compiled and checked here instead.
 *
 * @param {string} code
 * @param {object} locale
 */
function validateLocale(code, locale) {
    if (!locale || typeof locale !== 'object') {
        throw new Error(`Locale '${code}' must be a JSON object.`);
    }
    if (!locale.text || typeof locale.text !== 'object') {
        throw new Error(`Locale '${code}' is missing a 'text' dictionary.`);
    }
    // The 'language' field becomes <html lang> and the CLI's reported code, so a
    // copy-pasted locale file whose field still names the source language would
    // silently mislabel the app.
    if (locale.language && locale.language !== code) {
        throw new Error(
            `Locale '${code}': 'language' is '${locale.language}' but the file is named '${code}.json'; they must match.`
        );
    }

    const patterns = locale.patterns || [];
    if (!Array.isArray(patterns)) {
        throw new Error(`Locale '${code}': 'patterns' must be an array.`);
    }

    const seen = new Set();
    patterns.forEach((rule, index) => {
        const label = rule && rule.id ? `pattern '${rule.id}'` : `pattern #${index + 1}`;
        if (!rule || typeof rule.pattern !== 'string' || typeof rule.template !== 'string') {
            throw new Error(`Locale '${code}': ${label} needs both 'pattern' and 'template' strings.`);
        }
        if (rule.id) {
            if (seen.has(rule.id)) {
                throw new Error(`Locale '${code}': duplicate pattern id '${rule.id}'.`);
            }
            seen.add(rule.id);
        }

        let compiled;
        try {
            compiled = new RegExp(rule.pattern, rule.flags || '');
        } catch (err) {
            throw new Error(`Locale '${code}': ${label} has an invalid regex: ${err.message}`);
        }

        // A template placeholder beyond the pattern's capture-group count would
        // silently render as an empty string in the UI.
        const groupCount = new RegExp(`${compiled.source}|`).exec('').length - 1;
        for (const match of rule.template.matchAll(/\{(\d+)\}/g)) {
            const index2 = Number(match[1]);
            if (index2 < 1 || index2 > groupCount) {
                throw new Error(
                    `Locale '${code}': ${label} template references {${index2}} but the pattern has ${groupCount} capture group(s).`
                );
            }
        }

        for (const name of Object.values(rule.replace || {})) {
            const known = (locale.valueMaps && name in locale.valueMaps)
                || (locale.valueRules && name in locale.valueRules);
            if (!known) {
                throw new Error(`Locale '${code}': ${label} references unknown value map '${name}'.`);
            }
        }
    });
}

/**
 * Build the preload fragment for a locale by injecting its data into the
 * locale-neutral engine template.
 *
 * @param {object} locale
 * @returns {string}
 */
function buildPreloadFragment(locale) {
    const template = fs.readFileSync(path.join(PATCHES_DIR, 'engine.jsfrag'), 'utf8');
    // The engine reads everything except the menu map, which is applied in the
    // main process rather than the renderer.
    const { menu, ...rendererLocale } = locale;
    return template.replace('LOCALE_DATA_PLACEHOLDER', () => JSON.stringify(rendererLocale));
}

/**
 * Build the native menu fragment for a locale.
 *
 * @param {object} locale
 * @returns {string}
 */
function buildMenuFragment(locale) {
    const template = fs.readFileSync(path.join(PATCHES_DIR, 'menu.jsfrag'), 'utf8');
    return template.replace('MENU_DATA_PLACEHOLDER', () => JSON.stringify(locale.menu || {}));
}

module.exports = {
    DEFAULT_LOCALE,
    LOCALES_DIR,
    buildMenuFragment,
    buildPreloadFragment,
    listLocales,
    loadLocale,
    validateLocale,
};
