# P4 · PR #48 对外投资全景图专家火山云发布（2026-10-24）

## 发布对象与前提

- 本次发布的是 `main` 分支尖端提交 `9e116bd2f14bb495c022db4995356509d406c47a`，其中已包含已合并的 [PR #48](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/48)（对外投资全景图专家、隐藏「企业一层对外投资核查」入口、企业舆情报告「开发中」入口）。
- 发布前线上运行 PR #38 的发布（`d81f901c6d521c16387d4151b54b5d76d8cf35bf`）；发布前本机与公网 `/api/health` 均为 `ok=true`、`db=ok`、release 为 `d81f901c6d521c16387d4151b54b5d76d8cf35bf`，确认前置状态与预期一致后才开始。
- 本轮变更范围是 PR #48 的专家目录与执行器改动，以及随之而来的迁移 `0181`–`0190`：全景图断点台账（`0183`/`0184`）、`member_experts.status` 增加 `hidden`（`0185`–`0187`）与 `coming_soon`（`0188`–`0190`）、专家任务材料表与索引（`0181`/`0182`）。
- 部署在开发机执行：2026-10-24 12:45–12:52（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-48-deploy.log`，按仓库公开约定不随提交上传。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/9e116bd2f14bb495c022db4995356509d406c47a`（948 个文件），共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-9e116bd-20261024`，数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-9e116bd-20261024.dump`（8,744,138 字节）；两者权限均为 `0600`，转储经 `pg_restore --list` 检查可读（560 条目录项），**未做完整恢复演练**。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `9e116bd2f14bb495c022db4995356509d406c47a`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达（`registry-1.docker.io` 连接超时），因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；仓库源码不变，与 PR #19、#22、#29、#38 及 PR #32～#34 发布时的处理一致。
- 构建镜像 `citic-newsfeed:9e116bd2f14bb495c022db4995356509d406c47a` 成功（771 MB）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`。
- **迁移先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认 10 条迁移全部应用、setup 退出码 0 之后，才重建 web、API、worker。原因是新代码在目录播种时写入 `member_experts.status` 的 `hidden` 与 `coming_soon` 取值，而旧约束只允许 `available`/`blocked`；约束未放宽前启动新 API 会写入失败。
- setup 阶段应用 **10 条迁移**（`0181_expert_task_materials` 至 `0190_member_experts_status_coming_soon_validate`），`schema_migrations` 由 154 条增至 164 条；其中 `0183`/`0184` 为全景图断点台账表与并发索引，`0185`–`0187` 放宽并验证 `status` 检查约束以容纳 `hidden`，`0188`–`0190` 再次放宽并验证以容纳 `coming_soon`。迁移后 `member_experts_status_check` 为 `CHECK (status = ANY (ARRAY['available','blocked','hidden','coming_soon']))` 且已验证通过；新表 `member_expert_task_materials`、`member_expert_panorama_checkpoints` 已建立。信源数据未重复写入（`sources: 0 added, 26 already there`）。
- 数据库容器未重建（启动时间仍为 2026-10-22），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除；旧发布目录全部保留（本次为第 12 个发布目录）。

## 发布核对与回退

- 本机与公网 `/api/health` 均返回 `ok=true`、`db=ok`、release 为 `9e116bd2f14bb495c022db4995356509d406c47a`。
- 公网 `/login` 返回 HTTP 200；`/experts`、`/knowledge`、`/knowledge-bases` 均返回 HTTP 302 并跳转 `/login?next=…`，即未登录时按会话鉴权跳转到登录页，符合预期。`/api/v1/membership/experts` 未登录返回 401 `login_required`。web、API、worker 三个容器均运行本次目标镜像，`AIHOT_RELEASE` 为完整提交号。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`；未执行 `down`、`prune` 或卷删除，其他服务未停止或修改，四个 P3 开关未改动。
- 需要回退时使用上一个新平台镜像 `citic-newsfeed:d81f901c6d521c16387d4151b54b5d76d8cf35bf` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式迁移，未验证迁移回滚，也未做实际回退演练；旧镜像不识别 `hidden`/`coming_soon` 取值，回退应用镜像前须评估该不兼容。
- 本次只核对服务可用性、鉴权边界与迁移结果。**PR #48 的员工界面未做登录后验收**：「对外投资全景图」专家卡片与执行模式、隐藏后的「企业一层对外投资核查」入口不再出现在目录、企业舆情报告「开发中，敬请期待」条目与徽标，都需要登录后的真实账号确认。原因是内置专家的状态播种发生在员工首次读取专家目录时（`seedBuiltin`），未登录无法触发；因此发布后数据库中 `member_experts` 仍只有一行旧记录、状态为 `available`，该行会在首次登录读取目录时翻转为 `hidden`，同时写入全景图（`available`）与企业舆情报告（`coming_soon`）两行。这一播种行为本身在发布时**未在生产触发验证**。P1、P2、P5 的任务勾选不因本次发布而改变。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-48-deploy.log` 与 `pi-nf-48-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一次同类发布：[PR #38 卡片界面发布](2026-10-24-P4-pr38-cards-deployment.md)。
