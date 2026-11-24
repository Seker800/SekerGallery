# 大图复制与分享版

状态：现行；核验日期：2026-11-24；对应提交：22b9e92b。

素材和照片共用同一个复制/分享入口。普通查看器、照片组预览、查重比较和右键菜单都请求服务端生成的分享版，不再直接复制 1600px 浏览预览；向量工作台的大图查看器只持有预览地址、没有完整素材对象，仍保留旧的预览复制，不在本功能范围内。

## 交互流程

1. 用户点击复制或分享后，客户端创建或复用一个分享渲染任务，立即返回；等待超过约 1 秒才显示状态条，普通 JPEG 或缓存命中不闪状态条。
2. 渲染在 NAS 上的独立 `share-renderer` 进程执行，API 只受理和读取状态，不解码整份原图。
3. 状态条显示真实阶段：排队中 → 正在读取原图 → 解码 HEIC/RAW（仅这两种格式出现）→ 压缩 4K → 完成；外部解码没有百分比，不画假进度条。状态条同时显示已用秒数和取消。
4. 完成后写剪贴板或打开系统分享。失败说明原因并可重试；分享失败保留“改发原图”；图已生成但写剪贴板失败可“重试复制”。
5. 同一素材、同一媒体版本、同一规格只渲染一次；结果是永久的分享版衍生图，第二次复制直接命中。

网页浏览器只在点击手势内创建 `ClipboardItem` promise，等结果返回后兑现；如果浏览器不接受长时间等待，界面改为“分享图已准备好，点击复制”，第二次点击在已预取和转换好的图片上完成。网页系统分享同样在准备好后由用户点击“分享”；桌面和安卓准备好后自动完成。

## 接口

素材和照片共用（`PhotosController extends EagleController`）：

| 接口                                                                       | 作用                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `POST /api/{eagle\|photos}/assets/:assetId/share-renders`                  | 创建或复用任务；命中永久分享版时直接返回 READY              |
| `GET /api/{eagle\|photos}/assets/:assetId/share-renders/:renderId`         | 状态、阶段、已用时间、结果地址、稳定错误码                  |
| `DELETE /api/{eagle\|photos}/assets/:assetId/share-renders/:renderId`      | 取消；PENDING 直接终止，PROCESSING 通知渲染进程终止外部解码 |
| `GET /api/{eagle\|photos}/assets/:assetId/renditions/:renditionId/content` | 下载永久分享版 JPEG（复用现有 rendition 内容接口）          |

旧 `GET .../share-image` 同步接口已退役；客户端、OpenAPI 和安卓路径同步切换，不做旧客户端兼容。

## 永久分享版

复用 `EagleAssetRendition`，新增 `SHARE_JPEG` 类型：

- `kind = SHARE_JPEG`，`revision = asset.mediaRevision`，`variant = share-v1:edge=…:bytes=…:min=…`。
- 只有用户点复制/分享或打开安卓高清详情时才按需生成，不会给全库预生成；安卓详情与复制/分享共用同一 revision/spec 的永久结果。
- 长边最多 4096px（不放大小图）；输出 JPEG，质量从 90 起；体积上限 15MB，超限先按 85→60 降质量，再按 0.85 缩尺寸；最终结果如实返回。
- 重新编码去掉 EXIF（含 GPS）；方向按 EXIF 烘焙正；透明通道先垫白底。
- 不是新素材：不进素材库、不进回收站、不在列表出现；普通资产 DTO、预览和缩略图选择必须显式过滤 `SHARE_JPEG`。
- 素材删除/清空时现有 `asset-purge` 会删除所有 renditions 的对象；原图替换时上传替换会删除当前 revision 的所有 renditions 并登记对象删除。新类型自动包含。
- **永久保存，不设 TTL、不自动淘汰**。磁盘占用约等于“复制过的不同图片数 × 单张大小”；后续只提供占用统计和手动清理入口，不自动删除。规格变化会产生新的 `variant`，旧 variant 保留到素材删除或手动清理。

## 任务队列与渲染进程

- 新表 `LibraryShareRender`：`PENDING / PROCESSING / READY / FAILED / CANCELLED` 和阶段 `QUEUED / READING / DECODING / ENCODING / READY / FAILED / CANCELLED`；含 `leaseVersion / leaseUntil / attempts / cancelledAt / resultRenditionId / errorCode`。
- 唯一键 `(ownerId, libraryMode, assetId, assetRevision, spec)`；同一张图同时点两次只生成一个任务。
- 新进程 `share-renderer`：与 API 同一镜像、独立启动（`node apps/api/dist/library-share-renderer.js`），跑在 NAS，并发 1；只领取分享图任务，不处理图库媒体任务。
- 领取使用 `FOR UPDATE SKIP LOCKED` + lease CAS；过期 PROCESSING 可恢复；每 30 秒续租；失败最多 2 次，客户端再次复制会按 CAS 重置任务。
- 渲染函数复用 `library-share-image`，增加真实阶段回调和 `AbortSignal`；HEIC/RAW 子进程收到取消信号会终止。
- 成功后先把对象写入 outbox，再 S3 PUT，最后在同一事务里 upsert `SHARE_JPEG` rendition、队列行 READY 并删除 outbox；事务失败时由现有对象删除 outbox 清理孤儿。
- 队列行是临时的：READY/FAILED/CANCELLED 超过 1 小时清理；永久结果在 rendition。
- 专用 `LibraryShareRendererState` 记录渲染进程心跳；API 状态的 `rendererOnline` 只用于说明“等待渲染服务”，不混入媒体 worker 心跳。

