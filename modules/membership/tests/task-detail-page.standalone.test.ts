import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { artifactDownloadLabel, EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS, FRONTIER_PODCAST_EXPERT_SLUG, LISTED_FUND_PARTICIPATION_EXPERT_SLUG, PANORAMA_EXPERT_SLUG, SECTOR_PEER_EXPERT_SLUG } from "../experts/catalog.ts";

const moduleSource = readFileSync(new URL("../module.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/task-detail.tsx", import.meta.url), "utf8");
const expertDetail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
const tasksPage = readFileSync(new URL("../pages/tasks.tsx", import.meta.url), "utf8");
const artifactsPage = readFileSync(new URL("../pages/account-artifacts.tsx", import.meta.url), "utf8");
const expertsPage = readFileSync(new URL("../pages/experts.tsx", import.meta.url), "utf8");

test("the task detail page is registered on its own path", () => {
  assert.match(moduleSource, /\{\s*path:\s*"tasks",\s*file:\s*"pages\/tasks\.tsx"\s*\}/, "旧的任务记录地址仍在 /tasks");
  assert.match(moduleSource, /\{\s*path:\s*"tasks\/:id",\s*file:\s*"pages\/task-detail\.tsx"\s*\}/, "任务详情页注册在 /tasks/:id");
  assert.match(moduleSource, /\{\s*path:\s*"account\/artifacts",\s*file:\s*"pages\/account-artifacts\.tsx"\s*\}/, "任务与产物页注册在 /account/artifacts");
});

test("the employee task history pages through all of the logged-in employee's expert tasks", () => {
  assert.match(artifactsPage, /\/api\/v1\/membership\/expert-tasks\?/, "任务与产物页调用员工任务列表接口");
  assert.match(artifactsPage, /pagination: \{ limit: number; offset: number; hasMore: boolean; nextOffset: number \| null \}/, "读取服务端分页游标");
  assert.match(artifactsPage, /下一页/, "可以访问更早的任务");
  assert.match(artifactsPage, /返回专家平台/, "任务与产物页有返回专家平台入口");
  assert.match(artifactsPage, /上一页/, "可以返回较新的任务");
  assert.match(artifactsPage, /进行中/, "可以按状态筛选任务");
  assert.match(artifactsPage, /<IntentLink to=\{`\/tasks\/\$\{task\.id\}`\}/, "每条记录可打开任务详情");
  assert.match(artifactsPage, /查看任务/, "任务详情的入口写给员工看");
  assert.match(expertDetail, /IntentLink to="\/account\/artifacts"/, "专家页可以发现全部任务与产物");
  assert.match(expertsPage, /我的任务与产物/, "专家平台只有一个任务入口");
  assert.doesNotMatch(expertsPage, />任务记录</, "专家平台不再有第二个任务入口");
});

test("the old task list address lands on the task and artifact library", () => {
  assert.match(tasksPage, /redirect\(`\/account\/artifacts\$\{new URL\(request\.url\)\.search\}`\)/, "旧地址转到任务与产物页并带上分页参数");
});

