# P0 DeepSeek／新华财经配置与数据字段矩阵

## 范围与证据等级

本矩阵对照仓库当前代码、`docs/PLAN.md` v0.65、随仓库提供的新华财经企业基础信息 MCP PDF、`reference/SKILL.md`，并纳入 2026-10-22 在隔离部署 API 容器内进行的实际连通抽测。实时工具 schema、样例结果和边界见[抽测日志](logs/2026-10-22-P0-live-providers.md)。密钥值及完整供应商响应均未记录。抽测覆盖单次模型调用、一个主体画像和一组单页投资结果，不代表持续服务、全部 GP 或跨页边界已验收。

## P0-01：服务端配置读取与权限边界

| 项目 | 当前实现与约束 |
|---|---|
| 读取位置 | `packages/backend/src/config.ts` 的 `credential(group, name)` 仅由服务端代码调用。环境变量优先于分组 dotenv 文件；分组文件位于 `AIHOT_CREDENTIALS_DIR` 指定目录，默认名为 `models.env`、`collectors.env` 等。环境未提供对应值时，DeepSeek 和新华财经密钥还会回退读取仓库根目录 `.config/deepseek-api-key.json`、`.config/xinhua-mcp-key.json`。这两个文件按原始文本读取并 `trim`，不解析 JSON。 |
| DeepSeek | 内置专家和 GP 赛道分类使用 `model: "default"`。该模型需要 `LLM_BASE_URL`、`LLM_MODEL` 及 `LLM_API_KEY` 或 `DEEPSEEK_API_KEY`；请求发送到 `${LLM_BASE_URL}/chat/completions`，密钥只放在后端出站 `Authorization: Bearer` 请求头。另有 `deepseek-flash` 具名预设，使用 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_API_KEY`，但专家代码当前明确选择 `default`。 |
| 新华财经 | `XINHUA_MCP_API_KEY` 属于 `collectors` 凭据组。MCP URL 默认指向企业基础信息服务；可由 `XINHUA_MCP_COMPANY_URL` 覆盖，但代码只接受 HTTPS 且主机必须是 `mcp.cnfic.com.cn`，并拒绝重定向。工具调用使用 Bearer token，只允许 `modules/membership/experts/catalog.ts` 中的固定工具集。 |
| 启用闸门 | `MODEL_CALLS_ENABLED` 在应用配置加载时读取，代码默认 `false`；改值后需重启对应后端/worker。P3 GP 同步另受 `P3_GP_SYNC_ENABLED` 保护，默认关闭。2026-10-22 已在 API 容器用供应商密钥完成单次 DeepSeek 请求；此抽测未启用应用模型功能或 P3 开关。 |
| 启动检查 | 生产 API 启动检查会话、图片签名密钥及站点额外必需项；当前没有把 DeepSeek/Xinhua 设为启动必需项。因此缺少外部凭据不会自动阻止生产进程启动，调用阶段会返回未配置/服务商错误。实际抽测只证明当前挂载凭据在抽测时可用。 |
| 数据边界 | 凭据不下发浏览器。专家和 GP worker 将业务输入发往配置的模型或 MCP 服务；模型调用回执保存脱敏请求摘要/哈希、用量和供应商响应，专家响应按既有七天生命周期清理规则处理。供应商的数据处理、保留和展示/转发授权尚未核验。 |
| CI 边界 | 当前 GitHub Actions 文档/质量工作流没有注入 `DEEPSEEK_API_KEY` 或 `XINHUA_MCP_API_KEY`；自动化使用 stub/mock，不能据此证明线上凭据可用。GitHub 仓库 Secret 也不会自动成为本地、云端任务或服务器进程的环境变量。 |

脱敏配置示例（占位值，不可直接用于连接）：

```dotenv
# 后端进程环境或 .env
AIHOT_CREDENTIALS_DIR=/run/secrets/aihot
MODEL_CALLS_ENABLED=false
XINHUA_MCP_COMPANY_URL=https://mcp.cnfic.com.cn/bdc-mcp-service/mcp/zjs_company/http/
```

```dotenv
# /run/secrets/aihot/models.env
LLM_BASE_URL=https://<approved-openai-compatible-endpoint>/v1
LLM_MODEL=<approved-model-id>
DEEPSEEK_API_KEY=<redacted>
```

```dotenv
# /run/secrets/aihot/collectors.env
XINHUA_MCP_API_KEY=<redacted>
```

如果沿用兼容文件，`.config/deepseek-api-key.json` 和 `.config/xinhua-mcp-key.json` 的文件内容是单行原始密钥文本，不是 JSON 对象。`.config/` 与 `.env` 已列入 `.gitignore`。本次在服务器确认凭据挂载路径、API/worker 容器可读性与宿主机权限，并从 API 容器完成单次连通抽测；没有读取或输出凭据值。真实供应商授权范围仍待核验。

## 新华财经工具与实际代码

静态能力列来自随仓库的 `zjs_company` PDF；实际 schema 列结合 2026-10-22 的授权账号 `listTools` 和调用结果。单次实测覆盖的主体、页数有限。

| 工具 | PDF 所列能力/字段 | 当前代码行为 | 对照结论 |
|---|---|---|---|
| `fuzzy_search_company_list` | 关键词检索；`keyword`、`limit`、`offset`；候选 `company_id`、名称、状态、信用代码、地址、成立日期；结果有 `total` 和分页信息。 | `companyCandidates()` 传 `keyword/limit/offset`，最多取首 10 个候选交由员工选择；画像前保存候选 ID 和名称。 | 静态字段基本吻合；代码只取一页/10 项，候选不是全量名单。 |
| `get_company_profile` | PDF 的 `query_type` 枚举为 `auto`、`credit_code`、`company_name`、`stock_code`、`stock_short_name`；不列 `company_id`。实测实时枚举相同；按信用代码查询返回匹配的主体 ID、名称和信用代码。 | `querySelectedCompanyProfile()` 使用支持的 `credit_code`，没有信用代码时使用候选的准确公司名称；校验返回主体身份。实测的唯一候选以信用代码查询通过。 | `company_id` 查询类型不受支持已确认；实现已改用受支持的查询方式。单次主体样例已通过，其他候选冲突和名称变化仍需逐项验收。 |
| `get_direct_investment` | PDF 仅列 `query`、`query_type`，未列分页；实时 schema 支持 `limit`（最大 50）、`offset`，响应有 `has_more`、`next_offset`。样例字段包括 `record_id`、被投主体、投资方、比例、认缴/实缴、`shoud_date`、`capi_date`、`dates`、插入/更新时间及删除标记。 | 调用显式请求历史范围和缺失日期记录，每页最多 50。解析器把 `pagination.count` 解释为当前页行数，不当作总量；使用 `has_more`/`next_offset`。样例返回 13 行、`has_more=false`，13 行都有稳定 `record_id`。 | 实时 schema 与单页样例验证通过；跨页分页、超过 500 行的安全截断、多主体全量同步尚未实测。分页器遇到无效/不递进 offset 会显式标记不完整，避免误报成功。 |
| `get_company_shareholder` | 当前股东列表，含股东名称/类型/比例、认缴/实缴金额与日期、数据日期等。 | 在允许列表中，但首个专家和 GP 同步当前不调用。 | 可作当前股权关系核查的候选证据；不能单独代替 GP 对外投资历史事件或关联方控制权规则。 |
| `get_company_annual_report_investment_info` | 年报对外投资披露，含报告年度、`publish_date`、被投企业名称及证件号码、插入/更新时间。 | 在允许列表中，但当前首个专家/GP worker 不调用。 | 年报发布日期只代表披露时间；该工具未在静态文档中给出投资实际发生日期。可用于后续历史披露交叉核验，尚未实现。 |

基础信息 PDF 另外列出 `get_company_annual_report_base_info`、历史名称、变更、注销吊销等相关工具；它们当前没有成为首个专家或 GP 同步链路的实际调用。知识产权、经营、风险三份 PDF 也没有在当前首版 GP 事件映射中使用。

## GP 标准事件字段与时间语义

目标字段以 [`docs/PLAN.md` 的标准事件建议](PLAN.md#71-mcp-接入约定)为准。不得把供应商的“数据时间”当作投资发生日。

| 标准字段/语义 | 当前可见来源 | 当前映射/缺口 |
|---|---|---|
| 提供商、GP ID/名称 | 运行配置、已核验 GP watchlist；查询行的 `stock_name/stock_type` | 提供商和名单主体存在；查询行的投资方字段尚未与别名逐项比对，真实返回待核。 |
| `provider_event_id` | PDF 的投资关系 `record_id` | 原始证据保存，但没有归一化为标准事件 ID；当前去重主要按 GP + 被投主体 ID，可能合并同主体的多条关系记录。 |
| 被投主体 ID/名称 | `company_id/company_name` | 当前代码读取主体 ID 和名称；同一主体名称变化、同主体多关系的行为须用实际数据复核。 |
| 关系/轮次 | `get_direct_investment` 的直接股权投资关系 | 支持识别查询范围内的直接对外投资记录；不是企业股权融资轮次事件，PDF 未提供融资轮次工具。基金募集/设立不能替代 GP 对外投资。 |
| 金额/币种/持股比例 | `should_capi`、`should_capi_value`、`should_capi_unit`、`real_capi*`、`stock_percent` | 原始行进入证据；代码不做单位/币种标准化。不得将认缴额当作融资额或已实缴额。 |
| 投资发生日期 | PDF 的 `shoud_date`（认缴出资日期）、`capi_date`（实缴出资日期） | 两者均有各自法律/业务语义，不能自动等同投资发生日。PDF 没有清晰标示独立的投资事件发生日期；没有独立证据时保持未知。当前 P3 审核允许管理员录入 `approved_event_date` 和独立来源 URL。 |
| 对外披露时间 | 年报工具的 `publish_date` | 仅适用于对应年报披露，不等于直接投资发生时间；直接投资接口未列通用披露时间。 |
| 数据日期、供应商时间 | 直接投资 `dates`、`insert_time`、`update_time` | `dates` 是数据日期、`insert_time` 是插入时间、`update_time` 是更新时间。当前代码将 `dates` 映射为 `dataDate`，并单独保留原始行；三者均不能替代投资发生日期。 |
| 平台发现时间 | 本地 snapshot capture / `first_seen_at` | 由平台记录，只能说明平台何时首次观察到关系；不能证明投资何时发生。首个完整快照中的记录被标作 baseline，后续首次出现为 observed。 |
| 赛道、证据状态、修订 | DeepSeek 建议、管理员复核和独立来源 | 模型输出只是建议；需人工批准并保留审核状态/修订，不得把低证据模型分类作为投资事实。 |
| 来源 URL | 独立事实来源与管理员审核字段 | 新华财经直接投资 schema 未列可供公众核验的原始 URL；服务商记录/快照不能自动满足独立来源 URL 要求。 |

## 首个专家规则对照

首个专家参考 [`reference/SKILL.md`](../reference/SKILL.md)，原技能明确依赖悟道 MCP 和 10/11/12 专项 skill。当前试运行适配版只实现新华财经单层直接投资底稿：

- **有限支持：** 人工从名称候选中选择主体；代码尝试用唯一 ID/信用代码复核画像；读取主体画像和一层直接投资，保留字段原值与来源编号；DeepSeek 仅整理摘要/待核问题；未提供字段写“未提供”；用户输入不能扩大 MCP 权限。
- **未证实：** 唯一 ID 查询类型、直接投资分页参数/完整性元数据及真实字段名，须用实际账号 schema 核验。
- **未支持：** 全集团递归穿透；关联方合并控制比例/第一大股东；投资类主体续钻例外；上市主体识别；基金备案与公司制基金终止；有限合伙 GP/执行事务合伙人/管理人提取；历史退出、承接方及退出类型；10/11/12 专项附件；融资轮次事件。
- **安全结论：** 未从服务商字段明确证明发生日期/融资轮次/退出/基金备案时，必须展示未提供或待核，不能让模型补齐。

更细的原规则支持/缺失项见 [`P2-EXPERT-ADAPTER.md`](P2-EXPERT-ADAPTER.md)。

## P0-01/P0-02 的完成边界

本矩阵完成了仓库内配置实现和静态工具 schema 对照，因此可满足 `docs/IMPLEMENTATION.md` 中 P0-01/P0-02 的**文档交付标准**。P0 阶段本身仍未通过：凭据可用性、真实 MCP schema/字段、DeepSeek 模型与费用、来源授权、用户试用及服务器只读盘点仍需分别核验。不要因文档任务勾选而启用模型或 P3 运行开关。
