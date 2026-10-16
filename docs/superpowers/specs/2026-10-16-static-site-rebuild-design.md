# skyarea.github.io 重构：从手写 HTML 到 Markdown + 构建

日期：2026-10-16
状态：待批准

## 1. 意图与动机

现在这个站是手写 HTML 直接推到 GitHub Pages。加一篇笔记要付的价格是：

- 抄一遍 `<head>`（charset、viewport、title、description、3 个 og 标签、favicon、2 个字体预连接、1 个字体样式表、1 个 style.css）
- 抄一遍页面骨架（`.scope` / `.card` / `.horizon` / `.body` / `.foot`）
- 抄一遍底部 5 条导航
- 手动把 `<pre>` 代码块写成 HTML
- 再去 `notes.html` 手动加一条 `<article class="entry">`，填标题、日期、摘要、链接

现存那篇笔记 155 行，其中约 95 行是抄的。抄写已经在产生实际错误：那篇笔记里残留着一个 `<h1 class="title">quota</h1>`（逐字母入场动画的那个），而真正的文章标题是下面的 `<h2 class="note-title">` —— 两个标题并存，其中一个是抄样板抄出来的垃圾；同一份摘要文字在三个地方各写了一版（`<meta description>`、`og:description`、列表页 `entry-sum`），内容互不相同。

要的效果：**加一篇笔记 = 新建一个 Markdown 文件 + commit + push**，其他文件一个都不碰。内容行数降一半以上，且抄写带来的不一致永久消失。

## 2. 目标

