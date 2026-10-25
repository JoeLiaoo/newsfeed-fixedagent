# PR #88 + PR #86 发布（火山云生产）

- 发布对象：[PR #88](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/88) `fix(experts): 全景图候选优先展示母公司` 与 [PR #86](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/86) `feat(membership): 员工全局任务记录与详情页`，以 squash 方式先后合并到 `main`，tip 提交 `d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8`（短 SHA `d169c6b`）。PR #88 的 squash 提交为 `a7d2f0d570d1bd85d54029f21f3722fa4aff4f9b`，PR #86 的 squash 提交即 tip `d169c6b`。
- 发布主机：`root@115.190.114.65`（`ai-work`），Compose 项目 `citic-newsfeed-prod`，发布根目录 `/opt/citic-newsfeed`；发布窗口 2026-10-25 21:51–21:54（服务器时区 UTC+8）。
- 发布前线上 release：`b44e574a396ec22bcfcd43a1b350e5273e010f58`（PR #83 + PR #84），在改动任何内容之前通过公网 `/api/health` 与主机侧 `current` 软链、容器镜像三重核对确认。
- 本次发布只包含 `main` 上已合并的 PR #88 与 PR #86 的代码与文档，**0 条新迁移**；仓库源码未被发布过程修改。

## 发布内容

### PR #88：全景图候选优先展示母公司

对外投资全景图的候选排序此前按「登记名是否等于或以员工输入开头」分层，分支机构因为名字更长、和输入前缀更接近，常常把母公司挡在前面。现在先比较归一化后的登记名（去空格与常见标点），被其他候选当作母公司的登记名排到最前，分支候选降到最后一层；分支判定同时看登记名前缀关系与工商类型。

候选卡片新增关系标签：本身就是分支的候选标「分支机构」，是其他候选母公司的标「母公司候选」，两者都只是提示，员工仍需自行确认主体。

涉及文件：`modules/membership/experts/data.ts`（`normalizeCompanyName`、`companyRelationLabel`、`rankCompanyCandidates`、`markBranchRelations`、`carriesQuery`）、`modules/membership/experts/catalog.ts`、`routes.ts`、`task-page.ts`、`worker.ts`、`modules/membership/module.ts`、`modules/membership/pages/expert-detail.tsx`、`pages/experts.tsx`，回归用例 `modules/membership/tests/expert-task-detail.test.ts`、`experts-search.standalone.test.ts`、`task-detail-page.standalone.test.ts`。

### PR #86：员工全局任务记录与详情页

此前员工在专家详情页里只能看到该专家自己的任务，跨专家的任务散落各处，没有一个「我跑过什么」的入口。现在新增员工全局任务记录页：跨全部可用专家列出任务、分页、可按专家筛选，每条任务带上主体、阶段、状态、产物与断点标记；任务详情页按 ID 单独读取，展示状态流转、已确认主体、材料、产物与失败原因。

后端同时补齐按 ID 读取的接口 `GET /api/v1/membership/expert-tasks/:id`，列表接口改为分页返回并附带 `pagination.nextOffset`；未登录访问一律 401 `login_required`。

涉及文件：`modules/membership/experts/routes.ts`、`task-page.ts`、`modules/membership/module.ts`、`modules/membership/pages/tasks.tsx`、`pages/task-detail.tsx`，回归用例 `modules/membership/tests/expert-task-detail.test.ts`、`expert-task-page.standalone.test.ts`、`task-detail-page.standalone.test.ts`。

## 备份与迁移基线

| 路径 | 权限 | 说明 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-d169c6b-20261025` | `0600` | `AIHOT_RELEASE` 改写前的配置副本（1,120 字节） |
| `/opt/citic-newsfeed/shared/backups/db-before-d169c6b-20261025.dump` | `0600` | 发布前数据库转储（custom 格式，10,905,620 字节，magic `PGDMP`） |

- 转储经 `pg_restore --list` 检查可读：**573 条 TOC 条目**（主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储，故使用 db 容器内的 17.11 客户端校验）。**未执行完整恢复演练。**
- `schema_migrations` 发布前后均为 **164** 条，最大迁移 `0190_member_experts_status_coming_soon_validate.sql` 未变。
- `b44e574` 与 `d169c6b` 两个发布目录的迁移文件清单完全相同（各 164 个 `.sql`，逐文件名 diff 一致），PR #88 与 PR #86 不含任何 `.sql` 变更。

## 发布步骤与结果

1. `git archive` 精确提交 `d169c6b`，归档 sha256 `8043398afc97f6a30b67f26cb36f634ef1dc1dd3d4ab628df899db0b9fd12c4c`，本机与主机一致；解包到 `/opt/citic-newsfeed/releases/d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8`（999 个文件），`.env` 软链到 `/opt/citic-newsfeed/shared/.env`。
2. Docker Hub 不可达，仅在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与仓库内受版本控制的文件相比只差这一行 `FROM`，且与上一次发布目录里改写后的文件逐字节相同，仓库源码未改、未提交。
3. 发布目录与本地 `git archive` 逐文件 sha256 比对：998 个文件（排除被改写的 `Dockerfile.volcengine`）完全一致，排序归一后的清单摘要 `942e62a91d6a19bcc5a09316640efe4cea472c4e473f8e25273623525e72f1f7` 本机与主机相同。
4. 以 `docker compose -p citic-newsfeed-prod -f docker-compose.yml -f compose.volcengine.yml build` 构建（两份编排文件同时使用），产出镜像 `citic-newsfeed:d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8`（776 MB，image id `47ca8014290a`），未产生多余的 `aihot-app` 镜像；镜像内 `/app` 无 `.env`、无 `.config/`。
5. **先跑 setup**（迁移 + 播种），退出码 0，输出：

   ```
   database is up to date
   sources: 0 added, 26 already there
   experts: the platform's own catalog entries are in place
   ```

   之后 `schema_migrations` 仍为 164 / `0190`，确认 0 条新迁移。
6. 翻转 `current` 软链到新发布目录，再以 `--no-deps --force-recreate` 重建 api、worker、web；数据库容器未重建（启动时间仍为 2026-10-22T01:57:27.232065953Z），卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未动。

## 发布后核对

- 公网 `https://115.190.114.65/api/health` 连续 3 次返回 `{"ok":true,"db":"ok","ms":1,"release":"d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8"}`；主机侧经 Nginx 回环返回同一 release；web、api、worker 容器内的 `AIHOT_RELEASE` 均为该完整 SHA。
- 路由（未登录）：`/login` 200（20,404 字节）、`/favicon.ico` 200（`image/x-icon`，852 字节）、`/experts`、`/experts/outbound-investment-panorama`、`/tasks`、`/tasks/:id`、`/knowledge` 均 302 跳转登录页；`GET /api/v1/membership/experts`、`GET /api/v1/membership/expert-tasks`、`GET /api/v1/membership/expert-tasks/:id` 均 401 `login_required`。
- 目录数据（发布后只读核对，与发布前一致）：`outbound-investment-panorama` = `available`、`sector-peer-landscape` = `available`、`company-sentiment-report` = `hidden`、`external-investment-landscape-xinhua-adapter` = `hidden`；信源 26 条；员工专家任务 4 条。
- 运行镜像内已确认含本次发布的代码：api 镜像的 `experts/data.ts` 含 `normalizeCompanyName`、`companyRelationLabel` 与 `isParent ? 0` 的新分层，web 镜像的 `pages/expert-detail.tsx` 用 `companyRelationLabel` 渲染候选关系标签；api 镜像的 `experts/routes.ts` 含 `GET /api/v1/membership/expert-tasks/:id` 与 `expertTaskPagination`，`experts/task-page.ts` 存在；web 镜像含 `pages/tasks.tsx`、`pages/task-detail.tsx`，`module.ts` 注册了 `tasks` 与 `tasks/:id`。
- **部署镜像自带的 standalone 回归全部通过**：在发布镜像内以 `node --test` 运行 `modules/membership/tests/*.standalone.test.ts`（`--network none`，不连数据库、生产数据未参与），**129 个用例全部通过**（上一轮为 120），其中包含 PR #86 的「任务详情页注册在自己的路径上」「员工任务历史跨全部专家分页」「任务页只读它展示的那一个任务」「专家页上的每条任务都打开自己的页面」，以及 PR #88 的候选排序与关系标签相关用例。
- 四个应用容器 `restarts=0`；web / api / worker 最近 200 行日志中的 error / fatal / unhandled 扫描为 **0** 命中。

## 未改动与未验收边界

- Hermes 网关、系统 Nginx、证书续期链路、数据库容器与数据卷均未触碰；四个 P3 开关保持原值（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED` 仍为 `true`）；未清理旧发布目录、旧镜像或卷（发布目录与镜像各 21 个，均未删除）。
- 只发布 `main` 上已合并的内容，未合并任何开放中的功能或文档 PR（包括 PR #87 frontier-podcast，留待后续发布）；仓库 `main` 未被改动、未 force-push。
- **登录后的复验仍待人工完成**，本记录只覆盖未登录边界、路由、运行镜像中的代码、库内状态与镜像自带的回归用例：
  - 对外投资全景图以「宁德时代」发起一次端到端：母公司候选排在前面、分支候选标「分支机构」、母公司标「母公司候选」、任务卡显示已确认主体。
  - 员工全局任务记录：跨专家任务列表能分页、能按专家筛选，点进某条任务能看到该任务的详情与状态。
- 回退未演练：本轮 0 条新迁移，回滚镜像 `citic-newsfeed:b44e574a396ec22bcfcd43a1b350e5273e010f58` 保留，`.env` 备份与数据库转储保留，但转储只做过格式检查，未在临时库中实际恢复。
- Docker Hub 仍不可达，每次发布都要在发布目录里重新做一次基础镜像改写；该改写刻意不进版本库，新发布目录默认构建会失败。
- IP 证书 2026-10-30 UTC 到期；`certbot.timer` 处于 disabled 是既有状态，本次未改动，`ai-work-cert-renew.timer` 保持 active。
- 开放中的文档 PR（#80、#82、#85 等）与本记录改动同一批 `docs/` 段落，若它们先合并，本 PR 需要 rebase 或手工处理冲突。
