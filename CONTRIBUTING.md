# 贡献指南 (Contributing Guide)

感谢你关注并愿意为 **antigravity-zh** 贡献力量！无论是修复翻译错漏、补充新版本 UI 词条，还是优化匹配正则与跨平台支持，我们都非常欢迎。

---

## 🛠️ 本地开发与调试流程

1. **Fork 本仓库** 并克隆到本地：
   ```bash
   git clone https://github.com/wade19990814-hue/antigravity-zh.git
   cd antigravity-zh
   ```

2. **语法检查**：
   在提交修改前，运行快速语法验证：
   ```bash
   npm test
   ```

3. **本地测试**：
   在外部终端运行本地 CLI 测试语言切换：
   ```bash
   node bin/cli.js zh
   node bin/cli.js en
   ```

---

## 📝 词条贡献规范

所有渲染层翻译内容集中在 [`src/patches/preload-zhcn.jsfrag`](./src/patches/preload-zhcn.jsfrag) 中：

### 1. 静态词条增补
在 `zhCNText` Map 中添加新的键值对：
```javascript
['English Text', '中文翻译'],
```
* **去首尾空格**：由于 DOM 遍历时会对文本做 `.trim()`，字典中的 Key **请勿带有首尾多余空格**。
* **专业术语保留**：专有名词（如 `skills`、`MCP`、`Monaco` 等）通常保留原词，不建议生硬机翻。

### 2. 带有超链接/拆分 DOM 的长句
如果一个长句中间包含 `<a>` 链接（例如 `Google Chrome`），React 会将其拆分为多个独立的 TextNode。请将前半句和后半句**分别**作为一个独立的 Key 添加到 Map 中。

### 3. 动态参数/正则规则
对于带有时间、数字、邮箱等变量的字符串，请在 `hasTranslation()` 和 `translateString()` 的动态处理区块中扩展对应的正则表达式。

---

## 🚀 提交 Pull Request (PR)

1. 创建你的特性分支：
   ```bash
   git checkout -b feat/add-new-translations
   ```
2. 提交你的修改并推送到远程仓库：
   ```bash
   git commit -m "feat: add translations for scheduled tasks page"
   git push origin feat/add-new-translations
   ```
3. 在 GitHub 上发起 Pull Request，简要说明新增或修正的界面与词条内容。
