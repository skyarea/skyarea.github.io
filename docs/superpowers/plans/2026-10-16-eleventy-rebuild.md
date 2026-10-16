# skyarea.github.io Eleventy 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把这个手写 HTML 的 GitHub Pages 仓库改成 "Markdown 笔记 + Eleventy 构建 + GitHub Actions 发布"，使加一篇笔记只需新建一个 `.md` 文件。

**Architecture:** 所有样板（head / 导航 / 页脚 / 骨架）集中在 `src/_includes/layout.html` 一份；导航项与站点文案在 `src/_data/site.yml`；每篇笔记是 `src/notes/<slug>.md`（front matter: title/date/summary/tags）；笔记列表页由 Eleventy collection 自动生成。产物 `_site/` 不提交，由 Actions 构建后发 Pages。**全站零 JavaScript**：动效纯 CSS，"无 JS 也能用"降级成"没有 JS"这条更强也更简单的约束。

**Tech Stack:** Node 24（本机已有）、`@11ty/eleventy@^3.1.7`（唯一依赖，devDependency）、markdown-it（Eleventy 内置，`html: true`）、Nunjucks 模板、GitHub Actions（`actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`）。

**Spec:** `docs/superpowers/specs/2026-10-16-static-site-rebuild-design.md`

## Global Constraints

- 输入目录 `src/`，输出 `_site/`；`_site/` 与 `node_modules/` 必须在 `.gitignore` 内（spec C4）
- 依赖只有一个：`@11ty/eleventy`（devDependencies）。不加载任何 Web 字体，远程的也不加载，仓库里 0 个字体二进制（spec §10.1）
- 产物里不得出现 `fonts.googleapis.com` / `fonts.gstatic.com`
- 内容文件不得出现生成器专有语法；`src/notes/*.md` 必须是标准 CommonMark + YAML front matter（spec A2）
- 正文允许内嵌原生 HTML（提示块 `.key`、锚点）（spec §6.3.1）
- 文案照抄现有 `index.html` 两句介绍，删掉 `<!-- TODO -->` 注释；导航保留 emoji，`site.yml` 里拆成 `icon` + `label`（spec §12-Q3）
- `summary` 一个值同时供列表页摘要、`<meta name="description">`、`og:description`（spec §6.3）
- permalink 用干净 URL：`/notes/<slug>/`；旧扁平 URL 不兼容，只做 `404.html`（spec §9）
- 不设 `category` 字段；分类信息进 `tags`，展示成 `#github` 这样一排标签（spec §12-Q1）
- 动效只用 `transform` / `opacity`，时长 300–600ms，stagger ≤ 6 步，必须给 `prefers-reduced-motion: reduce` 无动画分支（spec §10）
- 深色优先，同时提供 `prefers-color-scheme: light` 分支
- 提交信息用中文，动词开头，说清改了什么
- 本机 git 身份已配好（`skyarea <1051168383@qq.com>`，仓库级），不要再配

## Review Focus

spec 给了愿景但没说这些输入该怎么表现；每条在下面的任务里都有对应断言。

1. **缺字段的笔记**：`tags` 省略，或 front matter 只写必填三项 —— 列表项和详情页不得留下光秃秃的 `·` 分隔符、空标签容器或 `undefined`。
2. **含特殊字符的 `summary`**：摘要里有 `<`、`&`、`"` 时，meta 标签必须正确转义，不得截断 HTML head 或产生多余的可执行属性。
3. **`site.yml` 里内部链接与外部链接混在一起**：`aria-current="page"` 只能落在指向本站当前页的那一条上；`https://github.com/...` 这类外部项永远不带 `aria-current`，且要带 `rel="noopener"`。
4. **同一天发两篇笔记**：排序必须在 date 相等时有稳定次键（title），否则每次构建列表顺序可能漂。
5. **书单条目漏了 `url`**：不得生成 `<a href="">`（点了留在原地、且分享时没有链接）；构建要么跳过它并在 stdout 警告，要么直接失败。

---

