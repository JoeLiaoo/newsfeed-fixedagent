# 2026-11-05 员工注册自动通过开关 工作日志

- Agent：pi（Joe 的编码 Agent）
- 对应任务：维护任务（不对应 P0–P4）
- 完成状态：完成

## 本次改动

- 修改文件：
  - `modules/membership/registration.ts`（新增）：`autoApproveEnabled()`，只认 `MEMBERSHIP_AUTO_APPROVE` 的 `true`／`1`／`yes`（去空格、忽略大小写），未设置或任何其他值都视为关闭；每次调用时读取环境变量，改开关不需要重新构建。
  - `modules/membership/server.ts`：注册接口在开关打开时以 `status='active'`、`approved_at=now()`、`approved_by=null` 落库，答覆 `{ status: "active" }`；开关关闭时仍按原来的 `INSERT`（数据库默认 `pending`）并答覆 `{ status: "pending_approval" }`。新增公开只读接口 `GET /api/v1/membership/registration-policy`，答覆 `{ autoApprove: boolean }`，并加入匿名可达白名单。
  - `modules/membership/pages/register.tsx`：页面 loader 从 api 读取注册策略；开关打开时页面写「注册后即可登录。」、按钮为「注册」，注册成功后按接口返回的 `status` 显示「注册成功，请使用用户名和密码登录。」；关闭时文案与今天一致。
  - `modules/membership/pages/login.tsx`：loader 一并读取注册策略；开关打开时登录失败且账号未开通的提示不再写「等待管理员审核」，关闭时保持原文案。
  - `modules/membership/tests/membership-auto-approve.test.ts`（新增）、`modules/membership/tests/membership-auto-approve.standalone.test.ts`（新增）。
  - `.env.example`：新增 `MEMBERSHIP_AUTO_APPROVE=false` 及说明。
  - `.github/workflows/p3-checks.yml`：两个新测试加入对应检查列表。
  - `docs/IMPLEMENTATION.md`、`docs/README.md`、`site/changelog/pending/membership-auto-approve.json`。
- 实际完成：
  - 注册、登录、待审核列表与管理员审核决定四条链路在开关关闭时与今天完全一致（数据库默认值仍为 `pending`，`GET /api/v1/membership/admin/pending` 与 `POST /api/v1/membership/admin/:id/decision` 未改动）。
  - 开关打开时新注册账号直接可登录，不再进入管理员待审核列表；没有人审核过该账号，`approved_by` 留空。
  - 策略接口只答覆一个布尔值，不含任何凭据或个人信息。
- 关键决定及理由：
  - 开关由 api 进程持有，网页经 `GET /api/v1/membership/registration-policy` 读取。docker compose 的 `web` 服务不加载 `.env`，只有 api／worker 加载，因此由网页直接读环境变量会在生产读到关闭值；接口是唯一真值来源。
  - 页面策略走 SSR loader（`react-router` 会把 loader 从浏览器包中去掉），因此开启后首屏就是正确文案，不出现先显示「等待审核」再改写的闪烁。
  - 注册成功提示按接口返回的 `status` 判断，而不是只按页面读到的开关，避免开关在打开与提交之间变化时说错。
  - 只新增一个公开可读接口，不复用已有接口：现有接口都要会话，而注册页在登录前就要知道是否审核。
  - 保留 `approved_by=null`：自动通过不是管理员审批，不应伪造审批人。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过；构建产物确认 `registration-policy` 只出现在 server 包，浏览器包不含该逻辑。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/membership-auto-approve.standalone.test.ts`：2 项通过。
  - `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/membership-auto-approve.test.ts`（本机 PostgreSQL 临时库）：1 项通过，覆盖关闭时注册→待审核→管理员通过后可登录、打开时注册即 `active` 且不进待审核列表、策略接口匿名可读。
  - 本机同时起 api 与 web 实测：开关关闭时注册页显示「提交后由管理员审核账号。」与「提交审核」，`POST /register` 返回 `{"status":"pending_approval"}`；开关打开时注册页显示「注册后即可登录。」与「注册」，经 web 代理注册返回 `{"status":"active"}`，随即登录返回 200。
  - `node scripts/check-doc-links.ts`：通过。
  - PR #179 的 CI（links、quality、postgres-integration）在 PR 首轮 head `e5795ac` 上全部通过；本次提交仅补记该结果。
- 未执行或需用户试用的检查：
  - 未部署到任何环境，未改动生产配置；生产仍是原行为（注册后待审核）。
  - 未在真实内网主机上验证开关生效路径（`/opt/citic-newsfeed/shared/.env` 变更与容器重建），需发布时按运维步骤人工确认。
  - 未做真实员工注册试用；注册页文案改动需在真机浏览一次。

## 风险与交接

- 已知限制／缺失依赖：
  - 开关对该实例上的所有注册生效：能访问注册页的人注册后即为可用账号。内网实例符合这一意图，公网实例须保持关闭。
  - 开关不追溯处理既有待审核账号：开启前注册的账号仍需管理员在「待审核账号」页放行。
  - 网页侧的文案依赖 api 的策略接口；api 未重启时网页读到的是旧值。
- 下一步：
  - 评审合并后，按发布步骤在 CITIC 主机把 `MEMBERSHIP_AUTO_APPROVE=true` 写入 api 的 `.env` 并重建 api 容器，再用一名员工账号走一遍「注册→直接登录」。
  - 该开关真正对员工生效时，再由发布负责人应用员工端更新日志待发布条目 `site/changelog/pending/membership-auto-approve.json`（文案只在该实例开启后成立）。
  - 回退路径：把 `.env` 中的开关改回 `false` 或删除该行并重建 api 容器，注册即回到待审核；已自动通过的账号需要管理员在后台改状态。
