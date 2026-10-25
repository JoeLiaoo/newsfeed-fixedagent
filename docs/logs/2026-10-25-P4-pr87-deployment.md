# 2026-10-25 · PR #87「前沿播客」生产发布（release `8a1a3cf`）

- 对应任务：P4 生产发布流程，把已在 `main` 上的 PR #87 部署到火山云生产实例。
- 发布提交：`8a1a3cf6d5e6b7ad17c83647debcf51a801deea3`（短 `8a1a3cf`），即 GitHub `origin/main` tip，已在发布开始前重新 fetch 确认。
- 上一个生产版本：`d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8`（短 `d169c6b`，PR #88 + PR #86），发布前经公网 `/api/health` 与现场 `current` 链接双重确认。
- 状态：生产已切换到 `8a1a3cf`；本日志所在 PR 仅作记录，**不合并**。

## 做了什么与修改文件

- PR #87（squash `8a1a3cf`）把「前沿播客」专家（slug `frontier-podcast`）加入平台内置目录：按话题读取公开播客文字库，产出 beautiful-article 单文件网页摘要与 Markdown 产物。同一提交还修掉了「非自定义专家被要求写备注」的回归——判定改为按内置专家与话题类专家分别处理，备注要求只留给导入的自定义专家。
- 本轮**没有代码改动**：部署的是 `main` 上已有的提交，没有为发布改仓库源码，也没有 force-push。
- 本次只新增本日志，并更新部署手册、进度汇报与文档索引：
  - `docs/logs/2026-10-25-P4-pr87-deployment.md`（新增，本文件）
  - `docs/DEPLOY-VOLCENGINE.md`（新增 PR #87 发布小节）
  - `docs/PROGRESS-REPORT.md`（“已记录的最新生产发布” 更新为 `8a1a3cf`）
  - `docs/README.md`（日志索引新增本条）

## 关键决定与理由

- **发布顺序：先 setup，再翻 `current`，最后重建 api/worker/web。** 迁移与播种必须先于新代码对外服务，因此沿用 PR #48 / #70 / #72 / #73 / #75 / #77 / #79 / #81 / #83 / #84 / #88+#86 的同一顺序。
- **本次 0 条新迁移。** `git diff d169c6b..8a1a3cf -- '*.sql'` 为空，两个版本的迁移 `.sql` 文件清单完全一致（各 164 个文件）。setup 报告 `database is up to date`，`schema_migrations` 发布前后都是 164 行、最大版本号仍是 `0190_member_experts_status_coming_soon_validate.sql`。因此回退镜像不携带迁移风险。
- **目录播种是可重入的。** PR #87 的 seed 对 `frontier-podcast` 用 `INSERT ... ON CONFLICT(slug) DO UPDATE`，冲突分支会把 `status` 写回，因此早前版本留在别的状态上的行会被纠正而不是留在目录里冒充可用的卡片。实测发布前该行不存在（0 行），发布后为 `available` / `0.1.0` / `owner_id IS NULL` / `manifest={"tools":[]}`。信源仍是 26 条，`0 added, 26 already there`。
- **Docker Hub 仍不可达，只在发布目录内改基础镜像。** 发布目录的 `Dockerfile.volcengine` 把 `FROM node:24-trixie-slim AS base` 换成 `FROM docker.m.daocloud.io/library/node:24-trixie-slim AS base`，与上一轮发布目录里的改法一致；该目录是 `git archive` 解出来的产物，不是 Git 工作树，所以仓库中被跟踪的 `Dockerfile.volcengine` 没有被改动，也没有为此提交或推送任何内容。
- **发布内容逐文件核对。** 发布目录与本地 `git archive 8a1a3cf` 的规范化清单摘要一致（两侧同为 `ec4e57a3329e20826cdaabc981db49f00f10334d1328c559cb40b1ad6f3b15a5`，各 1005 个文件，差异只有那一个被有意改写的 `Dockerfile.volcengine`）。发布目录与本地归档的 tar sha256 也一致（`e0488ede2ec29e8ffff54bf9cc05a59aceaf24ad20fdf5aeb2fdada75c14131c`）。

