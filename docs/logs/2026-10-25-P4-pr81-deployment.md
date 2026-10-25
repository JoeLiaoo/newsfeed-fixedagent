# PR #81 目录收敛发布（火山云生产）

- 发布对象：[PR #81](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/81) `fix(experts): converge the expert catalog in the release setup`，以 squash 方式合并到 `main`，tip 提交 `e3465e58bea25b18f4f273ae60baf135721fb66f`（短 SHA `e3465e5`）。
- 发布主机：`root@115.190.114.65`（`ai-work`），Compose 项目 `citic-newsfeed-prod`，发布根目录 `/opt/citic-newsfeed`；发布窗口 2026-10-25 20:10–20:14（服务器时区 UTC+8）。
- 发布前线上 release：`b8eb08bb75f708f6b309d58f61b3d98427f9d519`（PR #79），在改动任何内容之前通过公网 `/api/health` 与主机侧核对确认。
- 本次发布只包含 PR #81 的代码与文档，**0 条新迁移**；仓库源码未被发布过程修改。

## 发布内容

- `modules/membership/experts/seed.ts`（新增）：把平台自带专家的播种从路由里搬出来，成为可复用的 `seedBuiltinExperts()`；播种可重入，每行都重写内容，冲突分支同时把 `status` 写回。
- `modules/membership/experts/routes.ts`：改为调用搬出的播种函数，目录接口与上传接口行为不变。
- `modules/membership/package.json`：导出 `./experts/seed`。
- `scripts/seed.ts`：setup 阶段调用 `seedBuiltinExperts()`，发布时目录即收敛，不再依赖第一位员工登录触发惰性播种。
- `modules/membership/tests/expert-catalog-seed.test.ts`（新增）并加入 CI 的 postgres-integration 列表。
- 修复的实际缺陷：此前目录播种只在 `GET /api/v1/membership/experts` 鉴权通过后执行，且 `sector-peer-landscape` 的 `ON CONFLICT` 分支没有写回 `status`，已存在的旧状态（如 `coming_soon`）不会被纠正，目录会以「开发中」显示这张卡片，创建任务也会被 `expert_coming_soon` 拒绝。

## 备份与迁移基线

| 路径 | 权限 | 说明 |
|---|---|---|
| `/opt/citic-newsfeed/shared/.env.before-release-e3465e5-20261025` | `0600` | `AIHOT_RELEASE` 改写前的配置副本（1,120 字节） |
| `/opt/citic-newsfeed/shared/backups/db-before-e3465e5-20261025.dump` | `0600` | 发布前数据库转储（custom 格式，10,724,879 字节，magic `PGDMP`） |

- 转储经 `pg_restore --list` 检查可读：573 条 TOC 条目（主机 `pg_restore` 为 PostgreSQL 16，无法读取 PG17 转储，故使用 db 容器内的 17.11 客户端校验）。**未执行完整恢复演练。**
- `schema_migrations` 发布前后均为 **164** 条，最大迁移 `0190_member_experts_status_coming_soon_validate.sql` 未变；`b8eb08b` 与 `e3465e5` 之间的迁移文件清单完全相同（各 164 个 `.sql`），PR #81 不含任何 `.sql` 变更。

## 发布步骤与结果

1. `git archive` 精确提交 `e3465e5`，归档 sha256 `2e112d68a97ff2d16c8170621a55f22578bfef324685bf47bdbb9e64b70dadef`，本机与主机一致；解包到 `/opt/citic-newsfeed/releases/e3465e58bea25b18f4f273ae60baf135721fb66f`（988 个文件），`.env` 软链到 `/opt/citic-newsfeed/shared/.env`。
2. Docker Hub 不可达，仅在发布目录内把 `Dockerfile.volcengine` 的 Node 基础镜像指向 `docker.m.daocloud.io/library/node:24-trixie-slim`；与仓库内受版本控制的文件相比只差这一行 `FROM`，仓库源码未改、未提交。
3. 发布目录与本地 `git archive` 逐文件 sha256 比对：987 个文件（排除被改写的 `Dockerfile.volcengine`）完全一致。
4. 以 `docker compose -p citic-newsfeed-prod -f docker-compose.yml -f compose.volcengine.yml build` 构建（两份编排文件同时使用），产出镜像 `citic-newsfeed:e3465e58bea25b18f4f273ae60baf135721fb66f`（775 MB），未产生多余的 `aihot-app` 镜像；镜像内 `/app` 只有 `.env.example`，无 `.env`、无 `.config/`。
5. **先跑 setup**（迁移 + 播种），退出码 0，输出：

   ```
   database is up to date
   sources: 0 added, 26 already there
   experts: the platform's own catalog entries are in place
   ```

   之后 `schema_migrations` 仍为 164 / `0190`，确认 0 条新迁移。
6. 翻转 `current` 软链到新发布目录，再以 `--no-deps --force-recreate` 重建 api、worker、web；数据库容器未重建（启动时间仍为 2026-10-22T01:57:27Z），卷 `citic-newsfeed-prod_db`、`citic-newsfeed-prod_data` 未动。

## 发布后核对

- 公网 `https://115.190.114.65/api/health` 返回 `{"ok":true,"db":"ok","ms":1,"release":"e3465e58bea25b18f4f273ae60baf135721fb66f"}`；主机侧经 Nginx 回环连续 3 次返回同一 release；web、api、worker 容器内的 `AIHOT_RELEASE` 均为该完整 SHA。
- 路由（未登录）：`/login` 200、`/favicon.ico` 200、`/experts` 与 `/experts/sector-peer-landscape` 等专家路径 302 跳转登录、`GET /api/v1/membership/experts` 401 `login_required`。
- 目录数据（发布后只读核对）：`sector-peer-landscape` = `available`，`company-sentiment-report` = `hidden`，`outbound-investment-panorama` = `available`，`external-investment-landscape-xinhua-adapter` = `hidden`。
- `sector-peer-landscape` 行的 `created_at` 仍是发布前的 2026-10-25 11:48:59Z，说明 setup 播种是对既有行**就地更新**（`ON CONFLICT ... DO UPDATE`）而不是重建行，与设计一致。
- 发布后 Nginx 访问日志显示真实员工会话在 20:13 后请求 `GET /api/v1/membership/experts` 返回 200、739 字节，与发布后目录一致。

## 未改动与未验收边界

- Hermes 网关、系统 Nginx、证书续期链路、数据库容器与数据卷均未触碰；四个 P3 开关保持原值；未清理旧发布目录、旧镜像或卷（发布目录与镜像各 19 个，均未删除）。
- 只发布 `main` 上已合并的内容，未合并任何开放中的功能或文档 PR；仓库 `main` 未被改动。
- **登录后的目录复验仍待人工完成**：需要员工登录后确认「赛道同业竞争看板」卡片显示为可运行、「企业舆情报告」不在目录中显示。本记录只覆盖未登录边界、路由、运行镜像中的代码与库内状态。
- P0 看板仍是空壳（各分区「数据源未接入」），P1 的数据接入未包含在本次发布中。
