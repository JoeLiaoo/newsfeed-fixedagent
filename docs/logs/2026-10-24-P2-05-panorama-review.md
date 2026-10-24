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


## 自动复审直接修复

- 对作者追加提交 `06a067b` 复审后，确认首轮所述预算中途耗尽异常仍存在。现在在主体读取边界捕获预算异常，保留已完成关系与已采集画像，未核实关系不判定；当前及后续同级关系全部计入未处理数与缺口，返回不完整报告。
- 去掉调用前的粗略预算拦截，交由实际查询层在检查点读取后判断额度，使续跑可以复用已付费读取。主循环的预算截断也记录逐主体缺口。
- 增加画像、曾用名、股东三个中断点回归：无超额调用、部分报告可渲染、未处理数准确、续跑不重复付费查询。
- 同步 PR #48 已合并并于 release `9e116bd` 发布的文档状态；登录目录及真实 MCP 样例验收仍待完成。
- 本地全景测试 21 项通过；类型检查和最终 CI 结果见 PR 审阅记录。无本地 PostgreSQL，数据库验证由最新 head 的 CI 执行。未进行生产发布或真实业务验收，P2-05 保持 `[ ]`。
