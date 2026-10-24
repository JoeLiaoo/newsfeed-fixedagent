# 2026-10-24 P2-05 隐藏一层专家的目录入口

- Agent：pi coding agent
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P2-05（PR #48 内的追加改动；未合并、未部署）
- 完成状态：完成（代码、迁移、测试与文档已就绪；未做生产验收）

## 本次改动

- 修改文件：
  - `modules/membership/migrations/0185_member_experts_status_hidden_drop.sql`、`0186_member_experts_status_hidden_check.sql`、`0187_member_experts_status_hidden_validate.sql`：`member_experts.status` 的检查约束扩到 `('available','blocked','hidden')`。
  - `modules/membership/experts/catalog.ts`：新增 `HIDDEN_EXPERT_STATUS`（`hidden`）与 `HIDDEN_BUILTIN_SLUGS`（一层专家的 slug）。
  - `modules/membership/experts/routes.ts`：播种时把一层内置专家写成 `hidden`，冲突分支一并写回状态（已部署的 `available` 行在下一次播种时翻转）；目录接口对所有角色都不返回隐藏行；对隐藏的 slug 新建任务按「不存在」拒绝（404 `expert_not_found`）。
  - `modules/membership/experts/worker.ts`：执行器接受 `hidden` 状态，隐藏前已建的任务照常执行，不再报 `expert_unavailable`。
  - `modules/membership/tests/expert-catalog-hidden.test.ts`（新增）、`experts-access.test.ts`、`panorama-db.test.ts`、`.github/workflows/p3-checks.yml`。
  - `docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/PLAN.md`（v0.78）、`docs/README.md`、`docs/logs/2026-10-24-P2-05-panorama-expert.md`。
- 实际完成：
  - 按 Joe 2026-10-24 的决定（「第一个专家没啥意义，先隐藏入口吧」）隐藏内置专家「企业一层对外投资核查」（`external-investment-landscape-xinhua-adapter`）；「对外投资全景图」（`outbound-investment-panorama`）保持可见。
  - 员工目录不再出现一层专家的卡片；详情页从目录列表解析专家，因此直接打开 `/experts/external-investment-landscape-xinhua-adapter` 显示「该专家不存在，或你无权查看」。
  - 新建任务对隐藏 slug 返回 404 `expert_not_found`（不是「缺少依赖」，也不是 `blocked` 徽标）。
  - 一层专家的行、技能文本与执行器都保留：隐藏前已建的任务仍会执行；只声明主体检索、企业画像与一层直接投资三个工具的自定义技能仍是「一层对外投资核查」（`xinhua_trial`）模式并在目录可见；导入页与模式文案继续说明该能力模式。
- 关键决定及理由：
  - **新增 `hidden` 状态而不是复用 `blocked`**：`blocked` 的语义是缺少依赖，卡片会显示「缺少依赖」徽标，与事实不符。`hidden` 只表示目录不提供入口。
  - **约束改动拆成三条迁移**：在线迁移词表只允许一次一个动作，`DROP CONSTRAINT`、带 `NOT VALID` 的 `ADD CONSTRAINT` 与 `VALIDATE CONSTRAINT` 分开执行，避免在强锁下扫表。数据翻转（`available` → `hidden`）不放在发布迁移里，由播种完成。
  - **执行器接受 `hidden`**：隐藏的是入口，不是能力；已经存在的任务不应因为入口收起而失败。
  - **管理员目录同样不显示**：隐藏对所有角色生效，避免管理员视图重新把它变成目录入口。
  - **不删除一层专家的代码与测试**：保留历史任务与三工具自定义技能的可运行性。

## 最小验证

- 执行的检查及结果：
  - `node scripts/check-migrations.ts --base=origin/main`：通过（三条新迁移命名与在线安全词表合规）。
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过。
  - `node --import ./tests/standalone.ts --test ...`（CI 同款 standalone 清单）：82 项通过。
  - `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test ...`（CI 同款 PostgreSQL 清单，含新增 `modules/membership/tests/expert-catalog-hidden.test.ts`）：28 项通过；本地一次性 PostgreSQL，库名 `newsfeed_test`。
  - 迁移实跑：在一份已有旧约束的库与一份全新库上分别执行 `scripts/migrate.ts`，三条迁移都成功，`member_experts_status_check` 最终为 `CHECK (status = ANY (ARRAY['available','blocked','hidden']))` 且 `convalidated = t`。
  - `node scripts/check-doc-links.ts`：通过。
- 未执行或需用户试用的检查：
  - 未合并、未部署，没有在生产环境验证目录与任务行为。
  - 未用真实新华财经 MCP 调用验证隐藏前已建任务的完整执行链路（本地只验证到执行器接手任务并按「服务未配置」失败，不报 `expert_unavailable`）。
  - 隐藏前已建任务在员工界面上的可见性未做真机确认。

## 风险与交接

- 已知限制／缺失依赖：
  - 历史任务仍能在 `GET /api/v1/membership/expert-tasks` 里按专家名列出，但隐藏专家没有目录入口，其详情页（`/experts/<slug>`）不再渲染该专家的任务列表；产物仍可按任务 ID 通过接口下载。
  - 迁移期间（`DROP CONSTRAINT` 与 `ADD CONSTRAINT` 之间）`status` 暂时没有检查约束；该窗口内只会写入 `available`（旧代码）或 `hidden`（新代码），不会出现非法值。
  - 部署顺序：先应用迁移（放开 `hidden` 取值），再发布新代码；反过来会让播种在旧约束下报错。
  - P2-05 仍保持 `[ ]`：全景底稿的真实样例验收未做，与本次隐藏改动无关。
- 下一步：
  - 合并 PR #48 并部署后，用真实员工账号确认 `/experts` 只出现「对外投资全景图」，直接访问一层专家 URL 显示「不存在」，并用真实样例跑一次全景任务。
  - 若之后要恢复一层专家入口，把播种状态改回 `available` 即可（数据与执行器都还在）。
