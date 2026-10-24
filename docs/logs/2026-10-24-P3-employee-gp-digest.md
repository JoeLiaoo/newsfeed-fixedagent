# 2026-10-24 · 员工端关注赛道匹配的 GP 投资 digest

## 完成内容

- 在「已投GP直投项目」页增加「全部已核实」与「与我关注匹配」切换；匹配状态写入 `?matched=1`，保留项目信息导航和分页。
- GP 项目 API 以当前登录员工的 `member_interest_tags` 做精确标签交集，只返回已核实投资及有效 GP，仍不返回原始证据或审核人字段。战略配售不参与匹配；自定义标签按相同的精确交集规则处理。
- 页面区分未设置关注、无匹配结果、加载中及请求失败状态，并提供关注设置入口、重试和来源链接。缺少事件日期仍显示「日期未知」。
- 更新实施说明与文档索引；未改动中信股权联盟、市场头部机构项目数据或 P3 验收状态。

## 修改文件

- `modules/membership/gp/routes.ts`
- `modules/membership/pages/projects/invested-gp.tsx`
- `modules/membership/tests/gp-projects-access.test.ts`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`

## 验证

- `npm run typecheck`：通过。
- `modules/membership/tests/gp-projects-access.test.ts`：通过；使用独立临时 PostgreSQL 实例，覆盖未登录拒绝、无关注、兴趣交集、自定义标签、战略配售排除、非匹配/暂停/撤回隐藏、分页和敏感字段脱敏。
- `node scripts/check-doc-links.ts`：检查 369 个本地 Markdown 链接，全部存在。
- `git diff --check`：通过。
- 代码尚未部署；未做真实员工账号验收或微信推送验收。

## 风险与后续

- Web digest 展示已审核的投资项目，不证明主体核对、数据同步、微信通知或 P3 业务验收完成。
- `npm ci` 报告锁文件依赖有 5 项安全审计告警（1 low、2 moderate、2 high）；本次没有依赖变更，也没有运行自动升级。
- P3-01～P3-04 保持未勾选。PR [#54](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/54) 已合并（`ba1aedce846175aa5723f19c7409ec905e1fed68`）；首个提交为 `048c5ba`，最终修复 head 为 `79dd014`。最终 CI 全通过，未部署，复审与验证见 [r2 日志](2026-10-24-pr54-review-r2.md)。
