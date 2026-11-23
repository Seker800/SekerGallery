# 2026年11月23日 批量选择、标签与回收站交互发布（d3568fc9）

> 状态：历史记录 | 归档日期：2026-11-23 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`d3568fc9`（API／operations／library-reader／web 一致；macOS 客户端已用同一源码重打包并替换）。
- API／operations／library-reader：`sekereagle/api:main-d3568fc9`（linux/amd64）。
- Web：`sekereagle/web:main-d3568fc9`（linux/amd64）。
- 数据库：102 项迁移，待应用 0；本次应用 `20261123090000_manual_tag_system_key`，只新增可空列与唯一索引，并把现有“收藏／已编辑”标签标记为系统标签。
- 内容：批量选择与“选择全部匹配项”、选择条与撤销、标签页重建（新建／合并／颜色／组导航／系统标签保护）、回收站“永久删除所选”（输入确认词，复用现有清理任务）、照片组整组操作、发送不可用原因提示、从搜索保存智能文件夹、品牌统一为 SekerGallery、生产依赖安全修复；同时修复 reader 性能用例在完整集成套件中因查询计划平局翻转而失败的问题，改为有界分页断言。

## 构建与切换

- 在群晖以现用 `main-2405f5ed` 生产镜像为基座，叠加 HEAD 的 `apps/api/dist`、迁移、`packages/library-persistence/dist` 与 `apps/web/dist` 构建；镜像 label revision 与 `d3568fc9…` 一致。
- 发布包 1369 个文件逐一核对 SHA-256；清理 macOS 打包产生的 1514 个 `._*` 文件，并统一文件权限——`20261103130000_hot_table_autovacuum_tuning/migration.sql` 原为 0600，应用以 `node` 用户运行会读不到并触发 Prisma P3015。
- API 成品镜像通过 `npm run test:api-image -- sekereagle/api:main-d3568fc9`：隔离启动、102 条迁移、readiness 200、匿名 401、独立执行器无 API secrets 启动并退出 0。
- 线上 `index.html` SHA-256 `f756a57ba2f9f325108d0613009f40dc47de159e91376bc5d7a4e822aafdb0e0`，与本地构建一致。
- 切换：先停 operations，应用迁移，再停 gateway／api／library-reader／web，启动四个应用容器；无关容器 ID 未变，网关复用并 reload。

## 数据安全与备份

- 发布前一致性备份：941,432,321 字节，SHA-256 `356121ce301818ceefc6082a3e907edaf7478831f1d9089b41dd47758d502ae8`，`pg_restore --list` 完整解析。
- 发布前后计数完全相同：MATERIAL 64,876／PHOTO 58,869（合计 123,745）、回收站 13,755、草稿 243。
- schema 前后：`EagleManualTag.systemKey` 列与唯一索引均 0 → 1；两个回收站排序索引保持 1。
- 系统标签回填：FAVORITE 1 个、EDIT_COPY 1 个。

## 验证结果

- 公网首页 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；线上首页与本地构建哈希一致。
- api／operations／library-reader／web 四个容器 healthy、0 重启，切换后日志无 error／fatal／unhandled；无关容器未变。
- 本地门禁：`npm run ci:check` 全绿；生产依赖安全审计 0 漏洞；worker 租约测试通过；完整 `test:library-integration` 通过至人员排序既有失败之前（该失败在 2405f5ed 之前即存在，与本次改动无关）。
- 未做登录后的生产浏览器交互（无生产账号凭据）；建议现场走一遍：多选 → 选择全部匹配项 → 批量加标签 → 合并标签 → 永久删除 1 条测试素材 → 保存智能文件夹。
- macOS 客户端：用 `d3568fc9` 源码重打包 arm64 未签名客户端，替换安装为 `/Applications/SekerGallery.app` 0.1.9（app.asar `73a2d95a…`）；启动后已连接线上图库，无崩溃与错误日志，原服务器配置与缓存目录保留；旧版完整移动到 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app`（app.asar `ca3a6a38…`）。未用真实文件实测 100 个以上原文件的原生拖拽。
- 安卓客户端：0.9.31（versionCode 48）已覆盖安装到小米 25128PNA1C 并正常加载生产图库；0.9.32（versionCode 49）统一登录页、账户提示和备份通知的用户可见文案为 SekerGallery，`android:check` 通过，2026-11-23 20:06 安装到小米 Pad 7 Ultra（25032RP42C，`adb push` + `pm install -r`）；0.9.33（versionCode 50）让 ≥600dp 的平板网格改用 512 缩略图并把解码上限提到 512，手机保持原档位，已安装到 Pad 并确认缓存为 512 档、图库明显更清晰。未复跑完整 132 项设备套件（其中仍有 3 个旧夹具失败，见 [安卓客户端](../android-client.md)）。Mac 业务 worker 未更新，“已编辑”标签 systemKey 保护待 worker 更新后完整。

## 后续修复

- 本页的 `sekereagle/api:main-d3568fc9` 增量镜像未重新生成 Prisma 客户端，登录后读取标签会因 `EagleManualTag.systemKey` 报 500。同日 20:55 以 `main-d3568fc9-hotfix1` 修复并上线，见[热修记录](main-production-release-2026-11-23-manualtag-client-hotfix.md)。下文“回退到 main-2405f5ed”仍然有效；不要回退到 `main-d3568fc9`。

## 回退

- API／operations／library-reader／web 回退：`sekereagle/api:main-2405f5ed`／`sekereagle/web:main-2405f5ed`。
- macOS 客户端回退：关闭客户端，把 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261123-before-d3568fc9.app` 拷回 `/Applications` 后启动。
- NAS 私有 `maintenance/main-d3568fc9/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引；回退使用 `release.py` 的回退路径恢复镜像。本次迁移为增量，回退应用不需要删除列或索引。
