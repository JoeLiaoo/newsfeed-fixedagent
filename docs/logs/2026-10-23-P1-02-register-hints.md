# P1-02 · 注册输入提示（2026-10-23）

## 本次改动

- 在员工注册页的用户名输入框下常驻展示实际规则：3–40 位，仅支持英文字母、数字、英文句点（.）、下划线（_）和连字符（-）。
- 在密码输入框下常驻展示用户确认的提醒：请不要使用个人常用密码，建议为本平台设置独立密码（至少 12 位）。
- 使用 `aria-describedby` 将提示与对应输入框关联；沿用现有页面组件和文字样式。
- 修改文件：`modules/membership/pages/register.tsx`、本日志及 `docs/README.md`。

## 决定与验证

- 服务端 `modules/membership/server.ts` 接受用户名 `/^[a-zA-Z0-9._-]{3,40}$/`，密码长度 12–200 位；提示不增加新的强制条件，也不改变注册接口。
- 本次改动仅涉及可见说明和辅助技术描述。`node scripts/check-doc-links.ts` 检查 244 个本地链接通过；`git diff --check origin/main...HEAD` 通过；PR 的 Docs checks、P3 checks 均通过。

## 合并与发布

- [PR #29](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/29) 已合并，合并提交 `bd53dcbb8a46b83712160409b9424a2ff7061f62`。
- 火山云已部署该提交；本机与公网健康端点返回 `ok=true`、`db=ok` 与该 release，公网 `/register` 返回 HTTP 200，HTML 中含两段提示。发布过程见 [P4 发布日志](2026-10-23-P4-pr29-deployment.md)。

## 未验证事项

- 员工在实际浏览器与辅助技术中的阅读体验仍需人工确认；本次不改变账号审核或密码策略。
