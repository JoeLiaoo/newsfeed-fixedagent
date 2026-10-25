# 2026-10-26 · 后端/API/worker/data layer review

- 对应任务：维护审查（不对应 P0–P5 验收项）；基线 `origin/main` / `3744aaa`。
- 状态：修复已完成，PR 与 CI 状态待同步。

## 审查范围与发现

- 检查员工鉴权、专家任务与产物权限、知识库问答/历史/上传、播客采集、赛道同业检索、全景任务、GP 路由、worker lease/recovery、任务重试/idempotency、上传类型与体积、凭据及日志脱敏、SQL 参数化和近期迁移约定。
- P0：未发现。
- P1：锁文件中的 Zod（`<4.6.6`）与 Undici（`7.0.0–7.30.0`）命中高危公告；分别涉及受约束集合校验内存耗尽、网络响应中的拒绝服务。已更新到修复版本。
- P2：Fastify、`sanitize-html` 与两个 `fast-uri` 版本命中低／中危公告；已更新到修复版本。
- P2：畸形百分号编码的员工会话 cookie 会让 `decodeURIComponent` 抛错，而不是按匿名请求处理；现返回未认证结果。
- P2：知识库上限检查与写入不在同一串行化事务中，并发创建可超过 20 个；现锁定默认库作为跨用户串行化点，并把审计事件与插入放入同一事务。
- P2：播客供应商响应此前直接 `.json()`，没有读取字节上限；现限制为 4 MiB 并流式计量，在超限时取消读取。

## 修改文件与决定

- 更新 `apps/api/package.json`、`modules/membership/package.json`、`packages/backend/package.json` 和 `package-lock.json` 中的现有依赖修复版本；没有增加依赖职责或迁移。
- 修改 `modules/membership/server.ts`、`modules/membership/knowledge/routes.ts`、`modules/membership/experts/bidclub.ts`。
- 增加或扩展 `modules/membership/tests/member-session.standalone.test.ts`、`modules/membership/tests/access-contract.test.ts`、`modules/membership/tests/knowledge-bases.test.ts`、`modules/membership/tests/frontier-podcast.standalone.test.ts`。

## 最小验证

- `npm ci`：成功。
- `npm run typecheck`：通过。
- 前沿播客 standalone：19/19 通过，含 4 MiB 响应上限回归。
- malformed-cookie standalone：1/1 通过。
- `npm audit --audit-level=low`：0 vulnerabilities。
- PostgreSQL 场景测试 `access-contract.test.ts` 与 `knowledge-bases.test.ts` 未能在本地启动：环境未设置 `DATABASE_URL`；测试 harness 明确要求使用名为 `*_test` 或 `*_ci` 的临时数据库。回归测试已写入，待 PR 的 postgres-integration CI 执行。
- 本轮没有数据库迁移、生产访问或部署。

## 剩余风险与下一步

- 等待 PR 上 `links`、`quality`、`postgres-integration` 对当前 head 运行；必要时修复 CI 发现。
- PR 合并前核对最终 SHA 和 CI；合并后补录 squash SHA。生产部署和员工验收未执行。
- 全景图供应商实际服务持续可用、真实 GP 主体与事件、真实员工知识库引用仍按既有实施计划待验收；代码审查不替代这些业务核验。
