# PR #113 membership JSON 模式提示词生产发布（release `781f6d1`）

- Agent：pi coding agent（docs-only 发布记录）
- 对应任务：维护任务（不对应 P0–P5 验收项）；本轮只记录发布事实，不含应用代码改动
- 完成状态：发布完成（生产现为 `781f6d1`）；**真实模型调用与员工侧验收仍未完成**

**本 PR 不合并 — record-only for human review。** 本分支只记录发布事实，不含应用代码改动，也不部署。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 最终生产版本 | `781f6d1d450ed71bcf0f1738908e54aa173090ea`（短 `781f6d1`） |
| 对应 PR | [PR #113](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/113) `fix: require JSON objects in remaining membership chat prompts`（合并提交 `781f6d1`，合并于 2026-10-26 07:12 CST） |
| 发布前生产版本 | `4a68295209bfb941d3c86519dc5f2ffd7d1ad7d2`（短 `4a68295`，[PR #112](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/112)） |
| 本轮包含的代码 PR | [PR #113](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/113)（`781f6d1`）membership 剩余 `chatJson` 提示词明确 JSON 模式 |
| 本轮包含的文档 | [PR #113 随镜像发布的日志](2026-10-26-P2-P3-chatjson-prompts.md) 与 `docs/IMPLEMENTATION.md`、`docs/README.md` 更新 |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/781f6d1d450ed71bcf0f1738908e54aa173090ea` |
| 发布窗口 | 2026-10-26 07:13–07:19（Asia/Shanghai；服务器为 UTC+8） |

本轮代码内容（详见[提示词维护日志](2026-10-26-P2-P3-chatjson-prompts.md)）：

- **PR #113（membership JSON 模式提示词）**：membership 内九处 `chatJson` 调用中，一层核查、全景摘要、自定义技能导入与 GP 赛道分类四处系统提示词此前没有 JSON 字样，本轮补齐「只返回合法 JSON 对象」及各自顶层字段说明，并递增提示词版本；知识库问答／构建的四处调用早前已带 JSON 提示词，未改动。
- 未改动 schema、工具、业务规则、数据库迁移与员工界面文案。

| 调用 | 旧版本 → 新版本 | 输出字段 |
|---|---|---|
| 一层核查 | `xinhua-one-layer-1.0.0` → `xinhua-one-layer-1.0.1` | `summary`、`openQuestions` |
| 全景摘要 | `xinhua-panorama-1.0.0` → `xinhua-panorama-1.0.1` | `summary`、`openQuestions` |
| 自定义技能导入 | `skill-import-2` → `skill-import-3` | `result`、`caveats` |
| GP 赛道分类 | `gp-sector-1` → `gp-sector-2` | `tags`、`reason` |

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 与主机 `current` 软链、web/api/worker 容器镜像一致为 `4a68295`（PR #112），与预期一致后才开始发布。
- `git fetch origin main` 的 tip 恰为任务给定的期望 tip `781f6d1d450ed71bcf0f1738908e54aa173090ea`；`gh` 确认 PR #113 状态为 `MERGED`、合并提交即该 SHA、CI 三项（`links`、`postgres-integration`、`quality`）全绿。
- `4a68295..781f6d1` 是 PR #113 的合并提交（6 个文件，+72／−6），为**快进**，无分叉。
- 发布结束时再次 `git fetch`，`origin/main` 仍为 `781f6d1`，未再移动。

## 3. 发布包与完整性

| 项 | 值 |
|---|---|
| 来源 | 重新拉取的 `origin/main` SHA 的 `git archive`（非本地工作树） |
| 归档大小 | 15,534,080 B |
| 归档 sha256（本地 ↔ 主机） | `fddf49acfe8cdb221c2c2ec8dedcd367f7f10c8a3c798350129715cb2caffda4` — 逐字节一致 |
| 归档文件数 | 1,047（含目录条目），其中 `.sql` **164** 个 |
| 全树 sha256 清单比对 | 与本地解包一致（清单 `291445cb23108cebc7c54a44dad5483aa434e2cc7dcf716ea24689bcb5b15576`） |
| 基础镜像替换后的清单 | `e7eed6fb06751bae252e73152c67d7af8bf2fc66e0ef088ad1abe21cbe06a732` — 与干净清单的差异**恰好一行**：`./Dockerfile.volcengine` 的单条 `FROM` |
| 镜像 | `citic-newsfeed:781f6d1d450ed71bcf0f1738908e54aa173090ea`，id `de83bed087f8`，777 MB |
| 发布目录 | `/opt/citic-newsfeed/releases/781f6d1d450ed71bcf0f1738908e54aa173090ea`（`.env` 软链到 `shared/.env`） |
| 游离 `aihot-app` 镜像 | **0** |

- **Docker Hub 在主机上仍不可达**（`curl https://registry-1.docker.io/v2/` 失败；DaoCloud 镜像可达），因此只在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`。仓库中被 git 跟踪的文件未改（发布目录是 `git archive` 解包结果而非 Git 工作树），也没有为此提交或推送任何内容。
- 本轮使用独立的只读克隆 `~/Desktop/playground/nf113-deploy-src`（`git clone --no-checkout`），未触碰任何既有工作副本；其引用只指向 `origin/*`，没有本地提交，也没有推送。
- 发布目录数与镜像数 34 → 35，**未 prune、未删除任何旧发布目录或旧镜像**；上一版 `4a68295` 及更早镜像全部保留，回退只需按镜像 tag 切换。

## 4. 迁移

**0 条新迁移。**

- `git diff 4a68295..781f6d1 -- '*.sql'` 为空；发布归档内含 **164** 个 `.sql` 文件，与已应用的 164 行迁移一致。
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
| `781f6d1` | `shared/.env.before-release-781f6d1-20261026`（1,120 B） | `shared/backups/db-before-781f6d1-20261026.dump` | 11,880,832 B | 573 条 TOC |

- `.env` 备份在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是上一版 release `4a68295`。
- `pg_dump` 使用 `-Fc`（自定义格式），文件头为 `PGDMP`。`pg_restore --list` 在**数据库容器内**（PostgreSQL 17 客户端）执行；宿主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储。
- **只做了格式校验，未做完整恢复演练**（沿用历轮边界）。

## 6. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证，发布结束后复查 3 次）与主机 loopback `http://127.0.0.1:3000/api/health` 返回同一结果：

```json
{"ok":true,"db":"ok","ms":1,"release":"781f6d1d450ed71bcf0f1738908e54aa173090ea"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `781f6d1d450ed71bcf0f1738908e54aa173090ea`；主机 `current` → `/opt/citic-newsfeed/releases/781f6d1d450ed71bcf0f1738908e54aa173090ea`；`shared/.env` 的 `AIHOT_RELEASE` 同值（权限 `0600`）。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 发布 tip |
| `/` | 302 → `/login?next=%2F` | 根路径按会话鉴权 |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/sector-peer-landscape` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=…` | 按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表，按会话鉴权 |
| `/tasks/abc123` | 302 → `/login?next=%2Ftasks%2Fabc123` | 任务详情，按会话鉴权 |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | 按会话鉴权 |
| `/knowledge-bases` | 302 → `/login?next=%2Fknowledge-bases` | 按会话鉴权 |
| `/account/artifacts` | 302 → `/login?next=%2Faccount%2Fartifacts` | 按会话鉴权 |
| `/notifications` | 302 → `/login?next=%2Fnotifications` | 按会话鉴权 |
| `/profile` | 302 → `/login?next=%2Fprofile` | 按会话鉴权 |
| `GET /api/v1/membership/me` | 401 | API 鉴权边界 |
| `GET /api/v1/membership/expert-tasks/abc` | 401 | API 鉴权边界 |

> 与历轮相同的限制：不存在的 slug 同样返回通用 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，**不证明某个具体实体存在**。PR #113 不改任何路由或界面，只改 LLM 系统提示词，路由行为按设计与上一版一致。

### PR #113 确认存在于运行镜像

在已发布的 api／worker 容器内逐一核对（api 与 worker 结果一致）：

| 改动 | 标记 | 实测 |
|---|---|---|
| 一层核查提示词版本 | `xinhua-one-layer-1.0.1` | 各 1 处 |
| …旧版本已移除 | `xinhua-one-layer-1.0.0` | **0 处** |
| 全景摘要提示词版本 | `xinhua-panorama-1.0.1` | 各 1 处 |
| …旧版本已移除 | `xinhua-panorama-1.0.0` | **0 处** |
| 自定义技能导入提示词版本 | `skill-import-3` | 各 1 处 |
| …旧版本已移除 | `skill-import-2` | **0 处** |
| GP 赛道分类提示词版本 | `gp-sector-2` | 各 1 处 |
| …旧版本已移除 | `gp-sector-1` | **0 处** |
| 一层／全景 JSON 模式指令 | `只返回合法 JSON 对象，包含 summary 字符串和 openQuestions 字符串数组，不要 Markdown 围栏。` | 存在 |
| 自定义技能导入 JSON 模式指令 | `只返回合法 JSON 对象，包含 result 字符串和 caveats 字符串数组，不要 Markdown 围栏。` | 存在 |
| GP 赛道分类 JSON 模式指令 | `只返回合法 JSON 对象，包含 tags 字符串数组和 reason 字符串，不要 Markdown 围栏。` | 存在 |

membership 的 `chatJson` 调用点共 **9** 处（`worker.ts` 5、`gp/sync.ts` 1、`knowledge/answer.ts` 1、`knowledge/compile.ts` 2），与 PR #113 新增断言的数量一致；其中知识库问答／构建的 4 处早前已带 JSON 提示词，本轮未改动。

### PR #113 自带回归在已发布镜像内通过

在部署镜像内以 `--network none`（无网络、无数据库、生产数据未触碰、`--rm`）执行 PR #113 的结构性断言：

```
node --import ./tests/standalone.ts --test modules/membership/tests/chat-json-prompts.standalone.test.ts

✔ every membership chatJson system prompt names JSON mode (11.18ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

该测试解析 `modules/` 下每一处 `chatJson({…})` 的系统提示词并逐一断言含 JSON（`checked === 9`），是对 PR #113 意图的结构性证明，执行对象是运行中的镜像。

### 镜像卫生与线上数据

- 镜像 `/app` 下只有 `.env.example`，**没有 `.env`、没有 `.config/`**（在镜像内检查，不只是发布目录）。
- 全部 web bundle（`/app/apps/web/build`）`grep -ril "deepseek"` → **0 个文件**（员工侧界面不出现供应商品牌名）。
- PR #113 的测试与文档已随镜像发布：`modules/membership/tests/chat-json-prompts.standalone.test.ts`、`docs/logs/2026-10-26-P2-P3-chatjson-prompts.md`、`docs/IMPLEMENTATION.md`、`docs/README.md` 均在镜像内。
- 生产专家目录（发布后从线上库读回）无重复行：`company-sentiment-report` = `hidden`、`external-investment-landscape-xinhua-adapter` = `hidden`、`frontier-podcast` = `available`、`outbound-investment-panorama` = `available`、`sector-peer-landscape` = `available`。
- 发布后数据行数：`sources` = 26、`member_wiki_bases` = 2、`member_experts` = 5。

## 7. 镜像内回归（隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动、`--rm`）：

| 镜像 | membership 范围 | 全量范围 |
|---|---|---|
| `4a68295`（发布前基线） | 163 / **163 通过** / 0 失败 | 391 / 376 通过 / **15 失败** |
| `781f6d1`（已发布） | **164 / 164 通过** / 0 失败 | **392 / 377 通过** / 15 失败 |

- 15 个失败在**发布前基线镜像上完全相同**（两次抓取失败用例名后排序 `diff` 结果为空）：文章／日报／周报／月报元数据、主题路径的解码控件、过滤后的订阅、普通订阅页与首个主题页、普通分享卡片、过大 MCP 请求、公开只读端点的方法限制、故事元数据、`tests/migration-check.standalone.test.ts`、首页与创始人相关断言。它们需要可用的本地服务器或临时数据库，属既有环境性失败，**非本次发布引入**。
- membership 套件在两个镜像都全绿，并因 PR #113 的新用例由 163 → 164。

## 8. 范围未被触碰

- `nginx` → `active`，`nginx -t` 通过；`hermes-agent-gateway` → `active`；`ai-work-cert-renew.timer` → enabled + active（最近一次 2026-10-26 03:48:38 CST，`certbot.timer` 仍为 `disabled`，属既有状态，未改）。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好；没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- 三个应用容器重建后 `restarts=0`；web/api/worker 最近 300 行日志中 error/fatal/unhandled/exception/panic 扫描 **0 处命中**。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内仍为 `true`，**未做任何切换**（`MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` 同样保持 `true`）。
- 未合并或关闭任何 PR，**没有 force-push**，没有本地提交应用代码，没有改应用代码；`origin/main` 只被读取。
- 全过程未输出 `.env` 内容、私钥、密码或供应商原始响应；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径、目录字符串与聚合计数。
- 发布结束后磁盘剩余 36 GiB（总 79 GiB，占用 53%），仅新增 1 个发布目录与 1 个镜像。

## 9. 未验证事项

1. **没有真实模型调用。** PR #113 的全部价值在于供应商是否遵守「只返回合法 JSON 对象 … 不要 Markdown 围栏」以及 `chatJson` 层能否解析回来——这一点**未被实测**：没有发起任何模型或检索任务。提示词文本、版本号与调用点数量只由标记检查和 PR 自带的结构性断言证明，不是供应商真实响应的证据。
2. **没有登录后的员工冒烟。** 本环境没有凭据，也不允许编造，因此登录门之后的页面均未人工核对。PR #113 不改界面，**没有任何新页面可点**，但也意味着 #113 的实际效果完全没有在产品里跑过。
3. **没有回退演练，也没有完整数据库恢复演练。** 本轮 0 条新迁移，回退到 `4a68295` 或更早镜像都没有迁移风险；旧镜像、`.env` 备份与转储都保留，但转储只做过格式校验（`pg_restore --list`），从未恢复到临时库。
4. **发布当时没有仓库内日志与文档 PR。** 那一轮发布按任务要求只产出结果文件，仓库 `AGENTS.md` 的「每次发布留 `docs/logs/` 记录」约定未执行；本 PR 补记该发布事实。
5. **仓库的发布记录仍然滞后。** PR #113 随镜像发布的文档只描述已合并的 PR，没有写明生产当前服务的版本号；本次由本 PR 记录。
6. **员工侧验收仍未完成。** 镜像自带套件通过只证明代码路径可跑，**部署不等于验收**：仍需有人用真实数据跑一次一层核查、全景摘要、自定义技能导入与 GP 赛道分类，确认 `summary`／`openQuestions`／`result`／`caveats`／`tags` 字段能被正常填充且不再出现 JSON 解析错误。

## 10. 残余风险

1. **`origin/main` 随时可能移动。** 本轮结束时重新拉取确认仍是 `781f6d1`，但此前几轮曾出现发布窗口内 tip 移动（PR #109／#110）；下次发布必须重新拉取并重新确认 tip 后再归档。
2. **PR #113 的业务效果待人工确认。** 提示词是否符合供应商 JSON 模式要求、`chatJson` 解析是否稳定、既有失败任务是否需要重新执行，都还没有证据。
3. **Docker Hub 仍被阻断。** 每次构建都要在发布目录内重新做基础镜像替换，或给构建机配置代理／镜像白名单；该替换刻意不入库，新发布目录不重做就会构建失败。
4. **证书续期链路。** IP 证书 2026-10-30 10:32 UTC 到期（发布时约剩四天）；`certbot.timer` 被禁用是既有状态未改，`ai-work-cert-renew.timer` 处于启用且成功运行状态，需确认其持续成功。
5. **宿主机 `pg_restore` 无法读取 PG17 转储。** 备份格式校验必须在 db 容器内进行；若需在宿主机使用备份，需安装 PG17 客户端。
6. **15 个既有 standalone 失败仍为红色。** 与本次发布无关，但会持续干扰把全量套件当作发布闸门，需修复或从镜像内检查中排除。

## 11. 时间线（服务器时间，UTC+8）

| 时间 | 步骤 |
|---|---|
| 07:13 | SSH 可达性检查；发布前核对：`current` 软链、容器镜像与 `.env` 均为 `4a68295`，公网 `/api/health` 一致；`schema_migrations` 164 / 最大 `0190`；34 个发布目录与 34 个镜像；nginx、hermes、证书 timer 状态正常 |
| 07:13 | `git fetch origin main` → tip 恰为期望 tip `781f6d1`；`gh` 确认 PR #113 已合并、CI 全绿，`4a68295..781f6d1` 为快进 |
| 07:14 | `git archive 781f6d1` → 15,534,080 B，sha256 `fddf49ac…` 本地 ↔ 主机一致；1,047 文件 / 164 `.sql`；`git diff 4a68295..781f6d1 -- '*.sql'` 为空 |
| 07:14 | 建发布目录；1,047 文件清单与本地解包一致；基础镜像替换（只在发布目录内）；`.env` 备份 + `pg_dump -Fc` 转储（`0600`）；`pg_restore --list` → 573 条 TOC |
| 07:14–07:15 | 构建镜像 `citic-newsfeed:781f6d1…`（777 MB，退出码 0，无游离 `aihot-app`） |
| 07:15 | setup → 退出码 0，「database is up to date」「sources: 0 added, 26 already there」「experts: the platform's own catalog entries are in place」；迁移复核仍为 164 / `0190` |
| 07:15 | 切换 `current` 软链与 `AIHOT_RELEASE`；api / worker / web 重建（`restarts=0`）；主机与公网 `/api/health` → `ok=true`、`db=ok`、release `781f6d1…` |
| 07:15–07:16 | 公网路由检查、镜像内标记检查（PR #113 提示词版本与 JSON 指令）、web bundle 与镜像卫生检查 |
| 07:16–07:18 | 镜像内 standalone 套件：已发布镜像（membership 164/164；全量 392/377/15）与发布前基线 `4a68295`（163/163；391/376/15），失败集合完全相同 |
| 07:18–07:19 | 范围／服务／卷／证书核对；临时产物清理（主机与本地）；线上专家目录与行数读回 |
| 07:19 | 最终 `git fetch` 确认 `origin/main` = `781f6d1`（未漂移）；公网 `/api/health` 复查 3 次 → release `781f6d1…` |

## 12. 本次（文档）改动与最小验证

- 修改文件：`docs/logs/2026-10-26-P4-pr113-deployment.md`（本文件，新增）、`docs/DEPLOY-VOLCENGINE.md`、`docs/PROGRESS-REPORT.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、`README.md`。
- 实际完成：把 `781f6d1` 记录为**当前生产版本**，并写明发布前的 `4a68295`（PR #112）、0 条新迁移、备份与回退路径、镜像内回归结果与「未跑真实模型调用」的验收缺口。
- 关键决定：
  - **不复制其他打开的文档 PR 的日志文件。** 记录 release `e2daacd`（PR #96 + #97）的 [文档 PR #101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101)、记录 release `cc1a5af`（PR #100）的 [文档 PR #102](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/102)、记录 release `55244fc`（功能批次）的 [文档 PR #108](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/108)、记录 release `07488ac`（UI／后端复核）的 [文档 PR #111](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/111) **仍处于打开状态**，其独有日志文件不在本 PR 中重复加入；合并顺序应按发布先后（`e2daacd` → `cc1a5af` → `55244fc` → `07488ac` → `781f6d1`）。
  - 本 PR 只写文档，**不合并、不部署、不改应用代码**；`781f6d1` 已是生产版本，本 PR 不改变任何开关或数据。
  - `docs/IMPLEMENTATION.md` 的任务勾选**不变**：本轮只是发布，没有新增验收证据，P2-05、P3-01～P3-04、P4-03／P4-04 与 P5 仍为 `[ ]`；只在 P2／P3 与 P4 小节补记合并、发布状态与验收缺口。
  - 「未跑真实模型调用」与「未做登录后验收」在日志、运维手册、进度汇报与 README 中统一表述，**不把发布写成业务验收通过**。
- 执行的检查及结果：`node scripts/check-doc-links.ts` 通过（本地 Markdown 链接全部可解析）；`git diff --check` 通过。
- 未执行或需用户试用的检查：未连接生产实例复核（本次事实来自同一轮发布执行的记录）；未发起真实模型调用；未做登录后员工验收（需人工用真实数据跑一层核查、全景摘要、自定义技能导入与 GP 赛道分类）。
- 下一步：人工用真实数据跑通上述四条业务路径，确认 JSON 字段能被正常填充；并决定 #101／#102／#108／#111 与本 PR 的合并顺序。
