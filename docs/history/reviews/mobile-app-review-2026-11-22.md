# 手机端评审：分享链路、操作回执与大图库效率（2026-11-22）

> 状态：历史记录 | 核验日期：2026-11-22 | 基线提交：`614eb661`（Android 0.9.27）
>
> 后续：以下问题已在 Android 0.9.28 处理，见[修复记录](../records/android-mobile-fixes-2026-11-22.md)。
>
> 本轮是只读评审，没有修改业务代码，没有连接生产、群晖或 SekerChat，也没有运行真机／模拟器。
> 下文“确认”均指代码与契约可互相印证；“推算”是代码路径上的数量级估算，不能当作实测 p95。

## 结论

用户提出的分享问题属实：**Android 原生“发送”和手机网页“发送”都直接取原文件，没有走服务端已有的
`/assets/:assetId/share-image` 4K 分享链路**。原生端还把整份原文件落到 `cacheDir` 再交给系统分享，
大视频没有分享预算。

除分享外，本轮确认了四个系统性问题：

1. **把 202 受理当成已完成**。回收站、标签、评分、收藏、发送到另一模式都由服务端后台队列执行，
   Android 收到 202 后立即显示“已完成”并刷新列表，但没有操作投影，也没有轮询回执。结果是列表可能显示
   已删除／已发送的旧卡片，收藏图标可能没变化，失败也不会在列表里反馈。
2. **大图库回前台代价随已加载数量线性增长**。`refresh()` 会从当前窗口起点一直翻页到原来的条数；
   已加载 6 万项时，一次回前台最坏要发 1000 个列表请求。上传完成、传输事件、下拉刷新都复用这条路径。
3. **一批“看起来是小操作”的动作反复拉全量目录**。收藏一次会拉整份标签目录（上限 16 MiB）、隐私设置、
   再提交后台操作、再读详情；打开筛选面板也会重新拉所有选项。
4. **100 项上限重新把内部批处理变成了用户手动拆批**。选择、上传、下载、筛选标签都被 100 截断；
   发送和标签接口本身已不设这个上限，只有回收站 DTO 仍是 100。这与仓库已经明确的“不得让用户手动拆批”
   规则冲突。

另有几项直接影响体验或可靠性的问题：下载弹窗运行中只能“取消下载”不能后台关闭；素材搜索被强制按日期排序，
丢失服务端已有的相关度排序；缩略图请求不可取消，快速滚动时旧请求会占住解码通道；手动上传／下载仍在用受
6 小时限制的 dataSync 前台服务，而自动备份已经迁到 UIDT 任务；0.9.27 的“服务器已删除”核对只覆盖没有扫描回执的项，
正常备份成功后的项不会再次核对。

## 优先级总表

