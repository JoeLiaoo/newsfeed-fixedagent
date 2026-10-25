# PR #114 员工端更新日志待发布流程与回填发布（release `300e527`）

- Agent：pi coding agent（docs-only 发布记录）
- 对应任务：维护任务（不对应 P0–P5 验收项）；本轮只记录发布事实，不含应用代码改动
- 完成状态：发布完成（生产现为 `300e527`）；**登录后的员工侧验收仍未完成**

**本 PR 不合并 — record-only for human review。** 本分支只记录发布事实，不含应用代码改动，也不部署。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 最终生产版本 | `300e527aa555d6ec1dafef428b0ac045ea56b906`（短 `300e527`） |
| 对应 PR | [PR #114](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/114) `Apply pending employee changelog on release and backfill shipped updates`（合并提交 `300e527`，合并于 2026-10-26 07:24 CST） |
| 发布前生产版本 | `781f6d1d450ed71bcf0f1738908e54aa173090ea`（短 `781f6d1`，[PR #113](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/113)） |
| 本轮包含的代码 PR | [PR #114](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/114)（`300e527`）员工端更新日志「待发布文件 → 发布时统一写入」流程与已上线功能的员工公告回填 |
| 本轮包含的文档 | [PR #114 随镜像发布的日志](2026-10-26-employee-changelog-deploy.md)、[北京时间门禁记录](2026-10-26-pr114-beijing-time-ci.md) 与 `docs/DEPLOY-VOLCENGINE.md`、`docs/IMPLEMENTATION.md`、`docs/README.md` 更新 |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/300e527aa555d6ec1dafef428b0ac045ea56b906` |
| 发布窗口 | 2026-10-26 07:24–07:33（Asia/Shanghai；服务器为 UTC+8） |

本轮代码内容（详见[更新日志待发布流程日志](2026-10-26-employee-changelog-deploy.md)与[北京时间门禁记录](2026-10-26-pr114-beijing-time-ci.md)）：

- **待发布机制**：功能 PR 为每个员工可见变更集在 `site/changelog/pending/` 放一个 JSON（类型、标题、正文、可选重要标记），发布负责人在**将要构建的 Git tip** 上运行 `npm run changelog:apply`，整批使用同一个北京时间分钟写入 `site/changelog.json` 并删除已应用文件；重试按内容跳过已写入记录，无待发布文件时不改动数据，时间倒退时报错以防红点版本回退。
- **已上线功能回填**：为此前已上线但未出现在员工更新日志里的能力补写 5 条待发布条目并应用，使 `latestVersion` 从 `2026-10-25T16:27` 变为 `2026-10-26T07:15`。
- 未改动 schema、业务规则、数据库迁移与员工界面既有功能；新增的 `scripts/apply-employee-changelog.ts` 只在发布准备阶段运行，运行中的后端从镜像内 `REPO_ROOT/site/changelog.json` 读取并缓存。

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 与主机 `current` 软链、web/api/worker 容器镜像一致为 `781f6d1`（PR #113），与预期一致后才开始发布。
- `git fetch origin main` 的 tip 恰为任务给定的期望 tip `300e527aa555d6ec1dafef428b0ac045ea56b906`；`gh` 确认 PR #114 状态为 `MERGED`（合并于 2026-10-25T23:24:21Z）、合并提交即该 SHA，CI 三项（`links`、`postgres-integration`、`quality`）全绿。
- `781f6d1..300e527` 是 PR #114 的合并提交（11 个文件，+287／−1），为**快进**，无分叉。
- 发布结束时再次 `git fetch`，`origin/main` 仍为 `300e527`，未再移动。

## 3. 发布包与完整性

| 项 | 值 |
|---|---|
| 来源 | 重新拉取的 `origin/main` SHA 的 `git archive`（非本地工作树） |
| 归档大小 | 15,554,560 B（1,135 个 tar 条目） |
| 归档 sha256（本地 ↔ 主机） | `1fefed51b9b5636ab80a5582dded9858ebe6ca087b1bfe3166a3209b8e772ca3` — 逐字节一致 |
| 归档文件数 | 1,053，其中 `.sql` **164** 个 |
| 全树 sha256 清单比对 | 与本地解包一致（清单 `6eb10381f79f5fcbc53d8797b0c520ebe20b711bf119535d851805fff25fe7cc`） |
| 基础镜像替换后的清单 | `3c7515efa2aaa4d749d70fb4ec6210602bd2824a73f8fe1af8f89cb0db2ffc49` — 与干净清单的差异**恰好一个文件**：`./Dockerfile.volcengine` 的单条 `FROM` |
| 镜像 | `citic-newsfeed:300e527aa555d6ec1dafef428b0ac045ea56b906`，id `38abe38739ee`，777 MB |
| 发布目录 | `/opt/citic-newsfeed/releases/300e527aa555d6ec1dafef428b0ac045ea56b906`（`.env` 软链到 `shared/.env`） |
| 游离 `aihot-app` 镜像 | **0** |

- **Docker Hub 在主机上仍不可达**（`curl https://registry-1.docker.io/v2/` 失败；DaoCloud 镜像可达），因此只在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`。仓库中被 git 跟踪的文件未改（发布目录是 `git archive` 解包结果而非 Git 工作树），也没有为此提交或推送任何内容。
- 本轮使用独立的只读克隆 `~/Desktop/playground/nf114-deploy-src`（`git clone --no-checkout`），未触碰任何既有工作副本；其引用只指向 `origin/*`，没有本地提交，也没有推送。
- 发布目录数与镜像数 35 → 36，**未 prune、未删除任何旧发布目录或旧镜像**；上一版 `781f6d1` 及更早镜像全部保留，回退只需按镜像 tag 切换。

## 4. 迁移

**0 条新迁移。**

- `git diff 781f6d1..300e527 -- '*.sql'` 为空；发布归档内含 **164** 个 `.sql` 文件，与已应用的 164 行迁移一致。
- setup 先于新代码上线运行，退出码 **0**、restarts 0，输出：

  ```
  database is up to date
  sources: 0 added, 26 already there
  experts: the platform's own catalog entries are in place
  ```

- `schema_migrations`：发布前后均为 **164** 条，最大版本 `0190_member_experts_status_coming_soon_validate.sql`。
- 顺序与历次一致：构建 → `up -d --force-recreate --no-deps setup`（迁移 + 播种）→ 切换 `current` 软链并更新 `AIHOT_RELEASE` → `up -d --no-deps --force-recreate api worker web`。

## 5. 备份

| 版本 | `.env` 备份（`0600`） | 数据库转储（`0600`） | 转储大小 | `pg_restore --list` |
|---|---|---|---|---|
| `300e527` | `shared/.env.before-release-300e527-20261026`（1,120 B） | `shared/backups/db-before-300e527-20261026.dump` | 11,888,032 B | 573 条 TOC |

- `.env` 备份在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是上一版 release `781f6d1`。
- `pg_dump` 使用 `-Fc`（自定义格式），文件头为 `PGDMP`。`pg_restore --list` 在**数据库容器内**（PostgreSQL 17.11 客户端）执行；宿主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储。
- **只做了格式校验，未做完整恢复演练**（沿用历轮边界）。

## 6. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证，发布结束后复查 5 次）与主机 loopback `http://127.0.0.1:3000/api/health` 返回同一结果：

```json
{"ok":true,"db":"ok","ms":1,"release":"300e527aa555d6ec1dafef428b0ac045ea56b906"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `300e527aa555d6ec1dafef428b0ac045ea56b906`；主机 `current` → `/opt/citic-newsfeed/releases/300e527aa555d6ec1dafef428b0ac045ea56b906`；`shared/.env` 的 `AIHOT_RELEASE` 同值（权限 `0600`）。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 发布 tip |
| `/` | 302 → `/login?next=%2F` | 根路径按会话鉴权 |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/changelog` | 302 → `/login?next=%2Fchangelog` | 员工端更新日志页，按会话鉴权 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/sector-peer-landscape` | 302 → `/login?next=…` | 按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表，按会话鉴权 |
| `/tasks/abc123` | 302 → `/login?next=%2Ftasks%2Fabc123` | 任务详情，按会话鉴权 |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | 按会话鉴权 |
| `/knowledge-bases` | 302 → `/login?next=%2Fknowledge-bases` | 按会话鉴权 |
| `/account/artifacts` | 302 → `/login?next=%2Faccount%2Fartifacts` | 按会话鉴权 |
| `/notifications` | 302 → `/login?next=%2Fnotifications` | 按会话鉴权 |
| `/profile` | 302 → `/login?next=%2Fprofile` | 按会话鉴权 |
| `GET /api/v1/membership/me` | 401 | API 鉴权边界 |
| `GET /api/site/changelog` | **401 `login_required`** | 按会话鉴权，`cache-control: private, no-store` |
| `GET /api/site/meta` | **401 `login_required`** | 按会话鉴权，`cache-control: private, no-store` |

> `/api/site/changelog` 与 `/api/site/meta` **不是公开路由**：未登录时返回 `401 {"error":"login_required"}`，这在发布前的 `781f6d1` 基线上**同样成立**，PR #114 没有改变它们的暴露范围。本环境没有可用凭据，也不允许编造，因此改在运行中的 api 容器内读取同一代码路径（见下节）。
> 与历轮相同的限制：不存在的 slug 同样返回通用 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，**不证明某个具体实体存在**。

### `latestVersion` 已在运行容器内确认

在**已部署、正在运行**的 api 容器内读取后端实际使用的数据源（`packages/backend/src/site/meta.ts::loadChangelog()` → `siteMeta()`，与路由返回同一函数）：

```json
{"latestVersion":"2026-10-26T07:15","releases":10,"meta":{"changelogVersion":"2026-10-26T07:15"}}
```

- **`latestVersion` = `2026-10-26T07:15`**，与本 tip 上 `site/changelog.json` 的取值一致；镜像内 `/app/site/changelog.json` 也确认为 `"latestVersion": "2026-10-26T07:15"`。
- `siteMeta().changelogVersion`（即 `/api/site/meta` 背后的值）与更新日志页的 `latestVersion` 相同，红点版本与更新日志页一致。
- 共 **10** 条 release 记录，最新在前，全部标注 `2026-10-26 07:15`，即 PR #114 回填并应用的那一批。
- 后端在启动时从镜像内 `REPO_ROOT/site/changelog.json` 读取并缓存，因此运行容器的副本是权威值。

### PR #114 的机制在已发布镜像内确认

| 检查 | 结果 |
|---|---|
| 镜像内 `site/changelog/pending/` | 只有 `README.md` 与 `.gitkeep`，**没有待发布 `*.json`** |
| 在已发布镜像上跑 `npm run changelog:apply` | 输出 **`no pending changelog`** —— 该 tip 已带应用后的状态，发布时没有重复应用 |
| `scripts/apply-employee-changelog.ts` | ✅ 在镜像内 |
| `package.json` 的 `changelog:apply` 命令 | ✅ 已接线（第 26 行） |
| `tests/employee-changelog.standalone.test.ts`（`--network none`） | **5 / 5 通过**（解析字段白名单；一个北京时间戳 + 按文件名顺序前插 + 删除待发布文件；无效批次不改动更新日志与待发布目录；重试时按内容跳过已存在条目；时钟回退不能使红点版本变旧） |
| PR #114 随镜像发布的文档 | `docs/DEPLOY-VOLCENGINE.md` 的更新日志发布小节、`docs/logs/2026-10-26-employee-changelog-deploy.md`、`docs/logs/2026-10-26-pr114-beijing-time-ci.md` 均在镜像内 |
| 镜像 `/app` | 只有 `.env.example`，**没有 `.env`、没有 `.config/`** |

### 线上数据读回（发布后）

生产专家目录无重复行：`company-sentiment-report` = `hidden`、`external-investment-landscape-xinhua-adapter` = `hidden`、`frontier-podcast` = `available`、`outbound-investment-panorama` = `available`、`sector-peer-landscape` = `available`。发布后数据行数：`sources` = 26、`member_experts` = 5、`member_wiki_bases` = 2。

## 7. 镜像内回归（隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动、`--rm`）：

| 镜像 | membership 范围 | 全量范围 |
|---|---|---|
| `781f6d1`（发布前基线） | 164 / **164 通过** / 0 失败 | 392 / 377 通过 / **15 失败** |
| `300e527`（已发布） | **164 / 164 通过** / 0 失败 | **397 / 382 通过** / 15 失败 |

- 15 个失败在**发布前基线镜像上完全相同**（两次抓取失败用例名后排序 `diff` 结果为空）：文章／日报／周报／月报元数据、主题路径的解码控件、过滤后的订阅、普通订阅页与首个主题页、普通分享卡片、过大 MCP 请求、公开只读端点的方法限制、故事元数据、`tests/migration-check.standalone.test.ts`、首页与创始人相关断言。它们需要可用的本地服务器或临时数据库，属既有环境性失败，**非本次发布引入**。
- membership 套件在两个镜像都全绿且数量不变（PR #114 不涉及 membership 模块）。
- 全量套件增加 **5** 条，正是 PR #114 新增的 `tests/employee-changelog.standalone.test.ts`（单独运行 5/5 通过）。

## 8. 范围未被触碰

- `nginx` → `active`，`nginx -t` 通过；`hermes-agent-gateway` → `active`；`ai-work-cert-renew.timer` → enabled + active（最近一次 2026-10-26 03:48:38 CST，`certbot.timer` 仍为 `disabled`，属既有状态，未改）。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好；没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- 三个应用容器重建后 `restarts=0`；web/api/worker 最近 300 行日志中 error/fatal/unhandled/exception/panic 扫描 **0 处命中**。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内仍为 `true`，**未做任何切换**（`MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` 同样保持 `true`）。
- 未合并或关闭任何 PR，**没有 force-push**，没有本地提交应用代码，没有改应用代码；`origin/main` 只被读取。
- 全过程未输出 `.env` 内容、私钥、密码或供应商原始响应；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径、目录字符串与聚合计数。
- 发布结束后磁盘剩余 35 GiB（总 79 GiB，占用 54%），仅新增 1 个发布目录与 1 个镜像。

## 9. 未验证事项

1. **没有登录后的员工冒烟。** 本环境没有凭据，也不允许编造，因此登录门之后的页面均未人工核对——包括员工端更新日志页 `/changelog` 和红点标记。页面背后的**数据**已确认（`latestVersion = 2026-10-26T07:15`、10 条记录，见上节），但**渲染出来的页面**与每位员工的已读／未读状态仍需登录后人工检查。
2. **`/api/site/changelog` 与 `/api/site/meta` 未能通过 HTTP 读取。** 两者都在会话鉴权之后（401 `login_required`，与发布前基线一致），因此改在运行容器内读取进程内取值；那是路由返回的同一个函数，但**不是 HTTP 层面的证明**。
3. **没有发起真实模型或检索任务。** PR #114 是更新日志发布与工具链改动，不涉及运行时模型路径；但这轮发布因此没有顺带验证平台的模型／检索行为。
4. **没有回退演练，也没有完整数据库恢复演练。** 本轮 0 条新迁移，回退到 `781f6d1` 或更早镜像都没有迁移风险；旧镜像、`.env` 备份与转储都保留，但转储只做过格式校验（`pg_restore --list`），从未恢复到临时库。
5. **发布当时没有仓库内日志与文档 PR。** 那一轮发布按任务要求只产出结果文件，仓库 `AGENTS.md` 的「每次发布留 `docs/logs/` 记录」约定未执行；本 PR 补记该发布事实。
6. **仓库的发布记录仍然滞后。** PR #114 随镜像发布的文档只描述已合并的 PR，没有写明生产当前服务的版本号；本次由本 PR 记录。
7. **员工侧验收仍未完成。** 镜像自带套件通过只证明代码路径可跑，**部署不等于验收**：仍需有人登录后确认更新日志页可见、10 条公告内容正确、红点按已读状态变化。

## 10. 残余风险

1. **`origin/main` 随时可能移动。** 本轮结束时重新拉取确认仍是 `300e527`，但此前几轮曾出现发布窗口内 tip 移动；下次发布必须重新拉取并重新确认 tip 后再归档。
2. **更新日志发布仪式现在有两个写入方。** PR #114 既在 `main` 上**应用了**待发布批次，也**发布**了部署手册要求发布负责人在构建 tip 上运行的 `changelog:apply` 工具。本 tip 上两者一致（待发布目录为空 → `no pending changelog`），所以这次是纯快进、没有重复应用；但**下一个**新增 `site/changelog/pending/*.json` 的 PR 不能在 `main` 上应用一次、又在发布 tip 上再应用一次——只应用一次，并在构建前用 `git diff site/changelog.json site/changelog/pending` 复核，正如 `docs/DEPLOY-VOLCENGINE.md` 所写。
3. **`latestVersion` 是北京时间分钟戳。** 本次为 `2026-10-26T07:15`，即 PR #114 应用脚本运行的分钟，不是发布分钟的固定值。应用脚本拒绝比当前 `latestVersion` 更早的时间戳，因此回填不能让红点版本回退；但若某次发布没有任何待发布条目，`latestVersion` 会保持旧值，**员工看不到新的红点**，即使应用本身已经更新。下一轮需留意。
4. **Docker Hub 仍被阻断。** 每次构建都要在发布目录内重新做基础镜像替换，或给构建机配置代理／镜像白名单；该替换刻意不入库，新发布目录不重做就会构建失败。
5. **证书续期链路。** IP 证书 2026-10-30 10:32 UTC 到期（发布时约剩四天）；`certbot.timer` 被禁用是既有状态未改，`ai-work-cert-renew.timer` 处于启用且成功运行状态，需确认其持续成功。
6. **宿主机 `pg_restore` 无法读取 PG17 转储。** 备份格式校验必须在 db 容器内进行；若需在宿主机使用备份，需安装 PG17 客户端。
7. **15 个既有 standalone 失败仍为红色。** 与本次发布无关，但会持续干扰把全量套件当作发布闸门，需修复或从镜像内检查中排除。

## 11. 时间线（服务器时间，UTC+8）

| 时间 | 步骤 |
|---|---|
| 07:24 | SSH 可达性检查；发布前核对：`current` 软链、容器镜像与 `.env` 均为 `781f6d1`，公网 `/api/health` 一致；`schema_migrations` 164 / 最大 `0190`；35 个发布目录与 35 个镜像；nginx、hermes、证书 timer 状态正常 |
| 07:25 | `git fetch origin main` → tip 恰为期望 tip `300e527`；`gh` 确认 PR #114 已合并，`781f6d1..300e527` 为快进 |
| 07:25 | `git archive 300e527` → 15,554,560 B，sha256 `1fefed51…` 本地 ↔ 主机一致；1,053 文件 / 164 `.sql`；`git diff 781f6d1..300e527 -- '*.sql'` 为空 |
| 07:26 | 建发布目录；1,053 文件清单与本地解包一致；基础镜像替换（只在发布目录内）；`.env` 备份 + `pg_dump -Fc` 转储（`0600`）；`pg_restore --list` → 573 条 TOC |
| 07:26–07:28 | 构建镜像 `citic-newsfeed:300e527…`（777 MB，退出码 0，无游离 `aihot-app`） |
| 07:28 | setup → 退出码 0，「database is up to date」「sources: 0 added, 26 already there」「experts: the platform's own catalog entries are in place」；迁移复核仍为 164 / `0190` |
| 07:28 | 切换 `current` 软链与 `AIHOT_RELEASE`；api / worker / web 重建（`restarts=0`）；主机与公网 `/api/health` → `ok=true`、`db=ok`、release `300e527…` |
| 07:28–07:30 | 公网路由检查（含 `/changelog` 跳登录、`/api/site/*` → 401）；容器内 `loadChangelog()` 读回（`latestVersion 2026-10-26T07:15`，10 条）；镜像内 `changelog:apply` → `no pending changelog`；PR #114 自带的 5 条用例 5/5 |
| 07:30–07:32 | 镜像内 standalone 套件：已发布镜像（membership 164/164；全量 397/382/15）与发布前基线 `781f6d1`（164/164；392/377/15），失败集合完全相同 |
| 07:32–07:33 | 范围／服务／卷／证书核对；临时产物清理（主机与本地）；线上专家目录与行数读回 |
| 07:33 | 最终 `git fetch` 确认 `origin/main` = `300e527`（未漂移）；公网 `/api/health` 复查 5 次 → release `300e527…` |

## 12. 本次（文档）改动与最小验证

- 修改文件：`docs/logs/2026-10-26-P4-pr114-deployment.md`（本文件，新增）、`docs/DEPLOY-VOLCENGINE.md`、`docs/PROGRESS-REPORT.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、`README.md`。
- 实际完成：把 `300e527` 记录为**当前生产版本**，并写明发布前的 `781f6d1`（PR #113）、0 条新迁移、备份与回退路径、`latestVersion = 2026-10-26T07:15` 的容器内确认，以及「未做登录后验收」的缺口。
- 关键决定：
  - **不复制其他打开的文档 PR 的日志文件。** 记录 release `e2daacd`（PR #96 + #97）的 [文档 PR #101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101)、记录 release `cc1a5af`（PR #100）的 [文档 PR #102](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/102)、记录 release `55244fc`（功能批次）的 [文档 PR #108](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/108)、记录 release `07488ac`（员工端 UI 与后端复核）的 [文档 PR #111](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/111)、记录 release `781f6d1`（PR #113 membership JSON 模式提示词）的 [文档 PR #115](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/115) **仍处于打开状态**，其独有日志文件不在本 PR 中重复加入；合并顺序应按发布先后（`e2daacd` → `cc1a5af` → `55244fc` → `07488ac` → `781f6d1` → `300e527`），即 #101 → #102 → #108 → #111 → #115 → 本 PR。
  - 本 PR 只写文档，**不合并、不部署、不改应用代码**；`300e527` 已是生产版本，本 PR 不改变任何开关或数据。
  - `docs/IMPLEMENTATION.md` 的任务勾选**不变**：本轮只是发布，没有新增验收证据，P2-05、P3-01～P3-04、P4-03／P4-04 与 P5 仍为 `[ ]`；只在 P4 小节补记合并、发布状态与验收缺口。
  - 「未做登录后验收」与「两个 `/api/site/*` 路由在会话之后」在日志、运维手册、进度汇报与 README 中统一表述，**不把发布写成业务验收通过**。
  - 本 PR 与发布管线无关：不含 `Closes #26`／`#27`／`#28` 等任何 Issue 关联，也不改动构建、发布或迁移流程。
- 执行的检查及结果：`node scripts/check-doc-links.ts` 通过（本地 Markdown 链接全部可解析）；`git diff --check` 通过。
- 未执行或需用户试用的检查：未连接生产实例复核（本次事实来自同一轮发布执行的记录）；未发起真实模型调用；未做登录后员工验收（需人工登录后核对更新日志页、10 条公告与红点已读状态）。
- 下一步：人工登录后确认员工端更新日志页与红点行为；并决定 #101／#102／#108／#111／#115 与本 PR 的合并顺序。
