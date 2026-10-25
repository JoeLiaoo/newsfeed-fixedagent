# PR #92 全景图品牌前缀关系提示 · 生产发布记录（2026-10-25）

## 发布结论

- [PR #92](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/92) 已 squash 合并，`main` 尖端提交 `7858842dc2c04d1f2e1b1527df05b66fcd152e4d` 已发布到火山云生产 `/opt/citic-newsfeed/releases/7858842dc2c04d1f2e1b1527df05b66fcd152e4d`。
- 本次发布内容为短品牌前缀候选的**关系提示**（如「宁德时代」这类只输入品牌词的查询）：在登记名不以前者完整登记名开头、因此服务端 `branchOf` 判不出层级时，给候选挂上「母公司候选」「分支机构」提示；同名记录只标一条，大陆统一社会信用代码优先。`/experts/:slug` 与 `/tasks/:id` 共用同一条 `companyRelationLabel` 规则。
- **0 条新迁移**：PR #92 只改专家数据与界面，`git diff 8a1a3cf..7858842 -- '*.sql'` 为空，迁移 `.sql` 文件清单两版各 164 个且完全一致。
- 发布前生产 release 为 `8a1a3cf6d5e6b7ad17c83647debcf51a801deea3`（PR #87「前沿播客」），发布前已在公网 `/api/health` 与主机 `current` 软链上确认。
- 本记录只描述已发生的发布动作，**不勾选**任何实施状态；全景图候选的登录后人工复测仍待完成。

## 发布事实

| 项 | 值 |
|---|---|
| 主机 | `root@115.190.114.65`（`ai-work`），Compose 项目 `citic-newsfeed-prod`，路径 `/opt/citic-newsfeed` |
| 发布提交 | `7858842dc2c04d1f2e1b1527df05b66fcd152e4d` |
| 发布前 release | `8a1a3cf6d5e6b7ad17c83647debcf51a801deea3` |
| 镜像 | `citic-newsfeed:7858842dc2c04d1f2e1b1527df05b66fcd152e4d`（`34dc45c6d31b`，776 MB） |
| 发布目录 | `/opt/citic-newsfeed/releases/7858842dc2c04d1f2e1b1527df05b66fcd152e4d`（1007 个文件） |
| 归档校验 | `git archive` 的 sha256 `87fc01be1141e5ee76f9c1aa51431dc90a3b4e8253faf89ff5df8a0205ffa840` 本机与远端一致；除 `Dockerfile.volcengine` 外的 1006 个文件逐文件 sha256 比对与本地归档完全一致 |

发布顺序：备份 → setup（迁移＋种子）→ 翻 `current` 软链 → 重建 web、API、worker。

## 健康检查与路由

公网 `https://115.190.114.65/api/health`（从 Joe 的 Mac 侧多次复核，非仅主机侧）：

```json
{"ok":true,"db":"ok","ms":1,"release":"7858842dc2c04d1f2e1b1527df05b66fcd152e4d"}
```

`AIHOT_RELEASE` 在 web、api、worker 三个容器内均为该完整提交；`/opt/citic-newsfeed/current` 指向同一发布目录；主机回环 `http://127.0.0.1:3000/api/health` 返回相同 release。

| 路由 | 状态 | 说明 |
|---|---|---|
| `/api/health` | 200 | `ok=true`、`db=ok`、release 为目标提交 |
| `/login` | 200 | 登录页可渲染 |
| `/favicon.ico` | 200 | 站点图标可取 |
| `/experts` | 302 → `/login?next=%2Fexperts` | 会话鉴权跳转 |
| `/experts/outbound-investment-panorama` | 302 → `/login?next=%2Fexperts%2Foutbound-investment-panorama` | 全景图路径存在 |
| `/tasks` | 302 → `/login?next=%2Ftasks` | 员工任务列表路径存在 |
| `/tasks/x1` | 302 → `/login?next=%2Ftasks%2Fx1` | 单任务详情路径存在 |

> 口径说明（同 PR #79／#81／#87 的既有说明）：未登录时任何未知路径都会得到同样的通用 302，因此上面的检查证明的是**鉴权边界与路由注册**，不证明某个具体 slug 或任务号存在。代码与数据侧的存在性由下面的镜像内检查与数据库行证明。

## 迁移与播种

setup 容器退出码 0，输出：

```
database is up to date
sources: 0 added, 26 already there
experts: the platform's own catalog entries are in place
```

- `schema_migrations`：**164 → 164** 行，最大值仍为 `0190_member_experts_status_coming_soon_validate.sql`，发布前后完全一致。
- 种子为幂等：信源 0 新增、26 条已存在，未重写信源数据。
- PR #92 不改 `member_experts` 目录结构，不新增专家条目。

## 备份

| 路径 | 大小 | 权限 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-7858842-20261025` | 1,120 B | `0600` |
| `/opt/citic-newsfeed/shared/backups/db-before-7858842-20261025.dump` | 10,989,378 B | `0600` |

`.env` 备份在改写 `AIHOT_RELEASE` **之前**生成，因此保存的是上一版 release 值。数据库转储使用 `pg_dump -Fc`（自定义格式），文件头为 `PGDMP`；`pg_restore --list` 在数据库容器内读出 573 条 TOC 目录，结构可读。**未做完整恢复演练**；主机上的 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储，格式校验须在容器内进行。

## 运行镜像内的代码确认

| 标记 | 容器 | 文件 |
|---|---|---|
| `export function companyRelationLabel(candidate, candidates, query, approximate = false)` | api | `modules/membership/experts/data.ts` 第 218 行 |
| `"母公司候选"` / `"分支机构"` 标签字面量 | api | `modules/membership/experts/data.ts` 第 222、250、252 行 |
| `import { companyRelationLabel, isBranchType }` | web | `modules/membership/pages/expert-detail.tsx` 第 17 行，第 234 行渲染徽标 |
| `import { companyRelationLabel }` | web | `modules/membership/pages/task-detail.tsx` 第 12 行，第 169 行渲染徽标 |
| 构建产物包含标签文案 | web | `apps/web/build/server/index.js`、`apps/web/build/client/assets/data-BuWQLS0O.js` |

`companyRelationLabel` 的新签名把「员工输入的查询词」和「近似匹配」标记一起纳入判断：只有登记名真正携带查询词时才可能出标签，近似候选一律不出；母公司候选靠登记类型后缀、被明确引用的 `branchOf` 或大陆统一社会信用代码共同确定，同名候选只保留一条。

## 镜像内回归

在已发布的镜像里以 `--network none` 独立执行（不连数据库，不触碰生产数据）：

```
node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"
ℹ tests 144
ℹ pass 144
ℹ fail 0
```

上一版 `8a1a3cf` 同项为 141/141，新增的 3 条即 PR #92 的回归：真实形状的同名候选只标一条「母公司候选」、品牌兄弟主体标「分支机构」且不臆造 `branchOf`；不带查询词的近似候选不出标签；只有品牌匹配而无母公司信号时不编造母公司。

## 未改动的范围

- `nginx`、`hermes-agent-gateway` 均 `active`；`certbot.timer` 仍为 `disabled`（既有状态，未改）；`ai-work-cert-renew.timer` 仍 `active`。
- 数据库容器未重建（启动时间 `2026-10-22T01:57:27Z`，重启次数 0），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 完整；web 仍只绑定 `127.0.0.1:3000`。
- 四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）在 api 与 worker 容器内仍全为 `true`，本轮未改动取值。
- 发布目录 23 个、镜像 23 个，均未删除；未执行 `down`、`prune` 或卷删除。
- 五个容器重启次数均为 0；web／api／worker 最近 200 行日志中 error／fatal／unhandled／exception 命中 0。
- 未合并任何未合并的 PR；GitHub `main` 未改动，仍为 `7858842…`，只推送了本条文档分支。

## 构建口径

Docker Hub 在目标机不可达，因此只在**发布目录内**把 `Dockerfile.volcengine` 的 `FROM node:24-trixie-slim AS base` 指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；发布目录是 `git archive` 解包结果而非 Git 工作树（`fatal: not a git repository`），仓库中受版本控制的文件未被改动，也没有为此提交或推送任何内容。构建使用 `-f docker-compose.yml -f compose.volcengine.yml` 两个文件并带 `RELEASE_ID=<完整提交>`，未产生多余的 `aihot-app` 镜像。镜像内没有 `/app/.env`，也没有 `/app/.config`。

## 剩余风险与待办

1. **登录后的人工复测仍未完成。** 本次发布证明了公网健康、鉴权边界、路由注册、代码确实在运行镜像并被其提供，以及镜像内回归全绿；**不能**证明员工看到的候选徽标渲染正确。仍需人工确认：以「宁德时代」跑一次对外投资全景图，候选里出现「母公司候选」「分支机构」提示，员工确认主体后任务卡显示已确认主体。
2. **本次代码只实现了两种提示。** 发布说明里提到的「关联主体」标签在 `7858842` 的代码里并不存在（全仓检索 0 命中）：`companyRelationLabel` 只会返回「母公司候选」或「分支机构」。若产品上确实需要第三种标签，属于后续需求，不在本次发布范围内。
3. **候选标签是提示，不是认定。** 母公司候选由名称形态、信用代码等启发式规则推断，员工仍须确认法律主体；标签不构成股权或法律分支事实。
4. **只读登记数据的表现未被复测。** 提示是否按预期出现，取决于生产环境里该查询的实际候选形状（同名记录、类型后缀、信用代码分布），本次未在生产库上运行真实检索。
5. **P0 看板仍是空壳**，本轮不涉及；GP 真实证据仍缺失。
6. **回退未演练。** 本轮 0 条新迁移，回退到 `citic-newsfeed:8a1a3cf6d5e6b7ad17c83647debcf51a801deea3` 无迁移风险；旧镜像、`.env` 备份与数据库转储均保留，转储只做过格式校验，未恢复进临时库。
7. **Docker Hub 仍被拦截**，以后每次发布都要在发布目录重做基础镜像指向，或给构建机配代理／镜像白名单。
8. **文档滞后于线上。** 本条记录以 docs-only PR 提交、不合并，仓库自身的「最新生产发布」文字要等人合并后才反映本次发布。
