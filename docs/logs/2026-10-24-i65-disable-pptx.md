# 2026-10-24 Issue #65：停止接收 PPT/PPTX

- Agent：Codex
- 对应任务：Issue #65，知识库与专家任务材料上传维护。
- 完成状态：PR #69 已于 2026-10-26 合并（`e88564a`），已随 release `55244fc` 发布到生产；上传被拒的登录后复验待人工完成。

## 本次改动

- 修改文件：`modules/membership/knowledge/{catalog,extract,worker}.ts`、`modules/membership/experts/{materials,worker}.ts`、两处上传页面、知识库与专家格式检查、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/KNOWLEDGE-OPS.md` 与文档索引。
- 员工上传仅接收 PDF、DOCX、Markdown；PPT/PPTX 先转换为 PDF。后端按文件名和内容拒绝 PPTX，即使把 `.pptx` 改成 `.docx` 也无法提交。历史数据库仍允许已存在的 `pptx` 格式记录，原件保留与既有知识页可见性不变；旧任务再次运行时在复用已提取文本或解压前标为不可用，不触发后续模型构建。
- 采用拒绝 PPTX 的产品收口处理其多幻灯片解压风险。DOCX 仅解压单个 `word/document.xml`，继续沿用单条 20 MB 上限；不修改已发布数据库迁移。历史 PPTX 原件需要继续下载时，员工可自行转成 PDF 后重新上传。

## 最小验证

- 对现有格式检查补充 PPTX 扩展名、改名上传及历史格式不解压断言。
- `npm run typecheck`：通过。
- 知识库与专家的针对性独立用例：38/38 通过，包含 PPTX 文件名、伪装扩展名及历史格式在解压前拒绝。
- `node scripts/check-doc-links.ts`：399 个本地链接全部有效；`git diff --check`：通过。
- 未进行真实员工上传或生产发布。

## 风险与交接

- 生产中已有排队或待重试的 PPTX 版本将在提取前失败；已发布页面与原件仍按原有权限和保留规则处理。
- 合并后关闭 Issue #65 前核对 PR 和 CI，发布后再核对知识库与专家两处实际上传反馈；P2/P5 业务验收状态仍以真实场景为准。

## 2026-10-26 合并状态

- PR #69 复基后的 head `7f40860` 上 `links`、`quality`、`postgres-integration` 全部通过，已 squash 合并为 `e88564a2acbb1dbf309153350b0fe90ac995c6fb`。
- 尚未部署；知识库及专家上传的生产反馈仍待员工按真实账号验证。产品范围与 P2/P5 业务验收状态不变。

## 2026-10-26 生产发布

- 已随 release `55244fc81cde5e88dbde777b1c59d62826204245`（短 `55244fc`）发布到火山云 `ai-work` 生产；发布窗口 2026-10-26 01:42–01:56，0 条新迁移（`schema_migrations` 仍为 164 条、最大 `0190`），镜像内 membership 回归 158/158 通过。
- 拒绝 PPT 的代码与旧允许清单的移除已在最终运行镜像中确认（`expert_material_format_unsupported` 存在，含 `pptx` 的旧清单 0 处命中）。
- 登录后的员工侧复验仍待人工完成；本项的验收勾选状态不变。发布记录见[功能批次生产发布日志](2026-10-26-P4-feat-batch-deployment.md)。
