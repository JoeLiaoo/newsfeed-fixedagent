# P0 材料与可行性记录

初次盘点：2026-10-21（Asia/Shanghai）；本次更新：2026-10-22
状态：已完成本地材料、服务端配置读取和接口静态字段对照；当前开发先用 DeepSeek API 与新华财经 MCP，外部接口和个人微信投递尚未实测，用户参与实际试用。详见 [P0 配置与数据字段矩阵](P0-DATA-MATRIX.md)。

用户已告知 Codex 云端环境变量和 GitHub Actions 仓库级 secrets 均配置了 `DEEPSEEK_API_KEY`、`XINHUA_MCP_API_KEY`，上线服务器的凭据也已放在 `.config/`；上述可用性及服务器具体路径尚未核验。

## 已收到的材料与业务安排

| 阶段 | 已收到或确定 | 用途 |
|---|---|---|
| P0 | `.config/deepseek-api-key.json`、`.config/xinhua-mcp-key.json`；`reference/` 中四份新华财经 MCP 接口说明 | 评估模型与试用数据源接入；密钥仅留在被 Git 忽略的 `.config/` 中，不写入代码、日志或文档 |
| P1 | [aihot.news](https://aihot.news/) 原生信源用于“新一代信息技术—人工智能”及相关细分赛道的样例；用户本人担任首位管理员 | 建立资讯样例、初始管理员账号；原生资讯仍需按已审定标签分类，不把“基础模型”“垂直应用 Agent”“AI for Science”重复归入剩余类“人工智能” |
| P2 | `reference/SKILL.md`；核查对象“上海天之际创业投资合伙企业（有限合伙）”“杭州市国有资本投资运营有限公司” | 首个专家的两个业务样例；当前没有报告样例，以 skill 规定的底稿结构为首版输出目标，效果上线后继续联调 |
| P3 | `reference/母基金已投子基金管理人.md`，含 9 行、9 个不同的管理人名称 | 作为管理员 GP 候选名单的起点；导入前核对各主体身份、别名及“管理人”与“普通合伙人”的区别 |

## 新华财经文档的静态核对

- 企业基础信息服务 `zjs_company` 列出 29 个工具，其中 `fuzzy_search_company_list`、`get_company_profile`、`get_company_shareholder`、`get_company_change`、`get_direct_investment` 和 `get_company_annual_report_investment_info` 与 GP 新增投资识别相关。
- `get_direct_investment` PDF 给出被投企业 ID/名称、投资方名称、持股比例、认缴/实缴字段、认缴日 `shoud_date`、实缴日 `capi_date`、数据日期 `dates`、插入时间 `insert_time` 和更新时间 `update_time`。这些时间语义不同；PDF 没有给出独立投资发生日，也未列该工具的 `limit/offset` 或分页完成字段。
- 静态 schema 与当前代码有待实测确认的差异：`get_company_profile` PDF 未列代码传入的 `query_type=company_id`；`get_direct_investment` PDF 未列分页参数及 `total/has_more` 元数据；代码当前也未把 `dates` 映射到 `data_date`。真实 `listTools` schema 和一组脱敏响应确认前，不能声称 GP 同步分页完整或实体 ID 查询已被服务商支持。
- 当前四份文档未列出独立的“股权融资事件”工具，也未说明融资轮次或融资金额的完整字段。正式数据源仍按 `docs/PLAN.md` 的采购和授权核验结果决定。
- `.config/` 下两个密钥文件的内容是原始密钥文本，不是 JSON 对象；实现配置读取时应按原始文本读取并去除首尾空白，不能因为扩展名为 `.json` 就调用 JSON 解析。

## 本轮接入环境预核（2026-10-21）

- Hermes 官方 [Weixin/iLink 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin)说明：扫码关联一个 iLink bot 身份；每位允许使用的用户需主动向该 bot 发私聊，网关才能获得其用户标识和会话上下文；上下文会落盘并可在重启后恢复，但过期上下文仍可能导致主动发送失败。因此，试用须让至少两名同意参与的用户分别先发消息，再分别验证投递，并在后续日期复测；文档不能代替端到端证据。
- 当前 Codex 云端环境报告云端任务环境已运行，但未附加外部能力或出站身份，VPN 未配置，TCP 访问目标列表为空；配置的 HTTP 出站策略为受限策略。状态显示相关 API 凭据变量已就绪，但这不等于 API 已能调用；本轮没有可调用的新华财经 MCP 端点，也没有 `ai-work` 的只读 SSH 目标或连接路径。
- 上述环境限制只描述本任务执行环境，不能推断火山云 `ai-work` 实例本身不可达。计划中已有的 SSH／Nginx 状态记录未在本轮复核；需取得该实例的只读连接路径后盘点。
- 本轮没有读取或记录密钥值，没有调用外部 API，没有向微信账号发送消息，也没有连接或更改服务器。逐项记录见 [P0-03/P0-04 预核日志](logs/2026-10-21-P0-03-04-precheck.md)。

## P0 待完成的验证

- [ ] 用户验证 DeepSeek 凭据可用，并记录可用模型、费用或调用限制；不记录密钥值。
- [ ] 用户验证新华财经试用凭据及相关工具可调用；获取 `get_company_profile` 与 `get_direct_investment` 的真实工具 schema 和脱敏字段样例，核实身份查询与分页完整性。
- [ ] 用至少两个真实员工账号验证个人微信自行绑定、主动投递和跨日送达；记录渠道限制及失败情况（当前预核与阻塞条件见 [日志](logs/2026-10-21-P0-03-04-precheck.md)）。
- [ ] 在首个专家适配版中列明悟道 MCP 缺失所造成的规则差异；悟道接入与授权留作后续候选，不阻断当前用新华财经和 DeepSeek 开发。
- [ ] 核对首个专家引用的 10／11／12 专门 skill 是否可提供，缺失时在试运行界面明确显示依赖状态。
- [ ] 对 GP 候选名单逐项确认规范名称与主体身份，避免把基金产品、管理人和普通合伙人混为一个监测对象。
- [ ] 只读盘点 `ai-work` 当前资源、旧应用边界及其他服务；清理须等待同事备份完成（本轮访问阻塞见 [日志](logs/2026-10-21-P0-03-04-precheck.md)）。

外部验证和服务器盘点未完成前，P0 不标记通过；P1 的本地开发可先使用上述样例和模拟数据准备界面与数据结构。具体任务、日志和勾选状态见 `docs/IMPLEMENTATION.md`。