## 最小验证与结果

- **发布前基线（未改动任何东西前）**：公网 `https://115.190.114.65/api/health` 返回 `release=d169c6b…`；现场 `current` → `/opt/citic-newsfeed/releases/d169c6b…`；三个应用容器运行的镜像都是 `citic-newsfeed:d169c6b…`；发布前数据库 `schema_migrations` 164 行、`sources` 26 条、`member_experts` 4 行且无 `frontier-podcast`。
- **构建**：同时使用 `-f docker-compose.yml -f compose.volcengine.yml` 构建，产出 `citic-newsfeed:8a1a3cf6d5e6b7ad17c83647debcf51a801deea3`（image id `32a550a93915`，776 MB）。没有产生多余的 `aihot-app` 镜像；镜像内只有 `.env.example`，没有 `/app/.env`、没有 `/app/.config`。
- **setup（迁移 + 播种）**：退出码 0、restarts 0，日志为 `database is up to date` / `sources: 0 added, 26 already there` / `experts: the platform's own catalog entries are in place`。发布后 `member_experts` 为 5 行，新增 `frontier-podcast|available|0.1.0`。
- **公网健康检查**（从 Joe 的 Mac 连续三次）：`{"ok":true,"db":"ok","ms":1,"release":"8a1a3cf6d5e6b7ad17c83647debcf51a801deea3"}`。
- **路由检查**（公网、未登录）：`/api/health` 200；`/login` 200；`/favicon.ico` 200；`/experts`、`/experts/frontier-podcast`、`/experts/outbound-investment-panorama`、`/tasks`、`/knowledge` 均为 302 跳转 `/login?next=…`（按会话鉴权，路由存在）。`GET /api/v1/membership/experts` 与 `GET /api/v1/membership/expert-tasks` 均返回 401 `{"error":"login_required"}`，鉴权边界保持。
- **运行镜像内的 PR #87 代码**：api 容器内 `catalog.ts` 有 `FRONTIER_PODCAST_EXPERT_SLUG = "frontier-podcast"`；`routes.ts` 里 `podcast_search` 出现 2 次、备注判定改为 `if (!BUILTIN_SLUGS.has(slugText) && !QUERY_EXPERT_SLUGS.has(slugText) && notes.length < 2)`；`seed.ts` 引用 `FRONTIER_PODCAST_EXPERT`；新增的 `bidclub.ts`、`frontier-podcast-html.ts`、`frontier-podcast-markdown.ts`、`frontier-podcast-view.ts` 四个文件都在镜像里；web 容器的 `expert-detail.tsx` 命中 `HTML_PREVIEW_EXPERT_SLUGS` / `frontier-podcast`。
- **随镜像发布的回归用例在生产镜像内跑通**：`node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`，`--network none`、无数据库、临时容器 `--rm`，**141/141 通过**（上一版 `d169c6b` 为 129/129，新增 12 项即 PR #87 的播客用例）。跑完没有残留容器。
- **发布前后只动应用容器**：web/api/worker 重建后 `restarts=0`；db 容器未重建（仍是 `2026-10-22T01:57:27` 启动）；`nginx` → `active`，`hermes-agent-gateway` → `active`，`ai-work-cert-renew.timer` → `active`，`certbot.timer` 仍是发布前就存在的 `disabled`；web 仍只映射 `127.0.0.1:3000`，api / worker / db 没有对外端口；`citic-newsfeed-prod_db` 与 `citic-newsfeed-prod_data` 两个卷都在；四个 P3 开关在 api 与 worker 里都仍是 `true`，本轮没有翻动。
- **发布前备份**（权限 `0600`，路径不含任何秘密）：
  - `/opt/citic-newsfeed/shared/.env.before-release-8a1a3cf-20261025`（1120 B；在改动 `AIHOT_RELEASE` 之前抓取，其中仍是上一版 `d169c6b…`）
  - `/opt/citic-newsfeed/shared/backups/db-before-8a1a3cf-20261025.dump`（10,909,844 B；自定义格式，文件头为 `PGDMP`）
  - `pg_restore --list` 在 **db 容器内**执行通过，573 条 TOC 条目可读。没有做完整恢复演练。
