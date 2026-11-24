# 2026年11月24日 异步分享渲染与上传/缓存效率发布（22b9e92b）

> 状态：历史记录 | 归档日期：2026-11-24 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`22b9e92b6802dae18408fe054ae053daf2f69ce0`（API／operations／library-reader／share-renderer／web 一致；desktop 客户端未变）。
- API／operations／library-reader／share-renderer：`sekereagle/api:main-22b9e92b`（linux/amd64）。
- Web：`sekereagle/web:main-22b9e92b`（linux/amd64）。
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-22b9e92b`（PID 27479，worker ID `worker-01185bc9-4aff-4602-a696-98fce404f500`）。
- 数据库：107 项迁移，待应用 0。本次应用五项：
  - `20261124100000_upload_session_part_size`：上传会话持久化协商的 partSize。
  - `20261124143000_library_share_render`：新增 `SHARE_JPEG` 枚举、`LibraryShareRender` 队列表与 `LibraryShareRendererState` 心跳表。
  - `20261124150000_photo_person_review_asset_covering`：人物确认按素材的覆盖索引。
  - `20261124153000_upload_session_include_private`：上传会话保存私密可见授权。
  - `20261124154000_library_share_render_mode_trigger`：分享渲染表 `library_mode_immutable` 触发器。
- 主要内容：分享复制改为 API 受理、NAS 独立 `share-renderer` 按需渲染永久 `SHARE_JPEG`；上传私密预检按会话授权并在发布去重保持同一作用域；网页列表失效范围收窄、选择页轻量读取、颜色排名缓存与滚动阈值；安卓图库追加分页、暂停续传和后台备份身份修复；worker 源文件缓存、远程媒体流式落盘、金字塔复用校验与上传终结并发补齐。另修复分享渲染进程在就绪文件写出后、信号处理器安装前被停止时 PID 1 忽略 SIGTERM 的竞态。

## 构建与验收

- API 镜像以现用 `sekereagle/api:main-d3568fc9-hotfix1` 为基座，叠加本提交 `apps/api/dist`、`schema.prisma`、107 项迁移与 `packages/media-core/dist`，在镜像内重新生成 Prisma 客户端；label revision 为 `22b9e92b…`。Web 镜像以 `sekereagle/web:main-d3568fc9` 为基座叠加本提交静态产物；镜像内 `index.html` SHA-256 为 `112145e1f25fe1dab64668d7e2d07abcf0bb3a7af941bfae69b73ab3d316cec9`，与本机构建一致。
- 最终 API 成品镜像通过 `npm run test:api-image -- sekereagle/api:main-22b9e92b`：隔离启动、107 项迁移、readiness 200、匿名 401、登录后标签读取、独立 operations 与 share-renderer 无 API secrets 启动并优雅退出 0。
- 完整 `npm run test:library-integration` 通过 0 失败，包含历史升级与全量数据库恢复校验、分享渲染、人物与 worker 队列场景；API 单测 732 项全通过。
- 发布前一致性备份 939,533,209 字节，SHA-256 `ce92c1b6dafdc8488d11c98efd5fc451a2013b2c8add2555a638b9ac9f5cb7b9`，`pg_restore --list` 完整解析。
- 发布前后业务计数一致：MATERIAL 64,976／PHOTO 58,880（合计 123,856）、回收站 13,787、草稿 244。迁移为附加列、表、索引与触发器；schema 七项探针均由 0 变 1。

## 切换与验证

- 先停 operations，应用 5 项迁移；再停 gateway 释放上游连接，停止旧 API／reader／web，启动 API／operations／reader／web／share-renderer。网关容器复用，替换配置后 `nginx -t` 通过并 reload；Postgres、MinIO、计算协调器、中继容器 ID 未变。
- 五个应用容器 healthy、0 重启；公网首页 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 与匿名分享任务 401；切换后五个服务日志无 error／fatal／unhandled。
- 分享渲染进程心跳新鲜；发布窗口内 `LibraryShareRender` 与 `SHARE_JPEG` 均 0，未产生不可回退数据。网关已包含“大选择 150 秒”和“分享结果内容 120 秒”路由。
- Mac 业务执行器首次切换因新 worker 引用 `@sekereagle/photo-render-core/photo-output-format`、旧 release 的包 exports 不含该子路径而失败，自动恢复 `worker-93b5d583`；补齐 `photo-render-core` 的 `package.json` 与全部共享包 dist 后重试成功，767 个程序文件哈希通过，数据库心跳新鲜、`activeJobCount=0`。
- 未做登录后的生产分享复制交互（无生产账号凭据）；未在 NAS 实测 HEIC/RAW 分享渲染的耗时与内存峰值；桌面真实窗口、安卓固定测试图库和真实相机 RAW 分享复制仍未验证。Compose 提示既有孤儿容器 `sekereagle-nas-staging-worker-details-1`，本次未清理。

## 回退

- Web 回退：`sekereagle/web:main-d3568fc9`；API／operations／reader 回退：`sekereagle/api:main-d3568fc9-hotfix1`。
- **产生 `SHARE_JPEG` 渲染结果后不得回退旧 API／operations／reader**：旧 Prisma 客户端不认识该枚举。回退前确认 `LibraryShareRender` 与 `SHARE_JPEG` 行为 0，停止并移除 `share-renderer`，再使用 `maintenance/main-22b9e92b/rollback.json`；共享图产生后只能回退网页或向前修复。
- Mac worker 回退：`.runtime/business-worker/releases/worker-93b5d583`；切换前 plist 备份在 `.omx/artifacts/release-22b9e92b/worker-before.plist`，恢复后重新核对心跳与 worker ID。
- 数据库回退不自动恢复；本次迁移为附加结构，需要恢复时使用 `maintenance/main-22b9e92b/database-before.dump`，并同时回退配套应用镜像。

## 证据

- NAS 私有 `maintenance/main-22b9e92b/`：`active.json`、`images.json`、`rollback.json`、`migration-plan.json`、发布前服务快照、schema 探针、网关配置备份与修订、数据库备份、归档索引及镜像构建上下文。
- 本机私有 `.omx/artifacts/release-22b9e92b/`：`worker-before.plist`、`worker-program.sha256`、`mac-worker-active.json`。
