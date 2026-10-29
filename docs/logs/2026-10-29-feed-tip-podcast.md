# 2026-10-29 · 产业动态「播客」筛选

- 对应任务：资讯筛选维护。不改变 P0～P5 勾选，不部署。
- 类别键 `tip` 保持不变（`/all?category=tip`、公开接口、RSS、MCP）。用户看到的名称从「教程」改为「播客」。

## 做了什么

- `industry/taxonomy.ts`：`tip` 的标签改为「播客」，说明只收播客、对谈或访谈单集。教程、提示词、工具用法、工程复盘和技术讲解改由「观点」（`opinion`）收。两者仍共用日报分节「技巧与观点」，评论类快讯规则不变。分类标签增加「播客」，「教程/实践」仍在，话题页「教程实践」继续按该标签归类。来源标签常量 `PODCAST_SOURCE_TAG` 为「播客」。
- 确定性归类：来源标签含「播客」时，结构抽取和发布都写成 `tip`，并去掉其他分类标签、保留主题与 `entity:` 标签。没有该来源标签、却被标成 `tip` 的条目（含历史教程）在发布时写成 `opinion`，读取时也显示为观点。种子里的 BidClub（`json-bidclub`）、海外独角兽（`rss-overseas-unicorn`）和晚点聊（`rss-latepost-talk`）已经带有「播客」标签，因此新节目和已入库节目都会进同一筛选。
- 读取侧用 `feedCategorySql`，不新增会改历史行的迁移。线上迁移不允许 UPDATE 回填；`scripts/seed.ts` 对已有来源是冲突则跳过，不靠重跑 seed 改标签。
- `industry/prompts/structure.md` 与 `content-understanding.md` 同步：播客归 `tip`，教程不再归 `tip`。来源标签「教程」只是提示，不强制分类。结构抽取的材料里带上来源标签。
- 员工更新日志只写待发布文件 `site/changelog/pending/feed-podcast-filter.json`，不改 `site/changelog.json`。
- 未改筛选组件、话题配置、前沿播客专家、微信／iLink 帮助或 Hermes。

## 修改的文件

- `industry/taxonomy.ts`
- `industry/prompts/structure.md`
- `industry/prompts/content-understanding.md`
- `packages/backend/src/editorial/vocabulary.ts`
- `packages/backend/src/editorial/analyze.ts`
- `packages/backend/src/editorial/input.ts`
- `packages/backend/src/publication/rules.ts`
- `packages/backend/src/publication/publish.ts`
- `packages/backend/src/publication/items.ts`
- `packages/backend/src/publication/feeds.ts`
- `packages/backend/src/publication/og.ts`
- `packages/backend/src/publication/topics.ts`
- `packages/backend/src/reports/edition.ts`
- `packages/backend/src/notify/selected-content.ts`
- `tests/public-categories.test.ts`
- `tests/podcast-category.standalone.test.ts`
- `site/changelog/pending/feed-podcast-filter.json`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`

## 关键决定

教程放进已有的 `opinion`，不新开类别键。这样网址和接口身份不变，日报分节标题也不变，话题页仍靠「教程/实践」。没有「播客」来源标签的 `tip` 一律显示为观点，避免旧教程留在播客筛选里。代价是：未打「播客」标签的来源即使被模型标成播客，也会显示为观点。本次范围只有上述三个来源；其他播客聚合不在此变更内。

## 最小验证

- `node --import ./tests/standalone.ts --test tests/podcast-category.standalone.test.ts`：5/5 通过。覆盖芯片文案、三个种子来源的「播客」标签、发布归类、结构抽取覆盖，以及提示词不再把内容归教程。
- `npx tsc -p packages/contracts && npx tsc -p packages/backend && npx tsc -p tests`：通过。
- `node scripts/check-doc-links.ts`：609 条本地链接通过。`git diff --check`：通过。
- 未开浏览器，未连生产，未部署。当前环境没有 `DATABASE_URL`，也没有 Docker，因此未跑 `tests/public-categories.test.ts`。该用例已改为：`tip` 夹具使用带「播客」标签的来源，另有一条存在普通来源上、库内类别仍为 `tip` 的教程，应只出现在观点筛选。CI 的 `postgres-integration` 会跑它。

## 未验证与风险

- 生产库里这三个来源是否仍带「播客」标签，要在发布后看实际来源行。种子不会更新已存在的行。
- 管理后台在重新分析或重新发布前，可能仍按分析记录里的旧 `tip` 显示新标签「播客」。公开信息流、RSS、分享卡和通知按读取规则显示。
- 播客后续报道仍按评论类处理：已写过的事件通常只占一行快讯。

## 下一步

合并后由发布负责人在构建用的提交上运行 `npm run changelog:apply`，再按部署手册发布。打开 `/all?category=tip` 核对芯片为「播客」且只有播客节目；教程应出现在 `/all?category=opinion`，并仍可从话题「教程实践」进入。
