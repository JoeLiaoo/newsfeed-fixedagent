# P0 云端凭据配置记录（2026-10-21）

- 用户确认 Codex 云端环境变量与 GitHub Actions 仓库级 secrets 均已设置 `DEEPSEEK_API_KEY`、`XINHUA_MCP_API_KEY`。
- 更新 `AGENTS.md`、`README.md`、`docs/P0-STATUS.md`，明确云端任务、Actions 工作流及本地／上线服务器的凭据读取方式。
- 本次只修改文档；未读取凭据、调用接口或验证各环境的可用性。
- P0-01 保持未完成，待实现配置读取并做最小范围验证后勾选。
