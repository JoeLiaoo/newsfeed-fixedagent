# P0 DeepSeek 与新华财经 MCP 实际连通性抽测

日期：2026-10-22（Asia/Shanghai）  
环境：火山云上隔离部署的新平台 API 容器。只验证单次服务连通和接口样例，不启用模型功能开关或 P3 定时任务。

## DeepSeek

- 从容器只读挂载凭据文件发起最小 chat completion 请求；密钥没有被输出或写入日志。
- HTTP 请求成功，模型标识为 `deepseek-flash`；此单次请求记录用量为 7 prompt tokens、2 completion tokens、共 9 tokens。
- 本次仅证明凭据和单次请求可用；未验证价格、账号额度、持续可用性或实际专家产物质量，`MODEL_CALLS_ENABLED` 仍保持关闭。

## 新华财经 MCP

- MCP `listTools()` 成功，返回 29 个工具。
- `get_company_profile` 实时 schema 的 `query_type` 枚举为 `auto`、`credit_code`、`company_name`、`stock_code`、`stock_short_name`；不包含 `company_id`。按公司名称候选取得唯一主体后，以信用代码查询画像并核对返回公司身份成功。
- `get_direct_investment` 的 `query_type` 支持 `auto`、`credit_code`、`company_name`；`limit` 上限为 50，支持 `offset`。实时响应分页元数据含 `has_more`、`next_offset`，`pagination.count` 表示当前页行数，不是全量总数。
- 对一个有效样例请求历史范围（1900 年起，并纳入缺失日期记录）时，返回 13 条直接投资记录，`has_more=false`，均有稳定 `record_id`，本次单页结果没有重复 ID。此样例不能证明候选 GP 全名单、跨页情形或供应商长期契约均已验收。
- 首个专家已按实时 schema 修正画像查询类型、身份核对和投资分页；投资行 ID 优先采用 `record_id`，`dates` 映射为数据日期。采集器遇到缺失或非递进 offset 会显式报错，不把页行数误认为全量总数。

## 结论与边界

本次抽测验证了新平台容器内两项供应商凭据都可发起请求，并确认了一组新华财经实时 schema 与响应字段。没有记录密钥、完整企业/投资响应或供应商原始敏感内容。DeepSeek 定价/额度、更多企业的分页与身份边界、供应商授权及业务验收仍待核实；DeepSeek、GP 同步和通知相关功能开关保持关闭。
