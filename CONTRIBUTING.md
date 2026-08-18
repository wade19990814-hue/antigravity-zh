# 贡献指南

欢迎补充词条、修正译法、适配新版本界面，或提交其他语言的语言包。

## 本地开发

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

## 词条规范

所有语言数据集中在 [`src/locales/zh-CN.json`](./src/locales/zh-CN.json) 中，翻译引擎
（[`src/patches/engine.jsfrag`](./src/patches/engine.jsfrag)）不含任何语言相关内容，
因此增补词条通常只需修改 JSON：

语言包的字段含义与约束均记录在 [`src/locales/locale.schema.json`](./src/locales/locale.schema.json)，
支持 JSON Schema 的编辑器会据此提供补全与实时校验。

### 1. 静态词条增补
在 `text` 字段中添加新的键值对：
```json
"English Text": "中文翻译"
```
* **去首尾空格**：由于 DOM 遍历时会对文本做 `.trim()`，字典中的 Key **请勿带有首尾多余空格**。
* **专业术语保留**：专有名词（如 `skills`、`MCP`、`Monaco` 等）通常保留原词，不建议生硬机翻。

### 2. 带有超链接/拆分 DOM 的长句
如果一个长句中间包含 `<a>` 链接（例如 `Google Chrome`），React 会将其拆分为多个独立的 TextNode。请将前半句和后半句**分别**作为一个独立的 Key 添加到 `text` 中。

### 3. 动态参数/正则规则
对于带有时间、数字、邮箱等变量的字符串，在 `patterns` 数组中新增一条规则即可，无需改动引擎代码：

```json
{
  "id": "tasksRunning",
  "pattern": "^(\\d+) tasks? running$",
  "flags": "i",
  "template": "{1} 个任务正在运行",
  "sample": "7 tasks running"
}
```

* `template` 中用 `{1}`、`{2}` 引用正则的捕获组。
* 若某个捕获组需要按值翻译（如时间单位 `s` → `秒`），在 `replace` 中指向 `valueMaps` 里的一张表：
  `"replace": { "2": "durationUnit" }`。
* 若需要在捕获组内部做多次替换（如 `2 days, 3 hours`），使用 `valueRules`。
* `sample` 是必填的自测样例：`npm test` 会验证该规则确实匹配它并产生了变化，
  避免出现"判定可翻译但实际没翻译"的不一致。

---

## 提交 Pull Request

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
