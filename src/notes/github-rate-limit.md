---
title: GitHub API 配额：让脚本带上 token
date: 2026-10-16
summary: 匿名请求 api.github.com 只有 60 次/小时/IP。带 token，不是等 reset。
tags: [github, windows, powershell]
---

匿名请求 `api.github.com` 是 **60 次/小时/IP**，带 token 是 **5000 次/小时**。共享出口 IP 上那 60 次基本靠不住：这台机器上，什么都没跑的时候配额也常被吃到只剩零头，于是未认证的脚本随机失败 —— 同一行命令，昨天能过今天不过。

返回 403 时先去查配额，别怀疑脚本写错了：

```
gh api rate_limit --jq '.resources.core'
# 带认证：limit 5000

curl.exe -s https://api.github.com/rate_limit
# 匿名：limit 60，remaining 快见底就是被吃完了
```

响应里的 `reset` 是 Unix 秒，等它等于等最多一小时。**正确做法是带上 token，不是等。**

### codegraph：用 CODEGRAPH_VERSION 绕过那一次 API 调用

官方的 `install.ps1` 解析版本的逻辑，上游源码第 100–102 行（已核对）：

```
$version = $env:CODEGRAPH_VERSION
if (-not $version) {
  $version = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest").tag_name
}
```

这一步的 `Invoke-RestMethod` **没有 `-Headers`，整个脚本不带任何认证**，匿名打一次 API，撞墙就撞在第 2 步上。后面第 3 步的下载走 `github.com/…/releases/download/`，那不是 API，不占配额。

解法：先把版本号查出来设进环境变量，让脚本跳过那一次调用。

```
$env:CODEGRAPH_VERSION = gh api `
  repos/colbymchenry/codegraph/releases/latest --jq .tag_name
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex
```

`gh` 已经带好 token，所以查版本这一步没有配额问题。用 `Invoke-RestMethod` 也一样的效果，自己把 token 塞进 header：

```
$token = gh auth token
$env:CODEGRAPH_VERSION = (Invoke-RestMethod `
  "https://api.github.com/repos/colbymchenry/codegraph/releases/latest" `
  -Headers @{Authorization = "token $token"}).tag_name
```

<div class="key">
<p><code>irm | iex</code> 走 <code>raw.githubusercontent.com</code>，不占 API 配额，不需要 token。</p>
<p class="quiet">要 token 的只有<em>查版本号</em>那一下 —— 所以别整个脚本去重试或等配额。</p>
</div>

实测（本机 Windows PowerShell 5.1）：

- 匿名 `Invoke-RestMethod …/releases/latest` → 配额告急时 403；
- 加 `-Headers @{Authorization = "token $token"}` → `v1.6.2`；
- `"token gho_xxx"` 和 `"Bearer gho_xxx"` 两种写法都通，TLS 走 `SystemDefault` 也没问题。

### uv：只认 UV_GITHUB_TOKEN，不认 GITHUB_TOKEN

```
$env:UV_GITHUB_TOKEN = gh auth token
uv self update
```

一次性写法：

```
uv self update --token (gh auth token)
```

`$env:GITHUB_TOKEN` 是没用处的，uv 不读这个变量名。两条实测依据：

- `uv self update --help` 里 `--token` 只声明 `[env: UV_GITHUB_TOKEN=]`；
- 把 `uv.exe` 整个读进内存做字符串匹配：`UV_GITHUB_TOKEN` 出现 1 次，独立的 `GITHUB_TOKEN` 0 次（唯一那次命中就是 `UV_GITHUB_TOKEN` 的子串）。上游 `crates/uv-cli/src/lib.rs` 也是 `#[arg(long, env = EnvVars::UV_GITHUB_TOKEN)]`。

还有一点值得知道：uv 较新版本（本机 0.13.1）**已经不打 `api.github.com` 了**。

```
uv self update -v
DEBUG Using official public self-update path
```

版本号从 `raw.githubusercontent.com/astral-sh/versions/main/v1/uv.ndjson` 或 `releases.astral.sh` 镜像取，都不占 API 配额。所以在 `astral-sh/uv` 这个新版本上 token 只是保险 —— `GITHUB_TOKEN`/`UV_GITHUB_TOKEN` 设与不设，`--dry-run` 输出完全一致。

真正还会打 API 的，是第三方 `uv tool install` / `uvx` 指向某个仓库 GitHub release 的场景 —— 那种时候同样靠 `UV_GITHUB_TOKEN`。

[↑ 回到顶部](#top)
