# P4 · PR #77 合并后火山云发布（2026-10-25）

## 发布对象与前提

- 本次发布的是 `main` 尖端提交 `bd4b150afb49cebb408215713827b1e02b8ed432`（部署前重新 `git fetch origin main` 并 `git rev-parse origin/main` 确认，发布完成后尖端未移动）。该提交是 [PR #77](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/77) 的 squash 合并：`Fix knowledge-base detail functional-test findings (#77)`。
- PR #77 的范围：知识文档 markdown 正文内联渲染（`材料正文` 卡片）、知识库无效 base 保持「知识库不存在。」的友好提示、知识页关联页面解析标题与 URL、来源数与实际渲染引用数一致；问答链路偶发 502 未在本 PR 处理，已延后。
- 发布前线上仍是上一次主线发布 `46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0`（PR #75），公网与本机回环 `/api/health` 返回 `ok=true`、`db=ok`、release 为该提交，`/opt/citic-newsfeed/current` 也指向该发布目录，确认前置状态与预期一致后才开始。
- **本轮无新增迁移文件**：`git diff 46a5b38..bd4b150 -- modules/membership/migrations/ database/` 为空；新旧两个提交的迁移文件清单逐项相同（`database/migrations/` 125 个 + `modules/membership/migrations/` 39 个，共 164 个 `.sql`，最大编号 `0190`）。
- 部署在开发机执行：2026-10-25 19:05–19:13（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-77-deploy.log`，按仓库公开约定不随提交上传。
- 未合并任何开放 PR（#54–#61、#69、#71、#74、#76 等仍开放），只发布已经在 `main` 上的代码。

## 发布操作

- 源码以 `git archive` 导出后上传解包到 `/opt/citic-newsfeed/releases/bd4b150afb49cebb408215713827b1e02b8ed432`（984 个文件）；归档 sha256 `efff8fd7de2c7c83d2aa7755908ff347316682fdf4fbc0473d4359ddee6e5425`，本机与目标机一致。共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录（现有 17 个发布目录，历史目录全部保留）。
- 发布完整性核对：发布目录 983 个文件（排除下述被改写的 `Dockerfile.volcengine`）与 `git archive bd4b150` 的本地展开逐文件 sha256 比对一致，唯一差异是被改写的基础镜像行（排除 `.env` 符号链接）。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-bd4b150-20261025`（1,120 字节），数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-bd4b150-20261025.dump`（10,651,956 字节）；两者权限均为 `0600`。`.env` 备份在 `AIHOT_RELEASE` 被改写**之前**取得，保存的是上一版发布号。转储经 `pg_restore --list` 检查可读（573 条 TOC 目录项，文件头 `PGDMP`），**未做完整恢复演练**。
  - 注：宿主机自带 `pg_restore` 为 PostgreSQL 16.15，无法读取 PostgreSQL 17 的转储（`unsupported version (1.16) in file header`）；校验改在数据库容器内的 17.11 客户端完成，结论以容器内结果为准。
  - 注：`pg_dump` 必须显式加 `-Fc`（自定义格式）。默认的纯文本格式会产出约 54 MB 的 SQL 脚本，`pg_restore --list` 会报 `input file appears to be a text format dump`；本轮已按自定义格式重新生成并覆盖。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `bd4b150afb49cebb408215713827b1e02b8ed432`，文件权限仍为 `0600`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达，因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与 git 跟踪版本逐行比对差异只有该 `FROM` 一行，仓库源码不变，未提交也未推送。
- 构建镜像 `citic-newsfeed:bd4b150afb49cebb408215713827b1e02b8ed432` 成功（775 MB，镜像 id `76f24baa7cc1`）。构建命令同时使用 `docker-compose.yml` 与 `compose.volcengine.yml` 两份文件，未产生多余的 `aihot-app` 镜像。构建产物内已确认不含 `/app/.env` 与 `/app/.config`（仅 `.env.example`）。
- **setup 先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才把 `current` 指向新发布目录并重建 web、API、worker。
- setup 输出 `database is up to date` 与 `sources: 0 added, 26 already there`；`schema_migrations` 发布前后均为 **164 条**，最大 `0190_member_experts_status_coming_soon_validate.sql`，**0 条新迁移**。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 `2026-10-22T01:57:27Z`，镜像 `postgres:17-alpine`），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除。

## 发布核对与回退

- 本机回环与公网 `/api/health` 均返回 `{"ok":true,"db":"ok","ms":1,"release":"bd4b150afb49cebb408215713827b1e02b8ed432"}`；发布后连续 3 次复查均为 200 且 release 不变。
- web、API、worker 三个容器均运行 `citic-newsfeed:bd4b150afb49cebb408215713827b1e02b8ed432`，容器内 `AIHOT_RELEASE` 为完整提交号；setup 容器同镜像、退出码 0。四个应用容器重建后重启次数均为 0，应用日志（最近 200 行）未见 error/fatal/unhandled。
- 运行镜像内已确认含本次改动（web 容器与 api 容器内均已核对，实际对外提供服务的 SSR 产物 `apps/web/build/server/index.js` 中同样含相关标识）：
  - `modules/membership/knowledge/routes.ts:187` — 文档版本查询新增 `CASE WHEN v.format = 'markdown' AND v.extraction_status = 'available' THEN convert_from(v.body, 'UTF8') END AS "bodyMd"`；
  - `modules/membership/knowledge/routes.ts:392`–`399` — 关联页面集合 `knownRelated` 与 `related-target-missing` 类问题的过滤；
  - `modules/membership/pages/knowledge-document.tsx:65`–`69` — `材料正文` 卡片，用 `renderMarkdown(version.bodyMd, siteUrl())` 内联渲染正文；
  - `modules/membership/pages/knowledge-base.tsx:96`、`:190` — 404 时提示「知识库不存在。」并保持 `missing || !base` 渲染分支；
  - `modules/membership/pages/knowledge-target.tsx:36`–`41`、`:84` — `resolvedBody()` 解析关联页面标题与 URL，来源数改用 `citations.length`。
- 路由核对（未登录）：公网 `/login` 返回 HTTP 200（20,404 字节），`/favicon.ico` 返回 HTTP 200（`image/x-icon`，852 字节）；`/knowledge/documents/1`（文档详情路径）、`/knowledge/documents`、`/knowledge/targets`、`/knowledge/targets/some-slug`、`/knowledge/bases/new`、`/knowledge`、`/more` 均 302 跳转 `/login?next=…`，按会话鉴权受控。`GET /api/v1/membership/me` 返回 401，说明鉴权边界生效。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`，API、worker 与数据库没有主机端口映射；`certbot.timer` 仍为 `disabled`（既有状态），`ai-work-cert-renew.timer` 仍为 `active`。四项 P3 开关保持 `true`，未改动。
- 未执行 `down`、`prune` 或卷删除；17 个 `citic-newsfeed` 镜像与 17 个发布目录全部保留，上一版镜像 `citic-newsfeed:46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0` 作为回退目标继续保留。
- 需要回退时使用上一个镜像 `citic-newsfeed:46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式发布、无新迁移，回退不涉及结构回滚；旧镜像不含 PR #77 的文档正文内联、无效 base 提示与关联页面解析。

## 未验收与剩余风险

- **PR #77 的三项改动仍需登录后复测。** 本次只核对未登录边界、路由注册、静态资源可达性、代码确实在运行镜像内与 SSR 产物已包含新标识；知识文档详情页的 markdown 正文渲染、无效 base 时是否仍稳定显示「知识库不存在。」、以及知识页关联页面的标题／URL 与来源数是否与实际渲染的引用一致，均需要员工账号实际打开确认。
- **关联页面标题与 URL 的解析依赖真实发布数据。** `resolvedBody()` 以同库已发布页面的 `slug`／`target_name` 做映射，测试环境缺少真实知识页时无法覆盖链接改写与「来源 N」计数的对照关系，需要真实已发布知识库数据复测。
- **问答链路偶发 502 未在本 PR 处理。** PR #77 明确把该问题延后，本轮发布不改变问答行为，相关验收结论沿用既有状态，仍需登录后复测。
- 员工问答 422 与 200 的验收仍未完成（沿用既有结论）：用真实已发布知识页提问应返回 200 与引用，用泛问句应返回 422 提示，两者都需要登录后的员工账号复测，发布本身不构成验收。
- GP 真实来源证据仍然缺失：生产 GP 主体、投资事实与可核对来源仍需管理员核准的真实数据，员工端已投 GP 清单仍可能为空。
- **回退未演练。** 本轮无新迁移，回退到 `citic-newsfeed:46a5b38…` 不涉及结构回滚，但旧镜像、`.env` 备份与数据库转储仅做了格式级校验（`pg_restore --list`），从未在隔离数据库中实际恢复过。
- Docker Hub 仍不可达：每次构建都需要在发布目录内重新改写基础镜像，该改写刻意不入库，新的发布目录在重新改写前无法直接构建。
- 证书续期链路、实例外备份恢复与实际回退演练仍未完成（沿用既有结论，本轮未改变）。
- 本文件所在的文档 PR 按约定**保持开放不合并**；仓库内「最新发布」文字只有在人工合并后才同步。未合并的开放 PR（#54–#61、#69、#71、#74、#76 等）不在本次发布范围内，不能据此认为其功能已上线。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-77-deploy.log` 与 `pi-nf-77-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一轮同类发布记录在仍开放的 [PR #76](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/76)（`46a5b38` 发布）；更早的同类记录见[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)。
