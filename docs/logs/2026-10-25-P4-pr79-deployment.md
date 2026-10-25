# P4 · PR #79 合并后火山云发布（2026-10-25）

## 发布对象与前提

- 本次发布的是 `main` 尖端提交 `b8eb08bb75f708f6b309d58f61b3d98427f9d519`（部署前重新 `git fetch origin main` 并 `git rev-parse origin/main` 确认，发布完成后尖端未移动）。该提交是 [PR #79](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/79) 的 squash 合并：`赛道同业竞争看板 P0：替换舆情入口并生成 HTML 空看板 (#79)`。
- PR #79 的范围：目录里以可运行的「赛道同业竞争看板」（slug `sector-peer-landscape`）替换原「企业舆情报告」入口；旧 slug `company-sentiment-report` 改为隐藏并保留历史任务关联；worker 直接生成独立 HTML 空看板（三主区 + 美国参考带 + 数据源未接入 + 数据缺口 + 生成时间 + 免责提示），产物沿用 `member_expert_artifacts` 的本人鉴权、下载与七天清理；页面在无脚本权限的 iframe 中预览并可下载；生成时间改由 `@aihot/contracts/time` 的 `beijingStamp` 统一输出（P0 不接数据源、不调模型、不取数）。
- 发布前线上仍是上一次主线发布 `bd4b150afb49cebb408215713827b1e02b8ed432`（PR #77），公网与本机回环 `/api/health` 返回 `ok=true`、`db=ok`、release 为该提交，`/opt/citic-newsfeed/current` 也指向该发布目录，确认前置状态与预期一致后才开始。
- **本轮无新增迁移文件**：`git diff bd4b150..b8eb08b -- '*.sql'` 为空；新旧两个提交的迁移文件清单逐项相同（`database/migrations/` 125 个 + `modules/membership/migrations/` 39 个，共 164 个 `.sql`，最大编号 `0190`）。
- 部署在开发机执行：2026-10-25 19:41–19:46（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-79-deploy-result.md`，按仓库公开约定不随提交上传。
- 未合并任何开放 PR（#54–#61、#69、#71、#74、#76、#78 等仍开放），只发布已经在 `main` 上的代码。

## 发布操作

- 源码以 `git archive` 导出后上传解包到 `/opt/citic-newsfeed/releases/b8eb08bb75f708f6b309d58f61b3d98427f9d519`（986 个文件）；归档 sha256 `c4cee23830a891f955eca1d2543363c0d21010831ffc8943e8959148d9c0825d`，本机与目标机一致。共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录（现有 18 个发布目录，历史目录全部保留）。
- 发布完整性核对：发布目录 986 个文件（排除下述被改写的 `Dockerfile.volcengine`）与 `git archive b8eb08b` 的本地展开逐文件 sha256 比对一致，唯一差异是被改写的基础镜像行（排除 `.env` 符号链接）。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-b8eb08b-20261025`（1,120 字节），数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-b8eb08b-20261025.dump`（10,673,292 字节）；两者权限均为 `0600`。`.env` 备份在 `AIHOT_RELEASE` 被改写**之前**取得，保存的是上一版发布号。转储经 `pg_restore --list` 检查可读（573 条 TOC 目录项，文件头 `PGDMP`），**未做完整恢复演练**。
  - 注：宿主机自带 `pg_restore` 为 PostgreSQL 16.15，无法读取 PostgreSQL 17 的转储（`unsupported version (1.16) in file header`）；校验改在数据库容器内的 17.11 客户端完成，结论以容器内结果为准。
  - 注：`pg_dump` 必须显式加 `-Fc`（自定义格式）。默认的纯文本格式不能被 `pg_restore --list` 读取；本轮按自定义格式生成。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `b8eb08bb75f708f6b309d58f61b3d98427f9d519`，文件权限仍为 `0600`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达，因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与 git 跟踪版本逐行比对差异只有该 `FROM` 一行，仓库源码不变，未提交也未推送。
- 构建镜像 `citic-newsfeed:b8eb08bb75f708f6b309d58f61b3d98427f9d519` 成功（775 MB，镜像 id `a9bd5715752f`）。构建命令同时使用 `docker-compose.yml` 与 `compose.volcengine.yml` 两份文件，未产生多余的 `aihot-app` 镜像。构建产物内已确认不含 `/app/.env` 与 `/app/.config`（仅 `.env.example`）。
- **setup 先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才把 `current` 指向新发布目录并重建 web、API、worker。
- setup 输出 `database is up to date` 与 `sources: 0 added, 26 already there`；`schema_migrations` 发布前后均为 **164 条**，最大 `0190_member_experts_status_coming_soon_validate.sql`，**0 条新迁移**。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 `2026-10-22T01:57:27Z`，镜像 `postgres:17-alpine`），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除。

## 发布核对与回退

- 本机回环与公网 `/api/health` 均返回 `{"ok":true,"db":"ok","ms":1,"release":"b8eb08bb75f708f6b309d58f61b3d98427f9d519"}`；发布后连续 3 次复查均为 200 且 release 不变。
- web、API、worker 三个容器均运行 `citic-newsfeed:b8eb08bb75f708f6b309d58f61b3d98427f9d519`，容器内 `AIHOT_RELEASE` 为完整提交号；setup 容器同镜像、退出码 0。四个应用容器重建后重启次数均为 0，应用日志（最近 60 行）未见 error/fatal/unhandled。
- 运行镜像内已确认含本次改动（web、api、worker 容器内均已核对，实际对外提供服务的 SSR 产物 `apps/web/build/server/index.js` 与客户端产物 `expert-detail-*.js` 中同样含相关标识）：
  - `modules/membership/experts/catalog.ts` — 新增 `SECTOR_PEER_EXPERT_SLUG` / `SECTOR_PEER_EXPERT`；`HIDDEN_BUILTIN_SLUGS` 增加 `company-sentiment-report`；
  - `modules/membership/experts/routes.ts` — 旧 slug 播种为 `hidden` 并带 `ON CONFLICT` 回写；新 slug 播种为 `available`；目录查询排序与状态过滤调整；任务创建接受 `query`，少于两个汉字／拉丁字母返回 400 `sector_query_required`；
  - `modules/membership/experts/sector-peer-html.ts` — 独立 HTML 生成器，从 `@aihot/contracts/time` 导入 `beijingStamp`；
  - `modules/membership/experts/worker.ts` — 赛道同业任务直接产出 HTML，产物文件名后缀 `.html`、类型 `text/html; charset=utf-8`，结果以 `{ html, format: "html" }` 存回任务；旧舆情 slug 即使被手工排队也不落入文本模型执行；
  - `modules/membership/pages/experts.tsx`、`expert-detail.tsx` — 目录卡片与详情页的查询框、iframe 预览（`sandbox`）与下载文案。
- 生成器运行期核对（在运行中的 worker 容器内直接调用 `renderSectorPeerDashboard("商业航天", …)`）：产物长 2,862 字节，含标题、查询原文、`生成时间：…（北京时间）`、三主区（同业是谁／公开阶段信号／资本市场认可）、美国参考带、数据缺口与「数据源未接入」占位，全部为真；未调用模型或外部信源。
- 路由核对（未登录）：公网 `/login` 返回 HTTP 200（20,404 字节），`/favicon.ico` 返回 HTTP 200（`image/x-icon`，852 字节）；`/experts`、`/experts/sector-peer-landscape`、`/experts/company-sentiment-report`、`/experts/outbound-investment-panorama`、`/knowledge`、`/more` 均 302 跳转 `/login?next=…`，按会话鉴权受控。`GET /api/v1/membership/experts` 返回 401 `login_required`，说明鉴权边界生效。
- Hermes 网关与系统 Nginx 保持 `active`，`nginx -t` 通过，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`，API、worker 与数据库没有主机端口映射；`certbot.timer` 仍为 `disabled`（既有状态），`ai-work-cert-renew.timer` 仍为 `active`。四项 P3 开关保持 `true`，未改动。
- 未执行 `down`、`prune` 或卷删除；18 个 `citic-newsfeed` 镜像与 18 个发布目录全部保留，上一版镜像 `citic-newsfeed:bd4b150afb49cebb408215713827b1e02b8ed432` 作为回退目标继续保留。
- 需要回退时使用上一个镜像 `citic-newsfeed:bd4b150afb49cebb408215713827b1e02b8ed432` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式发布、无新迁移，回退不涉及结构回滚；旧镜像不含赛道同业入口与 HTML 空看板能力。

## 未验收与剩余风险

- **PR #79 的看板仍需登录后复测。** 本次只核对未登录边界、路由注册、静态资源可达性、代码确实在运行镜像内、SSR／客户端产物已包含新标识，以及生成器在运行容器内的输出结构；员工实际提交「赛道同业竞争看板」任务后，是否正确出现空 HTML 预览与可下载的 HTML 产物，仍需要员工账号实际打开确认。
- **目录播种是惰性的，本次发布后数据库里还看不到新专家行。** `seedBuiltin()` 在 `GET /api/v1/membership/experts` 处理函数内、鉴权通过之后才执行；本次发布后 `member_experts` 仍是发布前的 3 行（`company-sentiment-report` 为 `coming_soon`，无 `sector-peer-landscape`）。目录行会在**第一位员工账号首次打开专家目录时**才写入并把旧 slug 翻成 `hidden`；在此之前 `/experts` 的目录内容缺少新卡片属于预期，不是发布失败。该惰性播种与既有发布一致，仍列为待登录复测项。
- **看板本身按 P0 定位为空看板，不构成业务验收。** 数据源未接入，所有业务区显示「数据源未接入」；P1 才做企业／赛道消歧与中国同业边界、公开阶段信号、人民币融资／境内并购／IPO 密度与美国参考带的数据接入与来源 URL、时间口径核对。本轮发布不提供任何赛道竞争结论。
- **HTML 产物内联在任务 `result` 中，适合当前小型空看板。** 真实数据接入后列表响应体量会显著增大，需改为独立鉴权预览流，不应无限放大任务列表 JSON；该边界由 PR #79 记录，本轮未处理。
- 员工问答 422 与 200 的验收仍未完成（沿用既有结论）；生产问答偶发 502 也仍未处理（沿用 PR #77 的结论）：两者都需要登录后的员工账号复测，发布本身不构成验收。
- GP 真实来源证据仍然缺失：生产 GP 主体、投资事实与可核对来源仍需管理员核准的真实数据，员工端已投 GP 清单仍可能为空。
- **回退未演练。** 本轮无新迁移，回退到 `citic-newsfeed:bd4b150…` 不涉及结构回滚，但旧镜像、`.env` 备份与数据库转储仅做了格式级校验（`pg_restore --list`），从未在隔离数据库中实际恢复过。
- Docker Hub 仍不可达：每次构建都需要在发布目录内重新改写基础镜像，该改写刻意不入库，新的发布目录在重新改写前无法直接构建。
- 证书续期链路、实例外备份恢复与实际回退演练仍未完成（沿用既有结论，本轮未改变）。
- 本文件所在的文档 PR 按约定**保持开放不合并**；仓库内「最新发布」文字只有在人工合并后才同步。上一轮 PR #77 的发布记录（release `bd4b150`）仍在开放的 [PR #78](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/78) 中，未合并。未合并的开放 PR（#54–#61、#69、#71、#74、#76 等）不在本次发布范围内，不能据此认为其功能已上线。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-79-deploy-result.md`，含备份、迁移、容器状态、健康检查与路由核对输出；按仓库约定不提交到公开仓库。
- 功能与验收边界的原始记录见[赛道同业竞争看板 P0](2026-10-25-P5-sector-peer-landscape-p0.md)；上一轮同类发布记录在仍开放的 [PR #78](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/78)（`bd4b150` 发布）；更早的同类记录见[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)。
