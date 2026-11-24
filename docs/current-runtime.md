# 现用运行状态与交接

> 状态：现行 | 核验日期：2026-11-25 00:15（北京时间） | 对应提交：API `238a228d`、worker／nas-media `176b06e5`（web 仍为 `22b9e92b`；仓库另有未发布 API 提示修正 `feb22236`；Windows 客户端 `9e5420c7`）
>
> 本文只记录现用部署事实与接手顺序。完整发布快照、备份哈希和历史恢复过程见
> [2026-10/11 归档](history/releases/2026-11.md)。设计边界见 [architecture](architecture.md)，
> 进程职责见 [process-map](process-map.md)。

## 现用状态

| 项目                                               | 当前值                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图库                                               | 群晖 SekerDesign（DS1522+，AMD64，8GB），入口 https://yuntai.design:8181/                                                                                                                                                                                      |
| 运行源码                                           | API `238a228d`；web `22b9e92b`；operations／reader／share-renderer `238a228d`；worker／nas-media `176b06e5`；desktop 客户端 0.1.9（macOS `d3568fc9`，Windows 本机 `9e5420c7`）                                                                                 |
| NAS 媒体节点                                       | `sekereagle/worker:main-176b06e5`（Compose `nas-media`；领编辑成片、上传缩略图/预览/海报/探测、颜色、永久删除；并发 1、内存上限 2GB；心跳声明 `dedicatedMediaKinds`）                                                                                          |
| API / operations / library-reader / share-renderer | `sekereagle/api:main-238a228d`（linux/amd64，镜像 ID `aca98ce6…`；同一镜像的独立 HTTP、operations、reader 与分享渲染进程）                                                                                                                                     |
| Web                                                | `sekereagle/web:main-22b9e92b`                                                                                                                                                                                                                                 |
| macOS 桌面客户端                                   | `/Applications/SekerGallery.app` 0.1.9（`d3568fc9` 源码，app.asar `73a2d95a…`，已启动并连接线上图库；旧版备份 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app`）                                                                    |
| Windows 便携客户端（本机）                         | `D:\SekerEagle\SekerGallery-0.1.9-windows-x64-portable.exe`，0.1.9（`9e5420c7` 源码原生构建；exe `e45b2cdc…`、app.asar `da6eb1c1…`；开始菜单 `SekerGallery-0.1.lnk`）                                                                                          |
| 数据库                                             | 107 项迁移，待应用 0；本轮新增上传会话 partSize／私密授权、分享渲染队列表与触发器、人脸确认覆盖索引                                                                                                                                                            |
| Mac 业务执行器                                     | `.runtime/business-worker/releases/worker-22b9e92b`（launchd；worker ID `worker-aaa49c84-085a-426a-82c0-f64c312798fd`；2026-11-24 已同步 schema、重建 Prisma 客户端并更新 `176b06e5` dist；NAS 媒体节点心跳新鲜时让出其声明的任务清单；不是 Compose `worker`） |
| 未改动                                             | 网关容器复用并更新配置；Postgres、MinIO、计算协调器、中继未重启；不要为排查重启或重建                                                                                                                                                                          |
| 计数                                               | MATERIAL / PHOTO / 回收站 / 草稿从运行检查点读取，本文不维护动态百分比                                                                                                                                                                                         |

Web 最近覆盖：`main-22b9e92b`（11-24 17:10）→ `main-d3568fc9`（11-23 18:04）→
`main-2405f5ed`（11-20 11:02）。11-23 的 API／operations／reader 热修为
`main-d3568fc9-hotfix1`；11-24 起四个应用镜像与新增 `share-renderer` 统一到
`main-22b9e92b`。

11-24 22:36 热修：`main-22b9e92b` 是用旧镜像逐个替换 dist 组装的，但漏换
`packages/library-core` 与 `packages/photo-render-core`，缩略图等内容接口因
`assertOwnedObjectKey` 未定义返回 500。现用 `main-238a228d` 整体替换全部运行时 dist，
并加入启动期导出校验与镜像产物哈希门禁；web 与数据库结构未变。切换后素材与照片网格
缩略图均已恢复，照片页由用户刷新确认。详见 [发布归档](history/releases/2026-11.md)。

11-25 00:00 起 RAW/HEIF 编辑成片默认由 NAS 媒体节点执行；00:15 起同一节点
`nas-media` 扩展为领取 `RENDER_EDITED_COPY`、`GENERATE_RENDITIONS`、
`GENERATE_THUMBNAIL`、`GENERATE_PREVIEW`、`PROBE_MEDIA`、`EXTRACT_COLOR_PALETTE`
与 `PURGE_ASSET`，并发 1、内存 2GB；心跳声明 `dedicatedMediaKinds`，Mac worker
在心跳新鲜（60 秒）时让出这些任务，过期后自动兜底。验证：编辑保存 `3fbc36d3`
由 NAS 完成（7.75 秒、峰值约 789MB，Mac 未接手）；重跑缩略图与颜色任务
`fd510b4d`／`23c89cb8` 均由 NAS 一次完成（0.34 秒／1.35 秒，峰值约 246MB），
任务 attempts=1；永久删除 `83cb0a86` 由 NAS 完成（1.77 秒），测试对象与临时 owner
已清理。真实设备上传本轮未实测（测试时手机/平板均已断开），路由由上述重跑任务与
单测覆盖；Mac 兜底同样未做线上实测。

## 进程入口

| 进程           | 入口                                       | 说明                                    |
| -------------- | ------------------------------------------ | --------------------------------------- |
| API            | `apps/api/src/main.ts`                     | HTTP 认证、查询、受理                   |
| operations     | `apps/api/src/asset-operation-executor.ts` | 批量操作、上传终结、恢复、维护          |
| library-reader | `apps/api/src/library-reader.ts`           | 独立读取宿主，内部端口 3001             |
| share-renderer | `apps/api/src/library-share-renderer.ts`   | 分享图按需渲染，独立进程、并发 1        |
| edit-renderer  | `apps/worker/src/main.ts`（受限任务类型）  | NAS Compose 服务，只领编辑成片、并发 1  |
| 业务 worker    | `apps/worker/src/main.ts`                  | Compose `worker` 或 Mac launchd release |
| 计算节点       | `apps/compute-coordinator/main.mjs`        | 节点策略与远程媒体                      |

详细职责、启停和“不负责什么”见 [process-map](process-map.md)。

## 接手顺序

1. 先读 [start-here](start-here.md)、`AGENTS.md` 和 `architecture.md` 的 North star。
2. 用 `git status`、本地／远程提交、NAS `docker inspect` 分别核对代码与运行状态。
3. 通过 SSH 配置 `SekerDesign` 进入群晖；Docker 在 `/usr/local/bin/docker`。
4. 完整 Compose 参数保存在私有 `release-compose.json` 的 `command`；先检查目标与覆盖文件。
5. 只替换实际变化的服务；网页更新不需要重启数据库、MinIO 或独立封面容器。
6. 验收健康、真实页面、任务检查点和错误原因，再更新本页的核验日期与证据。

## 核验命令

```sh
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-api-1
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-web-1
/usr/local/bin/docker inspect --format '{{.Config.Image}} {{.State.Status}}' sekereagle-nas-staging-share-renderer-1
/usr/local/bin/docker inspect --format '{{.State.Status}}' sekereagle-cover-copy-20261023
```

不输出整个 Env 或展开后的 Compose 配置；不读取密码、令牌或私钥。

## 回退与证据

- Web 回退：`sekereagle/web:main-d3568fc9`（再上一版 `main-2405f5ed`）。
- 2026-11-24 22:36 热修回退：四个应用进程可临时切回 `sekereagle/api:main-22b9e92b`（`maintenance/main-238a228d/rollback.json`）；没有数据库变更。但该镜像的共享包产物陈旧，回退会恢复缩略图／上传等 500，仅用于紧急对比。
- edit-renderer 回退：用同一 Compose 链追加 `maintenance/edit-renderer-20261125/edit-renderer.json` 后执行 `rm -f edit-renderer` 或 `stop edit-renderer`；Mac worker 会在心跳过期约 70 秒内自动接管，不需要改配置。Mac worker 程序回退可用 `apps/worker-dist-before-edit-renderer-20261125.tar` 恢复旧 dist 后重启 launchd。
- API／operations／reader 回退：`sekereagle/api:main-d3568fc9-hotfix1`。**一旦 `SHARE_JPEG` 渲染结果存在，不得回退旧 API／operations／reader**：旧 Prisma 客户端不认识该枚举。需要回退时先确认 `LibraryShareRender` 与 `SHARE_JPEG` 行为 0，停止并移除 `share-renderer`，再按 `maintenance/main-22b9e92b/rollback.json` 切回；共享图产生后只能回退网页或向前修复。
- Mac worker 回退：`.runtime/business-worker/releases/worker-93b5d583`；切换前 plist 备份在 `.omx/artifacts/release-22b9e92b/worker-before.plist`。
- 2026-11-24 17:10 发布前一致性备份：939,533,209 字节，SHA-256 `ce92c1b6dafdc8488d11c98efd5fc451a2013b2c8add2555a638b9ac9f5cb7b9`，`pg_restore --list` 完整解析。NAS 证据与镜像、回退清单在 `maintenance/main-22b9e92b/`。
- macOS 客户端回退：`~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app`（app.asar `ca3a6a38…`）；更早的 `SekerGallery-0.1.9-20261118-before-cacheopt.app` 仍在。
- Windows 客户端回退：`D:\SekerEagle\backup\SekerEagle-0.1.9-windows-x64-portable-20261123-before-upgrade.exe`（`597acca0…`）；回退时快捷方式要指回该文件名，`SekerEagleData` 不动。
- 更早 worker 回退：`.runtime/business-worker/releases/worker-b852071b`；plist 备份在
  `.omx/artifacts/release-93b5d583/worker-before.plist`。
- 2026-11-18 11:00 本地清理：删除了 18 个旧 worker release（当时保留 `worker-93b5d583` 与回退
  `worker-b852071b`）及本机 Docker 中全部非回退项目镜像。本地 `sekereagle/web:share4k-e57b7ab7`、
  `sekereagle/web:viewer5d4d0ce0`、`sekereagle/api:share4k-e57b7ab7` 镜像缓存已不存在；生产镜像在群晖
  独立保存不受影响，本地如需对应版本可从 git 提交 `e57b7ab7`／`5d4d0ce0` 经 `deploy/mac` 重新构建。
  `.omx/artifacts` 中未被文档引用的 7 天前产物已删除（1.4 GB），文档引用证据全部保留。
- 上一轮一致性备份：941,432,321 字节，SHA-256 `356121ce301818ceefc6082a3e907edaf7478831f1d9089b41dd47758d502ae8`（2026-11-23 迁移前，`pg_restore --list` 完整解析）。
- 证据目录：本次热修见 NAS 私有 `maintenance/main-238a228d/`；上一轮发布见 `maintenance/main-22b9e92b/`，再上一轮见 `maintenance/main-d3568fc9/`。
- 2026-11-23 18:35 本机 Windows 便携客户端升级：用 `9e5420c7` 源码原生重建为
  `D:\SekerEagle\SekerGallery-0.1.9-windows-x64-portable.exe`（exe `e45b2cdc…`，app.asar
  `da6eb1c1…`），补齐 `13b1fbef` 之后的品牌文案与「拖拽不再限制 100 个原文件」；旧 exe
  `597acca0…` 备份在 `D:\SekerEagle\backup\`，开始菜单快捷方式改为 `SekerGallery-0.1.lnk`，
  `SekerEagleData` 未动。实机确认标题 SekerGallery、素材库 58,914 项正常加载，运行中解包 asar
  哈希与构建一致。注意：从带 `ELECTRON_RUN_AS_NODE=1` 的终端启动会按 Node 立即退出，不是包损坏。
- 2026-11-24 17:21 小米 Pad 7 Ultra（25032RP42C，Android 17）安卓客户端从 0.9.34 覆盖升级到 0.9.37（versionCode 54，APK SHA-256 `81d2877…`，含分享图任务化与缩略图选档统一）：`adb push` + `pm install -r` 成功，启动后账号、设置与图库保留，照片列表正常加载。未在真机手动执行分享、取消与改发原图交互。版本记录见 [安卓客户端](android-client.md)。
- 2026-11-24 17:10 群晖发布 `22b9e92b`：API／operations／reader／web 与新增 `share-renderer` 切到 `main-22b9e92b`，应用 5 项迁移至 107；发布前后计数 MATERIAL 64,976／PHOTO 58,880（合计 123,856）、回收站 13,787、草稿 244 一致；schema 七项检查均由 0 变 1。五个应用容器 healthy、0 重启；公网首页／readiness 200，匿名 assets 与分享任务 401；网关复用并更新“大选择 150 秒、分享结果 120 秒”路由后 `nginx -t`／reload；无关容器 ID 未变。Mac 业务执行器切到 `worker-22b9e92b`（PID 27479，worker ID `worker-01185bc9-4aff-4602-a696-98fce404f500`，767 个程序文件哈希通过）；首次切换因共享 `photo-render-core` 缺少新导出而回退到 `worker-93b5d583`，补齐包后重试成功。未做登录后的生产分享复制交互，也未在 NAS 实测 HEIC/RAW 峰值。
- 2026-11-23 20:55 群晖热修收藏／标签 500：`main-d3568fc9` 是以 `main-2405f5ed` 为基座的增量镜像，只覆盖了 dist、迁移和包产物，没有拷入新 schema、也没有重新生成 Prisma 客户端，导致登录后 GET `/api/eagle|photos/manual-tags` 报 `Unknown field systemKey`（手机小心心「收藏暂时不可用」）。线上以 `main-d3568fc9` 为基座补入 schema 并重跑 `prisma generate`，产出 `sekereagle/api:main-d3568fc9-hotfix1`，只切换 api／operations／library-reader；数据库、迁移、web 与无关容器未动，公网 readiness 200、匿名 401，三个容器内实际标签查询成功。`test:api-image` 已增加登录后标签列表与系统标签创建断言，旧镜像会在该检查处失败、热修镜像通过（NAS 证据见 `maintenance/manualtag-client-hotfix-20261123/`）。详见[热修记录](history/releases/main-production-release-2026-11-23-manualtag-client-hotfix.md)。
- 2026-11-23 18:04 群晖发布 `d3568fc9`：API／operations／reader／web 四个应用容器切到 `main-d3568fc9`，应用 1 项迁移 `20261123090000_manual_tag_system_key`；发布前后计数一致（MATERIAL 64,876／PHOTO 58,869、回收站 13,755、草稿 243）；schema 仅新增 `EagleManualTag.systemKey` 列与唯一索引，收藏／已编辑各回填 1 个系统标签；公网首页／readiness 200、匿名 401，线上首页哈希与本地构建一致；无关容器未变，网关复用并 reload；API 成品镜像通过 `test:api-image`（隔离启动、102 条迁移、readiness 200、匿名 401、独立执行器无密钥启动退出 0）。未做登录后的生产浏览器交互；macOS 客户端已重打包并替换为 `/Applications/SekerGallery.app`，安卓 0.9.34 已安装到小米 Pad 7 Ultra（平板网格使用 512 缩略图、上传改用系统照片选择器），手机 25128PNA1C 仍为 0.9.31、下次连接时更新。`main-d3568fc9` 还修复了 reader 性能用例在完整集成套件中因查询计划平局翻转的失败，完整套件现仅剩人员排序既有失败。
- 2026-11-20 11:02 群晖发布 `2405f5ed`：API／operations／reader／web 四个应用容器切到 `main-2405f5ed`，应用 1 项索引迁移；发布前后计数一致（MATERIAL 64,850／PHOTO 58,941、回收站 13,424、草稿 239），公网首页／readiness 200、匿名 401，线上首页哈希与本地一致；无关容器未变，网关复用并 reload。
- 2026-11-18 11:30 桌面缓存身份改为 v3（不含连接地址）：当前账号在新命名空间重建，
  旧地址键文件成为一次性孤立缓存；网页与 API 未变。
- 2026-11-18 13:00 本机旧版缓存已清理：删除 3459 个文件、5 个旧命名空间（约 89.8 MiB），
  当前 5.1 MiB v3 缓存完整保留；全局与当前账号占比变为 100% / 0%。缓存不按时间过期，
  只有容量上限、手动清理或库身份/账号/方案变化才会失效。完整回退清单与历史备份见
  [归档](history/releases/2026-11.md) 和 `rollback.json`。
- 2026-11-18 13:25 本机 Windows 便携客户端升级：用 `13b1fbef` 源码原生重建并替换
  `D:\SekerEagle\SekerEagle-0.1.9-windows-x64-portable.exe`（exe `597acca0…`，app.asar
  `e0fa70c0…`）；旧 exe `2fb31110…` 备份在 `D:\SekerEagle\backup\`，`SekerEagleData` 未动。
  实机确认图库正常加载（数万项）、缓存控制台为 10.0 GiB 并含旧缓存清理入口；核验用的调试端口已关闭。

## 最新发布摘要

- [2026-11-24 17:10 异步分享渲染与上传/缓存效率发布（22b9e92b）](history/releases/main-production-release-2026-11-24-main-22b9e92b.md)
- [2026-11-23 18:35 本机 Windows 客户端升级到 9e5420c7 原生构建](history/releases/main-production-release-2026-11-23-windows-client-upgrade.md)
- [2026-11-23 18:04 批量选择、标签与回收站交互发布（d3568fc9）](history/releases/main-production-release-2026-11-23-main-d3568fc9.md)
- [2026-11-20 11:02 照片排序与回收站排序发布（2405f5ed）](history/releases/main-production-release-2026-11-20-main-2405f5ed.md)
- [2026-11-18 13:25 本机 Windows 客户端升级到 13b1fbef 原生构建](history/releases/main-production-release-2026-11-18-windows-native-install.md)
- [2026-11-18 13:05 Windows 便携版与 Mac 桌面端对齐](history/releases/main-production-release-2026-11-18-desktop-parity.md)
- [2026-11-18 13:00 清理旧版桌面缓存并锁定缓存键（本机客户端）](history/releases/main-production-release-2026-11-18-cache-legacy-cleanup.md)
- [2026-11-18 11:55 缓存设置页改为仪器面板控制台（本机客户端）](history/releases/main-production-release-2026-11-18-cache-console-ui.md)
- [2026-11-18 11:40 缓存设置页改为卡片仪表盘（本机客户端）](history/releases/main-production-release-2026-11-18-cache-settings-ui.md)
- [2026-11-18 11:30 桌面缓存身份去掉连接地址（本机客户端）](history/releases/main-production-release-2026-11-18-cachekey-e4f45b9d.md)
- [2026-11-18 11:18 桌面切片直读与首屏先显示后校验](history/releases/main-production-release-2026-11-18-cacheopt-67e99d52.md)
- [2026-11-18 10:27 大图查看器顶栏状态与加载进度（仅网页）](history/releases/main-production-release-2026-11-18-viewer5d4d0ce0.md)
- [2026-11-17 17:00 4K 分享复制与预览/原图标记](history/releases/main-production-release-2026-11-17-share4k-e57b7ab7.md)
- [2026-11-17 09:05 缩略图并发与缓存调优（仅网页）](history/releases/main-production-release-2026-11-17-thumbs-e093f6d8.md)
- [2026-11-17 00:00 接手认知成本重构与审查修复](history/releases/main-production-release-2026-11-16-refactor-93b5d583.md)
- [2026-11-16 17:00 上传列表“清除已结束”修复](history/releases/main-production-release-2026-11-16-upload-clearfix.md)
- [2026-11-16 15:44 上传前查重改为流式指纹](history/releases/main-production-release-2026-11-16-upload-streamhash.md)
- [2026-11-16 15:27 上传前查重与上传管理器](history/releases/main-production-release-2026-11-16-upload-manager.md)

## 历史

- [2026-10/11 发布与恢复归档](history/releases/2026-11.md)
- [2026-10-23/24 恢复结构快照](history/releases/2026-10-recovery-state.md)
- 设计边界：[architecture](architecture.md)；验证入口：[testing](testing.md)；新环境启动：[operations-runbook](operations-runbook.md)。