### Task 1: Eleventy 脚手架与构建管道

**Files:**
- Create: `package.json`
- Create: `eleventy.config.mjs`
- Create: `.gitignore`
- Create: `src/index.html`（占位，Task 2 填内容）
- Modify: 无

**Interfaces:**
- Consumes: 无
- Produces: `npm run build`（产出 `_site/`）、`npm run dev`（`--serve`，端口 8080）；Eleventy 输入目录 `src/`、输出 `_site/`、`htmlTemplateEngine: nunjucks`（所以 `.html` 里能写 Nunjucks）、`markdownTemplateEngine: nunjucks`（md 里能用 layout）。

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "skyarea.github.io",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "eleventy",
    "dev": "eleventy --serve --port=8080",
    "check": "node tools/check.mjs"
  },
  "devDependencies": {
    "@11ty/eleventy": "^3.1.7"
  }
}
```

- [ ] **Step 2: 装依赖并锁版本**

Run: `npm install`
Expected: 退出码 0，生成 `package-lock.json`，`node_modules/@11ty/eleventy/` 存在。

- [ ] **Step 3: 写 `.gitignore`**

内容：`_site/`、`node_modules/`。`package-lock.json` 不忽略（spec §9：锁版本保证 Actions 构建可复现）。

- [ ] **Step 4: 写 `eleventy.config.mjs`**

关键项（其余按默认）：`dir.input = "src"`、`dir.output = "_site"`、`dir.includes = "_includes"`、`pathPrefix = ""`（用户站点在根路径，spec C1）、`setQuietMode(false)`、`dataDir = "_data"`。`htmlTemplateEngine` 与 `markdownTemplateEngine` 显式设为 `"11ty.nunjucks"`。`setUseGitIgnore(true)`。

- [ ] **Step 5: 写 `src/index.html` 占位**

front matter `layout: layout.html`；layout 还不存在，所以本步先写一个不带 layout 的最小文件：`---\n---` + `<h1>skyarea</h1>`。它的唯一作用是让构建有东西可跑，Task 2 会替换。

- [ ] **Step 6: 验证构建跑通**

Run: `npx eleventy`
Expected: 退出码 0，stdout 报告 `1 writ` / `Copied 0 files`，`_site/index.html` 存在且内容含 `<h1>skyarea</h1>`。

- [ ] **Step 7: 验证产物被忽略**

Run: `git status --porcelain`
Expected: 只列出 `package.json`、`package-lock.json`、`eleventy.config.mjs`、`.gitignore`、`src/`、`docs/`；**不得**出现 `_site/` 或 `node_modules/` 的任何条目。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json eleventy.config.mjs .gitignore src/index.html
git commit -m "加入 Eleventy 构建脚手架，产物目录不入库"
```

---

### Task 2: 单一 layout、站点数据、书单数据

**Files:**
- Create: `src/_includes/layout.html`
- Create: `src/_data/site.yml`
- Create: `src/_data/books.yml`
- Create: `src/books.html`
- Modify: `src/index.html`（去掉 Task 1 占位，接 layout）

**Interfaces:**
- Consumes: Task 1 的 `eleventy.config.mjs`（`_data` 目录、nunjucks 引擎）
- Produces:
  - `site.title` / `site.description` / `site.footer` / `site.nav[]`，每项 `{icon, label, path, external?}`
  - `books[]`，每项 `{title, source, url}`
  - layout 消费的变量：`title`（页面标题）、`pageDesc`（页面描述，喂 meta description + og:description）、`content`（正文）、`page.url`（当前页 URL，用于 `aria-current` 匹配）
  - 页脚文本来自 `site.footer`，全站一份

- [ ] **Step 1: 写 `src/_data/site.yml`**

导航五项，顺序照现有页面：`/`（🏠 主页）、`https://github.com/skyarea`（🐙 GitHub）、`https://github.com/skyarea?tab=repositories`（🛠️ 项目）、`/books/`（📚 书单）、`/notes/`（📝 记录）。后两条 `external: true` 的那两项是 GitHub 链接。`description` 照抄现有 `index.html` 的 `<meta name="description">`。`footer` 用 `© 2026 skyarea`。

