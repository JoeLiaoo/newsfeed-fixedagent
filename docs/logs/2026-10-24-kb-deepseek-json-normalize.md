# 2026-10-24 知识库 DeepSeek 构建耐久化与默认库改名 工作日志

- Agent：coding 助手（pi）
- 对应任务：维护任务（不对应 P0–P5）；知识库构建（`P5-01` 的代码部分）的线上修复与默认库改名
- 完成状态：完成

## 本次改动

- 修改文件：
  - `modules/membership/knowledge/normalize.ts`（新增）：模型回答到平台口径的归一层（`parseJsonObject`、`coerceDate`、`normalizeCompiledDraft`、`normalizeAuditResult`）。
  - `modules/membership/knowledge/prompts.ts`：编译者、复核者、回答三段系统提示词末尾各加一句「输出格式：只返回一个 JSON 对象，不要 Markdown 围栏。」
  - `modules/membership/knowledge/compile.ts`：编译者提示词加 `outputContract`；两次调用加 `parse` 归一钩子；输出上限 6,000→12,000（编译）、3,000→8,000（复核）；提示词版本 `wiki-builder-1`→`wiki-builder-1c`、`wiki-auditor-1`→`wiki-auditor-1e`。
  - `modules/membership/knowledge/bases.ts`：`DEFAULT_BASE_NAME` 由「全公司共享知识库」改为「知识库示例」；`DEFAULT_BASE_DESCRIPTION` 同步改写；`ensureDefaultBase` 由「只插入」改为「默认库已存在且名称／说明不是平台当前值时改名」。
  - `modules/membership/tests/knowledge-core.standalone.test.ts`：新增四个用例（归一、日期、无法解析、复核结果归一）。
  - `modules/membership/tests/knowledge-bases.test.ts`：断言默认库显示名，并验证默认库改名、员工自建库不改名。
  - `docs/KNOWLEDGE-OPS.md`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`：默认库显示名与归一／调用形状的运维说明。
- 实际完成：
  - 把线上容器里的临时热修（`/app/modules/membership/knowledge/{prompts.ts,compile.ts}`，4/4 次 Cubox 构建已发布）落进仓库，使下一次正式发布不会把 DeepSeek 可用的构建重新变回不可用。
  - 默认库显示名改为「知识库示例」；已在库的默认行会在读取库列表时改名，不写迁移、不动员工自建的库。
- 关键决定及理由：
  - 归一逻辑单独放 `normalize.ts` 而不是塞进 `compile.ts`：仓库的模块按职责分文件（`compile`／`lint`／`render`／`publish`…），归一是独立职责，且可以在不碰数据库的独立测试里验证。行为与线上热修一致，只改了摆放位置。
  - 归一**先于** schema 校验（`chatJson` 的 `parse` 钩子）：模型给的近形答案要能构建；读不出的值记「未知」或空数组，由 lint 显成质量问题，而不是整批构建失败。归一只做机械改写，不补造事实。
  - 日期在归一层统一为 `YYYY-MM-DD` 或「未知」：lint 把读不出的时间锚判为 `P0`（不发布），归一层收敛后这条 P0 只留给真正没有时间锚的页面。
  - 保留线上热修里「pages 最多 4 个，宁少勿多」：平台最多接受 `MAX_PAGES_PER_BUILD=8`，但页数越多答案越长、越容易撞输出上限；已验证的 4 页是稳妥取值，故保留并在代码里注明。
  - 比线上热修多做的两处：日期用 `coerceDate` 覆盖立场与时间线（热修里这两处是 `slice(0,10)`，模型写「2026年6月20日」会留下 P0）；JSON 字符串里的裸换行用 `escapeControlCharsInStrings` 再解析一次，与平台其它模型调用一致。
  - 默认库改名放在 `ensureDefaultBase` 而不是新增迁移：默认库本来就由该函数按需写入，改名同样按需完成，不需要迁移、不需要停机。
  - 提示词版本随提示词一起升位（`1c`／`1e`）：提示词版本是模型回执的幂等键的一部分，不升位会复用旧提示词的回执。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`（contracts／backend／api／worker／tests／modules／web）：通过。
  - 独立测试：`node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts` —— 23 个用例全过（含 4 个新增用例）。
  - 数据库测试：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/knowledge-bases.test.ts` —— 通过。
  - 模块回归：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/*.test.ts` —— 73 个用例全过。
  - 文档链接检查：`node scripts/check-doc-links.ts` —— 通过。
- 未执行或需用户试用的检查：
  - 未在生产调用真实 DeepSeek 验证（本次不发版、不调用付费接口）。
  - 未验证改版发布后线上默认库改名在真实请求路径上的效果（`ensureDefaultBase` 已有数据库测试覆盖）。
  - 未做真实员工验收：P5-02～P5-04 仍待真实账号与真实材料。

## 风险与交接

- 已知限制／缺失依赖：
  - 线上热修只覆盖了 `prompts.ts` 与 `compile.ts`；本仓库的 `lint.ts`、`render.ts` 等未改动，仍按发版时的版本发布（线上容器的这些文件未热修过）。
  - 归一后的页面字段被截到 schema 上限（如共识 800 字、立场 60 条），超长内容会被截断而不是整批失败。
  - `wiki-builder-1c`／`wiki-auditor-1e` 换了幂等键，同一材料重跑会重新付费调用一次。
- 下一步：
  - 合并后按常规发布流程发 api 与 worker（无新增迁移），确认默认库在页面上显示为「知识库示例」。
  - 用一份真实材料跑一次构建，确认 DeepSeek 在 json 模式下不再返回空草稿。
  - PR：<待补链接>。
