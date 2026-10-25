# 员工端 UI 与后端复核合并发布（release `07488ac`）

- Agent：pi coding agent（docs-only 发布记录）
- 对应任务：维护任务（不对应 P0–P5 验收项）；本轮只记录发布事实，不含应用代码改动
- 完成状态：发布完成（生产现为 `07488ac`）；**登录后的员工侧验收仍未完成**

**本 PR 不合并 — record-only。** 本分支只记录发布事实，不含应用代码改动，也不部署。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 最终生产版本 | `07488ac44992003de6176209a29c355ef2c8c25a`（短 `07488ac`） |
| 对应 PR | [PR #110](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/110) `docs: sync backend review merge status`（发布结束时的 `origin/main` tip） |
| 窗口内先上线 | `3744aaa`（[PR #107](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/107) `docs: record merged employee UI review`） |
| 发布前生产版本 | `55244fc`（[PR #105](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/105)） |
| 本轮包含的代码 PR | [PR #106](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/106)（`d3f813e`）员工端移动端控件与任务导航；[PR #109](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/109)（`68be31e`）后端/API/worker/data layer 加固 |
| 本轮包含的文档 PR | PR #107（`3744aaa`）、PR #110（`07488ac`） |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/07488ac44992003de6176209a29c355ef2c8c25a` |
| 发布窗口 | 2026-10-26 02:01–02:20（Asia/Shanghai；服务器为 UTC+8） |

本轮代码内容：

- **PR #106（员工端 UI 复核）**：移动端共用输入框／文本框 16px，成员界面按钮手机端至少 44px，微信验证码输入同步修正；`/tasks` 的分页 `offset` 与 `/account/artifacts` 的状态筛选 `state` 改由 URL 查询参数驱动，刷新、复制链接与浏览器前进／后退可恢复原视图。代码见[员工端 UI 规则复核日志](2026-10-26-UI-review.md)。
- **PR #109（后端/API/worker/data layer 加固）**：依赖升级（Zod、Undici、Fastify、`sanitize-html`、`fast-uri` 安全公告）；畸形百分号编码的员工会话 cookie 不再抛错，而是按未登录请求处理；知识库创建的上限检查与写入合并进同一串行化事务；播客供应商响应读取上限 4 MiB 并流式计量。代码见[后端复核日志](2026-10-26-backend-review.md)。

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 与主机 `current` 软链、web/api/worker 容器镜像一致为 `55244fc`（PR #105），与预期一致后才开始发布。
- 首次 `git fetch origin main` 的 tip 恰为任务给定的期望 tip `3744aaa1b1f6d6c5bc6556aef7c60fa6205e4be8`（PR #107，含 PR #106），**先按期望 tip 发布**（02:04 上线并通过健康检查与冒烟）。
- 02:05 窗口内 `origin/main` 又移动到 `07488ac`（PR #109 代码 + PR #110 文档，02:10/02:12 合并）。重新拉取后确认 `07488ac` 是 `3744aaa` 的**快进**，CI 全绿、0 条新迁移，再按同一流程发布，最终生产版本为 `07488ac`。
- 发布结束时再次 `git fetch`，`origin/main` 仍为 `07488ac`，未再移动。

## 3. 发布包与完整性

| 项 | `3744aaa`（先上线） | `07488ac`（最终） |
|---|---|---|
| 来源 | 重新拉取的 `origin/main` SHA 的 `git archive`（非本地工作树） | 同左 |
| 归档 sha256（本地 ↔ 主机） | `f3e9d030…` 逐字节一致 | `84211f1c…` 逐字节一致 |
| 归档文件数 | 1,042 | 1,044 |
| `.sql` 文件数 | 164 | 164 |
| 全树 sha256 清单比对 | 与本地解包一致（清单 `5606acd3…`） | 与本地解包一致（清单 `998a87a3…`） |
| 镜像 | `citic-newsfeed:3744aaa…`，id `9efe8cbe120c`，776 MB | `citic-newsfeed:07488ac…`，id `e9bb5456aa74`，777 MB |
| 发布目录 | `/opt/citic-newsfeed/releases/3744aaa…` | `/opt/citic-newsfeed/releases/07488ac…` |

- 清单在本地与主机两端都用 `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum` 生成（默认 `sort` 排序在 macOS 与主机上不同，会造成假 diff）。
- **Docker Hub 在主机上仍不可达**（`curl https://registry-1.docker.io/v2/` 失败），因此只在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`。逐文件比对确认**只有一个文件不同**（`Dockerfile.volcengine` 的一行 `FROM`）；仓库中被 git 跟踪的文件未改，发布目录是 `git archive` 解包结果而非 Git 工作树。
- 发布目录数与镜像数 31 → 33，**未 prune、未删除任何旧发布目录或旧镜像**；本轮两个版本与 `55244fc` 都可按镜像 tag 回退。

## 4. 迁移

**0 条新迁移 — 两个版本都是。**

- `git diff 55244fc..3744aaa -- '*.sql'` 与 `git diff 3744aaa..07488ac -- '*.sql'` 均为空；两个发布目录各含 **164** 个 `.sql` 文件。
- setup 先于新代码上线运行，每次退出码 **0**、restarts 0，输出：

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
| `3744aaa` | `shared/.env.before-release-3744aaa-20261026` | `shared/backups/db-before-3744aaa-20261026.dump` | 11,593,378 B | 573 条 TOC |
| `07488ac`（最终） | `shared/.env.before-release-07488ac-20261026` | `shared/backups/db-before-07488ac-20261026.dump` | 11,600,093 B | 573 条 TOC |

- `.env` 备份在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是上一个 release（`55244fc` → `3744aaa` → `07488ac`）。
- `pg_dump` 显式使用 `-Fc`（自定义格式），文件头为 `PGDMP`。`pg_restore --list` 在**数据库容器内**（PostgreSQL 17 客户端）执行；宿主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储。
- **只做了格式校验，未做完整恢复演练**（沿用历轮边界）。

## 6. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证）与主机 loopback `http://127.0.0.1:3000/api/health` 返回同一结果：

```json
{"ok":true,"db":"ok","ms":1,"release":"07488ac44992003de6176209a29c355ef2c8c25a"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `07488ac44992003de6176209a29c355ef2c8c25a`；主机 `current` → `/opt/citic-newsfeed/releases/07488ac44992003de6176209a29c355ef2c8c25a`。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 最终 tip |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/sector-peer-landscape` | 302 → `/login?next=…` | 按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=…` | 按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表（PR #106 改动过） |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | 按会话鉴权 |
| `/knowledge-bases` | 302 → `/login?next=%2Fknowledge-bases` | 按会话鉴权 |
| `/account/artifacts` | 302 → `/login?next=%2Faccount%2Fartifacts` | 员工任务与产物库（PR #106 改动过） |
| `/notifications` | 302 → `/login?next=%2Fnotifications` | 通知页（PR #106 改动过） |
| `/profile` | 302 → `/login?next=%2Fprofile` | 按会话鉴权 |

> 与历轮相同的限制：不存在的 slug 同样返回通用 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，**不证明某个具体实体存在**；PR #106／#109 的代码是否真的在运行镜像中，由下节的标记检查证明。

### PR #106 / #107 确认存在于运行镜像

| 改动 | 标记 | 容器 | 实测 |
|---|---|---|---|
| 任务列表分页进入 URL | `modules/membership/pages/tasks.tsx` 的 `useSearchParams` | api / worker | 各 2 处 |
| 任务页读写 `?offset=` | `searchParams.get("offset")` / `params.set("offset"` | api | 各 1 处 |
| 产物库读写 `?state=` | `useSearchParams` / `params.set("state"` | api | 2 / 1 处 |
| 移动端更大触控目标 | `member-ui/button.tsx` 的 `h-11 px-4 py-2 sm:h-10`、`size-11 sm:size-10` | api | 各 1 处 |
| 移动端 16px 字号 | `member-ui/input.tsx`、`member-ui/textarea.tsx` 的 `text-base … sm:text-sm` | api | 各 1 处 |
| 微信验证码输入同步修正 | `modules/membership/pages/notifications.tsx` 的 `text-base sm:text-sm` | api | 1 处 |
| 旧代码已移除 | `tasks.tsx` 的 `setOffset`、`button.tsx` 的 `"h-10 px-4 py-2",` | api | **均为 0 处** |
| PR #107 文档已随镜像发布 | `docs/logs/2026-10-26-UI-review.md` 存在且被 `docs/README.md` 引用 | api | 存在 |

### PR #109 / #110 确认存在于运行镜像

| 改动 | 标记 | 容器 | 实测 |
|---|---|---|---|
| 播客响应读取有上限 | `modules/membership/experts/bidclub.ts` 的 `MAX_RESPONSE_BYTES = 4 * 1024 * 1024`、`async function responseJson` | api / worker | 各 1 处 |
| 旧的无上限读取已移除 | `bidclub.ts` 的 `await response.json()` | api | **0 处** |
| 知识库创建已串行化 | `modules/membership/knowledge/routes.ts` 的 `FOR UPDATE`（4 处）/ `sql.begin`（5 处） | api | 存在 |
| 畸形会话 cookie 不再抛错 | `modules/membership/server.ts` 的 `catch { return null; }` | api | 1 处 |
| PR #110 文档已随镜像发布 | `docs/logs/2026-10-26-backend-review.md` 存在 | api | 存在 |

### 线上 web bundle 与数据

- `shared-BQiPsVkW.js` 含新的移动端触控类 `sm:h-10`、`sm:size-10`；`sm:text-sm` 出现在 `shared-BQiPsVkW.js` 与 `notifications-DX1hRRVv.js`；路由 chunk `tasks-CWkuGDqN.js`、`account-artifacts-DaGgrg2k.js`、`notifications-DX1hRRVv.js` 均在。
- 全 bundle `grep -ril "deepseek"` → **0 个文件**（员工侧界面不出现供应商品牌名）。
- 镜像 `/app` 下只有 `.env.example`，**没有 `.env`、没有 `.config/`**（在镜像内检查，不只是发布目录）。
- 生产 `member_experts` 目录（发布后读回）无重复行：`company-sentiment-report` = `hidden`、`external-investment-landscape-xinhua-adapter` = `hidden`、`frontier-podcast` = `available`、`outbound-investment-panorama` = `available`、`sector-peer-landscape` = `available`。
- 发布后数据行数：`member_wiki_bases` = 2、`sources` = 26、`member_experts` = 5。

## 7. 镜像内回归（隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动、`--rm`）：

| 镜像 | membership 范围 | 全量范围 |
|---|---|---|
| `55244fc`（发布前基线） | 158 / **158 通过** / 0 失败 | 386 / 371 通过 / **15 失败** |
| `3744aaa`（先上线） | 158 / **158 通过** / 0 失败 | 386 / 371 通过 / **15 失败** |
| `07488ac`（最终） | **160 / 160 通过** / 0 失败 | **388 / 373 通过** / 15 失败 |

- 15 个失败在**发布前基线镜像上完全相同**（`tests/page-metadata.standalone.test.ts` ×16、`tests/malformed-public-paths.standalone.test.ts` ×3、`tests/migration-check.standalone.test.ts` ×2、`tests/public-methods.standalone.test.ts` ×1、`tests/mcp-body-limit.standalone.test.ts` ×1），需要可用服务器或临时数据库，属既有环境性失败，**非本次发布引入**。
- membership 套件在每个镜像都全绿，且因 PR #109 新增 `member-session.standalone.test.ts`、`frontier-podcast.standalone.test.ts` 而 158 → 160。

## 8. 范围未被触碰

- `nginx` → `active`，`nginx -t` 通过；`hermes-agent-gateway` → `active`；`ai-work-cert-renew.timer` → enabled + active（`certbot.timer` 仍为 `disabled`，属既有状态，未改）。IP 证书有效期 `notBefore=Oct 23 18:32:07 2026 GMT`、`notAfter=Oct 30 10:32:06 2026 GMT`。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好；没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- 三个应用容器重建后 `restarts=0`；web/api/worker 最近 300 行日志中 error/fatal/unhandled/exception/panic 扫描 **0 处命中**。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内仍为 `true`，**未做任何切换**（`MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` 同样保持 `true`）。
- 未合并或关闭任何 PR，**没有 force-push**，没有本地提交应用代码，没有改应用代码；`origin/main` 只被读取。
- 全过程未输出 `.env` 内容、私钥、密码或供应商原始响应；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径、目录字符串与聚合计数。

## 9. 未验证事项

1. **没有登录后的员工冒烟。** 本环境没有凭据，也不允许编造，因此登录门之后的页面均未人工核对。**PR #106 的重点完全未在浏览器里跑过**：任务页 `?offset=` 分页、产物页 `?state=` 筛选、真机 44px 触控目标与 16px 输入字号、微信验证码字段字号，都未被实测。
2. **没有真实供应商调用。** PR #109 改变了播客供应商响应的读取方式（有上限、流式、UTF-8 严格），供应商的真实检索／抓取行为未跑过；知识库创建事务与 cookie 解析兜底同样只做了标记确认。
3. **没有回退演练，也没有完整数据库恢复演练。** 本轮 0 条新迁移，回退到 `3744aaa`、`55244fc` 或更早镜像都没有迁移风险；旧镜像、`.env` 备份与转储都保留，但转储只做过格式校验。
4. **发布本身没有仓库内日志与文档 PR。** 上一轮发布执行时按任务要求只产出结果文件，仓库的 `docs/logs/` 约定未执行；本 PR 补记该发布事实。
5. **仓库的发布记录滞后。** `07488ac` 之前随镜像发布的文档（PR #107、#110）只描述已合并的 PR，没有写明生产当前服务的版本号。
6. **员工侧验收仍未完成。** 镜像自带套件通过只证明代码路径可跑，**部署不等于验收**：仍需有人在手机上打开「全部任务」「我的任务与产物」「扫码绑定微信」，确认触控目标与字号合适、浏览器前进／后退能保住分页与筛选状态。

## 10. 残余风险

1. **`origin/main` 在发布窗口内移动过一次**（PR #109 代码 + PR #110 文档）。已发布的镜像是最后一次拉取的 tip，但**任何时刻都可能有新提交落地**；下次发布必须重新拉取并重新确认 tip。本次出现的 `git fetch` ref 锁冲突正是其他进程在并发推送的直接证据。
2. **一个窗口内发布了两个版本**（02:02–02:16）。两者各自备份、迁移（0 条）、健康检查，中间镜像也保留，回退只需按 tag 切换，但十五分钟内两次容器重建比平时更频繁，读日志时需留意。
3. **UI 复核的验收仍待人工完成。** 需在真机上核对：任务与产物页的分页与筛选、前进／后退保持 `?offset=`／`?state=`、刷新按钮不再重置页码、每个主按钮与输入框的 44px 触控与 16px 字号。
4. **Docker Hub 仍被阻断。** 每次构建都要在发布目录内重新做基础镜像替换，或给构建机配置代理／镜像白名单；该替换刻意不入库，新发布目录不重做就会构建失败。
5. **证书续期链路。** IP 证书 2026-10-30 10:32 UTC 到期（发布时约剩四天）；`certbot.timer` 被禁用是既有状态未改，`ai-work-cert-renew.timer` 处于启用且成功运行状态，需确认其持续成功。
6. **宿主机 `pg_restore` 无法读取 PG17 转储。** 备份格式校验必须在 db 容器内进行；若需在宿主机使用备份，需安装 PG17 客户端。
7. **15 个既有 standalone 失败仍为红色。** 与本次发布无关，但会持续干扰把全量套件当作发布闸门，需修复或从镜像内检查中排除。

## 11. 时间线（服务器时间，UTC+8）

| 时间 | 步骤 |
|---|---|
| 02:01 | SSH 可达性检查；发布前核对：`current` 软链、容器镜像与 `.env` 均为 `55244fc`，公网 `/api/health` 一致；`schema_migrations` 164 / 最大 `0190`；31 个发布目录与 31 个镜像；nginx、hermes、证书 timer 状态正常 |
| 02:01 | `git fetch origin main` → tip 为 `3744aaa`（任务给定的期望 tip，含 PR #106 `d3f813e` 与 PR #107）；`gh` 确认 #106、#107 均已合并且 CI 全绿 |
| 02:01–02:02 | `git archive 3744aaa` → 8,876,313 B，sha256 `f3e9d030…` 本地 ↔ 主机一致；1,042 文件 / 164 `.sql`；`git diff 55244fc..3744aaa -- '*.sql'` 为空 |
| 02:02 | 建发布目录；1,042 文件清单与本地解包一致；基础镜像替换（只在发布目录内）；`.env` 备份 + `pg_dump -Fc` 转储（`0600`）；`pg_restore --list` → 573 条 TOC |
| 02:02–02:03 | 构建镜像 `citic-newsfeed:3744aaa…`（776 MB，退出码 0） |
| 02:03 | setup → 退出码 0，「database is up to date」「sources: 0 added, 26 already there」；迁移复核仍为 164 / `0190` |
| 02:04 | 切换 `current` 软链与 `AIHOT_RELEASE`；api / worker / web 重建（`restarts=0`）；主机与公网 `/api/health` → `ok=true`、`db=ok`、release `3744aaa…` |
| 02:04–02:05 | 公网路由检查、镜像内标记检查（#106／#107）、范围／服务／卷核对 |
| 02:05 | **`origin/main` 移动到 `07488ac`**（PR #109 代码 + PR #110 文档）——确认是 `3744aaa` 的快进、CI 全绿、0 条新迁移 |
| 02:10–02:12 | 在镜像内重跑 standalone 套件：`3744aaa`（membership 158/158；全量 386/371/15）与发布前基线 `55244fc`（158/158；386/371/15），失败集合完全相同 |
| 02:13 | `git archive 07488ac` → 8,878,569 B，sha256 `84211f1c…` 本地 ↔ 主机一致；1,044 文件 / 164 `.sql`；清单一致（`998a87a3…`）；替换基础镜像（仅 1 个文件不同）；备份 + `pg_dump`（`pg_restore --list` → 573 条 TOC） |
| 02:14–02:16 | 构建镜像 `:07488ac…`（777 MB，退出码 0）；setup → 退出码 0（迁移仍 164 / `0190`）；切换软链与 `AIHOT_RELEASE`；api / worker / web 重建（`restarts=0`）；主机与公网健康 → `ok=true`、`db=ok`、release `07488ac…` |
| 02:17–02:19 | 最终公网路由检查、最终镜像标记复核（#106 + #109）、镜像内 standalone 套件（membership 160/160；全量 388/373/15）、范围／服务／卷／证书核对、临时产物清理 |
| 02:20 | 最终 `git fetch` 确认 `origin/main` = `07488ac`（未再移动）；公网 `/api/health` 复查 3 次 → release `07488ac…` |

## 12. 本次（文档）改动与最小验证

- 修改文件：`docs/logs/2026-10-26-P4-ui-backend-review-deployment.md`（本文件，新增）、`docs/DEPLOY-VOLCENGINE.md`、`docs/PROGRESS-REPORT.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、`README.md`。
- 实际完成：把 `07488ac` 记录为**当前生产版本**，并写明窗口内先上线的 `3744aaa`、发布前的 `55244fc`、0 条新迁移、备份与回退路径、镜像内回归结果与登录后验收缺口。
- 关键决定：
  - **不复制其他打开的文档 PR 的日志文件。** 记录 release `e2daacd`（PR #96 + #97）的 [文档 PR #101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101)、记录 release `cc1a5af`（PR #100）的 [文档 PR #102](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/102)、记录 release `55244fc`（功能批次）的 [文档 PR #108](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/108) **仍处于打开状态**，其独有日志文件不在本 PR 中重复加入；合并顺序应按发布先后。
  - 本 PR 只写文档，**不合并、不部署、不改应用代码**；`07488ac` 已是生产版本，本 PR 不改变任何开关或数据。
  - `docs/IMPLEMENTATION.md` 的任务勾选**不变**：本轮只是发布，没有新增验收证据，P4-03／P4-04 与 P3-01～P3-04 仍为 `[ ]`；只在 P4 小节补记最新生产版本与验收缺口。
  - `docs/PROGRESS-REPORT.md` 中「赛道同业竞争看板」与「前沿播客」的描述此前仍写「尚未合并、部署」，与生产实际不符，一并改为「已包含在生产版本 `07488ac` 中」；同文件中两处 `17/27` 的旧计数改为与实施计划一致的 `18/28`（P2-06 勾选后即为 18/28）。
- 执行的检查及结果：`node scripts/check-doc-links.ts` 通过（本地 Markdown 链接全部可解析）；`git diff --check` 通过。
- 未执行或需用户试用的检查：未连接生产实例复核（本次事实来自同一轮发布执行的记录）；未做登录后员工验收（需人工在手机上完成，见第 9 节第 6 条）。
- 下一步：人工在手机与桌面浏览器完成「全部任务」「我的任务与产物」「扫码绑定微信」的触控与字号核对、前进／后退的 URL 状态保持核对，并决定 #101／#102／#108 与本 PR 的合并顺序。