- [ ] **Step 2: 写 `src/_data/books.yml`**

现有那一条照搬，三个字段：

```yaml
- title: 你身体里的奥秘
  source: 微信读书
  url: https://weread.qq.com/web/reader/3a732350813abb123g0140b0
```

以后加一本书 = 加三行，不碰 HTML（spec G5）。

- [ ] **Step 3: 写 `src/_includes/layout.html`（失败测试先行）**

先只写这一件事，然后跑 Step 4 确认它坏了：layout 里 head 只出现一次（charset、viewport、title、description、og:title/description/type、favicon、`/assets/style.css`），导航从 `site.nav` 循环生成，页脚从 `site.footer` 生成，正文放 `{{ content | safe }}`。

`aria-current` 规则（Review Focus 3）：内部项比较 `entry.path` 与 `page.url`（`/books/` 与 `/books/foo/` 不同，只有完全相等才算当前页；根路径 `/` 只在 `page.url == "/"` 时高亮）；`external: true` 的项不参与比较，并输出 `rel="noopener"`。导航文本渲染成 `icon + 空格 + label`。

- [ ] **Step 4: 验证 layout 还缺样式资源**

Run: `npx eleventy && ls _site/assets/ 2>&1`
Expected: 构建成功但 `ls` 报 `No such file or directory` —— 证明 `style.css` 尚未进入产物，Step 5 才需要处理。

- [ ] **Step 5: 让 `src/assets/` 进产物**

在 `src/assets/` 建 `style.css`（空文件占位，Task 4 写真正的样式）与 `favicon.svg`（从仓库根 `git mv` 过来）。空 CSS 会被 eleventy 当静态资源复制；若 Eleventy 不复制空文件，则在 `eleventy.config.mjs` 加 `dir.assets`/`addPassthroughCopy` 明确把 `src/assets/**` 复制过去。favicon 的 `href` 在 layout 里写 `/favicon.svg`。

Run: `npx eleventy && grep -c '' _site/assets/style.css && ls _site/favicon.svg`
Expected: 两条命令都退出码 0，`_site/assets/style.css` 与 `_site/favicon.svg` 存在。

- [ ] **Step 6: 重写 `src/index.html`**

front matter：`layout: layout.html`、`title: skyarea`、`pageDesc: site.description`（或直接在模板里回退到 `site.description`）。正文：`<h1>skyarea</h1>` + 照抄的两句介绍（"你好，我是 skyarea。我写软件，会把做出来的东西放到 GitHub 上。" / "这里是我的个人主页，收集我做过的东西。"），**不带** `<!-- TODO -->` 注释。导航由 layout 提供，正文里不要再写 `<nav>`。最近笔记那一块留到 Task 3 接 collection，本步先不写。

- [ ] **Step 7: 写 `src/books.html`**

`permalink: /books/index.html`。正文遍历 `books`，每条输出标题（`<a>` 包 `url`）与 `source`。空列表时不崩、不输出空 `<article>`。

- [ ] **Step 8: 验证单一来源（Review Focus 1 的前半）**

Run: `npx eleventy && grep -o '<nav' _site/index.html _site/books/index.html | sort | uniq -c`
Expected: 每个页面恰好 1 个 `<nav`，总数 2。若某页出现 2，说明正文里又手写了导航 —— 删掉正文里的那份。

- [ ] **Step 9: 验证外部链接不带 aria-current（Review Focus 3）**

Run: `grep -o '<a href="https://github.com[^>]*' _site/index.html`
Expected: 输出的每条 GitHub 链接都含 `rel="noopener"`，且**没有**一条含 `aria-current`。

- [ ] **Step 10: 验证书单渲染**

Run: `grep -o '你身体里的奥秘' _site/books/index.html`
Expected: 命中 1 次；同一文件里 `<a href="">` 出现 0 次（`grep -c '<a href=""' _site/books/index.html || true` → 0）。

