# 2026-10-26 任务入口合并与 36 氪信源地址改写

- Agent：coding 助手 / Joe
- 对应任务：维护任务（不对应 P0–P5）
- 完成状态：完成（代码与本地验证通过；未合并、未部署，员工真实验收待做）

## 本次改动

- 修改文件：
  - `modules/membership/pages/experts.tsx`
  - `modules/membership/pages/account-artifacts.tsx`
  - `modules/membership/pages/tasks.tsx`
  - `modules/membership/pages/expert-detail.tsx`
  - `modules/membership/sources.ts`
  - `modules/membership/server.ts`
  - `packages/backend/src/lib/url.ts`
  - `modules/membership/tests/task-detail-page.standalone.test.ts`
  - `modules/membership/tests/source-host-alias.standalone.test.ts`（新增）
  - `modules/membership/tests/source-host-alias.test.ts`（新增）
  - `.github/workflows/p3-checks.yml`
  - `site/changelog/pending/task-library-entry.json`、`site/changelog/pending/source-address-alias.json`
  - `docs/IMPLEMENTATION.md`、`docs/README.md`
- 实际完成：
  - 专家平台页头只保留「我的任务与产物」，删去重复的「任务记录」入口；侧栏与个人设置早已指向同一页面，入口不再分裂。
  - `/account/artifacts` 每行新增「查看任务」，跳到该任务的详情页 `/tasks/:id`；材料与产物下载、状态筛选、分页保持不变。列表在有未完成任务时每 5 秒轻量刷新一次。
  - `/tasks` 改为薄重定向页，服务端渲染与浏览器跳转都落到 `/account/artifacts`（保留 `offset` 等分页参数）；`/tasks/:id` 任务详情页与相关接口未改动。
  - 专家详情页的「查看全部任务记录」改为「查看全部任务与产物」，指向 `/account/artifacts`。
  - 员工添加信源时，地址先按主机别名表改写再检查与入库：`36kr.com` → `www.36kr.com`。改写后的地址既用于来源检查，也作为落库的 `feedUrl`，采集时不再回到被反爬拦截的主域名；首页自动发现的 RSS／sitemap 地址同样改写。别名表放在 `packages/backend/src/lib/url.ts`，后续可按需补充。
- 关键决定及理由：
  - `/tasks` 用 loader 重定向而不是删除路由：旧链接、书签和外部引用继续可用，`/tasks/:id` 不受影响；沿用仓库已有的 `knowledge-redirect.ts` 写法。
  - 别名改写放在共享的 `lib/url.ts` 而非会员模块内部：地址规范属于后端 URL 职责，模块与采集侧共用一份规则。
  - 别名改写只影响主机名，路径、查询与端口原样保留；不改动失败码，也不把不可解析的地址静默通过。
  - 任务与产物页的轻量刷新不重置列表：只有换页或换筛选才显示加载态，刷新时行留在屏幕上。
  - 36 氪的实际差异（`https://36kr.com/feed` 返回反爬 HTML，`https://www.36kr.com/feed` 返回 `application/rss+xml`）已用 curl 现场核对，测试不依赖线上站点。
  - 两条员工可见变更写入 `site/changelog/pending/`，由发布负责人在发布 tip 上统一应用。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/*.standalone.test.ts`：通过（168 项，含新增的地址别名 3 项）。
  - 临时 PostgreSQL 17 容器上的数据库用例：`source-host-alias.test.ts`（新增）、`source-check.test.ts`、`account-artifacts.test.ts`、`expert-tasks-page.test.ts` 均通过；新用例用本地夹具冒充 `www.36kr.com`，验证检查只读改写后的地址、落库 `feedUrl` 为 `http://www.36kr.com/feed`，且从不读主域名。
  - `tests/architecture.test.ts`：通过（14 项）。
  - 生产 web server（本地构建）实测：`GET /tasks?offset=20` → `302 /account/artifacts?offset=20`；`GET /tasks` → `302 /account/artifacts`；`GET /tasks/abc-123` 仍渲染任务详情页（200）。
  - 浏览器（Playwright + 本地 web server + 假接口）实测：专家平台页头只剩「我的任务与产物 → /account/artifacts」与「新增专家 → /experts/new」；任务与产物页每行「查看任务 → /tasks/task-1」，「下载 Markdown 产物」仍在；专家详情页「查看全部任务与产物 → /account/artifacts」；有未完成任务时列表每 5 秒刷新一次且不闪加载态。
  - `node scripts/check-doc-links.ts`：通过。
- 未执行或需用户试用的检查：
  - 未做全量测试套件（按约定只做本次改动相关的最小验证）。
  - 真实员工在生产上添加 `https://36kr.com/feed` 并看到条目、登录后确认两个任务入口的观感，仍待人工验收。

## 风险与交接

- 已知限制／缺失依赖：
  - 别名表目前只有 `36kr.com` 一项；其他站点若也有主域名／`www` 差异，需要按同样的方式补一条。
  - 任务与产物页的轻量刷新只在前台页面打开时生效，与原 `/tasks` 的轮询行为一致但间隔更长（5 秒）。
  - `/tasks` 重定向后不再有独立的页面标题与面包屑，浏览器历史里显示为「我的任务与产物」。
- 下一步：
  - PR 评审与合并后按运维闸门发布；发布后由用户复验 36 氪信源与任务入口。
  - 员工真实验收完成前，P2-05 与其他任务的勾选状态不变。
