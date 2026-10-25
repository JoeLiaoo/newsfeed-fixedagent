# PR #93 前沿播客中英双语检索发布（2026-10-25）

本记录说明把 GitHub `main` 的提交 `f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1` 发布到火山云 `ai-work` 生产的过程与证据。该提交是 PR #93 的 squash 合并（`feat: bilingual frontier podcast search and Chinese bodies`）。

**本 PR 不合并 — record-only。** 本分支只记录发布事实，不含功能改动。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 发布提交 | `f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1`（短 `f472ad0`） |
| 对应 PR | [PR #93](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/93) `feat: bilingual frontier podcast search and Chinese bodies` |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1` |
| 发布窗口 | 2026-10-25 22:40–22:43（Asia/Shanghai；服务器为 UTC+8） |

PR #93 的内容：前沿播客专家按「原词 + 另一语言关键词」检索公开播客文字库 —— 固定对应词（如 具身智能 ↔ embodied intelligence）走对照表，其余话题只让模型扩展检索词；结果按 slug 去重，最多收录 6 集；英文节目必须存在中文要点或中文摘要，否则跳过并在产物中说明。

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 返回 `release = 7858842dc2c04d1f2e1b1527df05b66fcd152e4d`（PR #92），与预期一致；主机上 `current` 软链与 web/api/worker 三个容器镜像同为该 SHA。若公网已是目标 SHA 则应停止并报告。
- 主机 `current` → `/opt/citic-newsfeed/releases/7858842dc2c04d1f2e1b1527df05b66fcd152e4d`；四个应用容器均运行 `citic-newsfeed:7858842…`；数据库容器 `postgres:17-alpine` 启动于 `2026-10-22T01:57:27Z`，未被重建。
- `origin/main` 重新拉取后 tip 为 `f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1`，与预期 SHA 一致；发布结束后再次核对 `main` 未移动。

## 3. 发布包与完整性

- 发布包由 `git archive f472ad0` 从**重新拉取的 `origin/main`** 生成，不使用本地检出分支（本地检出分支仍是 `fix/expert-catalog-seed`）。归档 sha256 `744661ace927d4fe2845691d453d55bdc116a9cd49b195da33e58edc77cf6433`，大小 15,144,960 字节，本地与主机**逐字节一致**。
- 解包后发布目录共 1008 个文件；除被改写的 `Dockerfile.volcengine` 外，其余 1007 个文件按 sha256 逐文件比对，本地 `git archive` 与主机发布目录**完全一致**。
- 发布目录内 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`（宿主机无法直连 Docker Hub）。该改动**只存在于发布目录**：仓库中被 git 跟踪的 `Dockerfile.volcengine` 保持 `node:24-trixie-slim` 未变，未提交、未推送。发布目录是 `git archive` 解包结果而非 Git 工作树（`fatal: not a git repository`），被跟踪文件不可能被改写。

## 4. 迁移

**0 条新迁移。** PR #93 未改动任何 `.sql`：`git diff 7858842..f472ad0 -- '*.sql'` 为空。

- setup 先于新代码上线运行，退出码 **0**，输出：

  ```
  database is up to date
  sources: 0 added, 26 already there
  experts: the platform's own catalog entries are in place
  ```

- `schema_migrations`：**164 → 164** 条，最大版本 `0190_member_experts_status_coming_soon_validate.sql`，发布前后完全一致。
- 信源播种幂等（26 个信源，无新增），未改写信源数据；PR #93 不新增专家条目。
- 顺序与历次一致：构建 → `up -d --force-recreate --no-deps setup`（迁移 + 播种）→ 切换 `current` 软链 → `up -d --no-deps --force-recreate api worker web`。

## 5. 备份

| 路径 | 大小 | 权限 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-f472ad0-20261025` | 1,120 B | `0600` |
| `/opt/citic-newsfeed/shared/backups/db-before-f472ad0-20261025.dump` | 11,005,563 B | `0600` |

- `.env` 备份在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是发布前的 `7858842…`。
- `pg_dump` 显式使用 `-Fc`（自定义格式），文件头为 `PGDMP`。
- `pg_restore --list` 在数据库容器内（PostgreSQL 17 客户端）执行：**573 条 TOC 记录，可读**。宿主机 `pg_restore` 为 PostgreSQL 16.15，无法读取 PG17 转储，因此该校验必须在容器内执行。
- 未执行完整恢复演练；备份文件与旧镜像、旧发布目录一并保留。

## 6. 构建与镜像

- 构建命令使用**两份**编排文件并显式指定发布号：

  ```
  RELEASE_ID=<fullsha> docker compose -p citic-newsfeed-prod \
    -f docker-compose.yml -f compose.volcengine.yml build
  ```

  未产生游离的 `aihot-app` 镜像（`docker images aihot-app` 为空）。
- 目标镜像 `citic-newsfeed:f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1`，image id `030fea1e74ca`，776 MB。回退镜像 `citic-newsfeed:7858842dc2c04d1f2e1b1527df05b66fcd152e4d` 保留未删。
- 镜像卫生检查：`/app` 下只有 `.env.example`，没有 `/app/.env`、没有 `/app/.config`。
- 发布目录数 23 → 24，镜像数 23 → 24；**未清理任何旧发布目录或旧镜像**。

## 7. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证）：

```json
{"ok":true,"db":"ok","ms":1,"release":"f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1`；主机 loopback `http://127.0.0.1:3000/api/health` 返回同一 release。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 目标 SHA |
| `/login` | 200 | 登录页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts/frontier-podcast` | 302 → `/login?next=%2Fexperts%2Ffrontier-podcast` | **PR #93** 前沿播客专家路径，按会话鉴权 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工全局任务列表，按会话鉴权 |

> 与前几轮相同的限制：不存在的 slug 同样返回通用的 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，不能证明某个具体 slug 存在。PR #93 的代码确实在运行镜像中，由下节标记检查证明。

### PR #93 代码确认存在于运行镜像

| 标记 | 容器 | 文件 |
|---|---|---|
| `BILINGUAL_TERMS`（含 `["具身智能", "embodied intelligence"]`） | api | `modules/membership/experts/bidclub.ts` |
| `podcastQueryVariants` | api | `modules/membership/experts/bidclub.ts` |
| `expandQuery`（`collectPodcastEpisodes` 的扩展检索入参） | api | `modules/membership/experts/bidclub.ts` |
| `skippedWithoutChinese` | api | `modules/membership/experts/bidclub.ts` |
| `skippedWithoutChinese`、`expandQuery` 调用 | worker | `modules/membership/experts/worker.ts` |
| `editorialSourceLabel`、`公开播客文字库中文版`、`公开播客文字库原文`、`中英双语检索` | web | `modules/membership/experts/frontier-podcast-view.ts`、`frontier-podcast-html.ts`、`frontier-podcast-markdown.ts`、`catalog.ts` |

> 说明：`podcastQueryVariants` 与 `BILINGUAL_TERMS` 只定义在 `bidclub.ts`，`worker.ts` 通过 `collectPodcastEpisodes` 使用它们，因此 worker 容器内这两个标识符计数为 0 属预期，与仓库源码一致。

### 回归测试（运行镜像内，隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动）：

```
ℹ tests 147
ℹ pass 147
ℹ fail 0
```

命令：`node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`。上一版 `7858842` 为 144 条，**新增的 3 条来自 PR #93**：*"a Chinese topic also finds English-source episodes through the English search"*、*"English-source episodes without a Chinese edition are skipped for Chinese-backed results"*、*"an English query searches Chinese too, and a failed expansion stays visibly partial"*。临时容器使用 `--rm`，未留下容器或网络。

## 8. 范围未被触碰

- `nginx` → `active`，`hermes-agent-gateway` → `active`。`certbot.timer` 仍为 `disabled`（既有状态，未改），`ai-work-cert-renew.timer` → `active`。Nginx 上游仍为 `proxy_pass http://127.0.0.1:3000`，`nginx -t` 通过。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好。没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- web/api/worker 三个容器重建后 `restarts = 0`；最近 200 行日志中 error/fatal/unhandled/exception 扫描 **0** 处命中。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内均为 `true`，**未做任何切换**。
- 未合并任何其他 PR：#55～#61、#69、#71、#74、#76、#78、#80、#82、#85、#89、#90、#94 仍处于打开状态且未被触碰；只发布已经在 `main` 上的内容。GitHub `main` 保持 `f472ad09b73db7c0ea88fdbe2e2f4fc86b841be1` 不变，没有强推，没有改动其他仓库。
- 全过程未输出 `.env` 内容、私钥、密码或 API key；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径和数据库聚合计数。

## 9. 残余风险与待办

1. **登录后的复验仍待人工完成.** 本次发布证明了未登录边界、路由注册、静态资源、PR #93 代码确实在运行镜像中且被其服务，以及镜像内独立回归 147/147 通过；**不**证明员工侧真实渲染。仍需人工执行：用「具身智能」和「embodied intelligence」两个语言各跑一次前沿播客，确认结果中同时出现两种语言的命中、英文节目正文为中文、结果上限为 6 集且按 slug 去重、以及英文节目无中文版时被跳过并在产物中说明。
2. **模型扩展检索词仍是外部依赖.** 固定对照词之外的检索依赖平台模型扩展，本轮未在生产触发这类路径；若模型扩展失败，结果应标记为「部分结果」而不是报错，需人工确认该降级表现。
3. **公开播客文字库的收录与中文版覆盖仍是上游事实.** 平台只转述该库返回的要点与摘要，未逐条核验；引用前仍需回到来源页面核对。
4. **P0 看板仍是空壳.** 本次发布不含赛道同业竞争结论，相关板块仍显示「数据源未接入」。
5. **回退未演练.** 本轮 0 条新迁移，回退到 `citic-newsfeed:7858842…` 没有迁移风险；旧镜像、`.env` 备份与数据库转储均保留，但转储只做过格式校验（`pg_restore --list`），未在临时库中实际恢复。
6. **Docker Hub 仍不可达.** 每次构建都需在发布目录内重新做基础镜像镜像源替换，或给构建机配置代理/镜像白名单；该替换是刻意不入库的，新发布目录不重新替换就会构建失败。
7. **证书续期链路.** IP 证书 2026-10-30 UTC 到期；`certbot.timer` 被禁用是既有状态，本次未改动，需确认 `ai-work-cert-renew.timer` 持续成功。
8. **文档滞后于本次发布.** 本 PR 按要求保持打开，因此仓库中「最新发布」的文字只有在人工合并后才反映本次发布。
9. **其他打开的 PR 仍未发布.** #55～#61、#69 等功能 PR 的内容不在生产中。
10. **宿主机 `pg_restore` 无法读取 PG17 转储.** 备份格式校验必须在数据库容器内进行；若需在宿主机使用该备份，需安装 PG17 客户端。
