# 上传协议（网页/桌面与安卓共用）

状态：源码候选，本机调试 APK 已构建（未部署、未发布）
核验日期：2026-11-24
对应提交：本条改动所在提交

本文件是上传算法的唯一规格来源。网页/桌面批量导入、安卓手动上传、安卓自动备份按同一流程、同一并发规则执行；Eagle 迁移工具（`plugins/eagle-importer`）不在本协议范围内，保持原实现。

## 范围

- 网页与桌面客户端：`apps/web/src/lib/library-upload-queue.ts`、`upload-dedupe.ts`、`eagle-api.ts`。
- 安卓手动上传：`NativeUploads.kt` + `UploadPipeline.java`。
- 安卓自动备份：`BackupService.java` + 同一 `UploadPipeline`。
- Eagle 迁移工具（`plugins/eagle-importer`）采用同一会话分片大小规则，但不使用本协议的并发/内存预算。
- 服务端在 `UploadSession.partSize` 持久化协商结果；恢复路径原样返回，不由客户端或导入器重算。

## 流程与状态机

1. **本地指纹**：浏览器 ≤8MiB 用 WebCrypto 一次计算，更大的文件按 4MiB 分块流式；安卓按 256KB 流式。查重仅为优化，指纹失败时放行上传，服务端发布事务仍是权威去重。
2. **批量查重**：`POST /api/{photos|eagle}/uploads/check-content-batch`，请求 `{items:[{contentSha256,size}]}`，返回 `{exists, privateMatches}`。未解锁私密的会话只查公开内容，不返回私密命中；解锁会话才覆盖私密并可能返回 `privateMatches=true`（提示“已存在（私密）”）。发布事务沿用发起上传时的私密授权快照做同一作用域的权威去重：未解锁会话不会与私密素材去重，会创建独立的公开副本，既不会泄露私密存在性，也不会让用户整包上传后被静默丢弃。客户端按最多 50 个或 80ms 合并（网页 `UploadDedupeChecker`、安卓 `ContentCheckBatcher`）；调用失败按“不存在”放行。
3. **创建会话**：`POST /api/{photos|eagle}/uploads`，带 `originalName`、`mimeType`、`size`、`contentSha256`、`duplicatePolicy:"SKIP"`，返回 `{id, partSize}`。分片大小由服务端决定：≤16MiB 的文件单分片；更大的文件每片 16MiB；下限 5MiB。
4. **一次性签名**：`POST /api/{photos|eagle}/uploads/:id/parts`，请求 `{partNumbers:[...]}`，返回 `{parts:[{partNumber,uploadUrl}]}`。一个文件一次请求；签名过期（HTTP 403）时只对失败分片调用 `POST .../parts/:partNumber` 补签一次。安卓遇到旧服务端（批量签名返回 404/405）时自动退回逐片签名，滚动升级期间上传不中断。
5. **上传分片**：单文件最多 3 个分片在途；全进程最多 4 个文件在途。分片 PUT 直接发往签名地址，不经过 API 凭据。
6. **完成**：`POST /api/{photos|eagle}/uploads/:id/complete`，请求 `{parts:[{partNumber,etag}]}`。服务端返回 202 时对象已合并、入库任务已入队；客户端**立即释放上传位**，开始下一个文件，不逐文件轮询。
7. **入库确认**：`POST /api/{photos|eagle}/uploads/status-batch`，请求 `{uploadSessionIds:[...]}`，每 1.5 秒一次，按模式分块 ≤500。
   - `COMPLETED` 且 `eagleAssetId` 非空 → 成功；重复内容按服务端回执标记“重复跳过”。
   - `ABORTED`，或 `FAILED` 且 `finalizationAttempts >= 10` 或 `objectCleanupPending` → 终态失败。
   - 传输错误下一轮自动重试；10 分钟仍未终态：网页标记为“服务器仍在确认入库”的失败项，安卓保留待入库会话并在下次运行对账。安卓自动备份在传输全部结束后最多再等 60 秒入库确认，然后结束本次运行；未确认的文件保留 `PENDING` 记录，由下次运行先对账再扫描。
8. **界面**：传输完成显示“已上传，入库校验中”；入库完成后变为“导入成功/已完成”；失败项进入现有重试入口。

## 并发与资源

