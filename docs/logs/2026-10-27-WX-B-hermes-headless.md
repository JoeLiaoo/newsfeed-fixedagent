# 2026-10-27 · WX-B Hermes 无界面自由对话

- 对应任务：P3-04 的 WX-B 代码阶段。真实员工微信、跨日投递、GP 业务验收仍未完成，P3-04 保持 `[ ]`。
- 状态：本分支实现与本地合成验证；未部署、未合并、未启用 agent flag、未调用生产 Hermes 或模型。

## 做了什么

- WX-A 的阅读路由保持优先。只有未识别的文字在三个开关与逐员工 grant 均允许时进入 `membership.ilink-agent` 独立队列；重复入站沿用 WX-A 唯一键并只建一条 run。回复复用独立 outbox 与员工自己的 iLink 身份；模型调用前后及发送前复核绑定和授权。关闭开关、撤权、解绑或重绑阻止旧 agent 回发。
- 追加 `0203`–`0208` 迁移：grant、run、并发与待处理索引、agent 回复关联和入站轮询公平时间。grant 通过删除行撤权，重新插入产生新 grant ID；run 保存当时 ID，不会因重新授权恢复旧消息。
- 宿主机 Python runner 仅在受限 Unix socket 接收固定 JSON 对话请求。命令参数、模型、密钥、工作目录由服务控制；用户文本只走 stdin。每轮独立 home/cwd，白名单环境，`disabled_toolsets: [all]`；stdout/stderr 写文件并取最后一个成功 `result.text`；45 秒超时终止 CLI 进程组。
- R1 选 **(b)**：隔离 home 的 `unmanaged_idle_exit_seconds: 60`；可能短暂留存脱离进程组的 idle gateway，旧 home 在 180 秒后由后续请求清理。绝不触碰 live `/opt/hermes-agent/home` 或 Weixin gateway。R2 的 `--usage-file` 放在 `chat` 前；R3 用 `total_including_auxiliary.api_calls` 计标题生成等辅助调用，成本未知时不估人民币；R4 取最后一个 result。
- 每用户一条运行、三条待处理，全局最多两条运行；输入 2000 字、最多六轮历史并限定历史正文，10 分钟待处理过期。每人 30 次/小时、100 次/日，全局 2000 次/日，准入前按每轮两次模型调用预留。可能已付费的未知结果不自动重试。入站轮询按最近检查时间轮转，每轮取 20 个账号并发；生产 worker 数据库连接池增至 24，避免默认 10 连接把 20 个最长 39 秒的网络等待拆成两批。失败账号本轮检查时间也更新，下一轮轮转到后来者。
- 更新 `.env.example`、Compose socket 挂载、systemd 示例、runner 与 P3 运维说明、PLAN/IMPLEMENTATION/README/文档索引，新增员工端待发布更新条目。未增加 Node 依赖；Python runner 只用标准库。

## 关键决定和回退

- `P3_ILINK_AGENT_ENABLED=false` 默认关闭，依赖阅读回复、投递和模型三个开关；逐员工 grant 单独开通。撤权用 `DELETE FROM member_agent_grants WHERE user_id=...`，而不是修改旧 grant ID。回退先关闭 agent flag，保留 WX-A、run、用量和去重记录。
- 子进程不继承 worker 环境，也不能访问 worker 的数据库、iLink、新华财经或管理员密钥。worker 仅挂载 socket 目录；无需 SSH 或 Docker socket。Hermes 没有普通工具、KB/专家动作或旧 bridge 发送权限。
- 用量预留是平台侧防异常控制，实际辅助调用超过预留会占用后续额度；供应商侧硬费用上限需要模型出口另行强制。价格 `unknown` 不做金额推断。

## 最小验证

- `npm run typecheck`：通过。
- `node scripts/check-migrations.ts --base=HEAD`：通过。新增迁移在本机隔离 PostgreSQL 16 测试库应用并跑通数据库用例；生产 PostgreSQL 17 尚未应用。
- Python runner 合成 CLI 契约测试：通过；验证参数顺序、零工具配置、白名单环境、stdin 原样传输、重复 result 取最后一个、两轮 home 分离。未用真实密钥。
- WX-B standalone 2/2：通过；辅助调用计费与未知价格、WX-A 阅读指令优先。
- 隔离数据库 WX-B + WX-A 2/2：通过；两员工上下文隔离、重复入站唯一、运行中撤权取消回发、runner 故障降级、WX-A 旧行为。iLink 未真实发送。
- `node scripts/check-doc-links.ts`、`git diff --check`：通过。

## 未验证事项与风险

- 未在生产宿主机运行该 systemd 单元，需核对 runner 用户对固定 Hermes 可执行文件及只读运行时的访问权限、socket GID、模型出口和零工具实测。真实 provider 的流式响应、模型输出与实际用量、冷启动和约 20 员工轮询延迟仍待测量。
- iLink `accepted` 不证明手机收到；两员工真机、跨日会话窗口及异常恢复仍由 Joe 验收。P3-04 继续未勾选。
- 若模型出口不强制调用/金额上限，45 秒进程超时与平台请求前预留不能保证供应商侧费用硬上限。Runner 首次启动的隔离 idle gateway 最多留约 60 秒，进程组终止不覆盖它；不能把这段时间的资源占用说成零。
- Phase C 的知识库问答和专家微信动作、旧 bridge 清理均未做。

## 下一步

PR 评审 → 在部署闸门下核对宿主机 Hermes 指纹、安装 runner 和权限、应用迁移、少量真实模型与双员工微信验收；由 Joe 决定何时授予员工并开启 agent flag。
