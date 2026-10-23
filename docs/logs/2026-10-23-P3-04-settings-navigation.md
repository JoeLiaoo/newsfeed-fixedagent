# P3-04 · 个人设置子页导航调整（2026-10-23）

## 修改

- 关注赛道页增加「返回个人设置」按钮；移除该页的「微信通知」入口，保留并统一「添加或查看资讯信源」的 Button 外观。
- 绑定页标题改为「绑定微信」，增加「返回个人设置」按钮。
- 成功生成 iLink 二维码后，当前浏览器页面直接跳转到微信官方二维码地址。站内移除 iframe 占位；用户返回平台后，绑定页读取当前扫码会话并继续查询状态。活跃会话提供可再次打开官方页面的按钮。
- 修改文件：`modules/membership/pages/interests.tsx`、`modules/membership/pages/notifications.tsx`、`docs/P3-ILINK-QR-DESIGN.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`。

## 验证与边界

- 沿用仓库现有 Button 组件与 Lucide 图标，未增加依赖。
- `npm run typecheck --workspace @aihot/web` 通过；`node scripts/check-doc-links.ts` 检查 210 个本地 Markdown 链接，全部存在；`git diff --check` 通过。
- 真实微信扫码、浏览器返回后的实际状态显示和双用户投递仍待用户在部署后核验；P3-04 保持未完成。
