# P4 · PR #70 生产冒烟跟进火山云发布（2026-10-25）

## 发布对象与前提

- 本次发布的是 `main` 尖端提交 `d0713cce1fb41af53d2c642dedbb1b980e8ab067`（部署前重新 `git fetch` 并 `git rev-parse origin/main` 确认，尖端之后没有仅含文档的新提交）。该提交包含已合并的 [PR #70](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/70)（生产只读冒烟问题修复）与 [PR #64](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/64)（界面控件键盘交互修复），以及 PR #62／#63 的文档同步。
- 发布前线上仍是上一次主线发布 `8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e`（PR #50–#54），本机与公网 `/api/health` 均为 `ok=true`、`db=ok`、release 为该提交，确认前置状态与预期一致后才开始。
- **本轮无新增迁移文件**：`git diff 8e20afb..d0713cc -- modules/membership/migrations/ database/` 为空。
- 部署在开发机执行：2026-10-25 16:28–16:32（Asia/Shanghai，服务器本地时区同为 UTC+8）。原始部署输出保留在本地桌面 `pi-nf-70-deploy.log`，按仓库公开约定不随提交上传。
- 未合并任何开放 PR（#55–#61、#69 等仍开放），只发布已经在 `main` 上的代码。

## 发布操作

- 源码以 `git archive` 解压到 `/opt/citic-newsfeed/releases/d0713cce1fb41af53d2c642dedbb1b980e8ab067`（972 个文件），共享 `.env` 以符号链接挂入该目录；发布结束后 `/opt/citic-newsfeed/current` 指向该目录（现有 14 个发布目录，历史目录全部保留）。
- 发布完整性核对：发布目录内容与 `git archive d0713cc` 的本地展开逐文件比对一致（排除 `.env` 符号链接与下述被改写的 `Dockerfile.volcengine`）。
- 发布前备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-d0713cc-20261025`（1,120 字节），数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-d0713cc-20261025.dump`（10,485,989 字节）；两者权限均为 `0600`，转储经 `pg_restore --list` 检查可读（563 条 TOC 目录项），**未做完整恢复演练**。
- 共享 `.env` 的 `AIHOT_RELEASE` 已更新为本次完整提交号 `d0713cce1fb41af53d2c642dedbb1b980e8ab067`，文件权限仍为 `0600`；未记录或输出任何供应商凭据、数据库口令或会话密钥。
- 目标机 Docker Hub 元数据与镜像请求不可达（`registry-1.docker.io` 连接超时），因此**仅在发布目录内**把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与 git 跟踪版本的差异经逐行比对只有该基础镜像一行，仓库源码不变，未提交也未推送。
- 构建镜像 `citic-newsfeed:d0713cce1fb41af53d2c642dedbb1b980e8ab067` 成功（775 MB，镜像 id `45b1301bed4b`）。构建产物内已确认不含 `/app/.env` 与 `/app/.config`。
- **setup 先于新代码上线**：先以新镜像运行 setup 容器（迁移 + 种子），确认退出码 0 之后，才把 `current` 指向新发布目录并重建 web、API、worker。
- setup 输出 `database is up to date` 与 `sources: 0 added, 26 already there`；`schema_migrations` 发布前后均为 **164 条**，最大 `0190_member_experts_status_coming_soon_validate.sql`，**0 条新迁移**。信源数据未重复写入。
- 数据库容器未重建（启动时间仍为 `2026-10-22T01:57:27Z`，镜像 `postgres:17-alpine`），命名卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未删除。

## 发布核对与回退

- 本机与公网 `/api/health` 均返回 `{"ok":true,"db":"ok","ms":1,"release":"d0713cce1fb41af53d2c642dedbb1b980e8ab067"}`；公网 `/login` 返回 HTTP 200。
- web、API、worker 三个容器均运行 `citic-newsfeed:d0713cce1fb41af53d2c642dedbb1b980e8ab067`，容器内 `AIHOT_RELEASE` 为完整提交号；setup 容器同镜像、退出码 0。
- 运行镜像内已确认含本次改动：`modules/membership/knowledge/routes.ts` 的 GET 405 处理与 422 `knowledge_no_coverage`、`modules/membership/gp/source.ts` 的 `example.org`／`example.com`／`example.net` 演示来源过滤。
- 路由核对（未登录）：`POST /api/v1/membership/knowledge/answers` 返回 401 `login_required`；`GET` 同一路径**同样返回 401**（员工鉴权边界在 `onRequest` 阶段先于路由处理执行，PR #70 新增的 405 只在有会话时可达）；`/projects/invested-gp` 与 `/knowledge` 均 302 跳转 `/login?next=…`，按会话鉴权受控。
- Hermes 网关与系统 Nginx 保持 `active`，Nginx 仍监听 80/443，Web 仍只映射 `127.0.0.1:3000`，API 与数据库没有主机端口映射；`certbot.timer` 仍为 `disabled`（既有状态），`ai-work-cert-renew.timer` 仍为 `active`。四项 P3 开关保持 `true`，未改动。
- 未执行 `down`、`prune` 或卷删除；14 个 `citic-newsfeed` 镜像与 14 个发布目录全部保留。
- 需要回退时使用上一个镜像 `citic-newsfeed:8e20afbdb6d3dc5a8f1553ba4db021c1ef65d79e` 与本轮 `.env` 备份，并保留数据库卷与转储。本轮为追加式发布、无新迁移，回退不涉及结构回滚；旧镜像不识别 PR #70 的 405／422 与演示来源过滤语义。

## 未验收与剩余风险

- **员工问答 422 与 200 的验收仍未完成。** 本次只核对未登录边界与路由注册；用真实已发布知识页提问应返回 200 与引用，用泛问句应返回 422 提示，两者都需要登录后的员工账号复测，发布本身不构成验收。
- **GP 真实来源证据仍然缺失。** 本次只上线了演示来源的过滤逻辑；生产 GP 主体、投资事实与可核对来源仍需管理员核准的真实数据，员工端已投 GP 清单仍可能为空。
- 员工信源页面的实时清单与 About 缓存快照一致性未做登录后比对；PR #70 说明该差异需发布后核对。
- 未合并的开放 PR（#55–#61、#69 等）不在本次发布范围内，不能据此认为其功能已上线。
- 证书续期链路、实例外备份恢复与实际回退演练仍未完成（沿用既有结论，本轮未改变）。

## 证据来源

- 原始部署输出：本地桌面 `pi-nf-70-deploy.log` 与 `pi-nf-70-deploy-result.md`，含备份、迁移、容器状态与健康检查输出；按仓库约定不提交到公开仓库。
- 上一轮同类发布：[PR #48 对外投资全景图发布](2026-10-24-P4-pr48-deployment.md)；上一次主线发布见 [PR #61](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/61)（记录 `8e20afb`，该文档 PR 仍开放）。
