# P3-04 · 个人设置入口与扫码请求修复（2026-10-22）

## 现场定位

- GitHub `main`、本地基线和火山云 web/API/worker 镜像均为 `5031e2c04dec382263d05b38484b0cfaabeaa15b`。
- 用户点击「扫码绑定微信」时，生产 API 日志显示 `/api/v1/membership/weixin/start` 返回 HTTP 400、`FST_ERR_CTP_EMPTY_JSON_BODY`。页面为无请求体的 POST 设置了 `Content-Type: application/json`，Fastify 在进入扫码处理器前拒绝请求。该证据只证明当前点击失败的直接原因；修正后仍需真机验证上游二维码生成。

## 修改

- 扫码 POST 不再声明空 JSON 请求体；通用通知请求仅在有 JSON 请求体时发送对应 `Content-Type`，一并修正解绑调用。
- 首页右上角改为有边框、有图标的「个人设置」按钮；新增个人设置页，放置「调整关注赛道」「绑定微信」「退出登录」三个明显可点击的按钮。沿用现有 Button/Card 和 Lucide 图标，没有新增依赖。
- 涉及 `apps/web/app/routes/home.tsx`、`modules/membership/module.ts`、`modules/membership/pages/profile.tsx`、`modules/membership/pages/notifications.tsx` 及状态文档。

## 验证与剩余事项

- 前端 typecheck 通过；文档链接检查见 PR 记录。
- 修复尚未部署时，生产仍运行 `5031e2c`，扫码操作仍会遇到 HTTP 400。合并和重新部署后，需要用已审批员工账号真机验证生成二维码、扫码绑定、解绑与真实送达；P3-04 保持未完成。