test("the task page reads the one task it shows, and keeps the states of the employee flow", () => {
  assert.match(page, /\/api\/v1\/membership\/expert-tasks\/\$\{encodeURIComponent\(id \?\? ""\)\}/, "页面按任务编号读取单个任务");
  assert.match(page, /response\.status === 401/, "未登录回到登录页");
  assert.match(page, /location\.href = "\/login"/, "未登录回到登录页");
  assert.match(page, /response\.status === 404/, "任务不存在或已清理时显示空状态");
  assert.match(page, /正在加载任务/, "加载状态");
  assert.match(page, /任务加载失败，请重试。/, "读失败时给出可重试的提示");
  assert.match(page, /setInterval/, "任务进行中时定时刷新");
  for (const state of ["queued", "running", "waiting_input"]) assert.ok(page.includes(`"${state}"`), `进行中的状态 ${state} 会被刷新`);
  assert.match(page, /act\("retry"\)/, "失败后可重试");
  assert.match(page, /act\("cancel"\)/, "进行中可取消");
  assert.match(page, /\/entity`/, "等待选择主体时可确认主体");
  assert.match(page, /\/artifact`/, "可下载产物");
  assert.doesNotMatch(page, /\/checkpoint|下载采集台账/, "员工详情页不暴露内部采集台账");
  assert.match(page, /srcDoc=\{task\.result\.html\} sandbox=""/, "成功的全景任务显示隔离的 HTML 预览");
  assert.match(artifactsPage, /artifactDownloadLabel\(task\.expertSlug\)/, "列表按实际产物格式命名下载");
  assert.match(page, /artifactDownloadLabel\(task\.expertSlug\)/, "详情与列表使用相同格式文案");
  assert.match(page, /companyRelationLabel\(candidate, candidates, task\.result\?\.query/, "任务详情的主体选择复用相同的母公司／分支标签");
  assert.match(page, /\/materials\/\$\{material\.id\}/, "可下载材料");
  assert.match(page, /method: "DELETE"/, "任务结束后可删除材料");
  assert.match(page, /IntentLink to=\{`\/experts\//, "任务所属专家可回到专家页");
});

test("query expert input is visible on the task page without changing company tasks", () => {
  assert.match(page, /QUERY_EXPERT_SLUGS\.has\(task\.expertSlug\) \? task\.input\?\.query\?\.trim\(\)/);
  assert.match(page, /查询：\{query\}/);
  assert.match(page, /核查主体：\{task\.input\.companyName\}/);
  assert.match(page, /!task\.input\?\.companyName && !query && !task\.input\?\.region && !notes/, "有查询词、地区或任务要求时不能显示空输入");
  assert.equal(artifactDownloadLabel(SECTOR_PEER_EXPERT_SLUG), "下载 HTML 看板");
  for (const slug of [FRONTIER_PODCAST_EXPERT_SLUG, PANORAMA_EXPERT_SLUG, LISTED_FUND_PARTICIPATION_EXPERT_SLUG, "custom-expert"])
    assert.equal(artifactDownloadLabel(slug), "下载 Markdown 产物");
});

test("successful tasks read before metadata without an outer result card or fixed text scroll", () => {
  assert.ok(page.indexOf('aria-label="任务结果"') < page.indexOf('>任务信息</summary>'));
  assert.match(page, /srcDoc=\{task\.result\.html\} sandbox=""/);
  assert.doesNotMatch(page, /max-h-96/);
  assert.doesNotMatch(page, /<Card/);
  assert.match(page, /task\.result\?\.panorama\?\.incomplete/);
  assert.match(page, /IntentLink to="\/account\/artifacts"/);
});

test("the employee sees capability words, never the service or model behind the task", () => {
  const visible = `${page}\n${expertDetail}\n${Object.values(EXPERT_TASK_ERROR_LABELS).join("\n")}\n${Object.values(EXPERT_TASK_STAGE_LABELS).join("\n")}\n${Object.values(EXPERT_TASK_STATE_LABELS).join("\n")}`;
  assert.ok(!/悟道|新华财经|DeepSeek|BettaFish|微舆|wudao/i.test(visible), "员工界面不得出现供应商品牌名");
  assert.equal(EXPERT_TASK_STATE_LABELS.failed, "失败");
  assert.equal(EXPERT_TASK_STATE_LABELS.waiting_input, "等待选择主体");
  assert.equal(EXPERT_TASK_STATE_VARIANTS.succeeded, "success");
  assert.ok(EXPERT_TASK_STAGE_LABELS.choose_entity, "每个步骤都有员工看得懂的说明");
});

test("each task on the expert page opens its own page", () => {
  assert.match(expertDetail, /<IntentLink to=\{`\/tasks\/\$\{task\.id\}`\}>查看详情<\/IntentLink>/, "任务列表里每个任务都能打开详情页");
});
