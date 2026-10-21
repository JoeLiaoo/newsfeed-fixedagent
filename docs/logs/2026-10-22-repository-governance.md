# 2026-10-22-repository-governance 工作日志

- Agent：ChatGPT
- 对应任务：P3 合并后的仓库治理和文档状态同步（维护任务，不改变 P0–P4 的验收勾选）
- 状态：代码与文档已提交供 PR／CI 验证，外部联调不在本次范围。

## 变更

- 更新根目录 README、`docs/README.md` 文档导航、`docs/IMPLEMENTATION.md` P3 的已合并／未验收边界、`docs/P3-OPERATIONS.md` 启用条件与故障回退、P3 原日志的迁移文件名与 CI 记录。
- 统一 `AGENTS.md`、`CONTRIBUTING.md`、PR 模板的安全闸门：仓库公开、组件与依赖复用、Review 与验收有证据、CI 与 head 对齐、业务功能启用与代码合并独立、服务器清理要事先确认备份。
- 增加无额外依赖的 Markdown 本地链接检查及 docs-only GitHub Actions，防止文档入口失效。
- 更新 `docs/UPSTREAM.md`，区分 AIHOT 基线和本仓库 P2/P3 扩展。

## 验证与限制

- 本次不更改运行逻辑、数据库迁移、真实凭据或服务器；不将 PR #4 的 CI 成功冒充此次文档 PR 的检查结果。
- 需要在本 PR 的 GitHub Actions 中核对链接检查是否通过；首次检查若发现既有坏链，应先修正后合并。
- P3 的真实新华财经/DeepSeek/Hermes/iLink、两名微信用户跨日投递仍未验收，三个 P3 运行开关保持关闭。
- GitHub 分支保护与必需检查需要从 Settings 另行核实和配置，文档及 workflow 文件不能替代平台设置。
