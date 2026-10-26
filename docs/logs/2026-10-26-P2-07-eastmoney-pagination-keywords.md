# 2026-10-26 P2-07 公告分页与关键词跟进

- Agent：Codex
- 对应任务：P2-07 维护修复；不改变原任务勾选状态，也不代表真实来源或员工验收完成
- 完成状态：代码与离线验证完成；PR #141 CI、发布和员工真实样例复核待完成

## 本次改动

- `modules/membership/experts/listed-fund-participation.ts` 根据接口 `total_hits` 和 `page_size` 计算页数并保留 500 页上限；按列表降序日期，在页内最早公告早于任务起始日时停止；读取 Eastmoney 的 `title` 与 `title_ch` 字段。
- 公告关键词新增「投资基金」。已知标题「参与设立投资基金」「发起设立投资基金」「与私募基金合作投资」进入候选；仅含「证券投资基金」的标题排除，含参与/设立/合作等动作的相关标题仍可匹配。
- standalone fixture 模拟不含 `total_pages` 的分页响应，并验证页数推导、标题映射、日期提前停止和 securities-fund-only 排除。测试不访问实时网络。

## 最小验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/listed-fund-participation.standalone.test.ts`：11 项通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- `node scripts/check-doc-links.ts`：在本日志文件创建前运行，因三处新增日志链接尚无目标失败；创建日志后须重跑。

## 未验证事项与风险

- 未运行全量测试或实时公告请求；Volcengine 同主机验证由用户提供。分页与提前停止目前以脱敏结构 fixture 验证。
- Eastmoney 列表若不再按 `sr=-1` 降序返回，按页最早日期停止的假设需重新核对。
- 关键词命中仍只是待人工核实的候选；浙江样本覆盖、PDF 正文解析、基金备案数据及员工报告体验未验收。

## 下一步

- 推送到 PR #141 的既有分支并核对新 head 的 CI；由 coding 助手负责后续合并和部署。