- G1：笔记只写 Markdown（front matter 字段见 §6.3），正文是纯 Markdown，代码块用 ```` ``` ```` 围栏
- G2：head、导航、页脚、页面骨架在全站只存在一份（一个 layout 文件）
- G3：笔记列表页从 `notes/` 目录自动生成，按日期倒序
- G4：发布链路自动化：push 到 `main` → GitHub Actions 构建 → 发 GitHub Pages
- G5：书单从 HTML 变成数据文件，加一本书 = 加一行
- G6：视觉上按"简洁 / 科技 / 动态"重做，不继承现有 CSS
- G7：本地一条命令预览，改动即时可见

## 3. 非目标

- N1：不做评论、访问统计、CMS
- N2：暂不做站内搜索（到 20 篇笔记左右再买）
- N3：暂不做 RSS 和 tag 页；留好接口，见 §7
- N4：不做多语言
- N5：不引入 SPA、路由、水合（hydration）；产物是纯静态 HTML
- N6：不接自定义域名（用户站点仓库原样发布）

## 4. 反目标（做出来了但这些算失败）

- A1：为了"省事"反而多一层需要维护的抽象——以后每次改动都要查框架文档，就是失败
- A2：内容被工具绑架：`src/notes/*.md` 必须是标准 Markdown + 极少量 front matter（字段见 §6.3），任何别的生成器都能直接读走；不出现专有语法
- A3：构建产物里混进依赖或构建脚本
- A4：为了动态效果牺牲可读性与加载速度（首屏不能因为动效变慢或变糊）
- A5：以后加一篇笔记需要我（AI）帮忙改配置或加文件——这条路必须是人自己能独立走完的

## 5. 约束

- C1：部署方式是 GitHub Pages 用户站点（`skyarea.github.io`），仓库名固定，产物必须发布在站点根路径
- C2：机器上有 Node v24.19.0、npm 12.2.0、uv 0.13.1；没有 Python（`py` 不可用）
- C3：用户已批准引入 GitHub Actions 发布，并接受去 Settings → Pages 把来源从 "Deploy from a branch" 切换为 "GitHub Actions"（这一步只能由人操作，见 §8）
- C4：仓库里不提交构建产物；`_site/` 进 `.gitignore`
- C5：内容只有 1 篇笔记 + 1 条书单，迁移成本可忽略，不需要保持旧 URL 兼容（用户明确：只保留内容，其他都可推翻）
- C6：用户写作习惯是"写 Markdown，或把内容贴在聊天框让 AI 落盘"，所以工具间的写作体验差异不重要，构建产物面与样板复制次数才重要

## 6. 方案

### 6.1 选型

**Eleventy（`@11ty/eleventy`，devDependency）**。

选型过程（供追溯）：
- VitePress / MkDocs Material / Astro：默认形状是文档站（左栏目录 + 搜索框），与"个人主页 + 博客记录"的诉求相反；且引入整套 vite 依赖树，以后改一次配色要多读两份 config
- Quartz：价值在于不离开 Obsidian 写作，用户不依赖 Obsidian，绑定成纯成本
- Jekyll：需要 Ruby，且唯一独家好处（不用 Actions）已被 C3 抵消
- Hugo / Zola：单二进制构建极快，是百篇规模的优势；Go/Tera 模板语法最难读
- 自建脚本（`layout.html` + 约 60 行 Node）：与 Eleventy 同一量级，日常写作体验相同；代价是 tag 页、归档、RSS 将来都要从零写
- Eleventy：约定少、输入是 Markdown + 原生 HTML 模板、产出纯静态 HTML、§7 那些后加功能有官方配方

选择 Eleventy 是本设计的判断，不是用户点名。

### 6.2 目录结构

```
src/
  index.html              主页
  books.html              书单页
  notes/
    <slug>.md             每篇笔记一个文件
  notes.html              笔记列表（collection 自动生成）
  about.html              可选，见 §6.5
  _includes/
    layout.html           全站唯一骨架：head + 导航 + 页脚
    note-list.html        单条笔记的列表项
  _data/
    site.yml              站点名、描述、导航项、社交链接、页脚版权
    books.yml             书单
  assets/
    style.css             设计令牌 + 版式 + 动效
    favicon.svg
.eleventy.js              构建配置（输入 src/，输出 _site/）
.github/workflows/deploy.yml
package.json              scripts: build / dev
.gitignore                _site/, node_modules/
```

导航项、站点标题、版权年份都放进 `src/_data/site.yml`。这是全站唯一一份导航。

### 6.3 一篇笔记长什么样

```markdown
---
title: GitHub API 配额：让脚本带上 token
date: 2026-10-16
summary: 匿名请求 api.github.com 只有 60 次/小时/IP。带 token，不是等 reset。
tags: [github, windows, powershell]
---

正文从这里开始，标准 Markdown。

`gh api rate_limit --jq '.resources.core'`
```

- 必填只有 `title` / `date` / `summary`；`tags` 选填，缺了不影响构建
- **不单独设 `category` 字段**（用户定）。现在详情页与列表页那行 `2026-10-16 · Windows PowerShell` 里的 `Windows PowerShell`，归入 `tags`：渲染成 `日期 · #windows #powershell` 这样一排小标签。以后 §7 的 tag 页能直接用同一份数据，不必再改 schema
- 文件名为 kebab-case slug，permalink 走 `/notes/<slug>/`（干净 URL）
- 列表页显示 title / date / summary / tags，全部来自 front matter，不需要在任何地方手动登记
- `summary` 一份文字同时用于列表页摘要、`<meta name="description">` 和 `og:description` 三处。原笔记里那三份互不相同的摘要（meta 版、og 版、列表页三句版）收敛成一份：取最短、最不吸人的那句 og 版——这是我叫的，不是用户选的；用户只选了"归入 tags"

### 6.3.1 Markdown 里的原生 HTML

笔记正文允许内嵌原生 HTML（CommonMark 本身就允许，不是 Eleventy 专有语法，不违反 A2）。理由：提示块（现有的 `.key`）这类结构在标准 Markdown 里没有对应写法，禁掉就等于丢内容。实施时把需要的极少量结构样式（提示块、回到顶部锚点）写进新 CSS，其余靠 Markdown 原生元素。

`回到顶部` 的锚点由 layout 自动生成，作者不在正文里手写 `id`。

### 6.4 现有内容的迁移

| 现在 | 迁移后 |
|---|---|
| `index.html` | `src/index.html`，重写 |
| `books.html` | `src/books.html` + `src/_data/books.yml` |
| `notes.html` | `src/notes.html`（自动生成列表） |
| `notes/github-rate-limit.html` | `src/notes/github-rate-limit.md` |
| `style.css` | 不继承，`src/assets/style.css` 新写；提示块 `.key` 和 `回到顶部` 这两处结构样式重做（§6.3.1） |
| `.nojekyll` | 由 Actions 的 Pages 部署步骤处理，不需要手放 |
| `README.md` | 重写：改成"怎么加笔记"的操作说明 |

正文内容一字不改地搬；只有排版标记换成 Markdown。两处清理：

- 原笔记里手工着色的代码块（`<span class="c"># 注释</span>`）降级为普通围栏代码块，靠 CSS 给代码块统一的观感，不再逐块手工着色
- 残留的 `<h1 class="title">quota</h1>` 不迁移，标题由 front matter 的 `title` 生成一次

### 6.5 主页

一张卡片，三段：一句话介绍、导航链接、最近 3 篇笔记（从 collection 取）。"关于"页面是否要建，留给实施时按主页是否需要收口来判断。

## 7. 以后要加的东西（本设计只保证能加，不在本次做）

- RSS：`feed.njk` + Eleventy 官方文档一篇配方
- tag 页：`tags.njk` + `navigation` 插件（Eleventy 官方）
- 按年归档：`date` collection 分组
- 站内搜索：到笔记数量让人觉得必须时再引入（静态方案如 Pagefind）

以上都不需要改动本次的目录结构或 front matter 约定。

## 8. 需要人动手的一次性步骤

GitHub Actions 只能由人在仓库网页端完成，构建脚本无法替代：

1. Settings → Pages → Source 改成 **GitHub Actions**
2. 首次 push 后确认 Actions 跑绿，站点可访问

本设计把这两步写成 README 的最后一段，不假装它们可以自动完成。

## 9. 实施者已经叫定的（不是用户点的）

- `package-lock.json` **提交进仓库**：不锁版本的话 Actions 每次构建的 Eleventy 小版本可能不同，产物可能漂。
- 依赖只走 npm registry：已在本机核实可达（`npm view @11ty/eleventy` → 3.1.7），所以 §6.1 的备选"自建脚本"不必要。
- permalink 用 `/notes/<slug>/` 干净 URL；旧扁平 URL `notes/github-rate-limit.html` 会失效（C5 允许），同时提供一个 `404.html` 兜底。
- 高亮走构建期，不引入运行时依赖。
- 不建 `about.html`：§11.6 只数四个页面。
- 删除 `.nojekyll`：产物里没有下划线目录，Pages 部署步骤处理。
- 迁移提交是"删除并替换"，但时序按 §8 走，不留 404 空窗。
- CSS 的设计令牌（色值、字号、间距）由实施者定。

## 9.1 仍留给实施者

- 逐字母入场的大标题（现在的 skyarea / read / log 那个效果）留不留、怎么在单一 layout 里传参 —— 属于视觉细节，按 §10 的条款自行取舍
- 提示块、代码块的具体观感

## 10. 视觉方向的可执行条款

用户给的三个词，落成能验收的条款：

- **简洁**：全站最多两种字族（一个正文 + 一个等宽用于代码与元信息）；最多一个强调色；正文最大宽度约 72ch；无装饰性图片
- **科技**：深色优先，同时提供 `prefers-color-scheme: light`；等宽字体（系统栈，见 §10.1）承担标题与元信息；细网格/扫描线一类的背景纹理，但要保证正文对比度不因纹理下降

### 10.1 字体：只用系统字体栈（用户定 a）

**不加载任何 Web 字体**，远程和本地都不加载。仓库里 0 个字体二进制，head 里没有 `preconnect` 和 `fonts.googleapis.com` 那 4 行。两个字体栈：

- 正文：系统无衬线栈，中文落微软雅黑/PingFang/Noto Sans CJK
- 等宽（用于代码、元信息、拉丁标题）：`ui-monospace` / Cascadia Code / Consolas / Menlo / 系统后备

为什么这不是缩水：现有站加载的 Archivo 和 Manrope **本来就没有中文字形覆盖**，中文正文一直是系统字体在渲染，Web 字体只管拉丁字母。去掉远程字体省掉的是 2 次 preconnect + 1 次阻塞渲染的第三方 CSS 请求，而且消除“Google 域名不可达时首屏白等”这个真实风险（A4）。

代价（我认）：不同机器的等宽字体不一样，标题的字宽与气势不完全可控；“科技”感靠色彩、间距、网格纹理、字重与字距来做，不靠某个具体字形。
- **动态**：入场动画（页面级或卡片级，时长控制在 300–600ms，stagger 不超过 6 步）+ 导航与链接的 hover 反馈；一律用 `transform` / `opacity`，不触发 layout 重排；必须包在 `@media (prefers-reduced-motion: reduce)` 里给出无动画分支
- **底线**：无 JS 也要能用。如果某个动效必须靠 JS，那它是增强项，禁用 JS 后页面内容与导航完整可读

## 11. 验收标准

1. 从 `main` push 之后不需要任何手动操作，站点更新
2. 加一篇笔记：只新建 `src/notes/x.md`，列表页自动出现它，导航/head/页脚无需改动
3. `npm run build` 之后 `git status` 干净（产物全部被忽略）
4. `npm run dev` 能在本地起预览并即时反映改动
5. 动效只在 `transform` / `opacity` 上；无 `prefers-reduced-motion` 分支视为不合格
6. 关掉 JavaScript 后，四个页面（主页、列表、笔记详情、书单）内容与导航完整
7. 产物里不存在对第三方字体域的请求；首屏样式只有一个本地 CSS 文件

（原本这里有一条"Lighthouse 不倒退"，已删：仓库里没有历史分数可作基线，"不倒退"无法证伪，且本机没有可用的 Lighthouse 二进制。实施时改为一次性人工检查，不做 CI gate，也不为它加工具链。）

## 12. 用户已裁定的三题

- **Q1**：不设 `category`，归入 `tags`（已写进 §6.3）。`summary` 取哪一份用户未说，我取 og 那句（§6.3）
- **Q2**：(a) 只用系统字体栈，仓库 0 字体文件（已写进 §10.1）
- **Q3**：主页文案照抄现有两句（并删掉那句 `<!-- TODO -->` 注释）；导航 emoji 保留

Q3 衍生的一项是我叫的：`site.yml` 里导航拆成 `icon` + `label` 两个字段（而不是一个 `"🏠 主页"` 字符串），因为内部页需要 `aria-current` 与路径联动，拼好的字符串不好拆。渲染结果与现在视觉上完全一致。

## 13. 本设计的自报假设（用户未逐条确认）

- 首页列最近 3 篇笔记
- 旧扁平 URL 不兼容，只做 `404.html` 兜底
- `tags` 存小写英文（`windows` / `powershell` / `github`），展示时加 `#` 前缀
