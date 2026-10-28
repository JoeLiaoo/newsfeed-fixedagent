# E2E-FIX-BATCH · 2026-10-28

任务：修复员工端 E2E 反馈的 bugs 1、2、4–9。P1、P2、P3、P5 的真实业务验收状态不变；本分支不部署。

## 修改

- `modules/membership/gp/routes.ts` 在筛选项、分页列表和详情查询中排除示范来源域名；详情再以员工来源判断兜底返回 404。`modules/membership/tests/gp-projects-access.test.ts` 加入演示行并改用非占位 URL 验证正常分页。
- `industry/sources.json` 移除四个失败来源，增加 BidClub 的 JSON 列表配置。`scripts/seed.ts` 重跑时停用已有的四条旧记录，并按原有缺失插入逻辑添加 BidClub；不删除历史来源行。`README.md` 说明已有生产库要重跑 seed。
- `modules/membership/module.ts`、`pages/profile.tsx`、`apps/web/app/routes/more.tsx` 加入只读个人资料入口。关注赛道、资讯信源、微信通知、个人资料子页设置浏览器标题。收藏文案明确登录后仍只存在本机浏览器。
- `knowledge/fetch-url.ts` 在正文抽取前移除微信小说阅读器控件，增加独立回归用例。`pages/task-detail.tsx` 优先显示 worker 已存的安全错误说明。`pages/knowledge-base.tsx` 用已核实引用的知识页标题和链接替换回答末尾的原始页面标识，兼容历史问答。

## 验证

- `npm ci`、`npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-fetch-url.standalone.test.ts modules/membership/tests/gp-source.standalone.test.ts`：5/5 通过。
- 用现有 `fetchJsonList` 读取 BidClub 实时 `/api/v1/episodes`：返回 50 条，首条标题、URL、日期均可解析；未保存原始响应。
- `git diff --check`、`node scripts/check-doc-links.ts`：通过。
- `gp-projects-access.test.ts` 数据库回归未运行：当前工作区没有指向临时测试库的 `DATABASE_URL`，且未安装 Docker。发布前需在 CI/临时 PostgreSQL 运行该用例并复核员工列表、筛选项、详情。

## 风险与下一步

- BidClub 的实时解析是单次检查，持续可用性与内容分发授权仍需运营核验；公开目录链接不代表平台自有内容。
- 知识页标题替换依赖回答引用中已核实的标题；缺失标题时保留原始标识，避免编造名称。微信网页控件规则针对本次观察到的短语，其他变体需真实材料复核。
- PR 评审、CI、上线 seed 和真实员工复测均待后续；不勾选 P3/P5 业务验收任务。