- [ ] **Step 11: Commit**

```bash
git add src/_includes/layout.html src/_data/site.yml src/_data/books.yml src/books.html src/index.html src/assets .gitignore
git rm --cached favicon.svg 2>/dev/null; git add -A
git commit -m "全站样板收进单一 layout，导航/页脚/书单改为数据驱动"
```

---

### Task 3: 笔记 collection、markdown 管道、迁移现存笔记

**Files:**
- Create: `eleventy.config.mjs` 修改（注册 `notes` collection + markdownIt 选项）
- Create: `src/notes/notes.json`（目录数据文件）
- Create: `src/notes/github-rate-limit.md`（从现有 HTML 迁移）
- Create: `src/_includes/note-item.html`（列表项局部模板）
- Create: `src/notes.html`
- Modify: `src/index.html`（加"最近 3 篇"）
- Delete: `notes/github-rate-limit.html`（Task 6 统一删旧文件，此处先保留以便对照）

**Interfaces:**
- Consumes: `layout.html` 的 `title` / `pageDesc` / `content`
- Produces:
  - front matter schema：必填 `title`、`date`（ISO `YYYY-MM-DD`）、`summary`；选填 `tags: string[]`
  - collection `notes`：按 `date` 倒序，date 相等按 `title` 正序（Review Focus 4）
  - permalink：`/notes/<fileSlug>/`
  - `note-item.html` 消费一条 note 的对象（`.data.title` / `.data.date` / `.data.summary` / `.data.tags` / `.url`）

- [ ] **Step 1: 注册 `notes` collection（不要用 `tags` 当 collection 名）**

在 `eleventy.config.mjs` 里用 glob 注册，**不要**在目录数据里写 `tag: notes`：`tags` 已被占用为内容分类，写进去会让 "notes" 混进每篇笔记的标签数组并在页面上显示成 `#notes`。

```js
eleventyConfig.addCollection("notes", (collection) =>
  collection.getFilteredByGlob("src/notes/*.md"),
);
```

排序在此处做（倒序 + title 次键），下游模板只遍历，不再排序。

- [ ] **Step 2: 打开 markdown 的原生 HTML**

`setLibrary("markdownIt", { html: true, linkify: true })`（spec §6.3.1：提示块 `.key` 只能靠内嵌 HTML）。不引入语法高亮插件：`<pre>` 的观感由 Task 4 的 CSS 负责（spec §9 构建期、不加依赖；两个依赖都不加更简单）。

- [ ] **Step 3: 写 `src/notes/notes.json`**

```json
{
  "layout": "layout.html",
  "permalink": "/notes/{{ page.fileSlug }}/index.html"
}
```

- [ ] **Step 4: 迁移 `src/notes/github-rate-limit.md`**

front matter 四项照抄 spec §6.3 的例子（`tags: [github, windows, powershell]`）。正文处理规则：

- `<h1 class="title">quota</h1>` 那个带逐字母动画的假标题**不迁移**（spec §6.4：它是抄样板抄出来的残留）
- `<pre><code>…</code></pre>` → ``` 围栏；块内 `<span class="c"># …</span>` 注释着色降级成纯文本注释行
- 提示块 `<div class="key">…</div>` 与其中的 `<p class="quiet">` 原样保留为 HTML
- 保留三个小节标题（`###`），`<strong>`/`<em>`/`<code>` 换成 markdown 写法
- 结尾"回到顶部"改成 `[↑ 回到顶部](#top)`，`id="top"` 由 layout 给正文容器（作者不手写 id）
- 正文里那句 `Windows PowerShell` 不再作为独立字段，由 `tags` 渲染

- [ ] **Step 5: 验证迁移后内容不缺段**

Run: `npx eleventy && node -e "const s=require('fs').readFileSync('_site/notes/github-rate-limit/index.html','utf8');const t=(s.match(/<h3/g)||[]).length;console.log(t)"`
Expected: `2`（现有那篇有 2 个 `<h3>`）。另跑 `grep -c '<pre' _site/notes/github-rate-limit/index.html` → 与原文件 `grep -c '<pre' notes/github-rate-limit.html` 的值相等（原文 7）。

