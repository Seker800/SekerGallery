# 2026年11月23日本机 Windows 客户端升级到 9e5420c7 原生构建

> 状态：历史记录 | 归档日期：2026-11-23 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围

- 仅本机 Windows 便携客户端（`D:\SekerEagle`）。网页、API、operations／library-reader、数据库、Mac 客户端与 Mac worker 均未改动。
- 源码：HEAD `9e5420c7`（该提交本身是文档提交，桌面代码与 `d3568fc9` 相同）。
- 距上一次本机构建（11-18，`13b1fbef`）之间 `apps/desktop` 有 6 个提交：`7892ec01`／`62d445bd` 品牌文案统一为 SekerGallery、`252dfeef` 桌面拖拽不再限制 100 个原文件、`45ada929` 与 `6a1c47b4`／`f60e10b0` 为 lint／格式清理。
- 版本号仍为 0.1.9：与 11-15、11-17、11-18 三次本机重建一致，新旧包按哈希区分；网页端 `app.getVersion()` 读到的仍是 0.1.9。

## 构建

- Windows 10.0.26200，Electron 43.8.1，electron-builder 26.18.0，`npm run package:win --workspace @sekereagle/desktop`。
- 桌面 `typecheck` 退出 0，`vitest` 33 个文件 / 227 项测试全部通过。
- 产物：`apps/desktop/release/SekerGallery-0.1.9-windows-x64-portable.exe`，102,651,734 字节，SHA-256 `e45b2cdc0eb872e08503bc949ec8493556487e83dd83c279f3aab989df9c0cf3`；`app.asar` 666,365 字节，SHA-256 `da6eb1c1aeec5e5a5672cd30f81dcb7248305bc18e2ebf415d31a0ef8a6b9e85`。
- 文件名随 `productName=SekerGallery`（`7892ec01`）变为 `SekerGallery-…`，不再是旧名 `SekerEagle-0.1.9-windows-x64-portable.exe`；未签名。

## 安装

- 先正常关闭正在运行的旧客户端（主窗口进程优雅退出，解包进程与便携启动器一并结束），`SekerEagleData` 未移动、未删除。
- 旧 exe（102,645,805 字节，SHA-256 `597acca04eecb485ead8a54886119d7ad67336f4e66d490598941fbc6bc2a5b7`，即 11-18 `13b1fbef` 构建）备份为 `D:\SekerEagle\backup\SekerEagle-0.1.9-windows-x64-portable-20261123-before-upgrade.exe`，备份哈希复核一致。
- 新 exe 复制到 `D:\SekerEagle\SekerGallery-0.1.9-windows-x64-portable.exe`，安装后哈希复核 `e45b2cdc…`；`D:\SekerEagle` 下旧文件名已移除，避免误启动旧包。
- 开始菜单快捷方式 `SekerEagle-0.1.lnk` 改为 `SekerGallery-0.1.lnk`，目标、工作目录（`D:\SekerEagle`）与图标指向新 exe。
- 顺带修正：`current-runtime.md` 之前把本机路径写成 `D:\SekerGallery\SekerGallery-0.1.9-…`，与实际（`D:\SekerEagle`、旧 exe 名 `SekerEagle-…`）不符，本次按实际更正。

## 验证

- 启动后窗口标题为 `SekerGallery`；进程组为 `SekerGallery`（5 个）加便携启动器 `SekerGallery-0.1.9-windows-x64-portable`。
- 素材库正常加载并渲染 58,914 项（左侧「全部」计数），素材／照片双模式标签可见，缩略图与智能文件夹均显示。
- 运行中的解包目录 `resources\app.asar` SHA-256 与构建产物一致（`da6eb1c1…`），确认进程加载的是新构建，而不是残留旧包。
- 解包 `app.asar` 内 `package.json` 为 `@sekereagle/desktop` 0.1.9、`main=dist/main.cjs`；运行目录仍是 `D:\SekerEagle\SekerEagleData`（`Profile` 于 18:27 更新），登录态与缓存沿用。
- 证据：`.omx/artifacts/windows-client-upgrade-20261123/client-after-upgrade.png`（启动后窗口截图）。

## 排障记录

- 从带有 `ELECTRON_RUN_AS_NODE=1` 的终端（本会话的 DSH shell 即如此）启动任一构建，Electron 会按 Node 运行并立即退出：`--enable-logging` 报 `bad option`，无参数时在 `main.cjs` 的 `protocol.registerSchemesAsPrivileged` 处抛 `Cannot read properties of undefined`。这不是构建损坏，清除该变量或从快捷方式启动即可。该坑 11-15 已记录一次，本次仍复现，判定时先查环境变量再怀疑包。

## 未验证项

- 未做 Authenticode 签名与干净机安装／升级回滚演练；公网分发仍需签名与干净机验收。
- 未逐项人工复核 6 个桌面提交的全部行为；「拖拽不再限制 100 个原文件」只确认了源码与单测（`original-drag-export` 16 项通过），未在实机拖 100+ 原件。
- 客户端版本号只在 asar 内核对为 0.1.9，未打开设置页肉眼核对版本文案。

## 回退

- 关闭客户端，运行或复制回 `D:\SekerEagle\backup\SekerEagle-0.1.9-windows-x64-portable-20261123-before-upgrade.exe`（`597acca0…`）；`SekerEagleData` 保持不动。
- 回退后快捷方式需指回该文件名（或临时用备份 exe 直接启动），否则开始菜单项仍指向已删除的新文件。
