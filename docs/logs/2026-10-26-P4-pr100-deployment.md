# PR #100 赛道同业竞争看板公开资料检索生产发布（2026-10-26）

本记录说明把 GitHub `main` 的 tip `cc1a5af`（[PR #100](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/100) `feat: fill sector peer dashboard from public search`）发布到火山云 `ai-work` 生产的过程与证据。本次发布把「赛道同业竞争看板」从 P0 空看板换成有调用上限的公开网页检索与页面抓取版本，产出逐项引用来源的 HTML 看板。

**本 PR 不合并 — record-only。** 本分支只记录发布事实，不含功能改动。

## 1. 发布对象

| 项 | 值 |
|---|---|
| 发布提交 | `cc1a5afef96415e6829982479cfa41485b95b697`（短 `cc1a5af`） |
| 对应 PR | [PR #100](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/100) `feat: fill sector peer dashboard from public search (#100)` |
| 目标主机 | `root@115.190.114.65`（`ai-work`） |
| Compose 项目 | `citic-newsfeed-prod` |
| 发布目录 | `/opt/citic-newsfeed/releases/cc1a5afef96415e6829982479cfa41485b95b697` |
| 发布窗口 | 2026-10-26 00:50–00:56（Asia/Shanghai；服务器为 UTC+8） |
| 发布前版本 | `e2daacd533086a711eed996096d75189104034df`（PR #96 + #97 + #99，2026-10-26 00:29–00:50 的上一轮发布） |

- PR #100 的内容：`sector-peer-landscape` 专家为同业、阶段信号、境内资本事件与美国参考各执行一次固定 Search，每次最多 5 条结果并请求正文；正文不足时最多 Fetch 3 个来源页；最后最多一次结构化模型整理。来源标题、URL 与日期只取自检索结果或 Fetch 返回，模型输出须引用本次来源 ID，服务端剔除未检索 ID 与跨中国／美国分区的引用；无可靠证据的分区显示「未披露／未检索到」并并列检索缺口。
- 发布提交与发布结束时重新拉取的 `origin/main` tip **完全一致**：拉取后 `origin/main` 恰为该 SHA，无快进漂移，发布结束复核 `main` 仍为 `cc1a5af`。

## 2. 发布前核对

- 发布前公网 `https://115.190.114.65/api/health` 返回 `release = e2daacd533086a711eed996096d75189104034df`，与预期一致；主机 `current` 软链与 web/api/worker 三个容器镜像同为该 SHA。若公网已是目标 SHA 则应停止并报告。
- `origin/main` 重新拉取后 tip 为 `cc1a5afef96415e6829982479cfa41485b95b697`，与预期 SHA 一致。
- 发布前 `schema_migrations` 为 164 条、最大版本 `0190_member_experts_status_coming_soon_validate.sql`；主机上有 27 个发布目录与 27 个 `citic-newsfeed` 镜像；磁盘剩余 42 GiB。
- 本地检出分支（`fix/frontier-podcast-hide-partial-banner`，HEAD `f472ad0`，另有其他进程的未提交改动）**不是**发布来源；归档取自重新拉取的 `origin/main` SHA 并逐文件校验，那些既有本地改动未被触碰。

## 3. 发布包与完整性

- 发布包由 `git archive cc1a5af` 从**重新拉取的 `origin/main`** 生成，不使用本地检出分支。归档大小 15,339,520 字节，sha256 `4ba331b2666fbdd8738af68242052de058f26a99ccb9940f9ca1736c4ebe29a1`，本地与主机**逐字节一致**。
- 发布目录共 1,026 个文件（另有 80 个目录项），比上一版多 2 个：`packages/backend/src/providers/deepseek-search.ts` 与 `docs/logs/2026-10-26-P2-06-sector-peer-search.md`；其中 `.sql` 文件 164 个，与 `schema_migrations` 的 164 条已应用行一致。主机侧生成全部 1,026 个文件的 sha256 清单，与本地 `git archive` 解包结果**逐文件完全一致**（0 处差异）。
- 发布目录内 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`（宿主机无法直连 Docker Hub，`curl https://registry-1.docker.io/v2/` 失败）。该改动**只存在于发布目录**：与纯净 `git archive` 解包结果比对，差异恰好只有这一行 `FROM`；仓库中被 git 跟踪的 `Dockerfile.volcengine` 保持 `node:24-trixie-slim` 未变，未提交、未推送。发布目录是 `git archive` 解包结果而非 Git 工作树，被跟踪文件不可能被改写。

## 4. 迁移

**0 条新迁移。** `git diff e2daacd..cc1a5af -- '*.sql'` 为空。

- setup 先于新代码上线运行，退出码 **0**，输出：

  ```
  database is up to date
  sources: 0 added, 26 already there
  experts: the platform's own catalog entries are in place
  ```

- `schema_migrations`：**164 → 164** 条，最大版本 `0190_member_experts_status_coming_soon_validate.sql`，setup 前后分别捕获与复核，数值不变。
- 信源播种幂等（26 个信源，无新增）；专家目录行被**就地更新**：`sector-peer-landscape` 的 `version` 由 `0.1.0` 改为 `1.0.0`、描述改为新目录文案，没有产生重复行。
- 顺序与历次一致：构建 → `up -d --force-recreate --no-deps setup`（迁移 + 播种）→ 切换 `current` 软链与 `AIHOT_RELEASE` → `up -d --no-deps --force-recreate api worker web`。

## 5. 备份

| 路径 | 大小 | 权限 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-cc1a5af-20261026` | 1,120 B | `0600` |
| `/opt/citic-newsfeed/shared/backups/db-before-cc1a5af-20261026.dump` | 11,520,071 B | `0600` |

- `.env` 备份在写入新的 `AIHOT_RELEASE` **之前**生成，其中仍是发布前的 `e2daacd533086a711eed996096d75189104034df`。
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
- 目标镜像 `citic-newsfeed:cc1a5afef96415e6829982479cfa41485b95b697`（image id `960217712bf6`，776 MB，构建于 2026-10-26 00:52:46 +0800）。回退镜像 `citic-newsfeed:e2daacd…` 与 `citic-newsfeed:aa1323a…` 保留未删。
- 镜像卫生检查：`/app` 下只有 `.env.example`，没有 `/app/.env`、没有 `/app/.config`。
- 发布目录数 27 → 28，镜像数 27 → 28；**未清理任何旧发布目录或旧镜像**。

## 7. 运行状态与健康检查

公网 `https://115.190.114.65/api/health`（在 Joe 的 Mac 上验证，不只从主机验证；重建后复核 4 次）与主机 loopback `http://127.0.0.1:3000/api/health` 返回同一结果：

```json
{"ok":true,"db":"ok","ms":1,"release":"cc1a5afef96415e6829982479cfa41485b95b697"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为完整 SHA `cc1a5afef96415e6829982479cfa41485b95b697`；`/opt/citic-newsfeed/current` → `/opt/citic-newsfeed/releases/cc1a5afef96415e6829982479cfa41485b95b697`。

### 路由检查（公网，未登录）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release = 目标 SHA |
| `/login` | 200 | 登录页可打开 |
| `/register` | 200 | 注册页可打开 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 专家目录，按会话鉴权 |
| `/experts/sector-peer-landscape` | 302 → `/login?next=%2Fexperts%2Fsector-peer-landscape` | **PR #100** 赛道同业竞争看板路径，按会话鉴权 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=%2Fexperts%2Foutbound-investment-panorama` | PR #97 全景图路径，按会话鉴权 |
| `/experts/frontier-podcast` | 302 → `/login?next=%2Fexperts%2Ffrontier-podcast` | PR #93／#96 前沿播客路径，按会话鉴权 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表，按会话鉴权 |
| `/knowledge` | 302 → `/login?next=%2Fknowledge` | 知识库，按会话鉴权 |

> 与前几轮相同的限制：不存在的 slug 同样返回通用的 302 跳登录，因此路由检查只证明鉴权边界与动态路由已注册，不能证明某个具体 slug 存在。PR #100 的代码确实在运行镜像中，由下节标记检查与生产目录行证明。

### PR #100 代码确认存在于运行镜像

| 标记 | 预期 | 容器 / 文件 | 结果 |
|---|---|---|---|
| `packages/backend/src/providers/deepseek-search.ts`（7,919 B） | 存在 | api + worker | ✅ 两个容器均有 |
| `export async function searchSectorPeerSources` | 存在 | api + worker | ✅ 各 1 处 |
| `export function validateSectorPeerBoard` | 存在 | api + worker | ✅ 各 1 处 |
| `export function renderSectorPeerDashboard`（新的对象入参签名） | 存在 | api + worker | ✅ 各 1 处 |
| `async function runSectorPeer(task, leaseToken)` | 存在 | worker `experts/worker.ts` | ✅ 第 82 行 |
| `if (isSectorPeer) report = await runSectorPeer(task, leaseToken);` | 存在 | worker `experts/worker.ts` | ✅ 第 513 行 |
| `SECTOR_PEER_EXPERT_SLUG = "sector-peer-landscape"` | 存在 | api `experts/catalog.ts` | ✅ 第 106 行 |
| `version: "1.0.0"`（原 `0.1.0`） | 存在 | api `experts/catalog.ts` | ✅ 第 117 行 |
| `expert_search_unavailable` / `expert_search_response_invalid` / `expert_search_rejected` | 存在 | api `experts/worker.ts` | ✅ |
| 员工提示「看板整理可公开检索并附来源的信息」 | 存在 | web bundle | ✅ `build/server/index.js` 与 `build/client/assets/expert-detail-DvnrBiqu.js` |
| `赛道同业竞争看板` | 存在 | web bundle | ✅ server 与 client bundle |

### P0 空看板措辞已不在发布内容中

| 旧标记 | api | web bundle |
|---|---|---|
| `P0 空看板` | **0 处** | **0 个文件** |
| `数据源未接入 · 暂无同业名单` | **0 处** | **0 个文件** |
| `P0 只保存原始查询` | **0 处** | **0 个文件** |
| `P0 只生成公开数据空看板`（员工提示） | — | **0 个文件** |

### 员工界面不出现供应商品牌名

- 对整个已构建 web bundle `/app/apps/web/build/` 执行 `grep -ril "deepseek"`，结果为 **0 个文件**：员工侧产物中没有任何供应商品牌名。
- 员工看板模板 `modules/membership/experts/sector-peer-html.ts` 中唯一的 `deepseek` 出现在第 2 行的**类型导入**（`import type { PublicSearchSource } from "@aihot/backend/providers/deepseek-search";`），渲染出的 HTML 中 **0** 处供应商品牌名。表头写「检索公开网页资料」，描述写「通过公开网页检索整理同业、发展信号与融资／并购／IPO 事件；中国市场优先，美国资料仅作参考。」，只有能力表述。
- 三个员工 HTML 模板（`sector-peer-html.ts`、`frontier-podcast-html.ts`、`panorama-html.ts`）排除导入语句后的品牌名计数为 **0**。

### 生产目录行（发布后从生产库读回）

```
sector-peer-landscape | available | 1.0.0 | 通过公开网页检索整理同业、发展信号与融资／并购／IPO 事件；中国市场优先，美国资料仅作参考。
```

生产 `member_experts` 完整目录：

```
company-sentiment-report               | hidden   | 企业舆情报告
external-investment-landscape-xinhua-adapter | hidden | 企业一层对外投资核查
frontier-podcast                       | available| 前沿播客
outbound-investment-panorama           | available| 对外投资全景图
sector-peer-landscape                  | available| 赛道同业竞争看板
```

### 生产侧凭据接线（未改动任何配置）

- 生产 `.env` 没有 `DEEPSEEK_BASE_URL`，也没有 `DEEPSEEK_API_KEY`，只有 `LLM_BASE_URL=https://api.deepseek.com` 与 `LLM_MODEL=deepseek-flash`。
- `deepseek-search.ts` 的 `apiRoot()` = `credential("models","DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com"`，默认回退值与生产 `LLM_BASE_URL` 的主机完全一致，因此新的 `/v1/tools/search` 与 `/v1/tools/fetch` 指向的正是模型流量已在使用的主机，无需也不曾修改环境变量。
- `apiKey()` = `credential("models","DEEPSEEK_API_KEY") ?? credential("models","LLM_API_KEY")`，最终回退到原始凭据文件 `/run/credentials/deepseek-api-key.json`；该文件在 api 与 worker 容器内均可读（主机侧目录 `0750`、文件 `0640`、属主 `root:1000`，内容从未打印）。
- 生产 `config.modelCallsEnabled` 为 `true`（api 与 worker 的 `MODEL_CALLS_ENABLED=true`），因此供应商的 `disabled` 分支不会被触发。
- 检索查询的下限守卫 `sector_query_required`（少于 2 个汉字／拉丁字母返回 HTTP 400）存在于 `experts/routes.ts` 第 125 行。

## 8. 回归测试（运行镜像内，隔离执行）

镜像自带的独立回归套件在**已发布的镜像**内以 `--network none` 重跑（无数据库、无生产数据改动）：

```
ℹ tests 151
ℹ pass 151
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5084.937023
```

命令：`node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`。上一版镜像 `e2daacd` 为 149 条，**新增的 2 条来自 PR #100**：`expert-catalog-coming-soon.test.ts` 与 `expert-coming-soon.standalone.test.ts`。临时容器使用 `--rm`，未留下容器或网络。

## 9. 范围未被触碰

- `nginx` → `active`，站点配置 `/etc/nginx/sites-available/ai-work-mvp` 未改动（mtime 2026-10-22 10:54），仍为 `proxy_pass http://127.0.0.1:3000`；`nginx -t` 通过。`hermes-agent-gateway` → `active`；`ai-work-cert-renew.timer` → `enabled + active`（上次运行 2026-10-25 03:47:57 成功）；`certbot.timer` 仍为 `disabled`（既有状态，未改）。
- web 仍只绑定 `127.0.0.1:3000`；api、worker、db **没有**主机端口映射（`3000/tcp`、`5432/tcp` 只在 Compose 内网）。
- 数据库容器未重建（启动于 `2026-10-22T01:57:27.232065953Z`，restarts 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完好。没有执行 `down`、`prune`，未删除任何发布目录、镜像或卷。
- 五个应用容器重建后 `restarts = 0`；最近 300 行日志中 error/fatal/unhandled/exception 扫描 **0** 处命中。api 日志只有 "Server listening"，worker 只有 "worker started"，web 只有 "web started"。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内均保持 `true`，**未做任何切换**（`MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` 也仍为 `true`）。
- 未合并或关闭任何 PR；**没有强推**，没有本地提交；`origin/main` 保持 `cc1a5afef96415e6829982479cfa41485b95b697` 不变。功能 PR 未被触碰。
- 全过程未输出 `.env` 内容、私钥、密码或 API key；只读取了键名、非机密的 `AIHOT_RELEASE` 取值、备份路径、数据库行数与目录文案。
- 只删除了本次发布自己的临时产物（`/tmp/release-cc1a5af.tar`、`/tmp/release-cc1a5af.manifest`、db 容器内的临时 `verify.dump`，以及 Mac 上的本地归档与校验目录）。没有删除任何发布目录、镜像、卷或数据库。

## 10. 残余风险与待办

1. **线上检索链路仍是最大未知.** 若 `api.deepseek.com` 对本账号没有 `/v1/tools/search` 与 `/v1/tools/fetch`，专家会失败并给出明确错误码（`expert_search_unavailable` / `expert_search_response_invalid` / `expert_search_rejected`），三个错误码都已接线并产出中文员工提示，不会静默成功。必须用真实查询手工验证。
2. **看板是草稿，不是已核定事实集.** 每条结论都带本次来源集合过滤后的 `sourceIds`，URL 做了转义并以 `target="_blank" rel="noopener noreferrer"` 渲染，模型无法注入 URL；但「检索缺口」与来源页仍需人工阅读，「未披露／未检索到」不等于该事项不存在。
3. **PR #100 的员工验收仍待完成.** 手工闭环：用真实企业／赛道跑一次「赛道同业竞争看板」，确认 HTML 看板渲染出四个栏目 + 检索缺口 + 检索来源，每条结论有可点击来源与来源日期（或「未提供」），HTML 与 Markdown 产物可下载，并确认员工界面不出现供应商品牌名。
4. **Docker Hub 仍不可达.** 每次构建都需在发布目录内重新做基础镜像镜像源替换，或给构建机配置代理／镜像白名单；该替换是刻意不入库的，新发布目录不重新替换就会构建失败。
5. **证书续期链路.** IP 证书 2026-10-30 UTC 到期；`certbot.timer` 被禁用是既有状态，本次未改动，需确认 `ai-work-cert-renew.timer` 持续成功。
6. **宿主机 `pg_restore` 无法读取 PG17 转储.** 备份格式校验必须在数据库容器内进行；若需在宿主机使用该备份，需安装 PG17 客户端。
7. **`origin/main` 随时可能再次移动.** 本仓库有并行的文档合并流程（上一轮 PR #99 就在发布窗口内到达 `main`）；本轮结束复核 `main` 仍为 `cc1a5af`，下次发布前必须重新拉取并重新确认 tip 再归档。
8. **仓库自身的发布记录滞后.** 本次发布任务只要求产出发布结果文件并禁止合并或关闭 PR，因此没有为这次发布创建 `docs/logs/` 条目与文档 PR（按 `AGENTS.md` 约定，通常需要一份保持打开、只作记录的文档 PR，与 PR #95／#99 同类）。本文与[发布小节](../DEPLOY-VOLCENGINE.md)即为该记录，需人工合并后仓库「最新生产发布」文字才指向 `cc1a5af`。

## 11. 时间线

| 时间（服务器，UTC+8） | 步骤 |
|---|---|
| 00:50 | SSH 连通性检查；发布前盘点：`current` 软链、容器镜像与 `.env` 均为 `e2daacd`，公网 `/api/health` 同为 `e2daacd`；`schema_migrations` 164 / `0190`；27 个发布目录 / 27 个镜像；nginx、hermes、证书定时器均为运行状态；磁盘剩余 42 GiB |
| 00:51 | `git fetch origin main` → tip 确认为 `cc1a5af`；`git archive` → 15,339,520 B，sha256 本地 ↔ 主机一致；1,026 个文件 / 164 个 `.sql`；`git diff e2daacd..cc1a5af -- '*.sql'` 为空 |
| 00:52:04 | 主机创建发布目录；1,026 个文件的 sha256 清单与本地解包结果完全一致；改写基础镜像（仅发布目录内） |
| 00:52:20 | `.env` 备份 + `pg_dump -Fc` 数据库转储（`0600`）；`pg_restore --list` → 573 条 TOC 记录可读（db 容器内 PG17 客户端） |
| 00:52:22–00:52:46 | 构建镜像 `citic-newsfeed:cc1a5af…`（776 MB，退出码 0） |
| 00:53:09 | setup 容器运行 → 退出码 0，「database is up to date」「sources: 0 added, 26 already there」；迁移复核仍为 164 / `0190` |
| 00:53:19 | `current` 软链切到 `releases/cc1a5af…`；`.env` 的 `AIHOT_RELEASE` 更新为 `cc1a5af…` |
| 00:53:34 | api / worker / web 在新镜像上重建完成（`restarts=0`） |
| 00:53:45 | 主机与公网 `/api/health` → `ok=true`、`db=ok`、release `cc1a5af…` |
| 00:54–00:56 | 公网路由检查、镜像内标记检查、PR #100 代码标记核对、镜像内 standalone 回归 151/151、服务与数据库／卷范围检查、临时产物清理 |

## 12. 证据

- 本文件：`docs/logs/2026-10-26-P4-pr100-deployment.md`。
- 现场发布结果记录（维护者本地）：`~/Desktop/playground/pi-nf-100-deploy-result.md`。
- 上一轮 release `e2daacd`（PR #96 + #97 + #99）的发布记录正在文档 PR [#101](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/101) 中，**尚未合并进 `main`**；本文不改动其内容，只按事实把 `e2daacd` 记为本次发布的前一版本。
- 再上一轮：[PR #93 发布日志](2026-10-25-P4-pr93-deployment.md)（release `f472ad0`）。
- 仓库内运维手册：`docs/DEPLOY-VOLCENGINE.md`。
