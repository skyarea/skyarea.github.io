---
title: winget 升级为什么失败：三个断点
date: 2026-10-20
summary: winget 的判断全来自 manifest，而 manifest 只看得到系统登记的痕迹。失败永远断在链路的某一环。
tags: [windows, winget]
---

winget 的每一个判断都来自 **manifest**，而 manifest 只能看到系统登记留下的痕迹。所以升级失败不是玄学——它永远断在链路上的某一环。

### winget 认定「已装」时会丢信息

`winget list` 的 Id 列有三种形态：

- **真实 manifest Id**（如 `Ruihu.Apifox`）——源里有对应包，可查更新。
- **`MSIX\…`** ——商店包。
- **`ARP\Machine\X86\NpcapInst`** ——**源里找不到对应包，winget 只能造一个占位 Id**。

第三种是死路：第三方前端拿着这种 Id 去查更新，查不到就是查不到，只能显示成「Local PC」。不是前端笨，是 winget 已经把溯源信息丢了。

还有一个副作用：对无法关联的 ARP 条目，winget 会退化成按显示名去源里模糊匹配，可能把 EXE 装的软件误贴成 `msstore` 标签。

### 升级链路与三个断点

1. 解析请求
2. 拉取 manifest
3. 选择安装器
4. 下载
5. **校验 SHA256** ← 断点 A
6. **执行安装器** ← 断点 B
7. **版本记账** ← 断点 C

#### 断点 A：哈希不匹配

`Installer hash does not match`，退出码 `0x8A150011`。

根因通常是 manifest 的 `InstallerUrl` 用了可变地址（`.../latest/...`）：厂商一发新版本就覆盖同一个 URL，旧 manifest 里记的哈希立即失效。**厂商每发一次版，所有旧 manifest 集体失效。**

判据：URL 里含 `latest` / `stable` / `current` → 几乎必然是「可变 URL 定时炸弹」，不是文件被篡改；含具体版本号 → 才可能是下载损坏或供应链问题。

#### 断点 B：提权被掐死

`The package installation failed because administrator privileges are required`，`0x80073d28`。

两个原因叠加：winget 选了 MSIX 部署路径（manifest 声明了 `elevationRequired`），而命令里带了 `--disable-interactivity` —— **它的语义是「禁用所有交互式提示」，UAC 弹窗也属于交互提示**。于是没提权就去部署 → 权限不足。

修法：去掉 `--disable-interactivity`，让 UAC 能弹出来；对同时有 MSI + MSIX 登记的包，加 `--installer-type wix` 强制走 MSI 路径，让两条 ARP 一起更新。

#### 断点 C：记账脱节

命令返回 `Successfully installed`、退出码 `0`，但 `winget upgrade` 仍提示有更新。

根因：应用自带更新器已经把程序升到新版，但 ARP 的 `DisplayVersion` 还是最初安装器写入的旧值。winget 只看记账比对版本，于是判定仍需升级。**退出码 0 只说明安装器跑完了，没说明账本对上了。**

### 分诊

- 看到 `Installer hash does not match` → 看 `winget show` 里的 `InstallerUrl` 是否含 `latest` → 换官方源，或等 manifest 改用版本化 URL。
- 看到 `0x80073d28` → 看是否需管理员、命令是否含 `--disable-interactivity` → 去掉该参数，必要时加 `--installer-type wix`。
- 装完还提示升级 → 对比 ARP 的 `DisplayVersion` 与实际版本 → 若实际已最新，改用应用自己的更新器或忽略该包。
- `winget list` 里 Id 是 `ARP\…` → 溯源已丢 → 无法靠 winget 精确升级。
- 源里没有新版本 → `winget source update` 后对比源时间戳 → 镜像落后就换官方源。

### 退出码速查

- `0x00000000` 成功
- `0x8A150011` 哈希校验失败
- `0x80073D28` 部署需要管理员权限
- `0x8A15000D` 找不到匹配的包
- `0x8A150014` 包已安装，无需升级

<div class="key">
<p>三条通用原则：manifest 是社区维护的，winget 完全信任它；退出码 0 ≠ 系统账本一致；涉及提权就别用 <code>--disable-interactivity</code>。</p>
</div>
