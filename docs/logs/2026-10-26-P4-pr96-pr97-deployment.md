# PR #96 + PR #97 生产发布（2026-10-26）

本记录说明把 GitHub `main` 上的 `aa1323a`（PR #97）与其后到达 `main` 的 `e2daacd`（PR #99，纯文档）发布到火山云 `ai-work` 生产的过程与证据。`e2daacd` 只改文档，与 `aa1323a` 代码内容相同，因此本次发布同时包含 PR #96（前沿播客隐藏 partial 检索提示、取消 6 集上限）与 PR #97（全景图报告 HTML 预览与 Markdown 下载、移除员工可下载的采集台账 JSONL）。

**本 PR 不合并 — record-only。** 本分支只记录发布事实，不含功能改动。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 最终发布提交 | `e2daacd533086a711eed996096d75189104034df`（短 `e2daacd`） |
| 首个发布提交 | `aa1323a61602cd7cbac005f244829dc6eb4d3564`（短 `aa1323a`） |
| 对应 PR | [PR #96](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/96) `fix: remove podcast partial banner and episode cap`（合并提交 `ef1927a`）、[PR #97](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/97) `Show panorama reports as HTML and remove ledger download`（合并提交 `aa1323a`）、[PR #99](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/99) `docs: sync panorama PR merge status`（`e2daacd`，仅文档） |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/aa1323a61602cd7cbac005f244829dc6eb4d3564`、`/opt/citic-newsfeed/releases/e2daacd533086a711eed996096d75189104034df` |
| 发布窗口 | 2026-10-26 00:29–00:50（Asia/Shanghai；服务器为 UTC+8） |
| 发布前版本 | `036cb10a4a02ce44ed0e31a6ac9d84bcc7d8c224`（已含 PR #96 与文档批次 #98） |

- PR #96 的内容：前沿播客产物去掉「结果不完整」检索告警与 HTML hero 的范围标签，移除 6 集产品上限，改为按每批 3 集读取全部匹配候选；失败计数与错误处理保留。
- PR #97 的内容：成功的全景图任务在专家页与任务详情页显示 sandboxed 静态 HTML 预览，保留 Markdown 底稿下载；移除员工可下载的检查点 JSONL 接口与入口，服务端检查点与断点续跑不变。
- 提交顺序：`ef1927a`（PR #96）← `a6a35b9`（PR #94 文档）← `036cb10`（PR #95 文档）← `423d7a0`（PR #98 文档）← `aa1323a`（PR #97）← `e2daacd`（PR #99 文档）。PR #96 在本次发布前的版本 `036cb10` 中已经上线，本轮重新核对了它的标记在最终运行镜像中。

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 返回 `release = 036cb10a4a02ce44ed0e31a6ac9d84bcc7d8c224`，与预期一致；主机 `current` 软链与 web/api/worker 三个容器镜像同为该 SHA。若公网已是目标 SHA 则应停止并报告。
- `origin/main` 重新拉取后 tip 为 `aa1323a61602cd7cbac005f244829dc6eb4d3564`，与预期 SHA 一致；发布结束后再次核对 `main` 为 `e2daacd`。
- 本地检出分支（`fix/frontier-podcast-hide-partial-banner`，HEAD `f472ad0`，另有其他进程的未提交改动）**不是**发布来源；两个归档都取自重新拉取的 `origin/main` SHA 并逐文件校验，那些既有本地改动未被触碰。

## 3. 发布包与完整性

- 发布包由 `git archive` 从**重新拉取的 `origin/main`** 生成，不使用本地检出分支。归档大小均为 15,308,800 字节，sha256 本地与主机**逐字节一致**：`aa1323a` → `c0c5f4bd6c46433e250b1ff3a6ceeb2ea4dc42dc15ed0e24c5b14af650ea27e5`；`e2daacd` → `0f7e54f84deabd6c336cc19b6d29f065102d64d269c120cae39815ffd0de9075`。
- 每个发布目录 1,024 个文件，sha256 清单与本地 `git archive` 解包结果**逐文件完全一致**（0 处差异），核对在改写基础镜像前完成。
- 发布目录内 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`（宿主机无法直连 Docker Hub）。该改动**只存在于发布目录**：仓库中被 git 跟踪的 `Dockerfile.volcengine` 保持 `node:24-trixie-slim` 未变，未提交、未推送。发布目录是 `git archive` 解包结果而非 Git 工作树（`fatal: not a git repository`），被跟踪文件不可能被改写。

## 4. 迁移

**0 条新迁移。** `git diff f472ad0..e2daacd -- '*.sql'` 为空；两个发布目录各含 164 个 `.sql` 文件，与 `schema_migrations` 的 164 条已应用行一致。

- setup 先于新代码上线运行，两个发布目录的 setup 退出码均为 **0**，输出：

  ```
  database is up to date
  sources: 0 added, 26 already there
  experts: the platform's own catalog entries are in place
  ```

- `schema_migrations`：**164 → 164** 条，最大版本 `0190_member_experts_status_coming_soon_validate.sql`，第一次 setup 前捕获、两次 setup 后分别复核，数值不变。
- 信源播种幂等（26 个信源，无新增），未改写信源数据；PR #96 与 PR #97 均不新增专家条目。
- 顺序与历次一致：构建 → `up -d --force-recreate --no-deps setup`（迁移 + 播种）→ 切换 `current` 软链 → `up -d --no-deps --force-recreate api worker web`。

## 5. 备份

| 路径 | 大小 | 权限 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-aa1323a-20261026` | 1,120 B | `0600` |
| `/opt/citic-newsfeed/shared/backups/db-before-aa1323a-20261026.dump` | 11,505,417 B | `0600` |
| `/opt/citic-newsfeed/shared/.env.before-release-e2daacd-20261026` | 1,120 B | `0600` |
| `/opt/citic-newsfeed/shared/backups/db-before-e2daacd-20261026.dump` | 11,516,645 B | `0600` |

- 每份 `.env` 备份都在写入新的 `AIHOT_RELEASE` **之前**生成：第一份保存的是发布前的 `036cb10…`，第二份保存的是 `aa1323a…`。
- `pg_dump` 显式使用 `-Fc`（自定义格式），文件头为 `PGDMP`。
- `pg_restore --list` 在数据库容器内（PostgreSQL 17 客户端）执行：**573 条 TOC 记录，可读**。宿主机 `pg_restore` 为 PostgreSQL 16.15，无法读取 PG17 转储，因此该校验必须在容器内执行。
- 未执行完整恢复演练；备份文件与旧镜像、旧发布目录一并保留。

## 6. 构建与镜像

- 构建命令使用**两份**编排文件并显式指定完整发布号：

  ```
  RELEASE_ID=<fullsha> docker compose -p citic-newsfeed-prod \
    -f docker-compose.yml -f compose.volcengine.yml build
  ```

  未产生游离的 `aihot-app` 镜像（`docker images aihot-app` 为空）。
- 目标镜像 `citic-newsfeed:e2daacd533086a711eed996096d75189104034df`（image id `bbf4cdca8bc9`，776 MB）与 `citic-newsfeed:aa1323a61602cd7cbac005f244829dc6eb4d3564`（image id `3ccdb3740a53`，776 MB）。回退镜像 `citic-newsfeed:aa1323a…` 与 `citic-newsfeed:036cb10…` 保留未删。
- 镜像卫生检查：`/app` 下只有 `.env.example`，没有 `/app/.env`、没有 `/app/.config`。
- 发布目录数 25 → 27，镜像数 25 → 27；**未清理任何旧发布目录或旧镜像**。

## 7. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证）：

```json
{"ok":true,"db":"ok","ms":1,"release":"e2daacd533086a711eed996096d75189104034df"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `e2daacd533086a711eed996096d75189104034df`；主机 loopback `http://127.0.0.1:3000/api/health` 返回同一 release；`/opt/citic-newsfeed/current` → `/opt/citic-newsfeed/releases/e2daacd533086a711eed996096d75189104034df`。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 目标 SHA |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=%2Fexperts%2Ffrontier-podcast` | **PR #93／#96** 前沿播客专家路径，按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=%2Fexperts%2Foutbound-investment-panorama` | **PR #97** 全景图专家路径，按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表，按会话鉴权 |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | 知识库，按会话鉴权 |
| `/assets/expert-detail-BXUnD3r6.js` | 200（18,358 B） | 新 web bundle 公网可取；含 PR #97 标记 `全景图报告`（1 处），`采集台账` **0** 处 |

> 与前几轮相同的限制：不存在的 slug 同样返回通用的 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，不能证明某个具体 slug 存在。PR #96 与 PR #97 的代码确实在运行镜像中，由下节标记检查证明。

### PR #96 / PR #97 代码确认存在于运行镜像

| 标记 | 预期 | 容器 / 文件 | 结果 |
|---|---|---|---|
| `renderPanoramaHtml`（新增 `panorama-html.ts`，5,494 B） | 存在 | api | ✅ 第 70 行 `export function renderPanoramaHtml` |
| `panorama-html.ts` | 存在 | worker | ✅ |
| `import { renderPanoramaHtml }`、`panoramaHtml = renderPanoramaHtml(report)`、`task.expert_slug === PANORAMA_EXPERT_SLUG ? { html: panoramaHtml, format: "html", panorama: panoramaStatus }` | 存在 | api `experts/worker.ts` | ✅ 第 19／443／473／489 行 |
| `HTML_PREVIEW_EXPERT_SLUGS` 含 `PANORAMA_EXPERT_SLUG` | 存在 | api `experts/catalog.ts` | ✅ 第 146 行 |
| `checkpoint` 路由 | **0** | api `experts/routes.ts` | ✅ 0 处 |
| `panoramaCheckpointJsonl` | **0** | api `modules/membership/` | ✅ 0 处 |
| `hasCheckpoint` | **0** | web `modules/membership/pages/` | ✅ 0 处 |
| `expert-tasks/…/checkpoint` 链接 | **0** | web | ✅ 0 处 |
| `采集台账` | **0** | web `apps/web/build/` | ✅ 0 个文件 |
| `全景图报告` | 存在 | web `apps/web/build/server/index.js`、`client/assets/expert-detail-BXUnD3r6.js` | ✅ |
| `PODCAST_MAX_EPISODES`（PR #96 取消的上限） | **0** | api `modules/membership/` | ✅ 0 处 |
| `PODCAST_FETCH_CONCURRENCY = 3`（PR #96 保留的并发） | 存在 | api `experts/bidclub.ts` | ✅ 第 10／311 行 |
| `coverageLine`（PR #96 移除的覆盖／不完整提示行） | **0** | api `experts/` | ✅ 0 处 |
| `结果不完整` / `ra-aside--warning` 的提示标记 | **0** 处提示 | api `frontier-podcast-html.ts` | ✅ 2 处命中均为 CSS 类定义（`.ra-aside--warning{…}`，第 209／214 行），与上游源码逐字节一致，无提示标记残留 |

### 回归测试（运行镜像内，隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动）：

```
ℹ tests 149
ℹ pass 149
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

命令：`node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`。上一版镜像 `036cb10` 为 148 条，**新增的 1 条来自 PR #97**。临时容器使用 `--rm`，未留下容器或网络。

## 8. 两次发布步骤与两个 SHA

`origin/main` 在发布窗口内移动过一次：PR #99（`e2daacd`，纯文档，5 个文件，+9／−9）在 00:34:18 +0800 被推送到 `main`，此时 `aa1323a` 的镜像仍在构建。任务约定允许发布该 tip 的快进提交，因此本轮按时间顺序执行两步：

| 步骤 | 发布提交 | 相对上一版的变化 | 迁移 | 结果 |
|---|---|---|---|---|
| 1 | `aa1323a61602cd7cbac005f244829dc6eb4d3564` | PR #96 + 文档 #98 + **PR #97** | 0 | 已发布，健康检查 ok |
| 2 | `e2daacd533086a711eed996096d75189104034df` | **仅文档**（`README.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/README.md`、`docs/logs/2026-10-26-P2-05-panorama-html-no-ledger.md`） | 0 | 已发布，健康检查 ok → `current` |

`git merge-base --is-ancestor aa1323a origin/main` 为真；`git diff --name-only aa1323a..e2daacd` 不含任何非文档文件；`git diff aa1323a..e2daacd -- '*.sql'` 为空。因此最终生产发布提交与发布结束时的 `origin/main` tip 完全一致，发布结束后再次核对 `main` 仍为 `e2daacd`，没有再移动。

## 9. 范围未被触碰

- `nginx` → `active`，`hermes-agent-gateway` → `active`，`ai-work-cert-renew.timer` → `active`。`certbot.timer` 仍为 `disabled`（既有状态，未改）。`nginx -t` 通过；HTTPS 上游仍为 `proxy_pass http://127.0.0.1:3000`，站点仍以 `server_name 115.190.114.65` 提供 443 服务。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好。没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- 四个应用容器重建后 `restarts = 0`；最近 200 行日志中 error/fatal/unhandled/exception 扫描 **0** 处命中。api 日志只有 "Server listening"，worker 只有 "worker started"，web 只有 "web started"。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内均保持 `true`，**未做任何切换**。
- 未合并或关闭任何 PR：#55～#60、#69 与 #100 仍处于打开状态且未被触碰；只发布已经在 `main` 上的内容。`origin/main` 保持 `e2daacd533086a711eed996096d75189104034df` 不变，没有强推，没有本地提交。
- 全过程未输出 `.env` 内容、私钥、密码或 API key；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径和数据库聚合计数。
- 只删除了本次发布自己的临时产物（`/tmp/release-*.tar`、清单、纯净解包目录、构建日志、宿主机上的 `pg_restore --list` 输出，以及 Mac 上的本地归档与校验目录）。没有删除任何发布目录、镜像、卷或数据库。

## 10. 残余风险与待办

1. **登录后的复验仍待人工完成.** 本次发布证明了未登录边界、路由注册、静态资源、PR #96 与 PR #97 代码确实在运行镜像中且被其服务，以及镜像内独立回归 149/149 通过；**不**证明员工侧真实渲染。仍需人工执行：(a) 跑一次对外投资全景图，确认报告在任务卡片内以 HTML 预览呈现（`全景图报告`）；(b) 确认 Markdown 产物可从任务卡片与任务列表下载（`下载 Markdown 产物`）；(c) 确认采集台账 JSONL 下载按钮与 `/api/v1/membership/expert-tasks/:id/checkpoint` 接口已消失；(d) 跑一次前沿播客，确认不再出现「结果不完整」提示，且上游返回超过 6 集时不再被截断。
2. **未做登录后的 UI 冒烟.** 本次发布环境没有可用的登录凭据，登录门后的员工专家页面、全景图 HTML 预览与产物下载均未经手工验证。
3. **公开的全景图 HTML 是静态沙盒预览.** `renderPanoramaHtml` 在服务端转义 HTML 并渲染 Markdown 草稿，卡片用 `srcDoc` + `sandbox=""` 嵌入。该预览是**报告草稿**，不是已核定的事实集；全景图的验收边界（缺口、未核关系）仍需在报告正文中读出。
4. **采集台账不再可下载.** PR #97 移除了 JSONL 检查点导出及其按钮；检查点表仍在数据库中、仍作为 worker 状态写入，但平台不再向员工暴露。若需要台账，是新的产品决定，不是回退。
5. **回退未演练.** 本轮 0 条新迁移，回退到 `citic-newsfeed:aa1323a…`（或 `036cb10…`）没有迁移风险。两个镜像、`.env` 备份与数据库转储均保留，但转储只做过格式校验（`pg_restore --list`），未在临时库中实际恢复。
6. **Docker Hub 仍不可达.** 每次构建都需在发布目录内重新做基础镜像镜像源替换，或给构建机配置代理/镜像白名单；该替换是刻意不入库的，新发布目录不重新替换就会构建失败。
7. **证书续期链路.** IP 证书 2026-10-30 UTC 到期；`certbot.timer` 被禁用是既有状态，本次未改动，需确认 `ai-work-cert-renew.timer` 持续成功。
8. **`origin/main` 在窗口内移动过一次.** 最终发布提交与窗口结束时的 `origin/main`（`e2daacd`）一致，但本仓库有并行文档合并流程，`main` 随时可能再次移动；下次发布前应重新拉取并重新确认 tip 再归档。
9. **仓库自身记录滞后.** 本次发布任务只要求产出发布结果文件并禁止合并或关闭 PR，因此没有为这次发布创建 `docs/logs/` 条目与文档 PR（按 `AGENTS.md` 约定，通常需要一份保持打开、只作记录的文档 PR，与 PR #95／#99 同类）。仓库「最新生产发布」文字因此仍指向更早的 SHA，需人工合并本记录后才同步。
10. **宿主机 `pg_restore` 无法读取 PG17 转储.** 备份格式校验必须在数据库容器内进行；若需在宿主机使用该备份，需安装 PG17 客户端。
11. **P0 看板仍是空壳.** 公开资料检索版的赛道同业竞争看板（[PR #100](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/100)，合并提交 `cc1a5af`）在本窗口之后才合并，**不在本次发布内容中**，生产仍运行 `e2daacd`。本次发布不含任何赛道同业竞争结论，GP 真实证据仍缺。

## 11. 时间线

| 时间（服务器，UTC+8） | 步骤 |
|---|---|
| 00:29 | `git fetch origin main` → tip 确认为 `aa1323a`；发布前健康检查为 `036cb10`（公网 + 主机），`schema_migrations` 164 / `0190` |
| 00:30 | `git archive aa1323a` → 15,308,800 B，sha256 本地 ↔ 主机一致；解包到 `releases/aa1323a…`，1,024 文件清单一致；改写基础镜像（仅发布目录内）；`.env` 软链；`.env` 与数据库备份已生成，`pg_restore --list` 573 条 TOC 可读 |
| 00:31–00:44 | 构建镜像 `citic-newsfeed:aa1323a…`（776 MB，无报错） |
| 00:34:18 | ⚠️ PR #99（`e2daacd`，纯文档）由并行流程推送到 `main`——在第一次发布后用 `git ls-remote` 发现 |
| 00:44:48–00:44:59 | setup（退出码 0，"database is up to date"）→ 切换 `current` → 重建 api/worker/web；健康检查 `aa1323a` ok |
| 00:46–00:47 | `git archive e2daacd` → sha256 校验一致；解包到 `releases/e2daacd…`，清单一致；改写基础镜像与软链；备份与转储校验完成 |
| 00:47:20–00:47:45 | 构建镜像 `citic-newsfeed:e2daacd…`（命中缓存层，776 MB，无报错） |
| 00:48:09–00:48:30 | setup（退出码 0）→ 切换 `current` → 重建 api/worker/web；健康检查 `e2daacd` ok |
| 00:49–00:50 | 公网路由与标记检查、镜像内 standalone 回归 149/149、清理临时产物 |

## 12. 证据

- 本文件：`docs/logs/2026-10-26-P4-pr96-pr97-deployment.md`。
- 现场发布结果记录（维护者本地）：`~/Desktop/playground/pi-nf-96-97-deploy-result.md`。
- 前几轮：[PR #93 发布日志](2026-10-25-P4-pr93-deployment.md)（release `f472ad0`）、[文档批量合并记录](2026-10-25-P4-docs-deploy-log-batch-merge.md)（文档批次 #61–#98 → `423d7a0`）。
- 仓库内运维手册：`docs/DEPLOY-VOLCENGINE.md`。
