# P3-04 · 扫码及互动状态反馈（2026-10-23）

## 修改

- `modules/membership/pages/notifications.tsx`：扫码按钮同步打开新标签页，再将其转到微信官方二维码；原绑定页继续轮询，成功、过期、安全验证受阻、重复绑定与渠道查询失败均明确提示，且说明可以关闭二维码页。浏览器拦截新标签页时保留手动打开入口。
- 同页增加只读「已向机器人发送消息」复选框，仅在绑定有效、服务端记录过该用户入站消息且通道为 `active` 时勾选；每 10 秒及返回页面时刷新。渠道标记为 `needs_interaction` 或 `requires_rebind` 后取消勾选，用户再次发消息且服务端收到后恢复。
- `README.md`、`docs/P3-ILINK-QR-DESIGN.md`、`docs/P3-OPERATIONS.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`：同步交互、状态语义与未完成验收，并将 PR #18 的部署状态纠正为已随 PR #19 发布。

## 决定与边界

- 复用现有 Button、Alert、Checkbox 及 Lucide 图标，没有引入新依赖或手动设置消息状态的接口。
- 渠道窗口没有可靠的固定过期时间；只在服务端根据投递响应明确判为需要互动时取消勾选，避免单纯按时间误报。勾选表示当前已知状态，不能作为实际送达保证。
- P3-04 仍需部署后用两名员工真机验证扫码、提示、新标签页、首条消息与失效后恢复，任务保持未勾选。

## 最小检查

- `npm run typecheck --workspace @aihot/web` 通过。
- `node scripts/check-doc-links.ts` 通过（229 个本地链接）。
- `git diff --check` 通过。
