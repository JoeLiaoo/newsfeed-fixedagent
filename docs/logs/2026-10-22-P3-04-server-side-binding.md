# P3-04 · 服务端确认扫码绑定（2026-10-22）

- Agent：pi coding agent（fix/ilink-bind-server-poll 分支）
- 对应任务：P3-04（`docs/IMPLEMENTATION.md`）；本轮为修复任务，P3-04 仍保持 `[ ]`
- 完成状态：部分完成（代码与测试已提交，真实微信双员工验收仍待部署后执行）

## 本次改动

- 修改文件：
  - `modules/membership/notifications/binding.ts`（新增）：唯一的绑定落库函数，页面轮询与 worker 确认共用。
  - `modules/membership/notifications/scan.ts`（新增）：worker 侧扫码会话确认（过期标记、渠道失败标记、确认绑定）。
  - `modules/membership/notifications/routes.ts`：`/weixin/status` 复用共用落库函数；上游失败返回 502 + `status=error`；无扫码会话时若有 active 绑定返回 `bound`；`/weixin/start` 允许替换被标记为 `error` 的扫码会话。
  - `modules/membership/notifications/inbox.ts`：收到首条入站消息时回一句连接确认，每账号一次。
  - `modules/membership/pages/notifications.tsx`、`modules/membership/pages/scan-state.ts`（新增）：可见性恢复时立即查询、隐藏时降频继续查询、失败状态一行提示与「重新生成二维码」。
  - `modules/membership/migrations/0156_member_ilink_greeting.sql`（新增）：`member_ilink_accounts.greeted_at`。
  - `site/modules/server.ts`：注册 `membership.ilink-scan`（每分钟，受 `P3_ILINK_BINDING_ENABLED` 控制）。
  - `modules/membership/package.json`、`.github/workflows/p3-checks.yml`、文档：`docs/P3-ILINK-QR-DESIGN.md`、`docs/P3-OPERATIONS.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`。
- 实际完成：
  - 现场原因：网页在 `document.visibilityState==="hidden"` 时跳过轮询，员工切到微信后服务器不再询问渠道，`member_ilink_logins` 一直停在 `status=wait`；上游调用失败时状态接口返回 200 + `wait`，把错误显示成「等待中」。
  - 服务端自行完成绑定：worker 每分钟查询未过期的扫码会话，确认后调用与网页相同的落库函数；两个入口同时确认时事务内按 `pg_advisory_xact_lock` 加行锁串行，扫码会话在同一个事务里被消费，重复确认返回 `already_bound`，不会重复建行或报错。
  - 过期与失败：渠道返回 `expired`／`verify_code_blocked`／`binded_redirect` 或会话本身过期时标记 `expired`；渠道调用失败时标记 `error` 并保留会话，状态接口返回 502 + `status=error`，页面显示一行失败并可重新生成二维码（`error` 会话允许被新二维码替换，未过期的正常会话仍返回 429）。
  - 首条入站消息确认：拿到 `context_token` 且账号未确认过时，用现有 `sendIlinkText` 回「已连接，之后会在这里推送。」，`member_ilink_accounts.greeted_at` 持久化，每个账号一次；发送失败不写标记，可用同一幂等键在下一次入站消息时重试。
- 关键决定及理由：
  - 落库逻辑只保留一份（`notifications/binding.ts`），页面与 worker 共用，避免两套实现产生重复行或状态不一致。
  - 首条确认受 `P3_DELIVERY_ENABLED` 控制：设计文档与运维手册把「渠道发送」整体放在该开关之后（`P3-OPERATIONS.md` 的「PG 同步、通知生成、渠道发送全部保持默认关闭」与「只有真实 sidecar 的幂等协议和两个用户收件人验证完成，才考虑打开 `P3_DELIVERY_ENABLED`」），连接确认属于对真实微信的主动发送，因此遵守开关；关闭时入站同步、上下文恢复和 `needs_interaction` 恢复不受影响。
  - 上游失败返回 502 与 `status=error` 而非 200 `wait`：错误必须可区分，页面才能给出可执行的恢复动作。
  - 页面只保留必要状态与操作：失败时一行提示加一个「重新生成二维码」按钮，不增加说明性文案。
  - 迁移只追加 `0156`（可空列、无默认值），不改已发布迁移。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过。
  - `node scripts/check-migrations.ts --base=origin/main`：`migration history and online safety checked`。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/scan-state.standalone.test.ts`：3 项通过。
  - `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13 项通过。
  - `npm run test:standalone`：256 项中 244 通过、12 失败；12 项失败在未改动的 `main` 基线上同样失败（依赖 PostgreSQL 的站点路由／元数据用例），与本次改动无关。
  - `git diff --check`：通过。
- 未执行或需用户试用的检查：
  - 本机没有可用的 PostgreSQL，`modules/membership/tests/ilink-scan.test.ts`（后台确认绑定、并发幂等、过期、渠道错误状态、首条确认只发一次）未在本地运行，交给 GitHub Actions 的 PostgreSQL 集成任务执行；同样未运行的还有 `modules/membership/tests/ilink-binding.test.ts`、`p3-db.test.ts`、`notifications-access.test.ts` 与 `tests/architecture.test.ts` 的数据库用例。
  - 真实微信扫码、真实送达与跨日窗口仍待部署后由两名员工验证；线上代码未更新。

## 风险与交接

- 已知限制／缺失依赖：
  - worker 每分钟确认一次扫码会话，页面可见时约 3.5 秒查询一次；两者共用 `member_ilink_logins.last_polled_at` 的 2.5 秒租约，短时间内只会真正询问渠道一次。
  - 渠道失败时标记 `error`，若页面随后成功查询到状态会自动恢复；`error` 状态的会话允许重新生成二维码，原二维码在本地被丢弃后无法再被确认。
  - 连接确认只覆盖「首个入站消息」这一种情形；用户在窗口失效后发起的恢复消息同样会触发一次确认（每账号仍然只有一次）。
  - `greeted_at` 需要迁移 `0156`；未执行迁移的旧版本 worker 会因列不存在而报错，部署顺序必须是先迁移再发布 worker。
- 下一步：
  - 合并并部署后，用两个已批准网站账号真机验证：切到微信后台后绑定仍能完成、回到网页显示「已绑定」、渠道异常时页面显示失败并可重新生成、发出第一条消息后收到一次连接确认。
  - 部署记录与开关状态按 [P3 运维手册](../P3-OPERATIONS.md) 更新；`P3_04` 在真机验收前保持未勾选。
