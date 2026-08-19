# antigravity-zh

[简体中文](./README.zh-CN.md)

One-command Simplified Chinese localization for the [Google Antigravity](https://antigravity.google/) desktop app, with byte-exact restore to the official English version.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen?style=flat-square)

---

## Core Design: Safe, Reliable, and Non-Invasive

antigravity-zh is designed with strict engineering restraint, focusing on **zero friction**, **system safety**, and **deterministic rollback**:

- **Zero Friction**: No repo cloning or global installation required. A single `npx` command automatically discovers the installation path, gracefully manages the application process, and applies the patch.
- **Safe by Design**: Modifies only shell UI and native menu labels. The code editor (Monaco), terminal (xterm), LLM prompt/output streams, and logs are **explicitly isolated**, ensuring zero interference with your code or workspace.
- **Zero Telemetry**: Runs completely offline with no network requests, no telemetry collection, and no access to sessions, cookies, tokens, or API credentials. Does not write to the registry or install background services. Subprocess calls strictly use argument arrays to prevent shell injection.
- **Byte-Exact Restore**: Automatically secures a pristine backup (`app.asar.clean-backup`) on the first run. Running `en` restores the archive with byte-for-byte exactness matching the original official build.

---

## Scope and Coverage

The tool unpacks the application's `app.asar`, injects a lightweight translation runtime alongside the locale dictionary into the renderer process, and adapts native menus.

- **Static Interface**: Covers 600+ core UI, settings, and navigation labels.
- **Native Menus**: Deeply translates application title bar and context menus (28+ labels).
- **Dynamic Rules**: Supports runtime dynamic text interpolation (13+ regex pattern rules for expressions like `Thought for 5s` and `3 tasks running`).

---

## Installation and Usage

Requires Node.js 16 or later.

### Recommended (No Installation)

```bash
# Switch to Simplified Chinese
npx antigravity-zh zh

# Restore the official English version
npx antigravity-zh en

# Check current language, installation path, and backup status
npx antigravity-zh status
```

### Run from Source

```bash
git clone https://github.com/wade19990814-hue/antigravity-zh.git
cd antigravity-zh
npm install
node bin/cli.js zh
```

### Commands and Options

```text
Commands:
  zh                Switch to Simplified Chinese
  en                Restore the official English version
  status            Show language, installation path, and backup status
  locales           List bundled locales

Options:
  --app-dir <path>  Specify the Antigravity installation directory
  --locale <code>   Select a locale (default: zh-CN)
  --no-restart      Do not restart the app after patching
  --no-kill         Do not stop Antigravity automatically (close it manually first)
  --force           Skip the graceful shutdown wait and force-terminate immediately
  -h, --help        Show help
  -v, --version     Show the version
```

---

## Important Notes and Technical Details

**This tool modifies an installed application archive. Please review this section before proceeding:**

1. **Process Management & Graceful Exit**: Modifying `app.asar` requires Antigravity to be closed. The tool requests a graceful exit and waits up to 20 seconds for the app to save its state before force-terminating. Save your work first, or close the app manually and use `--no-kill`.
2. **Official Updates**: Official Antigravity updates will replace `app.asar`, automatically returning the interface to the official English version. Simply run `npx antigravity-zh zh` again to reapply the patch. This tool does not interfere with official auto-update mechanisms.
3. **Backup File Management**: The initial run generates `app.asar.clean-backup` in the `resources` directory, serving as the benchmark for English restoration. Do not delete this file.
4. **Security Boundaries**: The translation runtime only inspects visible DOM text nodes for matching and never accesses `localStorage`, cookies, IPC channels, or sensitive file paths.

---

## Contributing

To add or correct UI translations, edit the `text` dictionary in [`src/locales/zh-CN.json`](./src/locales/zh-CN.json):

```json
"Original Text": "Chinese translation"
```

- Run `npm test` before submitting PRs to validate the locale formatting and test suite.
- Dynamic text with runtime values requires a pattern rule in the `patterns` array (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
- The runtime engine is decoupled from locale dictionaries. Adding another language only requires adding a `src/locales/<locale-code>.json` file without altering the JavaScript core.

---

## Disclaimer

This is an independent third-party open-source project and is not affiliated with, authorized by, or endorsed by Google or the Antigravity team. Antigravity is a Google product; its name and trademarks belong to their respective owners.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. You assume all risks associated with the use of this tool, including but not limited to application failures, data loss, unexpected behavior, loss of official technical support, or consequences under applicable terms of service. The authors and contributors are not liable for any resulting direct or indirect loss. See [LICENSE](./LICENSE).

Ensure that modifying the client is permitted in your environment and does not violate any terms applicable to your use of Antigravity.

---

## License

[MIT](./LICENSE)