- [ ] **Step 6: 验证零专有语法**

Run: `grep -n '{%\|{{' src/notes/github-rate-limit.md`
Expected: 无输出（退出码 1）。笔记正文必须是纯 CommonMark + 内嵌 HTML。

- [ ] **Step 7: 写 `src/_includes/note-item.html`**

输入一条 collection 项。输出 `<article class="note-item">` + `<h2><a href="{{ url }}">{{ title }}</a></h2>` + `<p class="note-meta"><time datetime="{{date}}">{{date | date}}</time>{% if tags %} · <span class="tags">…#tag…</span>{% endif %}</p>` + `<p class="note-sum">{{ summary }}</p>`。

`tags` 缺失/空数组时，`·` 与 `<span class="tags">` 都不得输出（Review Focus 1）。

- [ ] **Step 8: 写 `src/notes.html`（列表页）**

`permalink: /notes/index.html`，`title: 记录`，`pageDesc` 照抄现有 `notes.html` 的 meta description。正文：一句 lede（照抄"踩过的坑，查到的事实。写下来是为了下次不用再查一遍。"）+ 遍历 `collections.notes` include `note-item.html`。空 collection 时页面仍生成，不抛错。

- [ ] **Step 9: 主页加"最近 3 篇"**

`src/index.html` 里遍历 `collections.notes | limit(3)`，复用 `note-item.html`。这是 spec §13 自报假设（首页 3 篇）。

- [ ] **Step 10: 验证 summary 三处一致（spec §6.3）**

Run: `npx eleventy && grep -o 'content="[^"]*60 次/小时[^"]*"' _site/notes/github-rate-limit/index.html`
Expected: 命中 2 次（`name="description"` 与 `property="og:description"`），且两处字符串完全相同；`/notes/index.html` 里同一段文字也出现一次。三处一致即"只留一份摘要"。

- [ ] **Step 11: 验证 meta 转义（Review Focus 2）**

Run: `node -e "const fs=require('fs');fs.writeFileSync('src/notes/_tmp-escape.md','---\ntitle: T\ndate: 2026-10-17\nsummary: 含 <b>标签</b> 与 \"引号\" 的摘要\n---\n正文\n');" && npx eleventy >/dev/null && grep -o '<meta name="description"[^>]*>' _site/notes/_tmp-escape/index.html`
Expected: 输出的 `content="..."` 里 `<` 变成 `&lt;`、`"` 变成 `&quot;`，且不出现第二个未闭合的 `<meta`。跑完 `git clean -f src/notes/_tmp-escape.md`（或直接 `rm src/notes/_tmp-escape.md`）清掉临时文件。

- [ ] **Step 12: Commit**

```bash
git add eleventy.config.mjs src/notes src/notes.html src/index.html
git commit -m "笔记改为 Markdown + collection 自动生成，迁移现存那篇配额笔记"
```

---

### Task 4: 视觉系统（简洁 / 科技 / 动态）

**Files:**
- Create: `src/assets/style.css`（覆盖 Task 2 的空占位）
- Create: `src/404.md` 或 `src/404.html`
- Modify: 无（layout 的 class 名在本任务定下，layout 如需补 class 一并改）

**Interfaces:**
- Consumes: `layout.html` 产出的 DOM 结构与 class
- Produces:
  - 设计令牌 `:root`：`--bg`、`--ink`、`--ink-dim`、`--panel`、`--panel-ink`、`--accent`（唯一强调色）、`--rule`、`--font-body`（系统无衬线栈）、`--font-mono`（`ui-monospace, "Cascadia Code", Consolas, Menlo, monospace`）、`--measure: 72ch`
  - class 契约（模板必须用这些名字，Task 5 的断言依赖它们）：`.page`、`.site-nav`、`.note-item`、`.note-meta`、`.note-sum`、`.tags`、`.key`、`.quiet`、`.prose`、`.foot`
  - 两个断点：`prefers-color-scheme: light`、`prefers-reduced-motion: reduce`

