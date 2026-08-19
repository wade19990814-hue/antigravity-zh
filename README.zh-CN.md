# antigravity-zh

[English](./README.md)

为 [Google Antigravity](https://antigravity.google/) 桌面端提供开箱即用的简体中文界面，并保留一条命令还原官方英文的退路。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen?style=flat-square)

---

## 核心设计：安全、可靠与无侵入

这个工具在实现上极其克制，所有逻辑均围绕**开箱即用**、**系统安全**与**确定性还原**构建：

- **极致方便（Zero Friction）**：无需克隆仓库或全局安装，`npx` 一行命令自动定位安装路径、平滑处理进程并完成切换。
- **边界清晰（Safe by Design）**：仅对外壳 UI 与原生系统菜单进行文本替换。代码编辑器（Monaco）、终端（xterm）、大模型输入输出流及日志区域被**显式硬隔离**，绝不改写任何代码与开发上下文。
- **纯本地无污染（Zero Telemetry）**：纯本地运行，不发起任何网络请求，无遥测上报，不接触 Session、Cookie、Token 或 API 凭据；不写注册表、不注册后台服务、外部调用严格使用参数数组防 Shell 注入。
- **逐字节无损还原（Byte-Exact Restore）**：首次运行自动固化官方原始备份（`app.asar.clean-backup`）。执行 `en` 命令即可实现与官方安装包逐字节完全一致的还原，不留修改痕迹。

---

## 覆盖范围

Antigravity 桌面端目前主要为英文界面。本工具解包应用的 `app.asar`，向渲染进程注入轻量翻译引擎与语言包，并同步适配原生菜单。

- **静态界面**：覆盖 600+ 条核心界面与设置词条。
- **原生系统菜单**：深度汉化应用顶部及右键原生菜单（28+ 词条）。
- **动态句式规则**：支持含运行时数值的动态文本匹配（如 `Thought for 5s`、`3 tasks running` 等 13+ 组规则）。

---

## 安装与使用

需要 Node.js 16 或更高版本。

### 推荐方式（免安装）

```bash
# 切换为简体中文
npx antigravity-zh zh

# 还原官方原版英文
npx antigravity-zh en

# 查看当前语言、安装路径与备份状态
npx antigravity-zh status
```

### 源码运行方式

```bash
git clone https://github.com/wade19990814-hue/antigravity-zh.git
cd antigravity-zh
npm install
node bin/cli.js zh
```

### 命令与参数

```text
Commands:
  zh                切换为简体中文
  en                还原官方原版英文
  status            查看当前语言、安装路径与备份状态
  locales           列出内置的语言包

Options:
  --app-dir <path>  指定 Antigravity 安装目录（未装在默认路径时使用）
  --locale <code>   指定语言包（默认 zh-CN）
  --no-restart      补丁完成后不自动重启应用
  --no-kill         不主动关闭 Antigravity（需自行先关闭）
  --force           跳过优雅关闭等待，立即强制结束进程
  -h, --help        查看帮助
  -v, --version     查看版本号
```

---

## 重要须知与技术细节

**这是一个修改应用归档文件的工具，请在动手前阅读本节：**

1. **应用关闭与进程保护**：改写 `app.asar` 要求应用处于未运行状态。工具会先请求正常退出并等待最多 20 秒以便应用保存状态，超时才会强制结束。建议先保存未完成的工作，或手动关闭应用后配合 `--no-kill` 运行。
2. **官方更新机制**：Antigravity 官方自动更新会替换 `app.asar`，界面将自动回到官方英文。更新完成后重新执行 `npx antigravity-zh zh` 即可重新应用汉化；本工具不干扰官方自身的升级流程。
3. **备份文件管理**：首次运行会在应用 `resources` 目录下生成 `app.asar.clean-backup`，这是还原英文的基准文件。请勿手动删除该备份。
4. **安全边界与数据隔离**：翻译引擎仅读取当前可见 DOM 节点的文本用于词条匹配，不接触 `localStorage`、Cookie、IPC 通道或本地文件系统。编辑器、终端与模型输出已被严格排除。

---

## 参与贡献

发现未翻译或翻译不当的界面文本，直接在 [`src/locales/zh-CN.json`](./src/locales/zh-CN.json) 的 `text` 字典里修改或新增词条即可：

```json
"Original Text": "中文翻译"
```

- 提交前请运行 `npm test` 校验语言包与测试套件。
- 含运行时数值的动态文本需在 `patterns` 数组中添加规则，规范详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 引擎与语言包解耦，如需添加其他语言，只需新增 `src/locales/<locale-code>.json` 文件，无需改动 JS 核心代码。

---

## 免责声明

本项目是独立的第三方开源工具，与 Google 及 Antigravity 官方团队没有任何关联，未获其授权或背书。Antigravity 是 Google 的产品，相关名称与商标归其所有者所有。

本软件按“原样”（AS IS）提供，不附带任何形式的明示或默示担保。使用者自行承担因使用本工具而产生的一切风险，包括但不限于应用无法启动、数据丢失、功能异常、失去官方技术支持，或违反相关服务条款可能带来的后果。作者与贡献者不对任何直接或间接损失负责。详见 [LICENSE](./LICENSE)。

请在使用前确认修改客户端不违反你所适用的相关使用条款。若你所处的环境不允许修改应用程序，请勿使用本工具。

---

## 许可证

[MIT](./LICENSE)