- 没有输出 `.env`、PEM、口令或密钥内容；只回读了键名、非秘密的 `AIHOT_RELEASE` 值、备份路径与聚合计数。

## 未验证事项、风险与阻碍

- **登录后的复验仍待人工完成。** 本轮证明的是：未登录边界、路由注册（含新的 `/experts/frontier-podcast`）、静态资源、PR #87 的代码确实在运行镜像里并由它提供、目录行已播种、镜像自带回归 141/141。**没有**证明员工实际看到的界面。仍需人工走一遍：
  - 「前沿播客」在专家目录里出现，详情页只有一个「话题」输入框；
  - 提交一个话题后，任务卡在沙盒 iframe 里显示网页摘要，并可下载 Markdown；
  - `/tasks` 员工全局任务记录可翻页、可按专家筛选，点进单条任务能看到详情与状态；
  - 对外投资全景图的「宁德时代」端到端：母公司候选排在前面、分支候选标「分支机构」、任务卡显示已确认主体。
- **公开播客库的服务条款、数据授权与长期可用性未核实**，平台只按公开 HTTP 接口读取；库里对所有查询都返回 `partial: true` 与 `searched_recent: 300`，即检索实际回退到最近 300 集的子串匹配，产物与页面都按这个口径写了「结果不完整」。
- **沙盒 iframe 不给 `allow-popups`**，预览里的来源链接不会新开标签页；每集的来源地址与摘要文件地址以文字印在提示框里，便于复制后自行打开。这一交互尚未在真实账号核对。
- **网页摘要随任务 `result` 一并返回**（与赛道同业看板同一做法），6 集满编时 HTML 约 30～60 KB，任务列表会重复携带；若后续集数或篇幅上调，应改为独立的鉴权预览流。
- **数据库备份只做了格式检查**，没有在隔离实例实际恢复；回退应用镜像不携带迁移风险（本次 0 条新迁移），但备份本身仍未经恢复验证。
- **Docker Hub 仍被封**：以后每次发布都要在发布目录里重做一次基础镜像改写，或给构建机配代理／镜像白名单。这个改写是有意不纳入版本控制的，所以新建的发布目录在改写前构建会失败。
- **P0 看板仍是空壳**，本版不含赛道竞争结论。GP 真实证据仍缺。
- **回退演练未做**。上一版镜像 `citic-newsfeed:d169c6b8c8114f5d7ed47f0f4b8ecc2599b0bfa8`（`47ca8014290a`）与上述备份都保留着；22 个 `citic-newsfeed` 镜像、22 个发布目录全部保留，没有 prune、没有删除旧目录或卷。
- **证书续期链**：IP 证书 2026-10-30 UTC 到期；`certbot.timer` 为 `disabled` 是发布前既有状态，本轮未改动，`ai-work-cert-renew.timer` 仍 active。
- **仓库文档滞后**：本 PR 故意不合并，所以仓库正文里的「最新生产发布」要等人工合并后才反映这次发布。上一轮的发布记录（`d169c6b`）也仍在未合并的 PR #89 里，两边改的是同一片文档区域，合并时需要人工解决。

## 下一步

- 人工登录完成上述「前沿播客」目录／提交／预览、`/tasks` 与「宁德时代」排序复验，并把结果回填本日志。
- 由人工决定何时合并本记录 PR；本 PR 不自动合并。
- 生产试用完成后，按 `docs/IMPLEMENTATION.md` 的对应验收标准更新任务勾选与员工端更新日志条目。