- [ ] **Step 1: 先写验收断言，确认它现在失败**

Task 5 的 `tools/check.mjs` 里有 CSS 相关断言（只用 transform/opacity、含 reduced-motion 分支、只两个字体栈）。本步先把它们跑起来：

Run: `npx eleventy && npm run check`
Expected: 失败，报 CSS 断言不通过（因为 style.css 是空的）。这条失败是 Step 2 的目标。

- [ ] **Step 2: 写 style.css**

按 spec §10 的可执行条款来。要点，具体色值/字号由实施者定：

- 深色优先写在 `:root`，浅色只覆盖令牌值（`@media (prefers-color-scheme: light)`），不重复布局规则
- `body { font-family: var(--font-body) }`；`code, pre, .note-meta, .tags, h1` 用 `var(--font-mono)`；**全站不出现 `@font-face`，不出现 fonts.googleapis**
- 正文容器 `max-width: var(--measure)`，中文行长控制靠这个而不是靠字号
- 强调色只允许一个（`--accent`），用在其上：链接 hover、当前导航项、标签 `#`、代码块左边框。不得出现第二种彩色
- 背景纹理：一层极淡的网格或水平扫描线（`linear-gradient` 画，不用图片，不加 DOM），亮度控制在正文对比度仍 ≥ 4.5:1
- 入场动画：`.page` 与 `.note-item` 用 `opacity` + `transform: translateY()`，`animation-duration` 在 300–600ms 之间；stagger 用 `--i` 乘以固定步长，最多 6 步
- 不得为动画开 JS（全站零 JS 是 spec §11.6 的最强实现）
- `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }` 之类的一刀切关闭
- `.key`（提示块）与 `.quiet`（弱化短句）两处结构样式重做，沿用 class 名以便迁移内容生效

- [ ] **Step 3: 验证没有第三方字体请求**

Run: `npx eleventy && grep -rn 'googleapis\|gstatic\|@font-face' _site/ src/`
Expected: 无输出（退出码 1）。

- [ ] **Step 4: 验证动效属性范围**

Run: `node -e "const c=require('fs').readFileSync('src/assets/style.css','utf8');const bad=[...c.matchAll(/(?:transition|animation)[^;]*?((?:width|height|top|left|right|bottom|margin|padding|font-size|border-width)[^;,]*)/g)];console.log(bad.map(m=>m[1]).join(' | '))"`
Expected: 输出为空。非空则把该属性换成 `transform`。

- [ ] **Step 5: 验证 reduced-motion 分支存在**

Run: `grep -c 'prefers-reduced-motion' src/assets/style.css`
Expected: ≥ 1。同时 `grep -c 'prefers-color-scheme' src/assets/style.css` ≥ 1。

- [ ] **Step 6: 写 404 页**

`src/404.html`，`permalink: /404.html`，正文两句：说明这个地址下没有东西 + 指向 `/` 和 `/notes/` 的链接。**不要**在正文里写 `<nav>`（layout 给）。

- [ ] **Step 7: 视觉自查**

Run: `npm run dev`
Expected: 起在 8080。人工过四个页面（`/`、`/notes/`、`/notes/github-rate-limit/`、`/books/`），确认：深色下正文可读、浅色下同样可读、缩窄窗口不破版、把系统"减少动态效果"打开后没有动画。这是 spec §11 一次性人工检查（Lighthouse 那条已从 spec 删除）。

- [ ] **Step 8: Commit**

```bash
git add src/assets/style.css src/404.html
git commit -m "新视觉系统：深色优先、双字体栈、纯 CSS 动效与 reduced-motion 分支"
```

---

### Task 5: 验收断言脚本 `tools/check.mjs`

**Files:**
- Create: `tools/check.mjs`
- Modify: 无

