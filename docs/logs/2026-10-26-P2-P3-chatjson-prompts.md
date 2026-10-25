# 2026-10-26 · P2/P3 membership JSON 模式提示词维护

- 对应任务：P2 专家执行与 P3-03 GP 赛道分类的模型请求格式维护；不改变业务验收勾选。
- 状态：本分支已修改提示词；待 PR 评审、合并、发布与真实业务复验。

## 修改与决定

`chatJson` 在默认 `LLM_JSON_MODE` 下发送 `response_format: { type: "json_object" }`。逐一核对 membership 九处调用：赛道同业、播客翻译和知识库三处已有 JSON 字样；一层核查、全景摘要、自定义技能导入和 GP 分类四处缺失。为这四处系统提示词补充「只返回合法 JSON 对象」及各自 schema 的顶层字段，并递增 `promptVersion`。未改变 schema、工具、业务规则或员工界面文案。

| 调用 | 旧版本 → 新版本 | 输出字段 |
|---|---|---|
| 一层核查 | `xinhua-one-layer-1.0.0` → `xinhua-one-layer-1.0.1` | `summary`, `openQuestions` |
| 全景摘要 | `xinhua-panorama-1.0.0` → `xinhua-panorama-1.0.1` | `summary`, `openQuestions` |
| 自定义技能导入 | `skill-import-2` → `skill-import-3` | `result`, `caveats` |
| GP 赛道分类 | `gp-sector-1` → `gp-sector-2` | `tags`, `reason` |

新增 standalone 静态断言，逐一检查 membership 的九处 `chatJson` 系统提示词均包含 JSON 字样。修改文件：`modules/membership/experts/worker.ts`、`modules/membership/gp/sync.ts`、`modules/membership/tests/chat-json-prompts.standalone.test.ts`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。

## 最小验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/chat-json-prompts.standalone.test.ts modules/membership/tests/expert-coming-soon.standalone.test.ts modules/membership/tests/experts.standalone.test.ts modules/membership/tests/panorama.standalone.test.ts modules/membership/tests/gp-core.standalone.test.ts`：52/52 通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：505 个本地 Markdown 链接通过。
- `git diff --check`：通过。

## 未验证、风险与下一步

未调用真实模型或生产任务；提示词符合已观察到的 JSON 模式请求规则，不代表模型返回、事实质量或完整业务链路已通过。既有失败任务不会自动重新执行。下一步为 PR 评审，后续按运维闸门发布并用真实任务复验；P2-05 与 P3-03 保持未勾选。
