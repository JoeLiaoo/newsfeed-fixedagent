# P4 · 主线（PR #50–#54）火山云发布（2026-10-24）

## 发布对象与前提

- 本次发布的是 `main` 分支尖端提交 `8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e`（发布开始前 `git fetch` 复核，`origin/main` 仍指向该提交）。
- 该提交已包含已合并的 [PR #50](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/50)（P3 GP 动态加固）、[PR #51](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/51)（对外投资全景图加固）、[PR #52](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/52)（员工端已投 GP 直投项目清单，`/projects/invested-gp`）、[PR #53](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/53)（GP 管理队列加固）与 [PR #54](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/54)（员工端关注赛道匹配的 GP 投资 digest）。
- 发布前线上运行 PR #48 的发布（`9e116bd2f14bb495c022db4995356509d406c47a`）；发布前本机与公网 `/api/health` 均为 `ok=true`、`db=ok`、release 为 `9e116bd2f14bb495c022db4995356509d406c47a`，确认前置状态与预期一致后才开始。
- 本轮只发布已进入 `main` 的内容，未合并任何开放 PR（#55–#60 保持开放），未实现占位方案。
- 部署在开发机执行：2026-10-24 20:35–20:42（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-main-gp-deploy.log`，按仓库公开约定不随提交上传。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e`（965 个文件），共享 `.env` 以符号链接挂入该目录；`/opt/citic-newsfeed/current` 已指向该目录。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-8e20afb-20261024`，数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-8e20afb-20261024.dump`（9,355,447 字节）；两者权限均为 `0600`，转储经 `pg_restore --list` 检查可读（573 条目录项），**未做完整恢复演练**。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e`；未记录或输出任何供应商凭据、数据库口令、会话密钥或 `.env` 内容。
- 目标机 Docker Hub 元数据与镜像请求不可达，因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；仓库源码不变，与 PR #19、#22、#29、#38、#48 发布时的处理一致，本次没有为此提交或推送任何改动。
- 构建镜像 `citic-newsfeed:8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e` 成功（镜像 id `c6126b54a220`，772 MB）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`，`/app/modules/membership/pages/projects/invested-gp.tsx` 与 `modules/membership/gp/routes.ts` 均在镜像内。
- **迁移先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才重建 web、API、worker。
- setup 阶段输出 `database is up to date` 与 `sources: 0 added, 26 already there`：**本次没有新迁移**，`schema_migrations` 仍为 164 条、最大编号仍为 `0190_member_experts_status_coming_soon_validate.sql`（PR #50–#54 只改动应用代码与文档，未新增迁移文件）。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 2026-10-22T01:57:27Z），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除；旧发布目录全部保留（本次为第 13 个发布目录）。

## 发布核对与回退

- 本机与公网 `/api/health` 均返回 `ok=true`、`db=ok`、release 为 `8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e`；容器内 `AIHOT_RELEASE` 为该完整提交号。
- 公网 `/login` 返回 HTTP 200；`/projects/invested-gp` 返回 HTTP 302 并跳转 `/login?next=%2Fprojects%2Finvested-gp`，即未登录时按会话鉴权跳转到登录页，符合预期；`/experts`、`/knowledge`、`/projects/citic-alliance` 同样按会话鉴权 302 跳转登录页。
- `/api/v1/membership/gp-projects` 未登录返回 401 `login_required`；`/api/v1/membership/experts` 未登录同样返回 401 `login_required`。
- web、API、worker 三个容器均运行本次目标镜像；setup 容器以退出码 0 结束。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`；未执行 `down`、`prune` 或卷删除，其他服务未停止或修改，四个 P3 开关（`P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`）未改动。
- 需要回退时使用上一个新平台镜像 `citic-newsfeed:9e116bd2f14bb495c022db4995356509d406c47a` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为**零新增迁移**，数据库 schema 未变化，回退不需要评估迁移兼容性（与 PR #48 不同）；旧镜像不识别 GP 投资与 digest 相关的新接口，回退后 `/projects/invested-gp` 页面将不可用。

## 未验收项与边界

- 本次只核对服务可用性、鉴权边界、迁移结果与容器状态。**员工登录后的「已投 GP 直投项目」列表内容没有验收**：该页面数据来自 `member_gp_investments` 与 `member_gp_watchlist` 的联表（`status='verified'` 且 GP 为 `active`/`gp`），而生产库当前 `member_gp_investments` 与 `member_gp_watchlist` **均为 0 行**。因此登录后页面预计可正常打开但列表为空，需要 GP 同步产出真实数据后才有可截图的清单内容。
- PR #50–#54 的其它员工侧功能（关注赛道匹配的 GP digest、全景图加固后的执行与断点台账、GP 管理队列）同样**未做登录后验收**；GP 同步开关虽为 `true`，但生产库内仍没有 active GP 与已核实投资记录，供应链数据尚未落地。
- 全景图加深的层级/调用预算与台账续跑（PR #50、#51）在生产没有真实样例运行证据。
- P1、P2、P5 的任务勾选不因本次发布而改变。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-main-gp-deploy.log` 与 `pi-nf-main-gp-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一次同类发布：[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)。
