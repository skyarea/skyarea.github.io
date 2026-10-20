---
title: WiX、Burn、MSI：造、包、跑不是一回事
date: 2026-10-20
summary: WiX 是造安装包的工具链，Burn 是它的引导器，MSI 才是 Windows Installer 真正执行的那张数据库。
tags: [windows, installer, wix]
---

WiX、Burn、MSI 常被当成同一层的三个选项。其实它们是流水线上的三段：**造 / 包 / 跑**。搞清自己在第几格，就知道出了问题该找谁。

### 四层全景

- **制作层**：WiX、Inno Setup、NSIS、Advanced Installer、InstallShield —— 用什么写安装包。
- **产物层**：`.msi`（OLE 复合文档、数据库）、bundle `.exe`（Burn 引导器，PE 里带 `.wixburn` 节）、`.msix` / `.appx`、绿色目录 —— 发出去的是什么。
- **运行时层**：`msiserver` 服务（SYSTEM 身份、事务化）、Burn 引擎、Deployment API、进程自身逻辑 —— 系统拿什么去执行。
- **记账层**：ARP 卸载项注册表、Package Cache、WindowsApps 包注册 —— 系统怎么记账。

**判断「这货是怎么装的」，永远看记账层。**

### Burn 存在的理由

MSI 单独搞不定五件事：

- 前置条件检测（OS 版本、已装组件、磁盘空间）
- 多包编排（主程序 + 运行库 + 驱动 + .NET，还要保证顺序）
- 按需下载（安装器本体几百 KB，真正的包从服务器拉）
- 依赖与提供方（A 提供 X，B 依赖 X，B 要先检测 A 在不在）
- 统一入口（用户只看到一个 setup.exe，一条卸载项）

Burn 把这五件事补上，内层该是 MSI 还是 exe 由作者定。

### 提权模型

Bootstrapper Application（BA，负责画界面、问问题）始终以**普通用户**身份运行；真正改系统的是 Burn 引擎——它把自己复制一份到临时目录，以干净副本提权执行。这样 UI 不需要管理员权限，也避免已提权进程被第三方 DLL 污染。

### 五阶段状态机

1. **Initialize** —— 读内嵌清单、解析命令行、初始化变量与引擎状态。
2. **Detect** —— 探测各包现状，得出 Installed / Absent / Upgrade。
3. **Plan** —— 从已探测状态推导到目标状态，算出 Cache / Execute 动作清单。
4. **Apply** —— Register → Cache → Execute，真正落地所有变更。
5. **Quit** —— 清理临时文件、落定注册状态、判断是否要重启。

Apply 内部三步：

- **Register**：把 bundle 自己在 ARP 注册，并登记依赖关系。
- **Cache**：下载 / 复制所有 payload，校验哈希，落盘到 Package Cache。
- **Execute**：按计划调用各包引擎执行。

### 包类型 → 引擎

- `MsiPackage` → MsiEngine，转调 msiexec
- `MspPackage` → MspEngine，补丁
- `MsuPackage` → MsuEngine，Windows 更新包
- `ExePackage` → ExeEngine，任意 exe（检测与卸载参数要自己给）
- `BundlePackage` → 嵌套另一个 Burn bundle

### 识别手册：看一眼卸载串

- **MSI**：`MsiExec.exe /X{GUID}`；旁证是 `WindowsInstaller=1`。
- **Burn bundle**：`"...\Package Cache\{GUID}\x.exe" /uninstall`；旁证是 PE 里的 `.wixburn` 节和同级的 `state.rsm`。
- **Inno Setup**：`unins000.exe`（同目录有 `unins000.dat`）。
- **NSIS**：`uninstall.exe`。
- **MSIX / APPX**：不进传统 ARP，用 `Get-AppxPackage` 查。
- **便携版**：什么记录都没有。

`/uninstall` 这个开关是 Burn 的签名动作——Inno 用 `unins000.exe`，NSIS 用 `uninstall.exe`，只有 Burn 会给 exe 挂 `/uninstall`。

### winget 的 InstallerType 别被 wix 绕晕

`wix` 和 `burn` 是两个不同的值：

- `wix` = 用 WiX 工具链做的 **MSI**（winget 仍走 `msiexec /i`）
- `burn` = WiX 的**引导器 EXE**（winget 执行 exe 并传静默参数）

winget 靠 PE 资源名自动识别：命中 Inno → `inno`，命中 NSIS → `nullsoft`，识别出 Burn 引擎 → `burn`，是合法 PE 但没框架特征 → 兜底 `portable`。

### 换类型升级会留残影

同一条 Burn 链升级是干净的：Detect 发现旧 bundle 和旧包都在，Plan 算出「卸旧装新」，ARP 只留一条记录。

但用 MSI 覆盖一个 Burn 装的产品时：MSI 部分正常升级，**Burn 自己那条 ARP 记录不会被清掉**（它指向缓存里那个旧版 exe）。于是「应用和功能」里出现两条记录，点旧那条卸载可能把新版也带走。根因是 Burn 的注册归它自己管，外部直接替换了它包着的 MSI，Burn 并不知道该注销自己。
