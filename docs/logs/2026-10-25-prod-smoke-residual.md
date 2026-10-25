# 2026-10-25 · 生产冒烟残余修复

- 对应任务：P1-02／P1-05 的员工身份展示与 P5 知识库页面体验维护。实施计划的真实员工与材料验收标准未完成，任务勾选不变。
- 基线：`origin/main` 的 `5594d1d`；用户复测生产同一 release 后指出残余。本分支未连接或修改生产。

## 做了什么

1. 核对 `GET /api/v1/membership/me` 返回 `user.realName`、`user.username`。`/more` 原先在浏览器 effect 中再次读取，失败被静默吞掉，姓名区域只在 state 非空时渲染。改为路由服务端用请求 cookie 读取身份并在首屏渲染姓名和用户名；401 转登录，其他失败显示页面错误；响应禁止缓存。
2. 材料与知识页详情在读取期间显示与标题、元数据和内容卡片对应的脉冲骨架，完成后沿用原有内容或错误；尊重系统减少动态效果设置。
3. `/knowledge/documents` 和 `/knowledge/targets` 缺少 ID／slug 时重定向到现有 `/knowledge` 列表，不增加新页面。

## 修改文件

- 身份与浏览器回归：`apps/web/app/routes/more.tsx`、`apps/web/tests/prod-smoke-remainders.test.ts`。
- 知识库：`modules/membership/module.ts`、`modules/membership/pages/knowledge-document.tsx`、`modules/membership/pages/knowledge-target.tsx`、`modules/membership/pages/knowledge-detail-skeleton.tsx`、`modules/membership/pages/knowledge-redirect.ts`。
- 状态与索引：`README.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。

## 关键决定与最小验证

- 根 loader 只含公开站点元信息，没有员工身份；使用 `/more` 自身 loader，避免把身份放入全站根数据。服务端已有登录检查，路由再次读取 `/me` 是小范围改动。
- `npm run typecheck -w @aihot/web`、`npm run build -w @aihot/web` 通过。
- 构建后 `node --test apps/web/tests/prod-smoke-remainders.test.ts`：4/4 通过，覆盖浏览器 API 请求失败时的身份首屏、知识库加载骨架到内容、无 ID 路由回退及原冒烟场景。
- `npx tsc -p modules --noEmit`、`node scripts/check-doc-links.ts`（406 个本地链接）、`git diff --check` 通过。

## 未验证事项、风险与下一步

- 未用真实员工会话复测生产、未运行全量测试，也未连接生产数据库或修改服务器。实际生产身份显示和慢网体验需部署后由员工验收。
- 本次没有迁移、开关或 API 合同变化；回退本 PR 即恢复原页面实现。保持 P5-02～P5-04 的真实材料验收未完成。
