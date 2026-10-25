# 2026-10-24 UI 控件与列表密度维护

- Agent：Codex
- 对应任务：UI 维护任务；不改变 P1～P5 的验收标准或勾选。
- 完成状态：代码与文档已随 PR #64 合并（`85784df`），尚无生产发布记录。

## 本次改动

- 修改文件：`apps/web/app/components/ui/{Menu,Tabs,Controls}.tsx`、`apps/web/app/components/shell/ThemeSwitch.tsx`、`apps/web/app/routes/item.tsx`、`modules/membership/pages/{experts,expert-detail,knowledge,knowledge-base}.tsx`、`modules/membership/pages/projects/invested-gp.tsx`、web 依赖清单和锁文件、`docs/IMPLEMENTATION.md`、`docs/README.md`。
- 菜单用 Radix Dropdown Menu 管理打开、方向键、焦点和关闭；页内单选切换用 Radix Toggle Group，主题三选一用现有 Radix Radio Group。链接式导航仍用真实链接。滑块交给已有 Motion，并照顾减少动态效果偏好；本次触及的自绘图标改为已有 Lucide。
- 新增 `@radix-ui/react-dropdown-menu` 与 `@radix-ui/react-toggle-group`，沿用仓库已有的 Radix、React 19 与 Tailwind 组合；锁文件固定版本。原生选择框和按钮类名仍适合资讯页面，无需另加一套组件。
- 专家目录与详情只在异常状态展示状态徽标；输入要求留在任务表单，去掉列表中的版本号与执行模式。已投 GP 清单只收录已核实记录，因此每张卡不再重复标记。知识库列表保留来源日期、构建状态、页面类型与时效，版本、文件名、尝试次数等留在材料详情或已有后台数据中。

## 最小验证

- `npm run typecheck -w @aihot/web`：通过。
- `git diff --check`：通过。
- 未运行自动化测试，也未进行浏览器键盘操作、真实员工账号试用或生产发布；上线交互仍需人工确认。

## 风险与交接

- Radix 两个新包会增加 web 依赖体积；菜单、单选组依赖其上游键盘与焦点行为，PR 审查时应检查分享海报打开、Markdown 下载以及链接导航的操作路径。
- 未做全站自绘图标、Sheet、Lightbox 与旧动画的批量替换；这些控件还有独立交互行为，需要逐个迁移。当前改动集中在本轮 UI 审查发现的操作菜单、切换控件与业务列表。
- 下一步：发布前在浏览器中核对键盘与触屏体验；发布单独登记，不据此更新业务验收状态。
