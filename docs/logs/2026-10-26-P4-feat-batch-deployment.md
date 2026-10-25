# 功能批次（PR #55–#59 / #69 + #103 + #104 / #105）生产发布（2026-10-26）

本记录说明把 GitHub `main` 的 tip `55244fc81cde5e88dbde777b1c59d62826204245`（短 `55244fc`）发布到火山云 `ai-work` 生产的过程与证据。该发布覆盖整个功能批次：知识库归因与时间线可见性（PR #55）、问答引用回跳与构建列表分页（PR #56）、专家任务列表分页与按专家过滤（PR #57）、知识库问答记录（PR #58）、员工个人任务与产物库（PR #59）、停止接收 PPT 材料（PR #69），以及文档同步 PR #103 与前沿播客检索排序改进 PR #104、文档 PR #105。

**本 PR 不合并 — record-only。** 本分支只记录发布事实，不含功能改动。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 最终发布提交 | `55244fc81cde5e88dbde777b1c59d62826204245`（短 `55244fc`，[PR #105](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/105) tip） |
| 发布目录 | `/opt/citic-newsfeed/releases/55244fc81cde5e88dbde777b1c59d62826204245` |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布窗口 | 2026-10-26 01:42–01:56（Asia/Shanghai；服务器为 UTC+8） |
| 发布前版本 | `cc1a5afef96415e6829982479cfa41485b95b697`（PR #100，2026-10-26 00:50–00:56 的上一轮发布） |
| 本轮先后上线的三个版本 | `6cd7739`（PR #103）→ `281ac12`（PR #104）→ `55244fc`（PR #105，最终版） |

- 任务预期的发布 tip 是 `6cd7739d35eda24d1d4763eebbec734724103b48`（PR #103 `docs: sync merged feature PR statuses`）。首次 `git fetch origin main`（01:43）时 `origin/main` **恰为** `6cd7739`，先按预期发布。
- **窗口内 `origin/main` 又移动了两次**，由并行的文档／代码合并流程产生：`281ac12`（PR #104，代码：前沿播客检索排序改进）与 `55244fc`（PR #105，文档）。两次都被重新拉取、确认为 `6cd7739` 的快进，并用同一套流程重新发布；**最终生产版本是 `55244fc`**。
- [PR #60](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/60) 于 2026-10-25T17:04:14Z **关闭且未合并**（功能已被 PR #86 覆盖），本轮没有从它发布任何内容。

### 本批次已合并的 PR（发布前经 `gh` 逐条核对）

| PR | 状态 | 合并时间（UTC） | 提交 | 主题 |
|---|---|---|---|---|
| #55 | MERGED | 2026-10-25T17:09:22Z | `9179785` | 补强员工知识库的归因与时间线可见性（P5-03 代码补强） |
| #56 | MERGED | 2026-10-25T17:12:59Z | `c207c01` | 问答引用可跳回材料与原件，构建列表分页（P5-04 代码补强） |
| #57 | MERGED | 2026-10-25T17:30:27Z | `65b10d9` | 分页并按专家过滤员工端专家任务列表 |
| #58 | MERGED | 2026-10-25T17:22:35Z | `b2dd6f8` | 知识库问答记录：员工可回看自己的回答并跳回材料与原件 |
| #59 | MERGED | 2026-10-25T17:35:46Z | `0cd880f` | 员工个人任务与产物库 `/account/artifacts` |
| #69 | MERGED | 2026-10-25T17:26:47Z | `e88564a` | 停止接收知识库与专家任务的 PPT 材料 |
| #103 | MERGED | 2026-10-25T17:39:41Z | `6cd7739` | docs: sync merged feature PR statuses |
| #104 | MERGED（窗口内） | 2026-10-26T01:48:15Z | `281ac12` | Improve frontier podcast search relevance |
| #105 | MERGED（窗口内） | 2026-10-26T01:50:48Z | `55244fc` | docs: record frontier podcast search merge |
| #60 | **CLOSED，未合并** | 2026-10-25T17:04:14Z | — | 被 PR #86 取代，无可发布内容 |

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 返回 `release = cc1a5afef96415e6829982479cfa41485b95b697`（PR #100），与预期一致；主机上 `current` 软链与 web/api/worker 三个容器镜像同为该 SHA。
- 发布前 `schema_migrations` 为 164 条、最大版本 `0190_member_experts_status_coming_soon_validate.sql`；主机上有 28 个发布目录与 28 个 `citic-newsfeed` 镜像；磁盘剩余 41 GiB。
- `nginx`、`hermes-agent-gateway` 与 `ai-work-cert-renew.timer` 均处于运行状态；`certbot.timer` 仍为 `disabled`（既有状态，本轮未改）。
- 本地检出分支（`fix/frontier-podcast-hide-partial-banner`，HEAD `f472ad0`，另有其他进程的未提交改动）**不是**发布来源；每一份归档都取自重新拉取的 `origin/main` SHA 并逐文件校验，其他工作树与那些未提交改动均未被触碰。

## 3. 发布包与完整性

三个版本各自独立取包、独立校验、独立备份：

| 项 | `6cd7739` | `281ac12` | `55244fc`（最终） |
|---|---|---|---|
| 来源 | 重新拉取的 `origin/main` SHA（`git archive`，非本地工作树） | 同 | 同 |
| 归档 sha256（本地 ↔ 主机） | `4b25ec17…` 逐字节一致 | `4f15f3d6…` 逐字节一致 | `924956b0…` 逐字节一致 |
| 发布目录文件数 | 1,040 | 1,041 | 1,041 |
| 其中 `.sql` 文件 | 164 | 164 | 164 |
| 全树 sha256 清单 vs 本地解包 | 完全一致，0 处差异 | 完全一致，0 处差异 | 完全一致，0 处差异 |
| 镜像 | `citic-newsfeed:6cd7739…`（id `e3c3b8471e32`，776 MB） | `:281ac12…`（id `1ef5ad9dccb7`，776 MB） | `:55244fc…`（id `fb0ea5146274`，776 MB） |

- 发布目录内 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`（宿主机 `curl https://registry-1.docker.io/v2/` 失败，Docker Hub 不可达）。该改动**只存在于发布目录**：与纯净 `git archive` 解包结果比对，差异恰好只有这一行 `FROM`；仓库中被 git 跟踪的 `Dockerfile.volcengine` 保持 `node:24-trixie-slim` 未变，未提交、未推送。
- **一次误报的说明**：首次清单比对两侧都用了默认 `sort` 排序规则，路径顺序在主机与 Mac 上不同，产生了一份很大但虚假的差异。两侧改用 `LC_ALL=C sort` 重跑后清单 sha256 完全一致（`d77ee373…` / `744b028e…` / `3fd7b7b2…`），发布树自始至终是正确的。
- `git diff cc1a5af..6cd7739 -- '*.sql'` 为空；三个发布目录各含 164 个 `.sql`，与 `schema_migrations` 的 164 条已应用行一致。

## 4. 迁移

**0 条新迁移 —— 本轮三个版本都是。** 每个版本的 setup 容器都报告：

```
database is up to date
sources: 0 added, 26 already there
experts: the platform's own catalog entries are in place
```

| 版本 | `schema_migrations` 发布前 | 发布后 | 最大已应用版本 |
|---|---|---|---|
| `6cd7739` | 164 | **164** | `0190_member_experts_status_coming_soon_validate.sql` |
| `281ac12` | 164 | **164** | `0190_…` |
| `55244fc`（最终） | 164 | **164** | `0190_…` |

- setup 容器退出码 **0**、restarts 0，每个版本都是；信源播种幂等（26 条，0 新增）。
- 顺序与历次一致：构建 → `up -d --force-recreate --no-deps setup`（迁移 + 播种）→ 切换 `current` 软链与 `AIHOT_RELEASE` → `up -d --no-deps --force-recreate api worker web`。

## 5. 备份

| 版本 | `.env` 备份（`0600`） | 数据库转储（`0600`） | 转储大小 | `pg_restore --list` |
|---|---|---|---|---|
| `6cd7739` | `shared/.env.before-release-6cd7739-20261026`（1,120 B） | `shared/backups/db-before-6cd7739-20261026.dump` | 11,579,990 B | ✅ 573 条 TOC |
| `281ac12` | `shared/.env.before-release-281ac12-20261026`（1,120 B） | `shared/backups/db-before-281ac12-20261026.dump` | 11,582,924 B | ✅ 573 条 TOC |
| `55244fc` | `shared/.env.before-release-55244fc-20261026`（1,120 B） | `shared/backups/db-before-55244fc-20261026.dump` | 11,585,556 B | ✅ 573 条 TOC |

- 每份 `.env` 备份都在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是上一版本的值（`6cd7739` → `281ac12` → `55244fc` 链已确认）。
- `pg_dump` 显式使用 `-Fc`（自定义格式），文件头为 `PGDMP`。
- `pg_restore --list` 在**数据库容器内**用 PostgreSQL 17 客户端执行：**573 条 TOC 记录，可读**。宿主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储，该校验必须在容器内完成。
- **未执行完整恢复演练**，只做了格式校验；备份文件与旧镜像、旧发布目录一并保留。

## 6. 构建与镜像

- 构建使用**两份**编排文件并显式指定发布号：

  ```
  RELEASE_ID=<fullsha> docker compose -p citic-newsfeed-prod \
    -f docker-compose.yml -f compose.volcengine.yml build
  ```

  未产生游离的 `aihot-app` 镜像。
- 镜像卫生检查：`/app` 下只有 `.env.example`，没有 `/app/.env`、没有 `/app/.config/`。
- 发布目录数 28 → 31，镜像数 28 → 31；**未 prune、未删除任何发布目录或旧镜像**，本轮三个版本都可按镜像 tag 直接回退。

## 7. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证；最终版本重建后复核 3 次）与主机 loopback `http://127.0.0.1:3000/api/health` 返回同一结果：

```json
{"ok":true,"db":"ok","ms":1,"release":"55244fc81cde5e88dbde777b1c59d62826204245"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `55244fc81cde5e88dbde777b1c59d62826204245`；`/opt/citic-newsfeed/current` → `/opt/citic-newsfeed/releases/55244fc81cde5e88dbde777b1c59d62826204245`。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 最终 SHA |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=%2Fexperts%2Ffrontier-podcast` | PR #93／#96／#104 前沿播客路径，按会话鉴权 |
| `/experts/sector-peer-landscape` | 302 → `/login?next=%2Fexperts%2Fsector-peer-landscape` | PR #100 赛道同业路径，按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=%2Fexperts%2Foutbound-investment-panorama` | PR #97 全景图路径，按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | PR #57／#86 员工任务列表，按会话鉴权 |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | PR #55／#56／#58 知识库，按会话鉴权 |
| `/knowledge-bases` | 302 → `/login?next=%2Fknowledge-bases` | 知识库列表，按会话鉴权 |
| `/account/artifacts` | 302 → `/login?next=%2Faccount%2Fartifacts` | **PR #59** 员工个人任务与产物库，按会话鉴权 |
| `/profile` | 302 → `/login?next=%2Fprofile` | 「我的」，按会话鉴权 |

> 与前几轮相同的限制：不存在的 slug 同样返回通用的 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，不能证明某个具体 slug 存在。本批次各功能的代码确实在运行镜像中，由下节标记检查与 web bundle 产物证明。

### 本批次代码确认存在于最终运行镜像

| 功能 | 标记 | 容器 / 文件 | 结果 |
|---|---|---|---|
| PR #69 — 拒绝 PPT | `if (!format) throw new Error("expert_material_format_unsupported");` | api | ✅ 1 处 |
| PR #69 — 旧允许清单已移除 | `pdf", "docx", "pptx", "markdown"].includes(format)` | api `experts/materials.ts` | ✅ **0 处** |
| PR #69 — 知识库允许清单已移除 | `pdf", "docx", "markdown"].includes(format)` | api `knowledge/catalog.ts`、`knowledge/worker.ts` | ✅ **两处均 0** |
| PR #57 — 任务分页 | `export const TASK_PAGE_SIZE = 20;`、`export function parseTaskPage`、`export function taskPagination` | api `experts/task-query.ts` | ✅ 各 1 处 |
| PR #55／#56／#58 — 引用与问答记录 | `export async function enrichCitations`、`enrichAllCitations`、`readCoverage`、`readFreshness` | api `knowledge/history.ts` | ✅ 各 1 处 |
| PR #59 — 产物库页面 | `export default function AccountArtifactsPage`、`我的任务与产物`、`path: "/account/artifacts"` | api `pages/account-artifacts.tsx` | ✅ 1／3／1 处 |
| PR #104 — 播客检索相关性 | `export function podcastMatchRelevance`、`function topicAliases`、`const preferredVariants`、扩展后的 `["具身智能", "embodied intelligence", "robotics", "机器人", "embodied ai", "具身"]` 别名组 | api `experts/bidclub.ts` | ✅ 1／1／1／319 处 |
| PR #105 — 文档随镜像发布 | `docs/logs/2026-10-26-P2-frontier-podcast-search-quality.md` 存在于镜像内 | api | ✅ |

### web 产物检查（最终镜像 `/app/apps/web/build/`）

- `account-artifacts-6xwVdbwz.js` chunk 存在且含「我的任务与产物」（PR #59）✅
- 「问答记录」出现在 `knowledge-base-BVzgzyab.js`（PR #58）✅
- 「每页」出现在 `agent-Ak9PcruV.js`（PR #57 分页）✅
- 对整个 web bundle 执行 `grep -ril "deepseek"` → **0 个文件**：员工侧界面不出现供应商品牌名 ✅

### 生产 `member_experts` 目录（发布后从生产库读回）

```
company-sentiment-report               | hidden   | 0.1.0
external-investment-landscape-xinhua-adapter | hidden | 0.1.0
frontier-podcast                       | available| 0.1.0
outbound-investment-panorama           | available| 0.1.0
sector-peer-landscape                  | available| 1.0.0
```

本批次没有新增专家条目，目录行与发布前一致，也没有重复行。

## 8. 回归测试（运行镜像内，隔离执行）

镜像自带的独立回归套件在**已发布的最终镜像**内以 `--network none` 重跑（无数据库、无生产数据改动）：

```
node --import ./tests/standalone.ts --test --test-concurrency=6 --test-timeout=120000 \
  "modules/membership/tests/*.standalone.test.ts"
ℹ tests 158
ℹ pass 158
ℹ fail 0
```

| 镜像 | membership 范围 | 全量 `test:standalone` 范围 |
|---|---|---|
| `cc1a5af`（发布前基线） | 151／**151 通过**／0 失败 | 379／364 通过／**15 失败** |
| `6cd7739` | 156／**156 通过**／0 失败 | 384／369 通过／**15 失败** |
| `281ac12` | 158／**158 通过**／0 失败 | 386／371 通过／**15 失败** |
| `55244fc`（最终） | **158／158 通过**／0 失败 | **386／371 通过／15 失败** |

- 那 15 个失败**在发布前基线镜像上完全相同**，全部位于 `tests/*.standalone.test.ts`（站点／元数据／SEO／迁移检查／公网端点套件），需要可用的本地服务或临时数据库，隔离的 `--network none` 容器提供不了。**属于既有环境性失败，不是本次发布引入的。**
- membership 范围（本轮使用的口径）在每个镜像上都是绿的，并随功能批次新增了 +5（`6cd7739`）与 +7（`281ac12` / PR #104）条通过用例。
- 临时容器使用 `--rm`，没有留下容器或网络。

## 9. 范围未被触碰

- `nginx` → `active`，站点配置仍代理到 `127.0.0.1:3000`（`server_name 115.190.114.65`，mtime 2026-10-22 未改），`nginx -t` 通过。`hermes-agent-gateway` → `active`。`ai-work-cert-renew.timer` → **enabled + active**（上次运行 2026-10-25 03:47:57 成功，下次 2026-10-26 03:48:31）；`certbot.timer` 仍为 `disabled`（既有状态，未改）。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27.232065953Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data`（外加一个既有匿名卷）完好。没有执行 `down`、`prune`，未删除任何发布目录、镜像、卷或数据库。
- web／api／worker 每次重建后 `restarts = 0`；最近 300 行日志中 error／fatal／unhandled／exception／panic 扫描 **0 处命中**（三个版本都是）。api 日志只有「Server listening」，worker 只有「worker started」，web 只有「web started」。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内均保持 `true`，**未做任何切换**（`MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` 也仍为 `true`）。
- 未合并或关闭任何 PR；**没有强推**，没有本地提交，没有改动任何应用代码；`origin/main` 只被读取。功能分支未被触碰。
- 全过程未输出 `.env` 内容、私钥、密码或 API key；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径、数据库行数／目录文案与聚合 HTTP 状态码。
- 只删除了本轮发布自己的临时产物（主机 `/tmp/release-*.tar.gz`、`/tmp/manifest-*`、`/tmp/nf*-*.sh`，db 容器内的临时 `verify*.dump`，以及 Mac 上的本地归档／清单／解包目录）。没有删除任何发布目录、镜像、卷或数据库。发布后磁盘剩余 39 GiB／79 GiB（约 49% 已用）。

## 10. 残余风险与待办

1. **没有登录后的员工冒烟。** 本环境没有可用的凭据，任务文件也禁止编造，因此登录态之后的界面完全未经人工验证。未实际演练：专家任务列表分页与按专家过滤（**#57**）、带回跳的问答记录（**#55／#56／#58**）、`/account/artifacts` 产物库（**#59**）、PPT 上传被拒（**#69**）、播客结果的新排序（**#104**）。
2. **没有真实供应商调用。** PR #104 改变的是检索结果的相关性排序，上游检索／抓取的实际行为**未**被触发（凭据不得编造，任务也未要求真实调用）。代码与接线只由标记检查证明。
3. **回退未演练，也没有完整恢复演练。** 本轮 0 条新迁移，回退到 `citic-newsfeed:281ac12…`、`:6cd7739…` 或 `:cc1a5af…` 没有迁移风险。所有镜像、`.env` 备份与数据库转储都保留；转储只做过格式校验（`pg_restore --list`），从未在临时库中实际恢复。
4. **`origin/main` 在发布窗口内移动了两次。** 最终镜像对应的是最后一次拉取的 tip，但**任何时刻都可能有新提交到达**；下次发布必须重新拉取、重新确认 tip 再归档。
5. **一个窗口内发了三个版本**（01:43–01:53）。每个版本都独立备份、独立迁移（0 条）、独立健康检查，中间镜像全部保留，回退任一版本只是换镜像 tag；但十分钟内三次容器重建比平常更频繁，读容器日志时应考虑这一点。
6. **员工侧验收仍未完成。** 手工闭环建议：上传一个 `.pptx` 并确认被明确拒绝；打开知识库确认「问答记录」列表、引用跳回材料／原件、列表分页；打开 `/account/artifacts` 确认任务与产物列表；打开专家任务列表确认每页 20 与按专家过滤；用「具身智能」「机器人」「宁德时代」跑一次前沿播客，确认新的相关性排序。
7. **Docker Hub 仍不可达。** 每次构建都需要在发布目录内重新做基础镜像镜像源替换，或给构建机配置代理／镜像白名单。该替换刻意不入库，新的发布目录不重新替换就会构建失败。
8. **证书续期链路。** IP 证书 2026-10-30 UTC 到期；`certbot.timer` 被禁用是既有状态（本轮未改），需确认 `ai-work-cert-renew.timer` 持续成功。
9. **宿主机 `pg_restore` 无法读取 PG17 转储。** 备份格式校验必须在数据库容器内进行；若需在宿主机使用该备份，需安装 PG17 客户端。
10. **那 15 个既有的 standalone 失败**与本次发布无关，但在隔离镜像里仍是红的；应修复或从镜像内检查范围中排除，这样后续发布才能用全量套件作为闸门。
11. **仓库自身的发布记录滞后。** 本 PR 按要求保持打开，因此仓库中「最新生产发布」的文字只有在人工合并后才指向 `55244fc`。文档 PR [#101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101)（记录 release `e2daacd`）与 [#102](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/102)（记录 release `cc1a5af`）**仍处于打开状态**，二者记录的是本轮之前的两个版本，文本可能与本 PR 重叠；合并时按发布顺序保留历史小节即可，不要用本 PR 的文字覆盖它们各自的日志文件。

## 11. 时间线（服务器时间，UTC+8）

| 时间 | 步骤 |
|---|---|
| 01:42 | SSH 连通性检查；发布前盘点：`current` 软链、容器镜像与 `.env` 均为 `cc1a5af`，公网 `/api/health` 同为 `cc1a5af`；`schema_migrations` 164 / `0190`；28 个发布目录 / 28 个镜像；nginx、hermes、证书定时器均为运行状态；磁盘剩余 41 GiB |
| 01:43 | `git fetch origin main` → tip 确认为 `6cd7739`；`git archive` → 9,281,865 B，sha256 本地 ↔ 主机一致；1,040 个文件 / 164 个 `.sql`；`git diff cc1a5af..6cd7739 -- '*.sql'` 为空 |
| 01:44 | 创建发布目录；1,040 个文件的 sha256 清单与本地解包一致（`LC_ALL=C` 复核后完全相同）；改写基础镜像（仅发布目录内）；`.env` 备份 + `pg_dump -Fc` 转储（`0600`）；`pg_restore --list` → 573 条 TOC |
| 01:44:20–01:44:44 | 构建镜像 `citic-newsfeed:6cd7739…`（776 MB，退出码 0） |
| 01:45:08–01:45:12 | setup 容器 → 退出码 0，「database is up to date」「sources: 0 added, 26 already there」；迁移复核仍为 164 / `0190` |
| 01:45:18–01:45:36 | `current` 软链切到 `releases/6cd7739…`；`.env` 的 `AIHOT_RELEASE` 更新；api / worker / web 在新镜像上重建（`restarts=0`）；主机与公网 `/api/health` → `ok=true`、`db=ok`、release `6cd7739…` |
| 01:46–01:48 | 公网路由检查、镜像内标记检查、镜像内 standalone 回归（156/156 membership；384/369/15 全量）、范围检查、临时产物清理 |
| 01:48:15 | **`origin/main` 移动 → `281ac12`（PR #104，代码）**，确认为 `6cd7739` 的快进 |
| 01:49–01:49:56 | `git archive 281ac12` → 9,285,007 B，sha256 本地 ↔ 主机一致；1,041 个文件 / 164 个 `.sql`；清单一致；重做基础镜像替换；备份 + `pg_dump`；镜像 `:281ac12…` 构建完成（退出码 0） |
| 01:50:15–01:50:21 | setup → 退出码 0；软链与 `AIHOT_RELEASE` 切换；api / worker / web 重建；健康检查 → release `281ac12…` |
| 01:50:48 | **`origin/main` 再次移动 → `55244fc`（PR #105，纯文档）**，确认为 `6cd7739` 的快进 |
| 01:52:10–01:52:35 | `git archive 55244fc` → sha256 本地 ↔ 主机一致；1,041 个文件；清单一致；重做基础镜像替换；备份 + `pg_dump`；镜像 `:55244fc…` 构建完成（退出码 0） |
| 01:52:55–01:53:36 | setup → 退出码 0（迁移仍为 164 / `0190`）；软链与 `AIHOT_RELEASE` 切换；api / worker / web 重建（`restarts=0`）；主机与公网健康检查 → `ok=true`、`db=ok`、release `55244fc…` |
| 01:54–01:56 | 最终公网路由检查、最终镜像标记复核、镜像内 standalone 回归（158/158 membership；386/371/15 全量）、服务与卷范围检查、临时产物清理、最后一次 `git fetch` 确认 `origin/main` = `55244fc` |

## 12. 证据

- 本文件：`docs/logs/2026-10-26-P4-feat-batch-deployment.md`。
- 现场发布结果记录（维护者本地）：`~/Desktop/playground/pi-nf-feat-batch-deploy-result.md`。
- 上一轮 release `cc1a5af`（PR #100）的发布记录正在文档 PR [#102](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/102) 中，**尚未合并进 `main`**；再上一轮 release `e2daacd`（PR #96 + #97 + #99）的发布记录在文档 PR [#101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101) 中，同样未合并。本文不改动它们的内容，只按事实把 `cc1a5af` 记为本次发布的前一版本。
- 更早的发布记录：[PR #93 发布日志](2026-10-25-P4-pr93-deployment.md)（release `f472ad0`）、[PR #92 发布日志](2026-10-25-P4-pr92-deployment.md)（release `7858842`）。
- 仓库内运维手册：`docs/DEPLOY-VOLCENGINE.md`。