## 网关

- 结果下载路径 `/api/{eagle|photos}/assets/<uuid>/renditions/<uuid>/content` 使用 `proxy_read_timeout 120s` 作为慢网络安全网。
- 任务创建、状态和取消保持默认 15 秒；渲染本身不在请求线程里等待。
- 发布顺序：先停 API／operations／share-renderer，再执行迁移并切同版镜像；产生 `SHARE_JPEG` 数据后不要回退旧 API／operations 镜像（旧 Prisma 客户端不识别该枚举）。Mac business worker 的 renditions 查询按 kind 白名单，不会投影该行。

## 环境变量

| 变量                                | 默认                                   | 保护的真实资源 / 到顶表现                                          |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `EAGLE_SHARE_IMAGE_MAX_EDGE`        | 4096                                   | 剪贴板与分享文件的像素规模；输出停在设定长边，不放大               |
| `EAGLE_SHARE_IMAGE_MAX_BYTES`       | 15MB                                   | 避免超大原图直接进入剪贴板；先降质量、再缩尺寸，界面显示真实结果   |
| `EAGLE_SHARE_IMAGE_MIN_QUALITY`     | 60                                     | 防止为凑体积把画质压到不可用；质到下限后改为缩尺寸                 |
| `EAGLE_SHARE_RENDERER_READY_FILE`   | `/tmp/sekereagle-share-renderer-ready` | 独立进程就绪文件；只用于 Compose 健康检查                          |
| `EAGLE_SHARE_RENDER_DB_CONNECTIONS` | 4                                      | 渲染进程数据库连接上限；只保护独立进程，不影响 API                 |
| `EAGLE_SHARE_RENDER_S3_MAX_SOCKETS` | 8                                      | 渲染进程对象存储连接上限；只保护独立进程                           |
| `EAGLE_SHARE_RENDERER_MEMORY_LIMIT` | 1536m（Compose）                       | 单张 6100 万像素解码的容器内存上限；并发固定为 1                   |
| `EAGLE_SHARE_RENDER_RETENTION_MS`   | 3600000                                | 临时任务行保留期；到顶只清理队列行，永久分享版仍在，可调大保留历史 |

## 验证

- 服务端单测：owner 作用域、非图片、阶段、规格解析、字节上限。
- 真实隔离 PostgreSQL（`scripts/testing/share-render.test.mjs`，随 `test:library-integration` 运行）：渲染一次并生成永久 `SHARE_JPEG`、缓存命中直接 READY、取消 PROCESSING、素材版本变化失败、原图对象不被改写。
- 架构门禁：`architecture:check`、`test:architecture`；新表登记在 media 能力，`SHARE_JPEG` 属于 rendition，新增进程写入 process-map。
- 2026-11-24 本机真实端（网页，本地 Compose API／Web／share-renderer／Postgres／MinIO）：登录后打开 9000×6000、47MB 测试图；首次复制生成 5.5MB `SHARE_JPEG`，系统剪贴板出现 PNG（31.5MB）及 JPEG 等表示；第二次复制直接命中缓存（`LibraryShareRender` 1 行、`SHARE_JPEG` 1 条，无新渲染）；右键菜单复制显示浮动阶段“正在压缩 4K 已用 4 秒”，完成后生成同一永久分享版；取消 PROCESSING 后队列为 CANCELLED、没有结果 renditions。网关 `nginx -t` 通过，120 秒内容路径在配置中。测试资产没有金字塔，查看器对 `/pyramid` 的 404 是夹具缺失，不是分享图错误。
- 2026-11-24 成品镜像与生产：最终 API 镜像通过 `npm run test:api-image -- sekereagle/api:main-22b9e92b`，隔离启动、107 项迁移、readiness 200、匿名 401、独立 operations 与 share-renderer 启动并优雅退出 0；完整 `test:library-integration` 0 失败，含历史升级与全量恢复。NAS 生产发布 `main-22b9e92b` 启用独立 `share-renderer`（healthy、0 重启、心跳新鲜），网关“分享结果内容 120 秒”路由生效，公网首页／readiness 200、匿名分享任务 401。发布时未产生 `LibraryShareRender`／`SHARE_JPEG` 行。
- 尚未完成：登录后的生产分享复制交互、NAS 真实 HEIC/RAW 分享渲染耗时与内存峰值、桌面真实窗口、安卓固定测试图库和真实相机 RAW 分享复制。不能以单测或本机 Compose 结果替代这些现场验证。

## 边界

- 单张图复制/分享，不加入多图批量复制或批量分享。
- 分享图由 NAS 的独立渲染进程制作，不使用 Mac 业务 worker。
- 不把分享任务放进任务中心；它不是图库处理工作。
- 不改视频分享；GIF/WebP 手机分享仍保留原始动画；向量工作台预览复制不在本次范围。
- 多用户 owner 隔离、跨 owner 404、私密/删除后再校验全部保留；分享版内容接口复用现有 rendition 校验。
