# P1-04 员工信源入口改进

日期：2026-10-22（Asia/Shanghai）

## 做了什么

- 保留已有员工信源页 `/settings/sources` 及公开来源检查、去重和全员共享流程。
- 将「资讯信源」加入桌面主导航，并在关注赛道设置页增加直达入口；手机端仍可从「我的」页的工具入口进入。
- 使用 Lucide RSS 图标表达资讯源入口。

## 修改文件

- `modules/membership/web.tsx`
- `modules/membership/pages/interests.tsx`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`
- 本日志

## 最小验证

- 静态检查导航目标均指向已注册的 `/settings/sources` 路由。
- 未运行全量测试；尚未在生产浏览器逐一验收桌面及手机导航。

## 下一步

- 合并并部署后，请员工从主导航或关注赛道页打开信源，确认可提交公开 RSS、网站首页、列表页或 sitemap。
