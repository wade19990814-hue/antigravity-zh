# antigravity-zh

[简体中文](./README.zh-CN.md)

Simplified Chinese localization and one-command language switching for the [Google Antigravity](https://antigravity.google/) desktop app.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen?style=flat-square)

## What it does

antigravity-zh patches the renderer and native menus of the Antigravity desktop app. It keeps an untouched copy of the official `app.asar` so the `en` command can restore the official English files.

The bundled Simplified Chinese locale currently contains 609 static translations, 28 native menu labels, and 13 rules for dynamic text such as `Thought for 5s` and `3 tasks running`.

## Install and use

Requires Node.js 16 or later.

```bash
# Switch to Simplified Chinese
npx antigravity-zh zh

# Restore the official English version
npx antigravity-zh en

# Show language, installation path, and backup status
npx antigravity-zh status
```

To run from source:

```bash
git clone https://github.com/wade19990814-hue/antigravity-zh.git
cd antigravity-zh
npm install
node bin/cli.js zh
```

### Commands and options

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
  --no-kill         Do not stop Antigravity automatically
  --force           Skip the graceful shutdown wait and force-terminate
  -h, --help        Show help
  -v, --version     Show the version
```

## Important notes

**This tool modifies an installed application. Read this section before using it.**

- **Antigravity must be closed.** The tool requests a graceful shutdown and waits up to 20 seconds so the app can save its state. It force-terminates only after the timeout. Save unfinished work first, or close the app yourself and use `--no-kill`.
- **Official updates overwrite the patch.** Run `zh` again after an update. Newly added UI text may not be translated yet.
- **Keep the backup files.** The first run creates `app.asar.clean-backup` in the app's `resources` directory. It is the primary restore source. Deleting it without another pristine backup may require reinstalling Antigravity to recover the official files.
- **Modified files may affect integrity checks and official support.** If the app behaves unexpectedly, run `en` first and check whether the issue remains.
- **Only interface text is translated.** Model responses, source code, terminal output, and your own input are not rewritten.

## Security and privacy

Installing dependencies or using `npx` for the first time makes the normal npm Registry requests. After installation, the CLI runs locally and does not make its own network requests or collect telemetry.

- The injected translator traverses translatable DOM text nodes and reads a small set of accessibility attributes to find UI strings. It does not store, upload, or network-process that content, access `localStorage`, cookies, or IPC channels, or send session content, account information, or API credentials anywhere.
- Monaco, xterm, editable areas, and log areas are explicitly excluded from translation.
- The tool modifies only `app.asar` and the backup/state files it creates beside it. It does not modify the registry, install services, or create startup entries.
- External commands receive paths as argument arrays rather than shell-interpolated strings.

## Contributing

To add or correct a static translation, edit the `text` dictionary in [src/locales/zh-CN.json](./src/locales/zh-CN.json):

```json
"Original Text": "Chinese translation"
```

Run `npm test` before submitting changes. Dynamic text with runtime values needs a rule in the `patterns` array. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

Additional locales can be added as `src/locales/<locale-code>.json` files without changing the JavaScript engine.

## Disclaimer

This is an independent third-party tool and is not affiliated with, authorized by, or endorsed by Google or the Antigravity team. Antigravity is a Google product; its name and trademarks belong to their respective owners.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. You use it at your own risk, including the risks of application failure, data loss, unexpected behavior, loss of official support, or consequences under applicable terms of service. The authors and contributors are not liable for any resulting direct or indirect loss. See [LICENSE](./LICENSE).

Make sure modifying the client is permitted in your environment and does not violate the terms that apply to your use of Antigravity.

## License

[MIT](./LICENSE)
