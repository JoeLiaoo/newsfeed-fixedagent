# 2026-10-26 P2-07 地区上市公司基金参与专家

- Agent：Codex
- 对应任务：P2-07（新增披露驱动的地区上市公司基金参与内置专家）
- 完成状态：实现与 fixture 验证完成；待 PR 评审、CI、部署和真实员工样例复核

## 本次改动

- 修改文件：
  - `.env.example`（可选基金备案公示查询 URL）
  - `modules/membership/experts/catalog.ts`、`seed.ts`、`routes.ts`、`worker.ts`
  - `modules/membership/experts/listed-fund-participation.ts`
  - `modules/membership/pages/experts.tsx`、`expert-detail.tsx`、`task-detail.tsx`、`account-artifacts.tsx`
  - `modules/membership/tests/listed-fund-participation.standalone.test.ts`
  - `modules/membership/tests/task-detail-page.standalone.test.ts`（地区任务输入展示断言）
  - `site/changelog/pending/listed-fund-participation.json`
  - `docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`README.md`、`docs/README.md`
- 实际完成：
  - 新增可播种、目录可见的「地区上市公司基金参与」专家，支持省市、年份或日期区间、可选六位证券代码；任务状态沿用现有异步队列和七天个人隔离产物。
  - 新增有超时、一次重试、进程内请求间隔、JSON 体积上限和拒绝重定向的公告检索/PDF 抽取及基金备案公示查询适配器；默认测试只使用 fixture。
  - 规则提取公告候选，使用精确名称对齐；对有限数量主体调用平台主体搜索与画像核验。未配置或未命中数据均保留未知并写缺口。
  - 生成披露明细、发行人/管理人热度、共同参与基金、身份核验、公告检索台账、预算和缺口；员工页面提供 sandboxed HTML 预览与 Markdown 下载。
  - 地区默认样本仅含 5 个浙江上市发行人代码，报告明确标注有限覆盖，不宣称完整发行人名录、全市场 LP 排名或完整工商穿透。
- 关键决定及理由：
  - 基金备案查询必须由运维通过 `FUND_REGISTRY_SEARCH_URL` 配置；当前只允许备案公示主机。未配置时保留公告候选，不推断“未备案”。接口字段映射是适配契约，不代表该源已获授权或真实 schema 已验收。
  - 基金名称仅按规范化后的精确文本对齐，主体身份核验则要求名称精确候选及画像核验。规则抽取是待核候选，不将金额、角色、关系或日期交给模型补造。
  - PR 中包含用户给定的方案日志；没有新增数据库迁移或依赖。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：安装完成，审计未报告漏洞。
  - `npm run typecheck`：通过。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/listed-fund-participation.standalone.test.ts`：8 项通过，均为本地 fixture/纯函数测试。
  - `git diff --check`：通过。
- 未执行或需用户试用的检查：
  - 未运行全量测试、真实公告 HTTP、真实基金备案查询或真实主体 MCP 调用；默认 fixture 用例不触网。
  - `FUND_REGISTRY_SEARCH_URL` 的授权、可用性及真实响应 schema 尚待运维核对；公告解析对复杂 PDF 表格的覆盖未验收。
  - 未执行浏览器真机/员工账号验收或生产部署。

## 风险与交接

- 已知限制／缺失依赖：
  - 静态地区代码表为小型人工样本，非全量；样本来源和快照时间随报告披露。
  - 公告关键词搜索、PDF 文本规则抽取及备案字段映射均可能漏读或误读，员工需回到公告逐项核对。
  - 备案公示查询地址默认未配置；未命中不代表“未备案”。主体核验上限为 40 项，基金名称查询上限为 80 项。
  - 员工更新日志保持待发布 JSON，按仓库发布流程在构建前应用；本 PR 不部署。
- 下一步：
  - 检查 PR 同一 head 的 CI 与评审意见；发布前由运维核对基金公示来源授权/schema，随后使用员工账号和小型已知样例核对发行人、公告、PDF 候选、身份与备案结果。
