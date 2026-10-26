# 2026-10-26 · P3 iLink 近失效保活提醒

- Agent：Codex
- 对应任务：P3-04 的维护增强；真实业务验收仍按原标准执行
- 完成状态：代码与文档完成；待 PR 评审、部署和真实微信验证

## 本次改动

- 修改文件：
  - `modules/membership/migrations/0192_member_ilink_keepalive_nudged_at.sql`
  - `modules/membership/notifications/inbox.ts`
  - `modules/membership/tests/ilink-keepalive.standalone.test.ts`
  - `.github/workflows/p3-checks.yml`
  - `docs/P3-OPERATIONS.md`、`docs/P3-ILINK-QR-DESIGN.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、`README.md`
- 实际完成：由每分钟 iLink inbox worker 检查活跃绑定用户；最后入站互动达到阈值且上下文仍在时，发送一条中文短提醒。仅在 `P3_DELIVERY_ENABLED=true` 时发送；`needs_interaction`、`requires_rebind`、缺失上下文、非活跃绑定或账号均跳过。
- 去重标记保存于账号行，并与 `last_inbound_at` 比较；收到更新的入站互动后允许新一轮提醒。发送 ID 由 user ID 和 inbound 时间 SHA-256 生成，失败重试使用同一 ID。
- 默认阈值为 20 小时，`P3_ILINK_KEEPALIVE_AFTER_HOURS` 可设置 1–23 小时。该阈值基于第三方约 24 小时经验预留余量，不是官方 TTL 或送达保证。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：通过，无新增依赖或锁文件变化；审计报告 0 vulnerabilities。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/ilink-keepalive.standalone.test.ts`：3/3 通过，覆盖阈值、同一/新 inbound 窗口去重、投递关闭及状态/上下文门禁。
  - `npm run typecheck`：通过。
  - `node scripts/check-doc-links.ts`：550 个本地 Markdown 链接通过；`git diff --check` 通过。
  - 新迁移单独通过 `migrationPlan` 在线迁移安全解析（transaction）；完整 `check-migrations.ts --base=origin/main` 在此 Windows checkout 报告所有旧迁移不可变，原因为 Git `core.autocrlf=true` 而脚本逐字比较 CRLF 工作树与 LF Git blob。该检查需在 Linux PR CI 复核。
- 未执行或需用户试用的检查：新增 PostgreSQL/iLink transport 集成断言已加入 `ilink-binding.test.ts`，本机未运行：测试环境未设置 `DATABASE_URL`，且未提供隔离 PostgreSQL。PR CI 的 postgres-integration 将执行该用例。真实微信收件、生产迁移及持续运行尚未验证；不得视为 P3-04 验收通过。

## 风险与交接

- 已知限制／缺失依赖：渠道可能在约定阈值前停止接受主动消息；提醒仅在仍可发送时尝试，用户仍需主动回复以刷新上下文。不能保证消息送达。
- 下一步：推送分支并开 PR；描述中列出迁移及发布后验证步骤，不合并、不部署。部署后先确认迁移列、开关与 worker 运行，再用测试账号验证阈值内不发送、阈值后 active 账号收到最多一条、回复后新窗口可再次提醒、失效状态跳过，并核对 outbox/账号状态和手机实际收件。
