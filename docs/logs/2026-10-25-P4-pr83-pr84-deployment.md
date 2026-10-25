# PR #83 + PR #84 发布（火山云生产）

- 发布对象：[PR #83](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/83) `fix(experts): 对外投资全景图端到端修复` 与 [PR #84](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/84) `fix(knowledge): 有覆盖的问题答得出来`，以 squash 方式先后合并到 `main`，tip 提交 `b44e574a396ec22bcfcd43a1b350e5273e010f58`（短 SHA `b44e574`）。PR #83 的 squash 提交为 `2e1eb36577ae84e03b2ed2f26f53564ee2cf9e21`，PR #84 的 squash 提交即 tip `b44e574`。
- 发布主机：`root@115.190.114.65`（`ai-work`），Compose 项目 `citic-newsfeed-prod`，发布根目录 `/opt/citic-newsfeed`；发布窗口 2026-10-25 20:50–21:01（服务器时区 UTC+8）。
- 发布前线上 release：`e3465e58bea25b18f4f273ae60baf135721fb66f`（PR #81），在改动任何内容之前通过公网 `/api/health` 与主机侧 `current` 软链、容器镜像三重核对确认。
- 本次发布只包含 `main` 上已合并的 PR #83 与 PR #84 的代码与文档，**0 条新迁移**；仓库源码未被发布过程修改。

## 发布内容

### PR #83：对外投资全景图端到端修复

2026-10-25 的生产冒烟（查询「宁德时代」）暴露四个缺陷，本次一并修复：

- 主体检索只读了第一页候选、且停在第一个关键词，登记在册的母公司被自己的分支挡住，员工只能选到分支。现在按页读取候选，并反查分支所依据的登记名，母公司排在前面。
- 候选本身是分支时，页面直接说明，不再把员工带进一个没有对外投资的主体。
- 平台的 `not_found` 答复曾被当成「页面没读完」，文本环节失败还会把整份底稿带走。现在底稿在没有摘要时依然成立，并写明缺了哪一段。
- 文本环节的失败原因此前一律显示同一句通用文案。现在模型侧有自己的错误码，页面显示服务端给出的中文原因。

任务列表同时返回已确认主体，卡片显示员工输入的名称、已确认主体与北京时间。发布期间网关 502 现在按 API 自身的形状作答；同一次提交重试复用同一个幂等键，因此返回第一次可能已经建好的任务，而不是再起一个。

涉及文件：`modules/membership/experts/data.ts`、`worker.ts`、`routes.ts`、`panorama-run.ts`、`panorama-markdown.ts`、`catalog.ts`、`modules/membership/pages/expert-detail.tsx`、`apps/web/app/lib/api-proxy.server.ts`，回归用例 `modules/membership/tests/panorama.standalone.test.ts`、`panorama-db.test.ts`。

### PR #84：知识库问答脚注合同

2026-10-25 的生产冒烟提问「AGI 六问」（知识库 `kb-4e7f876c7f74`）两次返回 HTTP 502，页面说答案没有可核对的引用。模型调用其实成功了：核对环节拒绝了答案，因为它只接受数字脚注标记，而下发给模型的载荷用的是知识库自己的来源标签；它还要求逐字出现页面标识符，而该标识符带库前缀与去重后缀。被拒的答案随后留在模型回执里，于是每次重试都重放同一份被拒输出——不是偶发，而是无尽重放。

现在由平台给这一轮的问答编号脚注、模型写这个编号；脚注也可以引用页面的来源标签，被截短的页面名仍指向同一页面。库里放不下的论断仍然整体拒绝，归因仍然来自知识库自己的记录。被拒的答复不是网关故障：它以 422 和诚实的文案作答，而模型根本不可达时仍然是 502。被拒答复的回执会被释放，下一次提问会重新调用模型；无覆盖路径仍然是 422。

涉及文件：`modules/membership/knowledge/answer.ts`、`routes.ts`、`catalog.ts`、`prompts.ts`、`modules/membership/pages/expert-detail.tsx`，回归用例 `modules/membership/tests/knowledge-core.standalone.test.ts`、`knowledge-access.test.ts`。

## 备份与迁移基线

| 路径 | 权限 | 说明 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-b44e574-20261025` | `0600` | `AIHOT_RELEASE` 改写前的配置副本（1,120 字节） |
| `/opt/citic-newsfeed/shared/backups/db-before-b44e574-20261025.dump` | `0600` | 发布前数据库转储（custom 格式，10,777,178 字节，magic `PGDMP`） |

- 转储经 `pg_restore --list` 检查可读：573 条 TOC 条目（主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储，故使用 db 容器内的 17.11 客户端校验）。**未执行完整恢复演练。**
- `schema_migrations` 发布前后均为 **164** 条，最大迁移 `0190_member_experts_status_coming_soon_validate.sql` 未变。
- `e3465e5` 与 `b44e574` 两个发布目录的迁移文件清单完全相同（各 164 个 `.sql`，逐文件名 diff 一致），PR #83 与 PR #84 不含任何 `.sql` 变更。

## 发布步骤与结果

1. `git archive` 精确提交 `b44e574`，归档 sha256 `942551f98551dff334272f91e46948be0b87a9ad3b48cf9e5d74ddccb7278c39`，本机与主机一致；解包到 `/opt/citic-newsfeed/releases/b44e574a396ec22bcfcd43a1b350e5273e010f58`（990 个文件），`.env` 软链到 `/opt/citic-newsfeed/shared/.env`。
2. Docker Hub 不可达，仅在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与仓库内受版本控制的文件相比只差这一行 `FROM`，且与上一次发布目录里改写后的文件逐字节相同，仓库源码未改、未提交。
3. 发布目录与本地 `git archive` 逐文件 sha256 比对：989 个文件（排除被改写的 `Dockerfile.volcengine`）完全一致，排序归一后的清单摘要 `ff54d94ced9ffd88d83e7b89a986ffa6a970c9cb33205bb687864cb1e74cdf07` 本机与主机相同。
4. 以 `docker compose -p citic-newsfeed-prod -f docker-compose.yml -f compose.volcengine.yml build` 构建（两份编排文件同时使用），产出镜像 `citic-newsfeed:b44e574a396ec22bcfcd43a1b350e5273e010f58`（776 MB，image id `3bca5c748981`），未产生多余的 `aihot-app` 镜像；镜像内 `/app` 无 `.env`、无 `.config/`。
5. **先跑 setup**（迁移 + 播种），退出码 0，输出：

   ```
   database is up to date
   sources: 0 added, 26 already there
   experts: the platform's own catalog entries are in place
   ```

   之后 `schema_migrations` 仍为 164 / `0190`，确认 0 条新迁移。
6. 翻转 `current` 软链到新发布目录，再以 `--no-deps --force-recreate` 重建 api、worker、web；数据库容器未重建（启动时间仍为 2026-10-22T01:57:27.232065953Z），卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未动。

## 发布后核对

- 公网 `https://115.190.114.65/api/health` 连续 3 次返回 `{"ok":true,"db":"ok","ms":1,"release":"b44e574a396ec22bcfcd43a1b350e5273e010f58"}`；主机侧经 Nginx 回环返回同一 release；web、api、worker 容器内的 `AIHOT_RELEASE` 均为该完整 SHA。
- 路由（未登录）：`/login` 200（20,404 字节）、`/favicon.ico` 200（`image/x-icon`，852 字节）、`/experts`、`/experts/outbound-investment-panorama`、`/knowledge`、`/more` 均 302 跳转登录页、`GET /api/v1/membership/experts` 401 `login_required`。
- 目录数据（发布后只读核对，与发布前一致）：`sector-peer-landscape` = `available`、`company-sentiment-report` = `hidden`、`outbound-investment-panorama` = `available`、`external-investment-landscape-xinhua-adapter` = `hidden`。
- 知识库数据（发布后只读核对）：`kb-4e7f876c7f74`（AI for science，13 页）仍为 `active`，`shared`（知识库示例）仍为 `active`。
- 运行镜像内已确认含本次修复的代码：api 镜像的 `experts/routes.ts` 有 `selectedEntity` 与幂等键处理，`experts/data.ts` 有分支判定与分页取数；web 镜像的 `pages/expert-detail.tsx` 有 `api_unavailable` 与 `selectedEntity`；api 镜像的 `knowledge/answer.ts` 有脚注编号与 `rejectReceivedResponse`，`knowledge/routes.ts` 有 422 / 502 / 无覆盖分支。
- **部署镜像自带的 standalone 回归全部通过**：在发布镜像内以 `node --test` 运行 `modules/membership/tests/*.standalone.test.ts`（`--network none`，不连数据库、生产数据未参与），**120 个用例全部通过**，其中包含 PR #83 的「provider 分页按 next offset 推进」「没有记录的列表说不出来，而不是当成没读完」「没有正文的底稿仍带着表格、缺口与账本」，以及 PR #84 的脚注与拒绝相关用例。
- 四个应用容器 `restarts=0`；web / api / worker 最近 200 行日志中的 error / fatal / unhandled 扫描为 **0** 命中。

## 未改动与未验收边界

- Hermes 网关、系统 Nginx、证书续期链路、数据库容器与数据卷均未触碰；四个 P3 开关保持原值（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED` 仍为 `true`）；未清理旧发布目录、旧镜像或卷（发布目录与镜像各 20 个，均未删除）。
- 只发布 `main` 上已合并的内容，未合并任何开放中的功能或文档 PR；仓库 `main` 未被改动、未 force-push。
- **登录后的复验仍待人工完成**，本记录只覆盖未登录边界、路由、运行镜像中的代码、库内状态与镜像自带的回归用例：
  - 对外投资全景图以「宁德时代」发起一次端到端：母公司候选排在前面、分支候选说明自己是分支、任务卡显示已确认主体、文本环节失败时底稿仍在并给出中文失败原因、同一次提交重试不重复建任务。
  - 知识库问答「AGI 六问」（库 `kb-4e7f876c7f74`）应返回 **200** 并带可核对的脚注；无覆盖的问题仍应返回 **422**；模型不可达时仍是 502。
- 回退未演练：本轮 0 条新迁移，回滚镜像 `citic-newsfeed:e3465e58bea25b18f4f273ae60baf135721fb66f` 保留，`.env` 备份与数据库转储保留，但转储只做过格式检查，未在临时库中实际恢复。
- Docker Hub 仍不可达，每次发布都要在发布目录里重新做一次基础镜像改写；该改写刻意不进版本库，新发布目录默认构建会失败。
- IP 证书 2026-10-30 UTC 到期；`certbot.timer` 处于 disabled 是既有状态，本次未改动，`ai-work-cert-renew.timer` 保持 active。
