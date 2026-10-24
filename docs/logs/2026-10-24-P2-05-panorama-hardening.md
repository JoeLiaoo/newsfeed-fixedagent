# 2026-10-24 P2-05 对外投资全景图硬化

- Agent：Codex
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P2-05
- 完成状态：部分完成（代码和自动化检查已完成；生产真实样例验收未完成）

## 本次改动

- 修改文件：`modules/membership/experts/panorama-run.ts`、`panorama-markdown.ts`、`worker.ts`、`routes.ts`、`pages/expert-detail.tsx`、`tests/panorama.standalone.test.ts`、`tests/panorama-db.test.ts`、`docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、`README.md`。
- 实际完成：
  - 审核了三类停止判断与六条穿透规则：上市与基金类主体止钻、参股/控股判断、投资类主体例外、有限合伙份额链、退出状态分表、年报交叉与存在性/噪音筛除均有执行路径；无备案、历史转让/回购/减持及接手股东、正式关联方证据、上市代码/地点和专项附件能力的规则继续列为底稿缺口，不补造事实。
  - 修正断点续跑时把缓存读取计入实际调用预算的问题；已验证起点画像也从任务检查点恢复，避免重试重复做实体核验查询。
  - 初次执行时把确认主体的画像核验查询计入 90 次总预算；候选名称搜索仍属于员工选定主体前的独立步骤。
  - 将此前只附在节点、未进入报告总缺口表的警告统一写入缺口清单，确保任务卡片的缺口数与报告一致。
  - 修正单节点恰好处理满预算时被误报为超限的问题；只有存在未处理关系才记录该限制。
  - 查询错误不再把原始错误消息带入员工报告；预算截断或单体读取缺口会在报告完整性行和任务卡片显示「结果不完整」。
  - 任务列表仅在已有采集检查点时显示 JSONL 下载；完成后仍可下载 Markdown 报告。详情页提交说明明确四项默认预算和达到上限/数据缺失后的结果状态。
  - 未改变迁移、执行模式权限或数据源；未触碰舆情报告入口、BettaFish、生产环境。
- 关键决定及理由：单体读取失败仍允许其他主体继续，但任务成功状态不再暗示数据完整；服务错误用能力级通用说明，避免把内部服务文本暴露到员工底稿。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：按锁文件安装完成。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/panorama.standalone.test.ts`：16 项通过，含查询失败脱敏/不完整状态、恢复读取不花实际调用预算、恰好达到单节点上限不误报。
  - `npm run typecheck`：通过。
  - `node scripts/check-doc-links.ts`：检查 357 个本地 Markdown 链接，通过。
- 未执行或需用户试用的检查：PostgreSQL 集成测试因 `DATABASE_URL` 未设置且测试要求指向 `*_test` 或 `*_ci` 临时库而未运行；生产登录目录播种、真实 MCP 全景图、员工下载/阅读和真实样例结果未验收。

## 风险与交接

- 已知限制／缺失依赖：规则能力边界不变；P2-05 仍需生产真实主体样例核对主体选择、分层结果、预算与缺口清单，不能由自动化测试替代。
- 下一步：PR [#51](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/51) 已打开，当前提交 `3c2be84` 待评审；提供临时测试数据库后补跑 `panorama-db.test.ts`。P2-05 保持未勾选，待用户完成生产样例验收。