**Interfaces:**
- Consumes: 前四个任务的全部产物与 class 契约
- Produces: `npm run check` —— 对 `_site/` 的一组断言，退出码 0/1，失败时打印哪一条、哪个文件。这是 spec §11 的可执行版本，也是 Actions 里的构建后 gate。

- [ ] **Step 1: 写 check.mjs 的断言**

每条一个函数，逐条打印 pass/fail，任一失败退出码 1：

1. `_site/` 存在且 `git status --porcelain` 里没有 `_site/` 或 `node_modules/` 条目（spec §11.3）
2. 产物里任意 `.html` 都不含 `googleapis` / `gstatic` / `@font-face`（spec §11.7）
3. 任意页面里 `<nav` 恰好 1 个；且各页面的导航 HTML 逐字节相同（单一来源的实证：改 `site.yml` 一处，四页同步）
4. 每个页面的 `</head>` 之前只有一份 style 链接，且指向 `/assets/style.css`
5. 任意 `.html` 里 `<script` 出现 0 次（零 JS，spec §11.6 的最强形式）
6. **加笔记不用碰别的文件**（spec §11.2 / A5）：记录当前 `/notes/index.html` 里 `.note-item` 数量 N → 临时写入一篇缺 `tags`、日期与既有笔记同日的探针 `.md` → 重新构建 → 断言列表数量变成 N+1、探针链接存在、列表项里没有光秃秃的 `·` 或空 `<span class="tags">`、且两篇同日的顺序稳定 → 删掉探针文件（`finally` 里必须删，失败也要删）
7. style.css 含 `prefers-reduced-motion` 与 `prefers-color-scheme`，且 transition/animation 里不出现盒模型类属性（Task 4 Step 4/5 的同一断言，收进 CI）
8. 书单页没有 `<a href=""`，且 `books.yml` 每条都渲染出来了（Review Focus 5）
9. 笔记详情页 `<h1>` 恰好 1 个（防止又长出第二个标题）
10. `/notes/github-rate-limit/` 的 `<pre>` 数量与迁移前那份 HTML 相等（内容不丢段的机器版）

- [ ] **Step 2: 验证探针文件不会残留**

Run: `node tools/check.mjs; git status --porcelain | grep -c 'src/notes/' || true`
Expected: 第二个命令输出 `0` —— 断言 6 的 `finally` 清理干净，工作树不因跑检查而变脏。

- [ ] **Step 3: 让全套断言通过**

Run: `npx eleventy && npm run check`
Expected: 全部 pass，退出码 0。有 fail 就回到 owning task 修，不要改断言迁就实现（除了断言里的具体数值确实写错的情况）。

- [ ] **Step 4: 故意制造一次失败，确认脚本有效**

Run: 临时在 `src/index.html` 里手写一个 `<nav>`，然后 `npx eleventy && npm run check`
Expected: 断言 3 失败并报出文件名。改回去再跑，恢复全绿。**这一步不能省**：不验证失败能力的检查等于没有检查。

- [ ] **Step 5: Commit**

```bash
git add tools/check.mjs
git commit -m "用脚本固化验收标准：单一来源、零 JS、零第三方字体、加笔记只碰一个文件"
```

---

### Task 6: Actions 发布管道与收尾清理

**Files:**
- Create: `.github/workflows/deploy.yml`
- Delete: `index.html`、`books.html`、`notes.html`、`notes/github-rate-limit.html`、`style.css`、`.nojekyll`（仓库根的旧手写版）
- Modify: `README.md`（重写）

**Interfaces:**
- Consumes: Task 1 的 `npm run build`、Task 5 的 `npm run check`
- Produces: push 到 `main` 即发布；README 里的"怎么加笔记"操作说明

- [ ] **Step 1: 写 `deploy.yml`**

`on: push: branches: [main]` + `workflow_dispatch`。`permissions: contents: read, pages: write, id-token: write`。步骤：checkout → setup-node（Node 24，`cache: npm`）→ `npm ci` → `npm run build` → `npm run check` → `actions/configure-pages` → `upload-pages-artifact`（`path: _site`）→ `deploy-pages`。`concurrency.group` 用 pages 那条约定写法，避免并发部署互踩。check 失败必须让部署停下来，不能只警告。