| #   | 级别 | 问题                                                       | 主要影响                                     |
| --- | ---- | ---------------------------------------------------------- | -------------------------------------------- |
| 1   | 高   | 分享仍发原图／原视频，未接 4K 分享图                       | 兼容性、流量、等待时间、EXIF 位置泄露        |
| 2   | 高   | 202 受理被当成完成，没有操作投影／回执                     | 删除、收藏、标签、评分、发送后列表不一致     |
| 3   | 高   | 100 项全局上限，要求用户手动分批                           | 与产品规则冲突，批量操作被迫拆很多次         |
| 4   | 高   | 回前台／传输事件触发全窗口重读                             | 大图库请求数、流量、电量、等待时间           |
| 5   | 高   | 下载弹窗运行中无法关闭，点空白即取消                       | 下载期间不能继续浏览，误触会中断             |
| 6   | 中   | 分享大视频会把整份原件复制到 cache                         | 最高 5 GB 级缓存占用，分享前长时间无进度     |
| 7   | 中   | 素材搜索和智能文件夹被强制按日期排序                       | 语义搜索最相关的结果不一定排在前面           |
| 8   | 中   | 缩略图／时间线请求不可取消，解码并发固定 4                 | 快速滚动时旧下载占用通道，可见图变慢         |
| 9   | 中   | 另一库离屏页仍会加载缩略图；回前台还会预取另一库           | 每次打开多下载一屏另一模式的图片             |
| 10  | 中   | 筛选／收藏反复拉全量标签目录                               | 标签多时每次点击都可能是十几 MB 的 JSON      |
| 11  | 中   | 备份传输页每 400 ms 复制并重排全部行                       | 首次全量备份几万项时主线程和内存压力大       |
| 12  | 中   | 手动上传／下载仍用 dataSync 前台服务                       | Android 14+ 长任务受 6 小时／24 小时限制     |
| 13  | 中   | 放大查看下载整份原图，解码压到 1600 万像素，离开即删       | 每次缩放重复下载几十 MB，且不是全分辨率      |
| 14  | 中   | 0.9.27 服务器已删除核对只覆盖“有检查点但无扫描回执”的项    | 已正常备份过的项之后被服务器删除时状态不更新 |
| 15  | 低   | 素材筛选缺少标签 ANY／ALL 切换                             | 不能复现网页的“同时包含这些标签”             |
| 16  | 低   | 自动备份失败行的“重试”实际重试全部失败项                   | 用户以为只重试这一张，实际可能重传很多张     |
| 17  | 低   | 回收站大图没有恢复入口                                     | 要退出大图、进入选择模式才能恢复             |
| 18  | 低   | 大图“发送”与选择栏“发送到素材”语义冲突                     | 想移动库的用户会先打开系统分享               |
| 19  | 低   | `BackupService.onDestroy()` 的“备份未完成”分支永远不会执行 | 服务异常结束时状态可能不准确                 |
| 20  | 低   | 传输记录最多 20 个批次，超出要求先清理                     | 连续多批手动上传时要手动整理记录             |

## 一、分享链路

### 1.1 Android 原生：确认仍分享原文件

