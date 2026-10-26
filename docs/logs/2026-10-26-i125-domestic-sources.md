# 2026-10-26 Issue #125 首批国内资讯信源

- Agent：Codex
- 对应任务：维护任务（不对应 P0–P5；沿用 P1-04 信源采集路径）
- 完成状态：完成（代码、公开源 dry-run 与本地检查通过；待 PR 评审和部署后员工验收）

## 本次改动

- 修改文件：
  - `industry/sources.json`
  - `README.md`
  - `docs/IMPLEMENTATION.md`
  - `docs/README.md`
  - `site/changelog/pending/domestic-news-sources.json`
  - `docs/logs/2026-10-26-i125-domestic-sources.md`
- 实际完成：
  - 新增五个可由首次启动 seed 导入的信源，沿用 worker 已有的 `rss`、`web_list`、`json_list` 采集器；无数据库迁移，也不覆盖管理员已修改的来源。
  - 海外独角兽：公开播客 RSS `https://feed.xyzfm.space/ym6ug8jctfp8`，通过 Apple Podcasts 目录的节目 `feedUrl` 核对；RSS 描述作为正文使用，不再跟进条目中附带的微信文章链接。
  - 拾象科技：官网报告列表 `https://shixiang.com/reports`，使用 HTML 列表解析器，只收录 `/reports/` 路径。公开页有四篇报告卡片，列表没有发布时间，故日期保留未知。
  - 晚点 LatePost：官网「晚点聊 LateTalk」RSS `https://podcast.latepost.com/rss`（跟随到 `feeds.fireside.fm/latetalk/rss`）。这是晚点官方播客，不代表晚点主站长报道的完整覆盖。
  - 极客公园：官网 RSS `https://www.geekpark.net/rss`；把条目中的 `http://www.geekpark.net/` 地址改写为 HTTPS。RSS 返回的 30 条均为可解析新闻条目。
  - 机器之心：官网公开文章库 JSON 列表 `https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=40`，提供官网文章库 Referer 与 Accept，映射标题、链接、作者、发布时间、摘要及稳定文章 ID；使用通用 `json_list`，没有新增站点适配器。
  - 五个信源在后台/员工信源池由同一 `sources` 表读取。待发布中文 changelog 说明五个频道及晚点覆盖范围。
- 关键决定及理由：
  - 没有采用公众号采集适配器。机器之心 `/rss` 当前跳转到数据服务页，不返回 feed；其官网文章库 JSON 接口可直接读取最新文章，因此选择官方列表 API。
  - 海外独角兽与拾象官网当前可确认的独立开放内容包括节目 RSS 和官网报告列表；RSS 项目直接保留节目 URL，避免拉取其条目中的微信链接。
  - 晚点主站开放 RSS 未找到，选择晚点官方播客 RSS。接受范围较窄，并在员工更新日志和本文标明。
  - seed 仅对缺少的来源执行 `ON CONFLICT DO NOTHING`，遵循现有管理员配置保护逻辑。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：按锁文件安装依赖，通过。
  - 五源实际网络 dry-run（使用仓库当前 `fetchRss`、`fetchWebList`、`fetchJsonList` 及 `assertSupportedConfig`）：全部解析非空条目。观测数量分别为海外独角兽 14、拾象科技 4、晚点 LatePost 183、极客公园 30、机器之心 20。
  - `npm run typecheck`：通过。
  - `node --import ./tests/standalone.ts --test tests/sources.standalone.test.ts tests/listing-fetch.standalone.test.ts`：17 项通过。
  - `node scripts/check-doc-links.ts`：通过，检查 536 个本地 Markdown 链接。
  - `git diff --check`：通过。
  - `npm run changelog:check`：按预期拒绝归档，当前有本次新增和既有的三个待发布 changelog 条目；此任务要求保留 `pending/*.json` 给发布流程应用，未运行 `changelog:apply`。
- 未执行或需用户试用的检查：
  - 未跑数据库集成测试；此变更只加 seed 信源定义，无迁移。
  - 未部署；部署后需要员工确认信源可见、 worker 连续轮询和资讯列表展示。
  - 机器之心接口返回最新条目数与上游分页行为仅本次抽测，`per=40` 请求实际返回 20 条；详情页全文提取和长期接口可用性未验证。

## 风险与交接

- 已知限制／缺失依赖：
  - 海外独角兽当前节目 RSS 仅抽测到 14 集，更新节奏受节目方控制。
  - 拾象官网当前列表四篇报告，未提供日期；晚点所选官方 RSS 仅为晚点聊播客。
  - RSS 与机器之心 JSON 接口的实测证明一次可访问，不代表生产网络持续可用；机器之心需要官网列表 API 持续保持当前字段与分页行为。
  - 当前 seed 是首次启动补充；已经运行的环境需要按既有运营流程导入信源，不会由部署自动更新已有数据库。
- 下一步：
  - PR 评审合并后按正常发布流程上线；发布后核对管理员信源与员工资讯列表，并记录 RSS/JSON 接口是否持续更新。不开启自动部署。
