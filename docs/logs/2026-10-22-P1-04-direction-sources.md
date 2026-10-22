# P1-04 其他方向示范信源

日期：2026-10-22（Asia/Shanghai）

## 做了什么

- 在 `industry/sources.json` 为新能源、新材料、先进制造、战略配售各增加两个公开 RSS 来源，共 8 个。沿用可重入的 `scripts/seed.ts`，仅插入尚不存在的来源，不覆盖后台编辑。
- 每个来源首次最多回填 5 条，保持标题、摘要和原文链接的模式；不抓取或转载全文。来源的管理标签只表示采集入口，文章的细分赛道仍由现有内容分类和用户关注匹配决定。
- 将本次补充记录在 README、文档索引和 P1-04 日志链接中。P1-04 已有功能验收不因新增来源而改变；P4-04 仍需员工本人验收。

| 方向 | 新来源 |
|---|---|
| 新能源 | pv magazine；CleanTechnica Wind Energy |
| 新材料 | Nature Materials Science；ScienceDaily Materials Science |
| 先进制造 | ScienceDaily Robotics；3D Printing Industry |
| 战略配售 | 新时空新股；HKEX News Releases |

## 修改文件

- `industry/sources.json`
- `README.md`
- `docs/README.md`
- `docs/IMPLEMENTATION.md`
- 本日志

## 关键决定与最小验证

- 依据发布方公开的 RSS 入口选择来源；从生产服务器访问上述 8 个地址时，HTTP 均为 200 且响应为 RSS/XML。被服务器返回 400/403 的候选源未纳入。
- 将新增来源导入当前生产数据库，种子程序报告 `8 added, 18 already there`。随后逐一使用生产采集器强制试读，8 个来源均返回 `ok`，各创建 5 条首次回填记录，共 40 条。API/Web/Worker 容器未重建，现有文章和员工数据未清理。
- 使用现有 RSS 类型和字段，不增加依赖、抓取器或数据库迁移。新股和交易所公告只是战略配售的候选新闻入口，不能把一般 IPO 消息直接称为战略配售事件。
- 本地解析 `industry/sources.json` 共 26 个唯一 ID，新增 8 个；`node scripts/check-doc-links.ts` 检查 162 个本地 Markdown 链接全部存在；`git diff --check` 通过。未运行全量测试，也未验证各方向的业务相关性和日报分发效果。

## 风险与下一步

- 外部 RSS 可能更改地址、限制机器人或返回大量无关内容；需要观察采集错误和管理员审核文章分类。
- 员工需要在关注设置选中相应方向或细分赛道；个人日报按当天快照生成，新增来源后的已有日报不会自行改写。
