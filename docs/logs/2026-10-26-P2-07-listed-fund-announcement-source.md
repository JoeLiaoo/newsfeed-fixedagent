# 2026-10-26 P2-07 公告来源修复

- Agent：Codex
- 对应任务：P2-07 维护修复（保留原任务完成勾选；本修复不代表真实来源或员工验收完成）
- 完成状态：实现完成，PR 与线上验收待完成

## 本次改动

- 修改文件：
  - `modules/membership/experts/listed-fund-participation.ts`
  - `modules/membership/experts/worker.ts`
  - `modules/membership/tests/listed-fund-participation.standalone.test.ts`
  - `docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`README.md`、`docs/README.md`
- 实际完成：公告列表改为按发行人分页读取；平台侧使用现有关键词和报告日期筛选；公告编号映射到稳定 PDF 地址，支持可信列表字段提供的附带 PDF URL；正文抽取允许两个受信 HTTPS PDF 主机。列表服务失败、空列表、日期缺失、PDF HTTP 错误及下载/解析失败写入不同能力描述缺口。worker 将剩余公告预算传给后续发行人，防止超出任务总预算。
- 关键决定及理由：旧公告查询 GET 在生产返回 HTTP 500，导致无公告和无 PDF 解析。切换主要列表源，避免依赖可能在某些服务器出口返回空结果的旧查询端点。员工可见文案不出现供应商名称；不增加实时网络依赖或包。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：完成，审计未报告漏洞。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/listed-fund-participation.standalone.test.ts`：10 项通过，覆盖列表映射、标题/日期过滤、空结果与 HTTP 错误、PDF 主机白名单和现有规则。
  - `npm run typecheck`：通过。
  - `node scripts/check-doc-links.ts`：542 条本地 Markdown 链接通过。
- 未执行或需用户试用的检查：未访问实时列表或 PDF；未运行全量数据库测试；员工浙江样例和线上出口仍待复核。

## 风险与交接

- 已知限制／缺失依赖：列表来源可能变更或受网络策略影响；关键词规则可能漏掉标题未含既有词汇的相关公告；PDF 文字抽取无法保证复杂表格完整。有限浙江发行人样本和基金备案缺口保持原状。
- 下一步：推送指定分支并打开 PR，检查该 head 的 CI；评审通过后再发布，并由员工复核已知公告样例。不得据此勾选真实来源或员工验收状态。
