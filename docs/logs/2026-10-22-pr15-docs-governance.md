# 2026-10-22 · PR #15 文档、仓库治理与合并准备

- Agent：ChatGPT（GitHub connector）
- 对应任务：维护任务（不对应单独 P0–P4）；支撑 `P3-04` 的代码交付
- 完成状态：文档治理与 PR #15 合并完成；真机验收尚未开始
- 变更：[PR #15](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/15)
- 合并结果：PR #15 已于 2026-10-22 合并到 `main`；merge commit `acef3866367d4718cd05905feb6a487d6d7af6d9`。双员工微信真机验收和生产部署仍未进行。

## 本次改动

- 修改文件：`AGENTS.md`、`CONTRIBUTING.md`、`docs/P3-ILINK-QR-DESIGN.md`、`docs/DEPLOY-VOLCENGINE.md`、`docs/README.md`、`README.md`、`docs/P3-OPERATIONS.md`（随本 PR 的先前提交）、本日志。
- 实际完成：把扫码绑定的代码交付与真实微信验收分开；删除设计文档中残留的「尚未实现」步骤，重新整理 API、数据表和 worker 收发职责；增加部署前备份/密钥管理/迁移兼容/回退要求，约束多用户令牌和 Agent 私聊权限。
- 关键决定：Side project 不走企业微信组织审批，接受员工在 iLink 主动消息窗口过期后向自己的 Bot 发消息恢复；不限制 Bot 数量。**扫码入站只用于通知会话上下文，不自动获得 Hermes Agent 的普通聊天权限。**
- 文档职责：`docs/PLAN.md` 保存产品范围；`docs/IMPLEMENTATION.md` 保存 P3-04 验收状态；`docs/P3-ILINK-QR-DESIGN.md` 保存绑定安全和模拟/真机证据边界；`docs/P3-OPERATIONS.md`、`docs/DEPLOY-VOLCENGINE.md` 保存运行闸门与回退；此日志只记录本轮变更。
- 本 PR 处理历史手输绑定码表的单语句删除迁移（`0152`、`0153`），并新增 `0154`、`0155` 两个 iLink 表。**上线前必须备份新平台数据库并确认旧桥接流程不再依赖这些表**，不得仅因为合并就清理服务器。

## 最小验证

- 合并前实际 head `3e6e2c0fa201b5fb1f6987e71e28859c56088c10` 的 `Docs checks`、`P3 checks` 均为 success（含 typecheck、Web build、迁移和 PostgreSQL 集成、独立协议测试）；合并结果为 `acef3866367d4718cd05905feb6a487d6d7af6d9`。
- 文档链接检查由 `Docs checks` 执行；如失败先修复后合并。PR 最新 head 的具体检查结论及合并结果记于 GitHub，不提前在这里写为「成功」。
- 本次不能证明的项目：微信真实 QR 的安全验证界面、多 Bot 持续在线、受限主动消息窗口、真实推送送达、两名员工跨日隔离；这些按照用户要求在合并部署后执行。

## 风险与交接

- **合并不代表功能激活**：`P3_ILINK_BINDING_ENABLED=false`，`P3_GP_SYNC_ENABLED=false`、`P3_NOTIFICATIONS_ENABLED=false`、`P3_DELIVERY_ENABLED=false` 默认保持关闭。
- AES-256-GCM 密钥需 API/worker 使用相同稳定随机值并单独备份；勿在仓库、公开日志或 PR 中写入任何密钥、实名员工资料或完整渠道返回。
- 若员工试用发现二维码身份错配、通知串号或不明重复送达，应保持/恢复发送开关关闭，记录脱敏结果，再修复通道；不要盲重试 `unknown`。
- 下一步：PR 检查通过后合并；按 [iLink 验收计划](../P3-ILINK-QR-DESIGN.md#c-合并部署后验收尚未执行) 进行小范围部署和两个真实微信账号连续三天跨日核验；验收前 `docs/IMPLEMENTATION.md` 的 P3-04 保持 `[ ]`。

不记录密钥、未脱敏接口响应或用户私人材料。
