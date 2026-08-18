/**
 * Injection idempotency tests.
 *
 * Re-running the patch must replace the previously injected block, not stack
 * another copy. This was a real defect: locating the old block by a code
 * identifier left the fragment's leading comment behind, so preload.js grew by
 * 361 bytes and menu.js by 135 bytes on every run.
 */

const assert = require('assert');
const {
    injectFragment,
    BLOCK_BEGIN,
    BLOCK_END,
    LEGACY_ENGINE_START_MARKERS,
    LEGACY_MENU_START_MARKER,
    UPDATER_ANCHOR
} = require('../src/index');

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (err) {
        failures += 1;
        console.error('  FAIL ' + name + ': ' + err.message);
    }
}

const FRAGMENT = [BLOCK_BEGIN, '/** injected doc comment */', 'function translateMenu(menu) { return 1; }', BLOCK_END].join('\n');
const MENU_LEGACY = { startMarkers: [LEGACY_MENU_START_MARKER] };
const ENGINE_LEGACY = { startMarkers: LEGACY_ENGINE_START_MARKERS, endMarker: UPDATER_ANCHOR };

const countBlocks = (s) => s.split(BLOCK_BEGIN).length - 1;

console.log('Patch injection:');

check('a pristine file gets exactly one block', () => {
    const source = 'const electron = 1;\n' + UPDATER_ANCHOR + ' x: 1 };\nmore();\n';
    const out = injectFragment(source, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    assert.strictEqual(countBlocks(out), 1);
    assert.ok(out.indexOf(BLOCK_BEGIN) < out.indexOf(UPDATER_ANCHOR), 'block must precede the anchor');
    assert.ok(out.includes('more();'), 'trailing code must survive');
});

check('re-injecting is byte-identical', () => {
    const source = 'const electron = 1;\n' + UPDATER_ANCHOR + ' x: 1 };\n';
    const once = injectFragment(source, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    const twice = injectFragment(once, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    const thrice = injectFragment(twice, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    assert.strictEqual(twice, once, 'second run differs from the first');
    assert.strictEqual(thrice, once, 'third run differs from the first');
});

check('no anchor: the block is appended once and stays stable', () => {
    const source = 'const only = 1;\n';
    const once = injectFragment(source, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    assert.strictEqual(countBlocks(once), 1);
    assert.strictEqual(injectFragment(once, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR), once);
});

check('a legacy menu block is removed, not left beside the new one', () => {
    const legacy = 'const a = 1;\n\n/**\n * stale comment\n */\nfunction translateMenu(menu) {\n    stale();\n}\n';
    const out = injectFragment(legacy, FRAGMENT, MENU_LEGACY);
    assert.ok(!out.includes('stale()'), 'stale body still present');
    assert.strictEqual(countBlocks(out), 1);
    assert.strictEqual(injectFragment(out, FRAGMENT, MENU_LEGACY), out, 'not idempotent after legacy upgrade');
});

check('a legacy engine block is bounded by the updater anchor', () => {
    const legacy = 'const electron = 1;\n/** stale engine */\nconst zhCNText = new Map([["a", "b"]]);\nfunction installZhCNPatch() { stale(); }\n'
        + UPDATER_ANCHOR + ' x: 1 };\nkeepMe();\n';
    const out = injectFragment(legacy, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    assert.ok(!out.includes('zhCNText'), 'stale engine still present');
    assert.ok(out.includes(UPDATER_ANCHOR), 'updaterAPI was swallowed');
    assert.ok(out.includes('keepMe();'), 'code after the anchor was lost');
    assert.strictEqual(countBlocks(out), 1);
});

check('an already-duplicated file is repaired to a single block', () => {
    const damaged = 'head();\n\n' + FRAGMENT + '\n\n' + FRAGMENT + '\n\ntail();\n';
    const out = injectFragment(damaged, FRAGMENT, MENU_LEGACY);
    assert.strictEqual(countBlocks(out), 1, 'duplicates were not collapsed');
    assert.ok(out.includes('head();') && out.includes('tail();'), 'surrounding code was lost');
    assert.strictEqual(injectFragment(out, FRAGMENT, MENU_LEGACY), out);
});

check('an unterminated sentinel does not truncate the file', () => {
    // A half-written block (interrupted run) must not cause data loss.
    const damaged = 'head();\n' + BLOCK_BEGIN + '\npartial();\n' + UPDATER_ANCHOR + ' x: 1 };\n';
    const out = injectFragment(damaged, FRAGMENT, ENGINE_LEGACY, UPDATER_ANCHOR);
    assert.ok(out.includes('head();'), 'leading code was lost');
    assert.ok(out.includes(UPDATER_ANCHOR), 'anchor was lost');
});

if (failures > 0) {
    console.error('\n' + failures + ' injection check(s) failed.');
    process.exit(1);
}
console.log('\nAll injection checks passed.');