- [ ] **Step 2: 本地模拟一次干净构建**

Run: `rm -rf _site node_modules && npm ci && npm run build && npm run check`
Expected: 退出码 0，全绿。这一步证明 Actions 里 `npm ci` 能复现（lockfile 已在 Task 1 提交）。

- [ ] **Step 3: 删掉旧的根目录手写页面**

Run: `git rm -q index.html books.html notes.html style.css .nojekyll && git rm -q -r notes`
Expected: 成功。仓库根此后只有 `src/`、`tools/`、`docs/`、配置文件与 `.github/`。

- [ ] **Step 4: 重跑构建与检查**

Run: `npx eleventy && npm run check`
Expected: 全绿 —— 确认没有任何东西还依赖旧路径（例如 layout 里写死的相对 `style.css`）。

- [ ] **Step 5: 重写 README.md**

按 spec G1/A5：主体是"加一篇笔记"的三步操作（新建 `src/notes/<slug>.md` → 填四项 front matter → commit push），给一段可复制的 front matter 模板；再加"本地预览 `npm install && npm run dev`"、"改了不生效怎么办：`npm run check`"；最后是 spec §8 那两步**只有人能做**的 Settings 操作，写明它是一次性的、以及在哪里点。不要保留旧的"改 `index.html`"说明。

- [ ] **Step 6: 提交文档与代码**

```bash
git add -A
git commit -m "改为 GitHub Actions 构建发布，删除根目录手写页面，README 改成加笔记的操作说明"
```

- [ ] **Step 7: 推分支，开 PR**

Run: `git push -u origin feat/eleventy-rebuild`
Expected: 推上去。PR 里贴 spec 路径 + `npm run check` 的输出。

---

### Task 7: 人工切换 Pages 来源并验证上线

这一步只能由用户完成，脚本无法替代（spec §8）。

- [ ] **Step 1: 用户操作**：Settings → Pages → Build and deployment → Source 选 **GitHub Actions**
- [ ] **Step 2: 用户操作**：Settings → Actions → General → Workflow permissions 确认 **Read and write**（`deploy-pages` 需要，这是 spec §8 之外评审提出的第二个隐藏步骤）
- [ ] **Step 3:** 合并 PR，或在分支上手动 `workflow_dispatch` 跑一次
- [ ] **Step 4:** 确认 Actions 跑绿，`https://skyarea.github.io/` 是新站的形状
- [ ] **Step 5:** 抽查 `/notes/`、`/notes/github-rate-limit/`、`/books/`、`/404.html`（访问一个不存在的地址看兜底页）
- [ ] **Step 6:** 关掉浏览器 JavaScript（DevTools → Settings → Debugger / 或 chrome://settings/content/javascript）再走一遍四个页面，内容与导航完整
- [ ] **Step 7:** 空跑一次"加笔记"流程验证 spec §11.2：随便建一篇 `src/notes/probe.md`，push，看列表自动长出来，然后再删掉

---

## 自检结论（写计划的人自己核对 spec）

- spec §11 的 6 条：1→Task 6/7，2→Task 5 断言 6，3→Task 5 断言 1，4→Task 1 Step 2 + Task 4 Step 7，5→Task 5 断言 7，6→Task 5 断言 5（零 JS 比"JS 可选"更强）
- spec G1..G7 → G1 Task 3，G2 Task 2，G3 Task 3，G4 Task 6，G5 Task 2，G6 Task 4，G7 Task 1
- Review Focus 5 条分别落在 Task 2 Step 9、Task 3 Step 11、Task 2 Step 9、Task 3 Step 1、Task 5 断言 8
- spec §7 的未来项（RSS / tag 页 / 归档 / 搜索）不阻塞本计划：`tags` 已经是数组，collection 已按日期排好，加 tag 页只新增模板文件
