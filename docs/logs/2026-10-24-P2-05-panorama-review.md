# 2026-10-24 P2-05 全景图首轮审查与修复

- Agent：Codex
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P2-05
- 完成状态：部分完成；本轮审查修复已完成，生产真实样例验收未完成，P2-05 保持 `[ ]`。

## 审查发现与修复

- 深度上限判断晚了一层：上限为 4 时，执行器仍可能读取第 5 层关系并将其写入报告。现在在达到层级上限的主体读完关系列表后，记录剩余关系数量并停止获取下一层主体详情。
- 主体数、调用次数和单节点预算跳过的关系只累计到未处理数，没有进入逐主体缺口清单。现在将受预算影响的数量和对应上限写入缺口清单；不会把被跳过关系作为已核实关系入表。
- JSONL 下载入口虽由任务卡片按检查点存在状态控制，接口本身仍会对无台账的全景任务返回空文件，也接受其他专家任务。现在接口仅向任务所有者提供已有采集台账的全景任务下载；无台账时返回 404。
- 核对 checkpoint 恢复与身份查询计数、关系恰好达到上限的判断、报告及任务卡片不完整标志、员工界面品牌文案、P2-05 验收状态。员工可见文案仍使用能力描述；P2-05 未勾选。
- 未修改企业舆情/`coming_soon`/BettaFish 功能；未部署、未合并。

## 修改文件

- `modules/membership/experts/panorama-run.ts`
- `modules/membership/experts/routes.ts`
- `modules/membership/tests/panorama.standalone.test.ts`
- `modules/membership/tests/panorama-db.test.ts`
- `docs/P2-EXPERT-ADAPTER.md`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`
- `docs/logs/2026-10-24-P2-05-panorama-review.md`

## 验证

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/panorama.standalone.test.ts`：18 项通过，含深度上限不多读一层、跳过关系进入缺口清单的回归用例。
- `node scripts/check-doc-links.ts`：首次运行时发现本日志链接目标尚未创建；创建日志后复跑通过，检查 360 个本地 Markdown 链接。
- `git diff --check`：通过。
- 本地 PostgreSQL `panorama-db.test.ts` 未运行：`DATABASE_URL` 未设置；新增“无台账下载应为 404”的集成断言已由 PR #51 的 `postgres-integration` CI 通过。
- 推送后 PR #51 的 `links`、`postgres-integration`、`quality` 三项 GitHub checks 均通过。

## 未验证事项与下一步

- 当前无真实 MCP 与生产员工验收证据；生产目录、样例全景、报告及 JSONL 下载仍待用户验收。
- 本轮修复已提交并推送到 PR #51；不合并、不部署。保持 P2-05 `[ ]`。
