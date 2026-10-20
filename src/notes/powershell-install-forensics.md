---
title: PowerShell 7.6.6 是怎么装上的：一次投递方取证
date: 2026-10-20
summary: MSI 确实来自 GitHub，但下载并运行它的不是人，是 Windows Update 的投递管线。
tags: [windows, powershell, installer]
---

本机 PowerShell **不是 winget 装的，不是 MSIX / 商店版，不是便携版，也不是手动双击装的**。

真实途径是 Windows 11 自带的「应用安装程序」投递管线：

```
Windows Update / Update Orchestrator (MoUpdateOrchestrator)
  ↓  投递 0.6 MB 引导器 EXE
C:\Windows\SoftwareDistribution\Download\Install\PowerShell-7.6.6-win-x64.exe
  ↓  引导器下载 payload（GitHub 官方 MSI，112 MB）
  ↓  调用 Windows Installer 服务（msiserver，SYSTEM 身份，事务化）
C:\Program Files\PowerShell\7\
```

MSI 字节确实来自 GitHub（哈希与官方 `hashes.sha256`、winget manifest 三方一致），但下载并运行它的是 Windows，不是人。所以「我从 GitHub 下载的 MSI」这个记忆在*结果*上正确，在*动作*上不成立。

### 决定性证据

- Update 历史里有一条 `PowerShell v7.6.6 (x64)`，时间与 MsiInstaller 事务结束**同一秒**。
- **`ClientApplicationID = MoUpdateOrchestrator`** —— Windows 11 的 Update Orchestrator 服务。
- `WixBundleOriginalSource` 指向 `C:\Windows\SoftwareDistribution\Download\Install\…`（该目录只有 TrustedInstaller / SYSTEM / Administrators 可写）。
- 官方发布页的 `hashes.sha256` 里，Windows 相关条目**只有 `.msi` 和 `.zip`，零个 `.exe`**——那个 0.6 MB 的 EXE 是 Windows Update 投的，不是 GitHub 资产。

### 可复用的鉴定判据

- **落地路径**：`(Get-Command pwsh).Source` → `Program Files` = 已安装。
- **ARP 判据**：`WindowsInstaller=1` 或卸载串含 `MsiExec` → MSI；指向厂商 exe → EXE / Burn 安装器。
- **缓存指纹**：`Package Cache\{GUID}\` 里有引导器 exe + `state.rsm`。
- **二进制解剖**：PE 里 `.wixburn` 节 / `WixBundle*` 字符串 → WiX Burn 引导器。
- **事件日志**：MsiInstaller 事务的源路径与客户端进程 ID。
- **投递方鉴定**：查 `Microsoft.Update.Session` 历史里的 `ClientApplicationID`——`MoUpdateOrchestrator` = Windows Update 投递，`SoftwareInstaller` = 用户手动双击。

### 升级时踩的坑

- `winget upgrade --id Microsoft.PowerShell` → `No installed package found`（`0x8A15006C`）。`winget list` 能列出它，但任何带查询的 `upgrade` 形式都匹配不上——winget 在这条 Burn 注册的 ARP 条目上有查询匹配缺陷。
- 未提权直接 `msiexec /i` → **Error 1730**「必须以管理员身份删除」→ 1603。
- 提权后 `msiexec /i 7.6.7.msi /qn` → 成功，`status 0`。

升级过程中 MSI 会删掉正在运行的 `pwsh.exe`，把执行它的 shell 一起终止（退出码 `0xC000013A`，`STATUS_CONTROL_C_EXIT`）。**自动化脚本做系统级升级必须预期这一点。**

### 清理幽灵条目

用 Burn 引导器自带的 `/uninstall` 清理——它只卸载自己装过的包，新版 MSI 的 ProductCode 不在它的 manifest 里，互不牵连。清理后 ARP 只剩一条 MSI 记录，`winget upgrade` 报无待升级。

<div class="key">
<p>通用顺序：先确认它是谁装的（ARP 判据）→ 再确认能否关联（Id 形态）→ 再看 manifest（URL / 哈希）→ 最后才看执行与记账。跳步就是在猜。</p>
</div>
