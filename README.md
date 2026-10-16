# skyarea.github.io

个人主页，纯静态 HTML/CSS，直接托管在 GitHub Pages（用户站点，无需构建）。

## 改内容

- `index.html` — 文案和链接。
- `style.css` — 顶部 `:root` 是配色和字体变量，深色模式在 `prefers-color-scheme: dark` 块里。

## 本地预览

浏览器直接打开 `index.html`，或：

```
python -m http.server 8080
```

## 上线

push 到 `main` 即可，Pages 已按用户站点仓库识别。