| 规则           | 值                  | 依据                                                             |
| -------------- | ------------------- | ---------------------------------------------------------------- |
| 同时上传文件   | 4                   | 网页 `UPLOAD_FILE_CONCURRENCY`；安卓 `UploadBudget.NORMAL_FILES` |
| 单文件在途分片 | 3                   | 网页 `UPLOAD_PART_CONCURRENCY`；安卓每文件最多 3 个待完成 PUT    |
| 浏览器指纹并发 | 4                   | 与上传位对齐，避免查重拖慢可见并发                               |
| 安卓分片缓冲   | 64MiB               | 真实内存：每片最多 16MiB，四文件共享字节预算                     |
| 低内存设备     | 2 文件 / 32MiB      | `ActivityManager.isLowRamDevice()` 启动时判定                    |
| 内存告急降级   | 本批 1 文件 / 24MiB | `onTrimMemory` 或分片缓冲分配失败；下一批恢复                    |
| 入库状态轮询   | 1.5 秒 / 次         | 全部终态后停止                                                   |

安卓的“内存告急”只包围分片缓冲分配：第一次失败释放缓冲、降档、2 秒后重试；降到 1 档仍失败则暂停本批并提示，不崩溃、不静默跳过文件。降档不打断在途分片，下一批自动回到正常档位。

## 暂停、取消与续传

- 用户暂停只在文件/分片边界生效：网页在文件之间暂停；安卓手动传输停止领取新文件，在途文件传完后停下。安卓自动备份的暂停与系统停止、清除任务、切换账号一样立即结束连接（保持原行为）。
- 断点保存在服务端会话上：恢复时读取 `GET .../:id` 与 `GET .../:id/parts`，分片大小以会话持久化的 `partSize` 为准。`INITIATED` 只补缺失分片；`ASSEMBLED`/`FINALIZING` 或本地已记录上传完成 → 进入入库轮询；`COMPLETED` → 直接确认；`ABORTED`/终态 `FAILED` → 清空会话后重新上传。
- 恢复前服务端校验已存在分片的真实大小；与 `partSize` 不一致时返回 409，客户端必须重新开始该文件，不能继续拼接。
- 安卓 `BackupJournal` v6 为 `files` 增加 `uploaded` 列；`scan_progress.result` 新增 `PENDING`。老版本检查点（v5，无 `uploaded`）按旧语义重传一次，不丢回执。

## 清理回执安全

只有入库 `COMPLETED` 之后才写成功回执（`confirmed`）。已上传但未确认的文件：

- 不会出现在安卓“释放空间”的可清理候选中（`CleanupEngine` 只认 `confirmed`）。
- 手动上传永远不产生清理回执（`NativeManualJournal.contains=false`）。
- 终态失败会清空会话与 `uploaded` 标记并写入失败原因；用户重试后重新上传。

## 各端映射

| 环节       | 网页/桌面                        | 安卓                                            |
| ---------- | -------------------------------- | ----------------------------------------------- |
| 文件来源   | 用户选择/拖放                    | 手动批次 JSON；自动备份媒体扫描                 |
| 指纹       | `sha256File`                     | `MediaCatalog.hash`（256KB 流式）               |
| 查重合并   | `UploadDedupeChecker`            | `ContentCheckBatcher`                           |
| 文件调度   | `LibraryUploadQueue`（4 worker） | `UploadBudget` + 4 worker/`BackupExecutor(4,4)` |
| 单文件流程 | `uploadEagleAsset`               | `UploadPipeline` + `MultipartTransport`         |
| 入库轮询   | 队列内 `#pollPending`            | `IngestionTracker`（备份/手动各一实例）         |
| 暂停       | 文件之间                         | 文件边界（系统停止仍立即）                      |
| 内存预算   | 浏览器自管；指纹 4×8MiB 上限     | 64/32/24MiB 分片缓冲                            |

## 测试与验证

- 网页：`library-upload-queue.test.ts`（4 并发、入库不占上传位、暂停/重试）、`upload-dedupe.test.ts`（4 路哈希）、`upload-dedupe-sha256.test.ts`（8MiB 边界与分块）、`eagle-api.test.ts`（批量签名、分片并发、状态批量）。
- 安卓 JVM：`UploadBudgetTest`、`ContentCheckBatcherTest`、`IngestionTrackerTest`、`BackupEngineTest`（PENDING、断点续入库、未确认不写回执）、`ForwardUploadSourceTest`（16MiB 缓冲上限）。
- 安卓设备：`NativeUploadTest`、`NativeUploadJourney`、`MobileBackupTest`、`NativeBackgroundTransferTest`、`NativeTransferQueueTest`。本轮设备套件未运行：隔离环境在生成预览阶段超时（本机缺少 `exiftool`）；4 个并发、入库校验中状态、暂停继续、杀进程续传与低内存降级仍需真机或带 exiftool 的隔离环境验收。
- 服务端变更：`UploadSession.partSize` 为可空新增列，恢复与分片列表返回该值；旧会话为空时按文件大小回退到同一 `chooseUploadPartSize` 规则。发布前按迁移和镜像门禁验证。
