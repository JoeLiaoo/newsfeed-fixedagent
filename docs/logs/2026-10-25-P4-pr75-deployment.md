# P4 · PR #75 合并后火山云发布（2026-10-25）

## 发布对象与前提

- 本次发布的是 `main` 尖端提交 `46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0`（部署前重新 `git fetch origin main` 并 `git rev-parse origin/main` 确认，发布完成后尖端未移动）。该提交是 [PR #75](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/75) 的 squash 合并：`Fix residual production smoke identity and knowledge loading issues (#75)`。
- PR #75 的范围：「我的」页面当前身份改由路由 loader 服务端读取（不再依赖浏览器端 fetch），知识库材料／知识页加载态改为骨架屏（并按设计系统圆角刻度 `rounded-mark`），以及把裸 `/knowledge/documents`、`/knowledge/targets` 两个无 ID 路径回退到 `/knowledge`。
- 发布前线上仍是上一次主线发布 `5594d1d50eb57a3c7a413c76f88c80c1e1b792ae`（PR #72 + #73），公网与本机回环 `/api/health` 返回 `ok=true`、`db=ok`、release 为该提交，`/opt/citic-newsfeed/current` 也指向该发布目录，确认前置状态与预期一致后才开始。
- **本轮无新增迁移文件**：`git diff 5594d1d..46a5b38 -- modules/membership/migrations/ database/` 为空；新发布目录与上一发布目录的迁移文件清单逐项相同（各 164 个 `.sql`，最大编号 `0190`）。
- 部署在开发机执行：2026-10-25 17:45–18:33（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-75-deploy.log`，按仓库公开约定不随提交上传。
- 未合并任何开放 PR（#54–#61、#69、#71、#74 等仍开放），只发布已经在 `main` 上的代码。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0`（983 个文件，比上一发布多 4 个 PR #75 文件）；共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录（现有 16 个发布目录，历史目录全部保留）。
- 发布完整性核对：发布目录内容与 `git archive 46a5b38` 的本地展开逐文件比对一致，唯一差异是下述被改写的 `Dockerfile.volcengine`（排除 `.env` 符号链接）。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-46a5b38-20261025`（1,120 字节），数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-46a5b38-20261025.dump`（10,568,029 字节）；两者权限均为 `0600`。`.env` 备份在 `AIHOT_RELEASE` 被改写**之前**取得，保存的是上一版发布号。转储经 `pg_restore --list` 检查可读（573 条 TOC 目录项），**未做完整恢复演练**。
  - 注：宿主机自带 `pg_restore` 为 PostgreSQL 16.15，无法读取 PostgreSQL 17 的转储（`unsupported version (1.16) in file header`）；校验改在数据库容器内的 17.11 客户端完成，结论以容器内结果为准。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0`，文件权限仍为 `0600`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达（`registry-1.docker.io` 连接超时），因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与 git 跟踪版本的差异经逐行比对只有该基础镜像一行，仓库源码不变，未提交也未推送。
- 构建镜像 `citic-newsfeed:46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0` 成功（775 MB，镜像 id `f9bdba5ced84`）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`（仅 `.env.example`）。
- **setup 先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才把 `current` 指向新发布目录并重建 web、API、worker。
- setup 输出 `database is up to date` 与 `sources: 0 added, 26 already there`；`schema_migrations` 发布前后均为 **164 条**，最大 `0190_member_experts_status_coming_soon_validate.sql`，**0 条新迁移**。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 `2026-10-22T01:57:27Z`，镜像 `postgres:17-alpine`），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除。

## 发布核对与回退

- 本机回环与公网 `/api/health` 均返回 `{"ok":true,"db":"ok","ms":1,"release":"46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0"}`；发布后连续 3 次复查均为 200 且 release 不变。
- web、API、worker 三个容器均运行 `citic-newsfeed:46a5b38ceb4e9df0623bacfaf00ab4f5cd37aca0`，容器内 `AIHOT_RELEASE` 为完整提交号；setup 容器同镜像、退出码 0。四个应用容器重建后重启次数均为 0，应用日志未见 error/fatal/unhandled。
- 运行镜像内已确认含本次改动：运行中的 web 容器内 `apps/web/app/routes/more.tsx` 使用 `useLoaderData` 与 loader 内的 `redirect("/login")`、`/api/v1/membership/me` 服务端读取，并渲染 `aria-label="当前登录账号"` 区块；`modules/membership/module.ts` 注册 `knowledge/documents`、`knowledge/targets` 两条指向 `pages/knowledge-redirect.ts` 的路由；`pages/knowledge-redirect.ts` 的 loader 抛出 `redirect("/knowledge")`；`pages/knowledge-detail-skeleton.tsx` 使用 `rounded-mark` 圆角刻度并带 `role="status"` 与「正在加载材料…」「正在加载知识页…」标签；`knowledge-document.tsx`、`knowledge-target.tsx` 均改为渲染 `<KnowledgeDetailSkeleton>`。实际对外提供服务的 SSR 产物 `apps/web/build/server/index.js` 中同样含上述标识。
- 路由核对（未登录）：公网 `/login` 返回 HTTP 200（20,404 字节），`/favicon.ico` 返回 HTTP 200（`image/x-icon`，852 字节）；`/more`、`/knowledge`、`/projects/invested-gp` 均 302 跳转 `/login?next=…`，按会话鉴权受控；`/knowledge/documents`、`/knowledge/targets` 同样先 302 到登录页（鉴权在回退规则之前生效，登录后才会命中回退）。`GET /api/v1/membership/me` 返回 401 `login_required`，说明新的服务端身份读取路径已注册且鉴权边界生效。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`，API、worker 与数据库没有主机端口映射；`certbot.timer` 仍为 `disabled`（既有状态），`ai-work-cert-renew.timer` 仍为 `active`。四项 P3 开关保持 `true`，未改动。
- 未执行 `down`、`prune` 或卷删除；16 个 `citic-newsfeed` 镜像与 16 个发布目录全部保留，上一版镜像 `citic-newsfeed:5594d1d50eb57a3c7a413c76f88c80c1e1b792ae` 作为回退目标继续保留。
- 需要回退时使用上一个镜像 `citic-newsfeed:5594d1d50eb57a3c7a413c76f88c80c1e1b792ae` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式发布、无新迁移，回退不涉及结构回滚；旧镜像不含 PR #75 的服务端身份 loader、知识库详情骨架屏与裸路径回退。
- 过程记录：构建阶段曾因一次错误的 compose 调用（漏加 `compose.volcengine.yml` 覆盖文件）额外产生 `aihot-app:latest`，该镜像不被任何容器引用，已当场删除；仓库源码与 `main` 未因此改动。

## 未验收与剩余风险

- **PR #75 的两项改动仍需登录后复测。** 本次只核对未登录边界、路由注册、静态资源可达性、代码确实在运行镜像内与 SSR 产物已包含新标识；「我的」页面顶部当前身份区块的真实姓名与用户名显示、以及知识库材料／知识页加载态的骨架屏呈现，均需要员工账号实际打开确认。
- **知识库详情骨架屏的圆角刻度未做视觉核对。** PR #75 把骨架文字条改为设计系统 `rounded-mark` 圆角，代码与构建产物均已确认，但实际观感（与真实卡片圆角是否一致、动效是否克制）仍需浏览器确认。
- **裸路径回退 `/knowledge/documents`、`/knowledge/targets` → `/knowledge` 只验证了未登录分支。** 两条路由已注册且在鉴权之后生效，登录后是否按预期 302 到 `/knowledge`，仍需登录态实测。
- 员工问答 422 与 200 的验收仍未完成（沿用既有结论）：用真实已发布知识页提问应返回 200 与引用，用泛问句应返回 422 提示，两者都需要登录后的员工账号复测，发布本身不构成验收。
- GP 真实来源证据仍然缺失：上线的是详情路由与展示层，生产 GP 主体、投资事实与可核对来源仍需管理员核准的真实数据，员工端已投 GP 清单仍可能为空。
- **回退未演练。** 本轮无新迁移，回退到 `citic-newsfeed:5594d1d…` 不涉及结构回滚，但旧镜像、`.env` 备份与数据库转储仅做了格式级校验（`pg_restore --list`），从未在隔离数据库中实际恢复过。
- Docker Hub 仍不可达：每次构建都需要在发布目录内重新改写基础镜像，该改写刻意不入库，新的发布目录在重新改写前无法直接构建。
- 证书续期链路、实例外备份恢复与实际回退演练仍未完成（沿用既有结论，本轮未改变）。
- 本文件所在的文档 PR 按约定**保持开放不合并**；仓库内「最新发布」文字只有在人工合并后才同步。未合并的开放 PR（#54–#61、#69、#71、#74 等）不在本次发布范围内，不能据此认为其功能已上线。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-75-deploy.log` 与 `pi-nf-75-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一轮同类发布记录在仍开放的 [PR #74](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/74)（`5594d1d` 发布）；更早的同类记录见[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)。
