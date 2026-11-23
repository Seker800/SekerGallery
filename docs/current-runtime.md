# 现用运行状态与交接

> 状态：现行 | 核验日期：2026-11-23 18:04（北京时间） | 对应提交：d3568fc9
>
> 本文只记录现用部署事实与接手顺序。完整发布快照、备份哈希和历史恢复过程见
> [2026-10/11 归档](history/releases/2026-11.md)。设计边界见 [architecture](architecture.md)，
> 进程职责见 [process-map](process-map.md)。

## 现用状态

| 项目                              | 当前值                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图库                              | 群晖 SekerDesign（DS1522+，AMD64，8GB），入口 https://yuntai.design:8181/                                                                                                                   |
| 运行源码                          | API `d3568fc9`；web `d3568fc9`；operations／reader `d3568fc9`；desktop 客户端已重打包为 0.1.9（`d3568fc9` 源码）                                                                            |
| API / operations / library-reader | `sekereagle/api:main-d3568fc9`                                                                                                                                                              |
| Web                               | `sekereagle/web:main-d3568fc9`                                                                                                                                                              |
| macOS 桌面客户端                  | `/Applications/SekerGallery.app` 0.1.9（`d3568fc9` 源码，app.asar `73a2d95a…`，已启动并连接线上图库；旧版备份 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app`） |
| Windows 便携客户端（本机）        | `D:\SekerGallery\SekerGallery-0.1.9-windows-x64-portable.exe`，0.1.9（`13b1fbef` 源码；exe `597acca0…`、app.asar `e0fa70c0…`）                                                              |
| 数据库                            | 102 项迁移，待应用 0；本轮新增 `EagleManualTag.systemKey` 与唯一索引，回填“收藏／已编辑”系统标签                                                                                            |
| Mac 业务执行器                    | `.runtime/business-worker/releases/worker-93b5d583`（launchd；不是 Compose `worker`）                                                                                                       |
| 未改动                            | 网关、Postgres、MinIO、计算协调器、中继；不要为排查重启或重建                                                                                                                               |
| 计数                              | MATERIAL / PHOTO / 回收站 / 草稿从运行检查点读取，本文不维护动态百分比                                                                                                                      |

Web 最近覆盖：`main-d3568fc9`（11-23 18:04）→ `main-2405f5ed`（11-20 11:02）→
`cacheopt-67e99d52`（11-18 11:18）。API／operations／reader 本轮一并升到 `main-d3568fc9`。

## 进程入口

| 进程           | 入口                                       | 说明                                    |
| -------------- | ------------------------------------------ | --------------------------------------- |
| API            | `apps/api/src/main.ts`                     | HTTP 认证、查询、受理                   |
| operations     | `apps/api/src/asset-operation-executor.ts` | 批量操作、上传终结、恢复、维护          |
| library-reader | `apps/api/src/library-reader.ts`           | 独立读取宿主，内部端口 3001             |
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
/usr/local/bin/docker inspect --format '{{.State.Status}}' sekereagle-cover-copy-20261023
```

不输出整个 Env 或展开后的 Compose 配置；不读取密码、令牌或私钥。

## 回退与证据

- Web 回退：`sekereagle/web:main-2405f5ed`（再上一版 `cacheopt-67e99d52`）。
- API／operations／reader 回退：`sekereagle/api:main-2405f5ed`（再上一版 `share4k-e57b7ab7`／`refactor-93b5d583`）。
- macOS 客户端回退：`~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app`（app.asar `ca3a6a38…`）；更早的 `SekerGallery-0.1.9-20261118-before-cacheopt.app` 仍在。
- Mac worker 回退：`.runtime/business-worker/releases/worker-b852071b`；plist 备份在
  `.omx/artifacts/release-93b5d583/worker-before.plist`。
- 2026-11-18 11:00 本地清理：删除了 18 个旧 worker release（保留现用 `worker-93b5d583` 与回退
  `worker-b852071b`）及本机 Docker 中全部非回退项目镜像。本地 `sekereagle/web:share4k-e57b7ab7`、
  `sekereagle/web:viewer5d4d0ce0`、`sekereagle/api:share4k-e57b7ab7` 镜像缓存已不存在；生产镜像在群晖
  独立保存不受影响，本地如需对应版本可从 git 提交 `e57b7ab7`／`5d4d0ce0` 经 `deploy/mac` 重新构建。
  `.omx/artifacts` 中未被文档引用的 7 天前产物已删除（1.4 GB），文档引用证据全部保留。
- 最近一致性备份：941,432,321 字节，SHA-256 `356121ce301818ceefc6082a3e907edaf7478831f1d9089b41dd47758d502ae8`（2026-11-23 迁移前，`pg_restore --list` 完整解析）；上一轮 944,962,937 字节 `43b78471…`。
- 证据目录：本次发布见 NAS 私有 `maintenance/main-d3568fc9/`；上一轮见 `maintenance/main-2405f5ed/`。
- 2026-11-23 18:04 群晖发布 `d3568fc9`：API／operations／reader／web 四个应用容器切到 `main-d3568fc9`，应用 1 项迁移 `20261123090000_manual_tag_system_key`；发布前后计数一致（MATERIAL 64,876／PHOTO 58,869、回收站 13,755、草稿 243）；schema 仅新增 `EagleManualTag.systemKey` 列与唯一索引，收藏／已编辑各回填 1 个系统标签；公网首页／readiness 200、匿名 401，线上首页哈希与本地构建一致；无关容器未变，网关复用并 reload；API 成品镜像通过 `test:api-image`（隔离启动、102 条迁移、readiness 200、匿名 401、独立执行器无密钥启动退出 0）。未做登录后的生产浏览器交互；macOS 客户端已重打包并替换为 `/Applications/SekerGallery.app`，安卓 0.9.31 已覆盖安装到小米 25128PNA1C 并正常加载图库。`main-d3568fc9` 还修复了 reader 性能用例在完整集成套件中因查询计划平局翻转的失败，完整套件现仅剩人员排序既有失败。
- 2026-11-20 11:02 群晖发布 `2405f5ed`：API／operations／reader／web 四个应用容器切到 `main-2405f5ed`，应用 1 项索引迁移；发布前后计数一致（MATERIAL 64,850／PHOTO 58,941、回收站 13,424、草稿 239），公网首页／readiness 200、匿名 401，线上首页哈希与本地一致；无关容器未变，网关复用并 reload。
- 2026-11-18 11:30 桌面缓存身份改为 v3（不含连接地址）：当前账号在新命名空间重建，
  旧地址键文件成为一次性孤立缓存；网页与 API 未变。
- 2026-11-18 13:00 本机旧版缓存已清理：删除 3459 个文件、5 个旧命名空间（约 89.8 MiB），
  当前 5.1 MiB v3 缓存完整保留；全局与当前账号占比变为 100% / 0%。缓存不按时间过期，
  只有容量上限、手动清理或库身份/账号/方案变化才会失效。完整回退清单与历史备份见
  [归档](history/releases/2026-11.md) 和 `rollback.json`。
- 2026-11-18 13:25 本机 Windows 便携客户端升级：用 `13b1fbef` 源码原生重建并替换
  `D:\SekerGallery\SekerGallery-0.1.9-windows-x64-portable.exe`（exe `597acca0…`，app.asar
  `e0fa70c0…`）；旧 exe `2fb31110…` 备份在 `D:\SekerGallery\backup\`，`SekerEagleData` 未动。
  实机确认图库正常加载（数万项）、缓存控制台为 10.0 GiB 并含旧缓存清理入口；核验用的调试端口已关闭。

## 最新发布摘要

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
