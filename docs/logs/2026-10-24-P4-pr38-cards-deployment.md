# P4 · PR #38 专家与知识库卡片界面发布（2026-10-24）

## 发布对象与前提

- 本次发布的是 `main` 分支尖端提交 `d81f901c6d521c16387d4151b54b5d76d8cf35bf`，其中已包含已合并的 [PR #38](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/38)（专家平台与知识库卡片列表，合并提交 `78c0fa3`）与 [PR #37](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/37)（旧组件退役记录与实施状态同步）。本次发布不引入新的代码改动，只把已合并的 PR #38 落到生产。
- 发布前线上运行 PR #32～#34 的发布（`4a911997af24e149c2a1880981d504b7f1305a2c`）；发布前本机与公网 `/api/health` 均为 `ok=true`、`db=ok`、release 为 `4a911997af24e149c2a1880981d504b7f1305a2c`，确认前置状态与预期一致后才开始。
- 本轮变更范围是 PR #38 的专家/知识库卡片列表与详情页，以及 PR #38 带来的多知识库表结构迁移 `0176`–`0180`。
- 部署在开发机执行：2026-10-24 08:15–08:22（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-38-deploy.log`，按仓库公开约定不随提交上传。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/d81f901c6d521c16387d4151b54b5d76d8cf35bf`（915 个文件），共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-d81f901-20261024`，数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-d81f901-20261024.dump`（8,205,113 字节）；两者权限均为 `0600`，转储经 `pg_restore --list` 检查可读（554 条目录项），**未做完整恢复演练**。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `d81f901c6d521c16387d4151b54b5d76d8cf35bf`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达（`registry-1.docker.io` 连接超时），因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；仓库源码不变，与 PR #19、#22、#29 及 PR #32～#34 发布时的处理一致。
- 构建镜像 `citic-newsfeed:d81f901c6d521c16387d4151b54b5d76d8cf35bf` 成功（771 MB）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`。
- setup 阶段应用 **5 条迁移**（`0176_member_wiki_bases`、`0177_member_wiki_documents_base_id`、`0178_member_wiki_pages_base_id`、`0179_member_wiki_documents_base_idx`、`0180_member_wiki_pages_base_idx`），`schema_migrations` 由 149 条增至 154 条；三条为表结构变更，两条为并发索引。信源数据未重复写入（`sources: 0 added, 26 already there`）。随后重建 web、API、worker，setup 容器退出码 0。
- 数据库容器未重建（启动时间仍为 2026-10-22），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除；旧发布目录全部保留。

## 发布核对与回退

- 本机与公网 `/api/health` 均返回 `ok=true`、`db=ok`、release 为 `d81f901c6d521c16387d4151b54b5d76d8cf35bf`。
- 公网 `/login` 返回 HTTP 200；`/experts`、`/knowledge`、`/knowledge-bases` 均返回 HTTP 302 并跳转 `/login?next=…`，即未登录时按会话鉴权跳转到登录页，符合预期。web、API、worker 三个容器均运行本次目标镜像。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443；未执行 `down`、`prune` 或卷删除，其他服务未停止或修改。
- 需要回退时使用上一个新平台镜像 `citic-newsfeed:4a911997af24e149c2a1880981d504b7f1305a2c` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式迁移，未验证迁移回滚，也未做实际回退演练。
- 本次只核对服务可用性、鉴权边界与迁移结果。**卡片列表与详情页的真实员工验收未做**：`/experts`、`/knowledge` 的登录后渲染、卡片计数、新增专家/知识库入口、多知识库共库与按库问答隔离，都需要登录后的真实账号与真实材料验证，详见[Issue #36 卡片列表记录](2026-10-24-i36-expert-knowledge-cards.md)。P1、P2、P5 的任务勾选不因本次发布而改变。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-38-deploy.log` 与 `pi-nf-38-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 合并与复核记录：[Issue #36 专家平台与知识库卡片列表](2026-10-24-i36-expert-knowledge-cards.md)、[PR #34 复审与修复](2026-10-24-P5-pr34-review.md)。
- 上一次同类发布：[PR #32～#34 主线火山云发布](2026-10-24-P4-pr32-34-deployment.md)。
