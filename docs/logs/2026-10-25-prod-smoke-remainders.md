# 2026-10-25 · 生产冒烟剩余项维护

- 对应任务：2026-10-25 只读生产冒烟报告的剩余清单；P1-05、P2-05、P3 员工 GP 读取、P5 页面体验维护。P2、P3、P5 的真实业务验收仍未完成，实施计划勾选不变。
- 基线：`origin/main` 的 `d0713cc`（PR #70）。该版本为用户报告的当前生产版本；本分支未连接或修改生产。

## 做了什么

1. 为已核实 GP 直投项目增加卡片详情入口、员工页面和 `GET /api/v1/membership/gp-projects/:id`。详情与清单使用同一筛选条件，仅返回清单已可见的字段；演示来源仍不可点击，内部 `raw_evidence`、审核人等字段不返回。未知、未核实及无效 GP 的记录返回 404，未登录返回 401。
2. 确认全景图路由为 `experts/:slug` 的通用专家详情，`xinhua_panorama` 会执行企业名必填判断。表单的空名错误移到输入框旁，原生 `onInvalid` 和提交处理均显示同一中文提示，并在提交处理触发时聚焦输入框。
3. 材料和知识页详情读取期间显示“正在加载…”状态，读取完成后仍显示原有内容或错误。
4. 首页历史按 API 已提供的北京时间日键 `date` 每日保留一个芯片，保留服务端排序中同日最新关注版本。
5. “我的”读取现有 `/api/v1/membership/me`，展示真实姓名与用户名。
6. 从仓库现有圆环标记形状制作三种尺寸的 `site/brand/favicon.ico`，根布局显式声明 favicon。现有 API 静态路由会直接服务 `/favicon.ico`，Web 路由将该地址转发给 API。

## 修改文件

- GP：`modules/membership/gp/routes.ts`、`modules/membership/module.ts`、`modules/membership/pages/projects/invested-gp.tsx`、`modules/membership/pages/projects/invested-gp-detail.tsx`、`modules/membership/tests/gp-projects-access.test.ts`。
- 表单及知识库：`modules/membership/pages/expert-detail.tsx`、`apps/web/app/components/member-ui/input.tsx`、`modules/membership/pages/knowledge-document.tsx`、`modules/membership/pages/knowledge-target.tsx`、`modules/membership/tests/panorama.standalone.test.ts`。
- 首页、身份、图标与浏览器验证：`apps/web/app/routes/home.tsx`、`apps/web/app/routes/home-history.ts`、`apps/web/app/routes/more.tsx`、`apps/web/app/root.tsx`、`site/brand/favicon.ico`、`apps/web/tests/home-history.test.ts`、`apps/web/tests/prod-smoke-remainders.test.ts`。
- 文档：`README.md`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P3-OPERATIONS.md`、`docs/README.md`、首轮冒烟日志与本日志。

## 关键决定与最小验证

- 详情不读取或序列化内部证据，不新增数据源、外链或表结构。卡片内部已有的核对来源链接仍可独立点击；卡片其他区域进入详情。
- `npm run typecheck`、`npm run build -w @aihot/web`、`node scripts/check-doc-links.ts`、`git diff --check` 通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/panorama.standalone.test.ts apps/web/tests/home-history.test.ts`：23/23 通过。
- PostgreSQL 17 临时容器上，仅运行 `modules/membership/tests/gp-projects-access.test.ts`：1/1 通过，覆盖清单和详情的鉴权、404、200、安全字段及 favicon 200。
- 构建后运行 `node --test apps/web/tests/prod-smoke-remainders.test.ts`：2/2 通过；覆盖全景空提交不发 POST、首页同日单芯片、当前身份、GP 卡片跳转，以及材料／知识页加载态到内容态。

## 未验证事项、风险与下一步

- 未运行全量测试、未连接生产数据库、未调用 DeepSeek 或新华财经、未用真实员工账号验收。上述 fixture 只证明代码路径，不证明真实 GP 投资事实、知识页性能或生产缓存行为。
- 本分支没有迁移和开关变更；合并与生产发布需遵循现有运维闸门。部署后由员工核对实际项目详情、全景空名提示、知识库慢网首屏与浏览器图标；GP 主体、跨日推送及知识库真实材料验收仍需单独完成。
