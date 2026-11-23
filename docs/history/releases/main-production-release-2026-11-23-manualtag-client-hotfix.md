# 2026年11月23日 收藏／标签 500 热修（main-d3568fc9-hotfix1）

> 状态：历史记录 | 归档日期：2026-11-23 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 现象与影响

- 安卓客户端右上角小心心提示「收藏暂时不可用：… 500」；网页端标签列表同样受影响。
- 线上 API 日志为 `PrismaClientValidationError`：`Unknown field systemKey for select statement on model EagleManualTag`，来自 `LibraryManualTagService.listManualTags`。
- 影响：所有登录后读取标签的接口（收藏筛选、标签页、创建／重命名标签）；上传、浏览、编辑等其他路径不受影响。

## 根因

- `d3568fc9` 发布使用“以 `main-2405f5ed` 为基座、只覆盖 `apps/api/dist`、迁移和 `packages/library-persistence/dist`”的增量镜像；镜像内 `apps/api/prisma/schema.prisma` 与生成的 Prisma 客户端仍是 11-16 基座版本，不含当日新增的 `EagleManualTag.systemKey` 字段。
- 数据库迁移已正确应用（`20261123090000_manual_tag_system_key`，列为空值可空、唯一索引已建，收藏／已编辑各回填 1 个系统标签），因此不是数据问题。
- 11-20 的发布只新增索引、未改模型字段，旧客户端不受影响；`systemKey` 是 11-16 以来第一次模型字段变更。
- 原有 `test:api-image` 只验证启动就绪、匿名 401 与执行器退出，没有登录后查询，因此发布验收未覆盖该组合。

## 修复

- 以 `sekereagle/api:main-d3568fc9` 为基座构建 `sekereagle/api:main-d3568fc9-hotfix1`：拷入 `d3568fc9` 的 schema，镜像内执行 `npm run db:generate`，构建时断言生成的客户端与 schema 均包含 `systemKey`；label 保留 `org.opencontainers.image.revision=d3568fc9…` 并新增 `org.sekereagle.hotfix=manualtag-prisma-client-20261123`。
- 切换只涉及 api／operations／library-reader：先停 operations，停网关释放上游连接，停旧 api／reader，再以覆盖文件启动三个容器；等待 healthy 后校验镜像、环境变量哈希、挂载与其余容器 ID 不变，随后启动网关并 reload。
- 未触碰数据库、迁移、web、Postgres、MinIO、网关配置、计算协调器和中继。

## 验证

- 旧容器内执行与接口相同的只读查询（owner 的 `EagleManualTag`，`select systemKey`）失败；热修后 api／operations／library-reader 三容器均成功。
- 公网 `readiness` 200、匿名 `assets` 401；API 日志不再出现 `PrismaClientValidationError`。
- `test:api-image` 已增加：建临时账号 → 登录（cookie）→ GET `/api/eagle/manual-tags`、GET `/api/photos/manual-tags` 必须 200 → 创建「收藏」标签必须返回 `systemKey=FAVORITE` → 列表可见。正反对照：旧镜像 `main-d3568fc9` 在该检查处失败（500），热修镜像通过（输出 `authenticatedManualTags:true`）。
- 同时修复门禁自身在群晖上的首连挂起问题：容器刚发布端口时的首个 HTTP 连接可能悬挂，新增带兜底超时的 `fetchWithTimeout`，避免门禁静默退出。

## 证据与回退

- NAS 私有 `maintenance/manualtag-client-hotfix-20261123/`：修复 Dockerfile、schema 副本、`switch.py`、`hotfix-images.json`、`rollback.json`、切换前后服务快照、`active.json` 与门禁日志。
- 回退：API／operations／library-reader 用 `main-2405f5ed`（`rollback.json` 同目录）。不要回退到 `main-d3568fc9`，该镜像用于收藏／标签会 500。
