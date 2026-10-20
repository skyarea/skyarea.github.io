---
title: winget、双击、便携版：差在哪一层
date: 2026-10-20
summary: 三者差别不在装出来的东西，而在谁下载、谁写系统、能不能回滚、谁来记账。winget 不是安装格式，是一层调度。
tags: [windows, winget]
---

同一款软件，三条路走完，系统留下的痕迹完全不同。差别不在「装出来的东西」，而在**谁负责下载、谁负责写系统、能不能回滚、谁来记账**。

### 三条路径

- **winget**：解析 ID → 拉 manifest → 下载并校验 SHA256 → 按类型调用厂商安装器 → 登记版本。**第 4 步之后和双击完全一样**；winget 的价值是前三步，加上「静默、可脚本化、版本可管」。
- **双击 setup.exe / .msi**：EXE 是普通 Win32 程序，自己决定怎么改系统；MSI 走 msiserver（SYSTEM 身份、事务化）。
- **便携版**：解压就完事，不进入系统安装模型。

底层都在写同一套原语：文件落盘位置、注册表、PATH / App Paths、服务 / 驱动 / 计划任务 / 快捷方式。

### winget 是调度层，不是安装引擎

默认源是 `winget-pkgs` 社区仓库，manifest 由社区或厂商提交并审核。执行流水线七步：解析参数 → 请求 manifest → 选安装器与作用域 → 下载并校验哈希 → 注入静默参数 → 调用对应安装栈 → 登记版本以便升级。

manifest 描述错了，winget 不会纠正，只会照做并失败。所以 winget 安装失败时，失败点几乎总在**厂商安装器本身**。

### MSI 与 EXE 的本质区别

- **MSI 是「声明式数据库 + 系统服务执行」**：`msiexec.exe` 触发，实际写入由 SYSTEM 身份的 msiserver 完成；有事务，失败自动回滚；`msiexec /f` 可按文件 / 注册表 / 快捷方式修复。
- **EXE 是「一个自己改系统的普通程序」**：没有回滚，中途失败留半成品；注册表写哪算哪；卸载项只有一条厂商私有脚本。
- **MSIX 走容器**：原子替换、声明式重算，卸载即整体删除。

per-user / per-machine 的分流点由 MSI 属性决定：

- `ALLUSERS=1` → 全机：Program Files、HKLM、系统 PATH
- `ALLUSERS=2` 加 `MSIINSTALLPERUSER=1` → 当前用户：`%LocalAppData%\Programs`、HKCU、用户 PATH

（Windows Installer 会忽略 `MSIINSTALLPERUSER`，除非 `ALLUSERS=2`。）

### 装到哪里：四个落点

- **目录**：`Program Files`、`Program Files (x86)`、`%LocalAppData%\Programs`
- **注册表**：`HKLM\Software`、`HKCU\Software`、`…\CurrentVersion\Uninstall`
- **命令可达**：系统 PATH、用户 PATH、App Paths
- **系统集成**：服务 / 驱动、计划任务、文件关联 / 快捷方式

权限边界：写 `Program Files` / `HKLM` / 系统 PATH 要管理员（触发 UAC）；写 `%LocalAppData%\Programs` / `HKCU` / 用户 PATH 普通用户即可。安装器自身的 `requestedExecutionLevel` 决定它自己要不要提权；MSI 特殊在客户端触发 UAC、真正写盘的是 SYSTEM。

### 装完之后怎么被跑起来

启动链路：触发（快捷方式 / 命令）→ 解析 → 查找可执行文件 → 提权 → 装载 → 建立进程（拿到完整性级别）。

EXE 查找顺序：应用目录 → 当前工作目录 → System32 → System / Windows → PATH。**当前目录排在 PATH 之前**，这是「从下载文件夹双击反而打不开」的根源。

DLL 加载顺序（SafeDllSearchMode 开启）：KnownDLLs → 应用目录 → System32 / System / Windows → 当前目录 → PATH。

MSIX 程序走的是另一套栈：进程在 AppContainer 里跑，文件系统访问重定向到包内 VFS，注册表写入落到 `Registry.dat`，对 `Program Files` / `System32` 的写入被静默忽略。

### 便携版：不是「另一种安装」，是「不安装」

收益：零注册零残留、不要管理员权限、可放 U 盘随身带、多版本并存。

代价：系统完全不知道它存在（无法统一更新、批量管理）、命令行要手动加 PATH、没有文件关联 / 右键菜单 / 服务 / 驱动。

winget 也支持便携包（`InstallerType: portable`），解压后按需建 PATH 别名——更新能力有了，系统集成还是没有。

### 怎么选

- 日常装软件、批量 / 无人值守、要固定版本 → winget
- 没有 winget 包 → 官方 EXE，优先选 MSI 变体而非 setup.exe
- 企业分发、要组策略 / AppLocker → MSI / MSIX
- 临时排查、绿色工具、U 盘携带 → 便携
- 驱动、虚拟化、底层组件 → 官方 EXE
