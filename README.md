# skyarea.github.io

个人主页 + 技术记录。笔记写 Markdown，[Eleventy](https://www.11ty.dev/) 构建，push 到 `main` 之后 GitHub Actions 自动发布。

## 加一篇笔记

只需要新建一个文件：`src/notes/<英文短标题>.md`。文件名就是网址（`/notes/<英文短标题>/`）。

开头这段是必填的，抄过去改就行：

```markdown
---
title: 标题，会出现在列表、页面顶部和搜索结果里
date: 2026-10-16
summary: 一两句话。列表页的摘要、搜索结果的描述、分享卡片的文案都用这一句。
tags: [github, windows]
---

正文从这里开始，标准 Markdown。

代码块直接三个反引号围起来。行内代码用单个反引号。
```

然后 commit、push，Actions 会发布。**不用改任何其他文件**——笔记列表、导航、页脚、`<head>` 里的 meta 都是自动生成的。

`tags` 可以省略。`date` 只写 `YYYY-MM-DD`，不要写成带时区的完整时间戳（那种写法下页面显示的日期可能比你写的那天差一天，因为日期是按 UTC 取的）。日期相同的两篇按标题排（按字符码位，不看拼音，也不随系统语言变）。

想改主页介绍、导航项、页脚版权：`src/_data/site.yml`，全站只有这一份。
想加一本书：`src/_data/books.yml`，一本书三行。

## 本地预览

```
npm install
npm run dev
```

打开 http://localhost:8080 。改文件即时生效。

## 改了不生效 / 不确定有没有改坏

```
npm run build
npm run check
```

`npm run check` 是 24 条验收断言（导航是否只有一份、有没有混进 JavaScript、加一篇笔记是否真的只碰一个文件、正文用色的对比度够不够……）。GitHub Actions 里也会跑它，**不通过就不会部署**，所以本地跑绿了再 push。

## 目录结构

```
src/
  index.html              主页
  books.html              书单页
  notes.html              笔记列表（内容自动从 src/notes/ 生成）
  404.html                兜底页
  notes/<slug>.md         一篇笔记一个文件
  _includes/
    layout.html           全站唯一的 <head> + 导航 + 页脚
    note.html             笔记详情页的骨架
    note-item.html        列表里一条笔记的样子
    macros.html           共用的小片段（笔记的日期/标签行）
  _data/
    site.yml              站点名、导航、页脚
    books.yml             书单
  assets/style.css        全部样式：深色为默认，浅色在 media query 里覆盖
```

`_site/` 是构建产物，不入库。

## 首次上线需要人点两下（只做一次）

这两步只能在 GitHub 网页上做，构建脚本代替不了：

1. 仓库 **Settings → Pages → Build and deployment → Source**，选 **GitHub Actions**。
   （默认是 "Deploy from a branch"，不切换的话 Actions 跑完也不会发布。）
2. 仓库 **Settings → Actions → General → Workflow permissions**，选 **Read and write**。

然后 push 到 `main`，在 **Actions** 页面看 `构建并发布到 GitHub Pages` 跑绿，https://skyarea.github.io 就是新内容了。

## 以后想加的东西

tag 页、RSS、按年归档、站内搜索都不在本期。前三个 Eleventy 官方文档有现成配方；笔记的 `tags` 已经是数组、列表已经按日期排好，加这些不用改现在的结构。