[`NativeShare.kt`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeShare.kt#L12-L53)
的入口是 `repo.original(...)`，然后直接把原文件 `renameTo` 到 `cacheDir/shared-media`，用
`Intent.ACTION_SEND` + `setType(originalMime)` 交给系统分享。大图底栏在
[`NativeViewer.kt`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeViewer.kt#L177-L207)
把按钮标成“发送”，等待文案是“正在准备发送原件…”。

代码库中 `apps/android` 下没有任何 `share-image` 或 `getShareImage` 调用；服务端接口
[`eagle.controller.ts`](../../../apps/api/src/eagle/eagle.controller.ts#L555-L575) 已经同时存在于
`/api/eagle` 和 `/api/photos`（`PhotosController` 继承 `EagleController`），并且网页复制按钮
[`EagleImageCopyButton.tsx`](../../../apps/web/src/components/eagle/EagleImageCopyButton.tsx#L27-L45)
已经在用这条链路。也就是说，缺的不是服务端能力，而是手机端没有接。

影响：

- **格式兼容**：HEIC、HEIF、DNG／NEF／ARW 等相机 RAW、TIFF 原样交给微信等目标应用，很多应用不能预览。
- **体积与等待**：6100 万像素 JPEG 常见 20–40 MB；4K 分享版通常 1–3 MB。当前分享没有字节进度，
  只能看“正在准备发送原件…”。
- **隐私**：原文件保留 EXIF／GPS；服务端分享版按设计重新编码并去掉 EXIF。
- **大视频**：见 6。

### 1.2 手机网页：同样发原文件，而且提示语不准确

[`EagleMobileViewer.tsx`](../../../apps/web/src/components/eagle/EagleMobileViewer.tsx#L104-L141)
在 `byteSize > 32 MB` 时直接进入下载兜底，否则把原文件流式读进内存，再用
`navigator.share({ files: [file] })` 发出。测试也明确断言请求的是
`/api/photos/assets/one/original`（[`EagleMobileViewer.test.tsx`](../../../apps/web/src/components/eagle/EagleMobileViewer.test.tsx#L131-L141)）。

两个具体问题：

- 文件大于 32 MB 时，提示语是“当前环境不支持系统分享，可先下载原文件”，但真实原因是“文件太大”，
  不是环境不支持。
- 对图片来说，32 MB 限制本来可以被 4K 分享版绕开；现在图片和视频走了同一条原文件路径。

### 1.3 视频：应优先分享播放副本或明确提示

原生视频已经有服务端生成的 MP4 播放副本（`NativeAsset.playback`，编辑器和大图播放器都在用），
但分享仍然取 `original`。对 MOV／HEVC／AVI 等原件，目标应用可能不能播放；对 4 GB 视频，还会
先复制整份到 cache。建议把“图片走分享图、视频优先播放副本、只有用户明确选择原片时才发原件”
作为统一策略，并在按钮上明确说明。

### 1.4 建议的落地形状（不改代码，只定方向）

- 图片：默认请求 `/assets/:id/share-image`，下载到专用 cache 文件后以 `image/jpeg`、`.jpg`
  分享；`asset.width/height` 长边 ≥ 4096 时才写“4K”，小图如实写“分享图”。
- 动图：GIF／动态 WebP 不要走 JPEG 分享图，保留原文件或明确提示会丢失动画。
- 视频：优先分享播放副本；没有播放副本时再用原件，并设置分享预算；超过预算时提供“下载原文件”。
- 失败退化：服务端 4xx／超时／生成失败时，提供“改发原图”或“下载原文件”，不要只留一个错误框。
- 进度与取消：准备分享图同样需要可见进度和取消；不要让用户只看到转圈。
- 缓存：分享图可按媒体版本缓存在本地，避免同一张图连续分享多次都让服务端重渲染。
- 手机网页复用同一策略；`fetchShareJpeg` 已经存在，可直接得到 JPEG Blob 再构造 `File`。
- 测试要覆盖：HEIC／RAW／61MP JPEG、动图、大视频、服务端 500／超时、分享图小于 4096 的文案。

## 二、操作回执与列表一致性

### 2.1 202 被当成“已完成”

服务端这些接口返回 202，只是受理：

- `POST /assets/batch/trash`、`/restore`：`enqueue` 后台队列
  （[`eagle.controller.ts`](../../../apps/api/src/eagle/eagle.controller.ts#L699-L720)）。
- `POST /assets/batch/manual-tags`：`enqueueCommand`
  （[`eagle.controller.ts`](../../../apps/api/src/eagle/eagle.controller.ts#L874-L889)）。
- `PATCH /assets/batch`：`ASSET_UPDATE` 后台命令
  （[`eagle.controller.ts`](../../../apps/api/src/eagle/eagle.controller.ts#L635-L648)）。

Android 在 [`NativeGalleryRepository.change`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L320-L380)
里只 `session.json(...)`，不读返回的操作摘要；[`changeSelection`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L1126-L1180)
在请求返回后立即把 `busy` 置 false、显示“已完成，共 N 项”，然后调用 `refresh()`。此时后台操作很可能
还没执行完，`refresh()` 读到的仍是旧数据。

实际表现：

- **删除／恢复**：照片可能短暂重新出现在列表里；如果刷新刚好在后台执行前完成，就会一直留到下一次刷新。
- **标签／评分**：新值可能没显示，用户以为没生效。
- **发送到素材／照片**：源卡片在后台操作完成前仍在；点进去可能看到已失效的预览或 404。
- **收藏**：见 2.2，问题更明显。
- **失败**：后台操作失败时列表不会提示；只有打开传输列表才可能看到失败计数。

网页侧有 `workspaceCache.operations.visible(...)` 的操作投影
（[`SekerEaglePage.tsx`](../../../apps/web/src/components/eagle/SekerEaglePage.tsx#L636-L670)），
会在受理后先隐藏／更新受影响项。Android 没有对应层。

建议：至少区分“已提交”和“已完成”；用操作回执做局部投影（隐藏／替换受影响项），或轮询操作终态后再刷新。
如果继续用 `refresh()`，也必须等操作完成，而不是受理后立即刷新。

### 2.2 收藏一次要发四个请求，且结果可能不更新

[`NativeGalleryRepository.setFavorite`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L272-L316)
每次收藏／取消收藏都会：

1. 拉整份 `manual-tags`（上限 16 MiB）找“收藏”标签；
2. 拉 `privacy-settings` 检查该标签是否私密；
3. POST `assets/batch/manual-tags`（202）；
4. 回到 [`toggleFavorite`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L1028-L1068)
   再 GET 一次详情。

标签多的时候，第 1 步本身就是一次可观的下载；第 4 步读到的详情还可能是后台操作执行前的旧状态。
用户看到的是图标没变、但操作“没报错”。同时 `busy` 为 true 时
[`back()`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L826-L831)
直接 `return true`，这四个请求没跑完之前返回键是没反应的。

建议：

- 收藏标签 ID 和隐私状态按 mode／owner 缓存，标签变更时失效；不要每次点击拉全量标签。
- 受理后先做乐观图标切换，或在操作终态后再更新；不要在 202 后立刻读详情。
- 收藏失败／未完成时要能在当前界面看到，不要只写进 `message` 后又被下一次刷新覆盖。

### 2.3 “操作回执刷新”没有按仓库约定使用

[`refresh-map.md`](../../refresh-map.md) 明确要求：写操作返回 operation 回执后按回执局部更新列表、
计数、详情和缓存，“不要在每次进度 tick 重取整页”。Android 的 `changeSelection` 末尾直接
`refresh()`；上传完成事件也通过
[`refreshTransfersWhenIdle`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L233-L246)
触发完整刷新。即使位置没丢，数据访问量也远大于局部更新。

## 三、大图库效率

### 3.1 回前台全窗口重读（高）

[`refresh()`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L510-L550)
先取一页，然后在 `cursor != null && items.size < maxOf(60, snapshot.items.size)` 时继续翻页。
每页 60 项；如果用户已经通过无限滚动加载了 6000 项，一次刷新要 100 个请求；6 万项最坏 1000 个请求。
[`onForeground`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L1208-L1255)
在每次真正回到前台时调用它；上传／传输事件也会触发。

这不是“刷新会重置位置”的问题，而是**刷新本身把整个已加载窗口重新读一遍**。在手机流量、NAS 和
API 单实例的规模下，这个成本不科学。

建议：刷新只取第一页或当前可见窗口（可用 `before`／`offset` 围绕第一个可见项），保留更深的已加载项；
后台变更用操作回执或增量游标局部更新，不要用全窗口重读当同步机制。

### 3.2 缩略图和时间线请求不可取消（中）

[`NativeImage`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeMedia.kt#L31-L42)
的 `LaunchedEffect` 被取消时，`repo.image(...)` 里的阻塞 `HttpURLConnection` 读取不会随协程停止；
[`image()`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L385-L480)
没有 cancellation 参数，`session.media(path)` 也没有绑定取消。解码并发固定 4；快速滚动时，
已经离开屏幕的缩略图仍会占着 permit 完成下载，可见图排在后面。

同样的问题存在于 [`timeline()`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L154-L172)
和 `detail()`：`timelineJob?.cancel()` 只取消协程，不取消在途 HTTP，最长要等 30 秒超时才释放。

建议：图片请求接受 `NativeTransferCancellation`，在 `LaunchedEffect` 的 `onDispose` 取消；给可见项
更高优先级；至少让离开屏幕的下载尽快断开。时间线和详情也复用同一取消对象。

### 3.3 另一库离屏页会加载缩略图（中）

[`NativeLibraryPager`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeLibraryPager.kt#L42-L60)
用 `beyondViewportPageCount = 1` 同时组合两页；另一页拿到 `retained` 的首屏后，
`NativeLibraryPage` 里的 `NativeImage` 仍会按可见区域加载缩略图，没有任何 `active` 判断。按三列、
一屏约 24 项估算，每次打开应用都可能额外下载一屏另一模式的图片。再叠加
[`prefetchLibrary`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L142-L200)
的首屏 60 项元数据和时间线，冷启动的请求量比“只看当前模式”多不少。

建议：离屏页只保留元数据和占位图，`NativeImage` 增加 `active`／可见性门槛；预取元数据可以保留，
但不要顺带下载图片。

### 3.4 筛选与收藏反复拉全量标签目录（中）

打开“筛选”时 [`openFilters`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt#L876-L940)
会并行拉 TAGS、SMART_FOLDERS、FORMATS、PHOTOGRAPHY 四组；TAGS 在
[`options`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L200-L230)
里使用 16 MiB 预算。每次重新打开面板都重新拉，没有 TTL 或 generation 缓存；收藏也重复拉同一份目录。

建议：按 mode／owner 缓存目录，标签写操作后只失效对应 section；面板打开先显示上次结果、后台校准；
收藏只查／缓存“收藏”标签，不拉全量。

### 3.5 备份传输页每 400 ms 复制全部行（中）

[`NativeTransferScreen`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferScreen.kt#L99-L104)
每 400 ms 调一次 [`BackupLive.snapshot()`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupLive.java#L114-L120)；
后者在锁内复制 `rows` 里的每一行。随后
[`autoRows`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferScreen.kt#L178-L235)
在每次新 snapshot 上重建并排序全部 `TransferRowView`。首次全量备份几万项时，`BackupLive` 会为每个
提交项建一行；即使用户只看传输页，也会在执行期间每秒复制数万行对象。

建议：传输页只订阅活跃窗口（例如最近 200–500 行）加汇总计数；已完成行折叠时不构造完整列表；
用 StateFlow／快照差量代替全量复制。不要为了 UI 展示把整个扫描台账放进内存。

### 3.6 放大查看下载整份原图（中）

[`ZoomPhoto`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeViewer.kt#L286-L302)
在放大时调用 `repo.original(..., normalize = true)`，把整份原图下载到 `viewer-originals` 临时文件；
[`decodeViewerOriginal`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeOriginal.kt#L128-L140)
再把解码目标压到 1600 万像素。缩回适屏就关闭并删除文件，下一次放大重新下载。对大图：
每份 20–40 MB，重复缩放重复下载；显示上限 1600 万像素，也不是全分辨率。

服务端已经有金字塔切片，网页查看器在用。Android 目前没有接。建议至少：
按需只取当前视口／倍率所需的图，或复用 4096 分享图作为中间层；对已下载原图做有界缓存；
在 UI 上把“原图”与“1600 万像素解码”说清楚，避免用户以为看到的是全分辨率。

### 3.7 回前台“请求风暴”（中，和 3.1 同源）

一次真正回前台同时可能发生：

1. `GET /api/auth/me` 复核；
2. `refresh()` 重读已加载窗口（3.1）；
3. `automaticallyBackup()` 启动一次自动扫描（30 秒节流，见
   [`BackupLauncher`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupLauncher.java#L24-L38)）；
4. `invalidateInactiveLibrary()` 把另一库标记为 stale，切过去时再刷新；
5. 预取另一库首屏和时间线（3.3）。

建议：把“回前台”拆成“会话复核”和“数据校准”两件事；数据校准只取当前可见窗口；自动备份加一个
基于 `lastFinished` 的最小间隔（例如最近几分钟内成功过就跳过），不要每次回前台都启动扫描。

## 四、使用直觉与一致性

### 4.1 100 项上限让用户手动拆批（高）

相关位置：

- [`NativeSelection.LIMIT = 100`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeLibraryControls.kt#L106-L118)；
- [`NativeDownloads.start`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeDownloads.kt#L45-L52)；
- [`NativeAssetOperations.send`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeAssetOperations.kt#L41-L48)；
- [`NativeGalleryRepository.change`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L326-L329)；
- [`NativeUploadPolicy.picked`](../../../apps/android/app/src/main/java/com/sekereagle/android/core/NativeUploadPolicy.java#L20-L25)；
- [`NativeTransferStore`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferStore.kt#L76-L82)；
- [`NativeFilters.validationError`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeLibraryControls.kt#L18-L22)；
- [`NativeTagPicker`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTagPicker.kt#L46-L50)。

表现：选择第 101 项时提示“每次最多选择 100 项”；一次选 150 个文件上传时提示“请分批选择”；
“全选已加载”实际只选前 100；标签筛选最多 100 个；传输记录最多 20 个批次。

服务端并不是都要求 100：

- `SendEagleAssetsDto.assetIds` 没有 100 上限；
- `BatchChangeEagleManualTagsDto.assetIds` 没有 100 上限（仓库已有测试明确接受超过 1000 项）；
- `manualTagIds` 查询参数没有 100 上限；
- 只有 `EagleAssetIdsDto`（`batch/trash`、`batch/restore`）仍是 `@ArrayMaxSize(100)`
  （[`eagle.dto.ts`](../../../apps/api/src/eagle/eagle.dto.ts#L268-L275)）。

这正是仓库已经禁止的“内部自动分批变成用户手动拆批”
（[`AGENTS.md`](../../../AGENTS.md) 产品定位与效率取舍）。建议：

- 选择、发送、加标签、下载不再用 100 截断；需要按请求大小限制的，由客户端内部自动分批并显示总进度。
- 回收站／恢复改用 `/operations` 的 TRASH／RESTORE（服务端支持，且能显示后台进度），或移除 DTO 的 100
  上限；不要继续用 `batch/trash` 把用户卡在 100。
- 上传选择不设 100 文件上限；如果持久 URI 授权确实有系统级预算，说明真实资源、到顶表现和开关，
  并在后台自动分批，而不是让用户重新选。
- 20 个传输批次类似：自动清理最旧已完成记录，不要用“列表已满”阻挡新任务。

### 4.2 下载弹窗运行中不能关闭（高）

[`NativeDownloadDialog`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeDownloadDialog.kt#L15-L52)
的 `onDismissRequest` 在下载中直接 `downloads.cancel()`；运行中唯一按钮是“取消下载”，没有“后台继续”。
弹窗里的文案却写着“下载可在后台继续，通知和此处会保留进度”。实际是：用户要么等整批下载完，要么取消；
点空白／返回键也会取消。

建议：运行中把“关闭弹窗”和“取消下载”分开；关闭只隐藏 UI，下载继续并有通知／图库小进度入口；
取消需要二次确认。下载失败或进程死亡后的 MediaStore `IS_PENDING` 行也应清理。

### 4.3 素材搜索被强制日期排序（中）

Android 的 [`page()`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt#L125-L135)
永远追加 `&sort=${sort.name}`。服务端的搜索排序在
[`rankPage`](../../../apps/api/src/eagle/eagle-image-search.service.ts#L112-L180) 里：只要传了 `sort`，
就按日期列扫描和排序；只有不传 `sort` 时才用 `tier, similarity` 相关度顺序。API DTO 的说明也写着
“Omitted preserves mode defaults and search relevance”
（[`eagle.dto.ts`](../../../apps/api/src/eagle/eagle.dto.ts#L88-L96)）。

网页的 `assetFilters` 只在照片模式且不是智能文件夹相关度时传 `sort`；素材搜索不传，所以素材搜索是相关度排序。
Android 素材搜索因此与网页不一致：搜索“橘色宇航服的女人”时，结果按日期而不是按最相关排列。
智能文件夹的 `smartFolderOrder=RELEVANCE` 也没有被 Android 使用。

建议：搜索、智能文件夹增加“相关度”排序选项；默认在素材搜索中省略 `sort`，在智能文件夹未显式选择日期时
传 `smartFolderOrder=RELEVANCE`；照片模式若保留日期默认，也要让用户能切到相关度。分页游标必须和服务端
选择的排序一致。

### 4.4 标签筛选缺 ANY／ALL（低）

[`NativeFilters.parameters`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeLibraryControls.kt#L30-L45)
固定 `tagMatch=ANY`；服务端 DTO 支持 `ANY | ALL`，网页也有“匹配全部标签”的单选
（[`EagleQuickFilterBar.tsx`](../../../apps/web/src/components/eagle/EagleQuickFilterBar.tsx#L484-L518)）。
Android 目前无法表达“同时包含这些标签”。建议在标签筛选里补一个两态选择，并保留到草稿／URL 参数。

### 4.5 “发送”命名冲突（低）

大图底栏的“发送”是系统分享；选择栏的“发送到素材／照片”是跨库移动。两者在中文里都叫“发送”，
用户想移动库时会先打开系统分享。建议系统分享统一叫“分享”，跨库操作保留“发送到…”。手机网页同样适用。

### 4.6 回收站大图没有恢复（低）

[`NativeViewer`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeViewer.kt#L155-L200)
在 `state.trash` 时不显示底部工具栏，所以回收站大图里不能恢复、下载或分享；用户必须退出大图、
长按选择、再点恢复。建议至少提供“恢复”和“下载”；如果回收站是只读，也要把原因说清楚，而不是直接没有操作。

### 4.7 自动备份失败行的“重试”实际重试全部（低）

[`NativeTransferScreen`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferScreen.kt#L318-L322)
把每一行的 `onRetry` 都接到 `BackupService.retryFailed(context, scope)`，后者会重置账号下全部失败项
（[`BackupService.retryFailed`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java#L135-L140)）。
手动上传队列里的单行重试只重试该文件，两个列表的行为不一致。建议要么做单文件重试，要么把按钮文案改成
“重试全部失败”，不要放在单行上。

## 五、可靠性与资源边界

### 5.1 手动上传／下载仍用 dataSync 前台服务（中）

自动备份在 0.9.25 已经改为 Android 14+ 的用户发起数据传输任务（UIDT，
[`BackupLauncher`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupLauncher.java#L33-L58)），
但手动上传和下载的 [`NativeTransferManager.startService`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferManager.kt#L206-L211)
仍然直接 `startForegroundService(NativeUploadService)`；服务声明为 `dataSync`
（[`AndroidManifest.xml`](../../../apps/android/app/src/main/AndroidManifest.xml)）。Android 14+ 的 dataSync
前台服务受 6 小时／24 小时限制（见[安卓客户端说明](../../android-client.md)）；大视频或大量文件可能在传输中途被系统停止，只能回到传输列表继续。

建议：把手动上传／下载也接入 UIDT 任务（或统一的传输 Job），保留前台服务作为旧系统兜底；
这样“用户发起的大传输”与自动备份使用同一套系统配额语义。

### 5.2 0.9.27 的“服务器已删除”核对只覆盖没有扫描回执的项（中）

[`BackupService`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java#L348-L370)
在扫描时先判断 `store.scanCompleted(...)`，是就直接 `countRun("SKIPPED")` 并返回；只有
“有 confirmed checkpoint、但 scan_progress 还没有回执”的项才加入 `pendingSkips`，
最后 [`verifySkipped`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java#L485-L535)
批量 `check-content-batch`。

`scanCompleted` 的 SQL 只认 `UPLOADED`／`SKIPPED`
（[`BackupJournal.scanCompleted`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupJournal.java#L128-L137)）。
因此：

- 首次从旧目录授权迁移到媒体库授权时，checkpoint 在、scan_progress 不在，480 张会被核对并标成服务器已删除，
  这与 0.9.27 的实机记录一致；
- 但**之后正常备份成功的项，下一次扫描会走 `scanCompleted` 直接跳过，不会再核对服务器**。如果用户之后在服务器
  删掉这些照片，备份状态不会更新成“服务器已删除”，仍显示已备份。

释放空间的“也清理服务器已删除的原图”有自己的 `check-content-batch`
（[`CleanupScreen.scan`](../../../apps/android/app/src/main/java/com/sekereagle/android/CleanupScreen.java#L305-L390)），
所以不会因此误删；问题在备份状态和“服务器已删除”标记不准确。

建议：把核对对象扩展到“本轮所有按本地回执跳过的项”，至少在整库扫描或每隔 N 天做一次；`scan_progress`
里保存 hash 或从 checkpoint 读回；批量大小继续按 500，保持服务端一次 SQL 的预算。

### 5.3 分享大文件没有预算（中）

[`NativeOriginal.original`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeOriginal.kt#L44-L125)
的 256 MB 查看预算只在 `normalize = true` 时生效；分享传的是默认 `normalize = false`，所以：
5 GB 的视频或几百 MB 的 TIFF 会先整份下载到 `cacheDir/shared-media`，然后才交给系统分享。
[`NativeDownloadPolicy.validate`](../../../apps/android/app/src/main/java/com/sekereagle/android/core/NativeDownloadPolicy.java#L13-L21)
只挡到 5 GB。分享缓存的清理还要等下一次分享、且只删 24 小时前的文件
（[`NativeShare.kt`](../../../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeShare.kt#L20-L28)）。

建议：图片走分享图后自然变小；视频优先播放副本；如果仍要发原件，设置明确的分享预算（到顶提示“文件较大，
下载原文件”）、显示进度、允许取消，并在分享结束后或定时清理。

### 5.4 `BackupService.onDestroy()` 的未完成分支永远不执行（低）

[`onDestroy`](../../../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java#L880-L890)
先 `working.set(false)`，随后又判断 `working.get()`，这个条件永远为 false，所以“备份未完成，下次打开继续”
的状态不会在服务销毁路径写入。建议在置 false 之前判断，或用单独的 `running` 快照。

### 5.5 其它小问题

- 下载中途进程死亡会留下 MediaStore 的 `IS_PENDING` 隐藏行；下次启动没有清理。
- `NativeShare` 的临时目录在失败时不会即时删除，只靠下一次分享的 24 小时清理。
- `openSavedAsset` 在保存后调用 `refresh()` 再等待当前 operation；如果当前还有别的 operation，可能等到
  错误的任务，最后给出“请返回图库查看”的提示。
- `NativeLogin` 只有在成功登录后才保存服务器地址；密码错误或网络失败后，重启应用要重新输入地址。

## 六、没有发现的问题

- 没有发现绕过 owner／模式隔离、跨 owner 读取、匿名访问或私密资源泄露的新路径。
- `share-image` 服务端按 owner、`includePrivate` 和 mode 查询，非图片返回 400，跨 owner 返回 404；
  Android 只需在客户端正确调用，不需要放宽服务端权限。
- 目录扫描、上传检查点、缓存加密、下载 pending 发布这些既有安全边界没有发现需要在本轮修改的地方。

## 七、建议的验证（不排期）

以下验证用于确认修复后的真实行为，不能拿单测代替：

1. **分享**：在真机上分别分享 61MP JPEG、HEIC、NEF／DNG、透明 PNG、GIF、4 GB 视频到微信／相册／文件管理器；
   确认输出格式、尺寸、体积、是否保留动画、是否有进度和取消、失败是否能改发原图。
2. **操作回执**：100+ 项删除、恢复、加标签、评分、发送到另一模式；确认列表在操作前后不出现“已删除又回来”、
   失败可见、返回键不被长时间吞掉。
3. **大图库**：用 5000／60000 项的图库加载到较深位置后切后台再回前台，记录列表请求数、流量、首屏时间；
   确认刷新不再随已加载项线性增长。
4. **滚动**：快速滚动缩略图，确认离开屏幕的请求被取消，可见图不被旧请求拖慢。
5. **下载**：100 项下载中关闭弹窗、切后台、杀进程；确认不会误取消、不会留下 pending 行。
6. **搜索**：素材模式搜索语义词，确认最相关结果排在前面；智能文件夹确认相关度排序可用。
7. **备份**：完成一次正常备份后，在服务器删除若干照片，再跑一次备份；确认状态能更新为“服务器已删除”，
   而不是因为 `scanCompleted` 直接跳过。
8. **长传输**：手动上传／下载超过 dataSync 时限的样本，确认 UIDT／旧系统兜底的实际表现。

## 一句话总结

分享确实还停在“原文件”上；更值得先处理的是“202 当完成”和“回前台全窗口重读”这两条系统性问题，
它们会同时影响删除、收藏、标签、发送和大图库的日常手感；100 项上限则明确违背了仓库自己的效率规则。
