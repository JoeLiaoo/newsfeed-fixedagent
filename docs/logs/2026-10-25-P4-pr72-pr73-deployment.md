# P4 · PR #72 + #73 合并后火山云发布（2026-10-25）

## 发布对象与前提

- 本次发布的是 `main` 尖端提交 `5594d1d50eb57a3c7a413c76f88c80c1e1b792ae`（部署前重新 `git fetch` 并 `git rev-parse origin/main` 确认，发布完成后尖端未移动）。该提交包含已合并的 [PR #72](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/72)（员工端更新日志 `site/changelog.json` 补齐）与 [PR #73](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/73)（生产只读冒烟剩余项修复）。
- PR #73 的六项修复范围：GP 单项详情路由（`GET /api/v1/membership/gp-projects/:id` 与 `/projects/invested-gp/:id` 页面）、全景图空目标企业名提示、知识库材料／知识页加载状态、我的日报按日期去重、「我的」页面当前身份显示、站点 favicon。
- 发布前线上仍是上一次主线发布 `d0713cce1fb41af53d2c642dedbb1b980e8ab067`（PR #70），本机回环 `/api/health` 返回 `ok=true`、`db=ok`、release 为该提交，确认前置状态与预期一致后才开始。
- **本轮无新增迁移文件**：`git diff d0713cc..5594d1d -- modules/membership/migrations/ database/` 为空；发布目录内迁移文件仍为 39 个，最大编号 `0190`。
- 部署在开发机执行：2026-10-25 16:47–16:50（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-72-73-deploy.log`，按仓库公开约定不随提交上传。
- 未合并任何开放 PR（#55–#61、#69、#71 等仍开放），只发布已经在 `main` 上的代码。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/5594d1d50eb57a3c7a413c76f88c80c1e1b792ae`（979 个文件），共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录（现有 15 个发布目录，历史目录全部保留）。
- 发布完整性核对：发布目录内容与 `git archive 5594d1d` 的本地展开逐文件比对一致（排除 `.env` 符号链接与下述被改写的 `Dockerfile.volcengine`）。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-5594d1d-20261025`（1,120 字节），数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-5594d1d-20261025.dump`（10,508,907 字节）；两者权限均为 `0600`，转储经 `pg_restore --list` 检查可读（573 条 TOC 目录项），**未做完整恢复演练**。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `5594d1d50eb57a3c7a413c76f88c80c1e1b792ae`，文件权限仍为 `0600`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达（`registry-1.docker.io` 连接超时），因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与 git 跟踪版本的差异经逐行比对只有该基础镜像一行，仓库源码不变，未提交也未推送。
- 构建镜像 `citic-newsfeed:5594d1d50eb57a3c7a413c76f88c80c1e1b792ae` 成功（775 MB，镜像 id `30579b00d8fd`）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`（仅 `.env.example`）。
- **setup 先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才把 `current` 指向新发布目录并重建 web、API、worker。
- setup 输出 `database is up to date` 与 `sources: 0 added, 26 already there`；`schema_migrations` 发布前后均为 **164 条**，最大 `0190_member_experts_status_coming_soon_validate.sql`，**0 条新迁移**。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 `2026-10-22T01:57:27Z`，镜像 `postgres:17-alpine`），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除。

## 发布核对与回退

- 本机回环与公网 `/api/health` 均返回 `{"ok":true,"db":"ok","ms":1,"release":"5594d1d50eb57a3c7a413c76f88c80c1e1b792ae"}`；公网 `/login` 返回 HTTP 200（20,404 字节）。
- web、API、worker 三个容器均运行 `citic-newsfeed:5594d1d50eb57a3c7a413c76f88c80c1e1b792ae`，容器内 `AIHOT_RELEASE` 为完整提交号；setup 容器同镜像、退出码 0。四个应用容器重建后重启次数均为 0。
- 运行镜像内已确认含本次改动：`modules/membership/gp/routes.ts` 的 `GET /api/v1/membership/gp-projects/:id`、`modules/membership/module.ts` 的 `projects/invested-gp/:id` 页面路由、`modules/membership/pages/projects/invested-gp-detail.tsx`、`apps/web/app/routes/home-history.ts` 的 `oneDigestPerDay` 去重、`apps/web/app/routes/more.tsx` 的当前身份显示、`apps/web/app/root.tsx` 的 `rel="icon"` 声明、`knowledge-document.tsx`／`knowledge-target.tsx` 的加载状态文案、`expert-detail.tsx` 的企业名称错误提示，以及 PR #72 的 `site/changelog.json`（5 条记录，`latestVersion=2026-10-25T16:27`）与 `site/brand/favicon.ico`。
- 路由核对（未登录）：`/favicon.ico` 返回 HTTP 200、`image/x-icon`、852 字节（PR #73）；`/projects/invested-gp`、`/knowledge`、`/experts` 与新增的 `/projects/invested-gp/:id` 均 302 跳转 `/login?next=…`，按会话鉴权受控；`GET /api/v1/membership/gp-projects/:id` 返回 401 `login_required`，说明新路由已注册且鉴权边界生效。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`，API 与数据库没有主机端口映射；`certbot.timer` 仍为 `disabled`（既有状态），`ai-work-cert-renew.timer` 仍为 `active`。四项 P3 开关保持 `true`，未改动。
- 未执行 `down`、`prune` 或卷删除；15 个 `citic-newsfeed` 镜像与 15 个发布目录全部保留。
- 需要回退时使用上一个镜像 `citic-newsfeed:d0713cce1fb41af53d2c642dedbb1b980e8ab067` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式发布、无新迁移，回退不涉及结构回滚；旧镜像不含 PR #73 的 GP 单项详情、加载状态、日报去重、当前身份与 favicon 修复。

## 未验收与剩余风险

- **PR #73 六项冒烟修复仍需登录后复测。** 本次只核对未登录边界、路由注册、静态资源可达性与代码确实在运行镜像内；GP 单项详情的数据内容、全景图空目标企业名提示的焦点与读屏表现、知识库材料／知识页的加载态、「我的日报」按日期去重后的实际条目数、「我的」页面当前身份显示，以及 favicon 在浏览器标签页的呈现，均需要员工账号实际打开确认。
- **员工端更新日志内容未做线上核对。** PR #72 的 5 条记录已进入镜像，但「我的」页面红点与更新日志弹层的内容、顺序与时间是否与线上实际一致，仍需登录后核对。
- **员工问答 422 与 200 的验收仍未完成。** 沿用上一轮结论：用真实已发布知识页提问应返回 200 与引用，用泛问句应返回 422 提示，两者都需要登录后的员工账号复测，发布本身不构成验收。
- **GP 真实来源证据仍然缺失。** 本次上线的是详情路由与展示层；生产 GP 主体、投资事实与可核对来源仍需管理员核准的真实数据，员工端已投 GP 清单仍可能为空。
- 未合并的开放 PR（#55–#61、#69 等）不在本次发布范围内，不能据此认为其功能已上线。
- 证书续期链路、实例外备份恢复与实际回退演练仍未完成（沿用既有结论，本轮未改变）。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-72-73-deploy.log` 与 `pi-nf-72-73-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一轮同类发布：[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)；上一次主线发布（PR #70）的发布记录在仍开放的 [PR #71](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/71)。
