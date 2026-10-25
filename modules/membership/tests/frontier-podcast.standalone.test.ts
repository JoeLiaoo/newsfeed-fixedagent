// The podcast expert: what the public library answers, what the report may claim, and what the
// article that shows in the task card is allowed to contain.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { collectPodcastEpisodes, createPodcastClient, PodcastSourceError, podcastSummaryUrl } from "../experts/bidclub.ts";
import { FRONTIER_PODCAST_EXPERT, FRONTIER_PODCAST_EXPERT_SLUG, HTML_PREVIEW_EXPERT_SLUGS, PANORAMA_EXPERT_SLUG, QUERY_EXPERT_SLUGS } from "../experts/catalog.ts";
import { renderFrontierPodcastHtml } from "../experts/frontier-podcast-html.ts";
import { renderFrontierPodcastMarkdown } from "../experts/frontier-podcast-markdown.ts";
import type { FrontierPodcastView } from "../experts/frontier-podcast-view.ts";
import type { PodcastEpisode } from "../experts/bidclub.ts";

const SEARCH_PAYLOAD = {
  q: "具身智能",
  count: 2,
  partial: true,
  searched_recent: 300,
  results: [
    {
      slug: "latetalk-182",
      title: "182: 对话梁琛奇",
      shows: { name: "晚点聊 LateTalk" },
      date: "2026-09-24",
      published_at: "2026-09-23T23:00:00+00:00",
      duration_min: 202,
      lang: "ZH",
      dek: "推理成本下降，AI 娱乐窗口已开启。",
      source_url: "https://podcast.latepost.com/182",
      source_label: "Podcast",
      chips: ["person:梁琛奇", "person:程曼祺"],
      tag_sectors: ["ai_software", "consumer"],
      tag_focus: ["company_building"],
    },
    { slug: "empty-record", title: "只有标题的一集", shows: { name: "十字路口" } },
  ],
};

const EPISODE_PAYLOAD = {
  slug: "latetalk-182",
  title: "182: 对话梁琛奇",
  shows: { name: "晚点聊 LateTalk" },
  date: "2026-09-24",
  published_at: "2026-09-23T23:00:00+00:00",
  duration_min: 202,
  lang: "ZH",
  lang_alt: "EN",
  dek: "推理成本下降，AI 娱乐窗口已开启。",
  source_url: "https://podcast.latepost.com/182",
  source_label: "Podcast",
  chips: ["person:梁琛奇", "person:程曼祺"],
  tag_sectors: ["ai_software", "consumer"],
  tag_focus: ["company_building", "technical"],
  tldr_md: "- **第一点要点。** 展开说明。",
  digest_md: "### 1. 小节标题\n- 摘要第一行。",
  tldr_md_alt: "- English points.",
  digest_md_alt: "### 1. English section",
};

/** The library as a stub: the search answers, and the episodes answer or fail as the test says. */
function stubFetch(episodes: Record<string, unknown>, search: Record<string, unknown> = SEARCH_PAYLOAD) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/api/v1/search")) return new Response(JSON.stringify(search), { status: 200, headers: { "content-type": "application/json" } });
    const slug = url.split("/api/v1/episodes/")[1] ?? "";
    const payload = episodes[slug];
    if (!payload) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function episode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    slug: "latetalk-182",
    title: "182: 对话梁琛奇",
    showName: "晚点聊 LateTalk",
    date: "2026-09-24",
    publishedAt: "2026-09-23T23:00:00+00:00",
    durationMin: 202,
    lang: "ZH",
    dek: "推理成本下降，AI 娱乐窗口已开启。",
    sourceUrl: "https://podcast.latepost.com/182",
    sourceLabel: "Podcast",
    tldr: "- **第一点要点。** 展开说明。",
    tldrLang: "ZH",
    digest: "### 1. 小节标题\n- 摘要第一行。",
    digestLang: "ZH",
    altLang: "EN",
    people: ["梁琛奇", "程曼祺"],
    sectors: ["人工智能与软件", "消费"],
    focus: ["公司建设", "技术"],
    ...overrides,
  };
}

function view(overrides: Partial<FrontierPodcastView> = {}): FrontierPodcastView {
  return {
    query: "具身智能",
    episodes: [episode()],
    partial: true,
    searchedRecent: 300,
    failed: 0,
    generatedAt: new Date("2026-10-26T04:00:00Z"),
    ...overrides,
  };
}

test("the library client reads the search and one episode as the service answered", async () => {
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({ "latetalk-182": EPISODE_PAYLOAD }) as typeof fetch });
  const search = await client.search("具身智能");
  assert.equal(search.count, 2);
  assert.equal(search.partial, true);
  assert.equal(search.searchedRecent, 300);
  assert.equal(search.matches[0]?.slug, "latetalk-182");
  assert.equal(search.matches[0]?.showName, "晚点聊 LateTalk");
  assert.equal(search.matches[1]?.durationMin, null, "a field the service did not send stays missing");
  const read = await client.episode("latetalk-182");
  assert.equal(read.tldrLang, "ZH");
  assert.equal(read.tldr, "- **第一点要点。** 展开说明。");
  assert.equal(read.digestLang, "ZH");
  assert.deepEqual(read.people, ["梁琛奇", "程曼祺"]);
  assert.deepEqual(read.sectors, ["人工智能与软件", "消费"]);
  assert.deepEqual(read.focus, ["公司建设", "技术"]);
});

test("an episode without a Chinese text keeps the language it does have", async () => {
  // The library keeps the text of an episode in `lang` and the other language in `lang_alt`.
  const englishOnly = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({ "en-only": { ...EPISODE_PAYLOAD, slug: "en-only", lang: "EN", lang_alt: null, tldr_md: "- English points.", tldr_md_alt: null, digest_md: "### English", digest_md_alt: null } }) as typeof fetch });
  const read = await englishOnly.episode("en-only");
  assert.equal(read.tldrLang, "EN");
  assert.equal(read.tldr, "- English points.");
  assert.equal(read.digestLang, "EN");

  // A record whose Chinese text sits in the alternate field is read as Chinese.
  const chineseAlternate = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({ "alt-zh": { ...EPISODE_PAYLOAD, slug: "alt-zh", lang: "EN", lang_alt: "ZH", tldr_md: "- English points.", tldr_md_alt: "- 中文要点。" } }) as typeof fetch });
  const alternate = await chineseAlternate.episode("alt-zh");
  assert.equal(alternate.tldrLang, "ZH");
  assert.equal(alternate.tldr, "- 中文要点。");
});

test("a Chinese topic also finds English-source episodes through the English search", async () => {
  const queries: string[] = [];
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: (async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/search") {
      const query = url.searchParams.get("q")!;
      queries.push(query);
      const results = query === "具身智能"
        ? [{ slug: "zh", title: "具身智能访谈", lang: "ZH" }, { slug: "shared", title: "共同命中", lang: "ZH" }]
        : [{ slug: "shared", title: "共同命中", lang: "ZH" }, { slug: "en", title: "Embodied AI", lang: "EN" }];
      return Response.json({ count: results.length, results, partial: true, searched_recent: 300 });
    }
    const slug = url.pathname.split("/").at(-1)!;
    return Response.json({ ...EPISODE_PAYLOAD, slug, lang: slug === "en" ? "EN" : "ZH", lang_alt: slug === "en" ? "ZH" : "EN",
      tldr_md: slug === "en" ? "- English points." : "- 中文要点。", tldr_md_alt: slug === "en" ? "- 中文要点。" : "- English points.",
      digest_md: slug === "en" ? "English digest." : "中文摘要。", digest_md_alt: slug === "en" ? "中文摘要。" : "English digest.",
      dek: slug === "en" ? "English introduction" : "中文导语。" });
  }) as typeof fetch });
  const collected = await collectPodcastEpisodes("具身智能", { client });
  assert.deepEqual(queries, ["具身智能", "embodied intelligence"]);
  assert.deepEqual(collected.episodes.map(item => item.slug), ["zh", "en", "shared"]);
  assert.equal(collected.count, 3, "a shared slug is deduplicated");
  const english = collected.episodes[1]!;
  assert.equal(english.tldr, "- 中文要点。");
  assert.equal(english.digest, "中文摘要。");
  const report = view({ episodes: [english], queries: collected.queries });
  for (const rendered of [renderFrontierPodcastHtml(report), renderFrontierPodcastMarkdown(report)]) {
    assert.ok(rendered.includes("公开播客文字库中文版"));
    assert.ok(rendered.includes("中文要点"));
    assert.ok(rendered.includes("中文摘要"));
    assert.ok(!rendered.includes("English points."));
    assert.ok(!rendered.includes("English digest."));
    assert.ok(!rendered.includes("English introduction"));
  }
});

test("English-source episodes without a Chinese edition are skipped for Chinese-backed results", async () => {
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({
    "en-only": { ...EPISODE_PAYLOAD, slug: "en-only", lang: "EN", lang_alt: null, tldr_md_alt: null, digest_md_alt: null },
    "zh-next": { ...EPISODE_PAYLOAD, slug: "zh-next", lang: "ZH" },
  }, { ...SEARCH_PAYLOAD, results: [{ slug: "en-only", lang: "EN" }, { slug: "zh-next", lang: "ZH" }] }) as typeof fetch });
  const collected = await collectPodcastEpisodes("具身智能", { client });
  assert.deepEqual(collected.episodes.map(item => item.slug), ["zh-next"]);
  assert.equal(collected.skippedWithoutChinese, 1);
  const markdown = renderFrontierPodcastMarkdown(view({ episodes: collected.episodes, skippedWithoutChinese: collected.skippedWithoutChinese }));
  assert.ok(!markdown.includes("缺少中文正文，未收录"), "employee output omits search coverage warnings");
});

test("an English query searches Chinese too, and a failed expansion stays internal", async () => {
  const calls: string[] = [];
  const client = {
    search: async (term: string) => {
      calls.push(term);
      if (term === "具身智能") throw new PodcastSourceError("podcast_source_unavailable");
      return { matches: [{ slug: "en", title: "Embodied AI", showName: null, date: null, publishedAt: null, durationMin: null, lang: "EN", dek: null, sourceUrl: null, sourceLabel: null }], count: 1, partial: true, searchedRecent: 300 };
    },
    episode: async () => episode({ slug: "en", lang: "EN", tldrLang: "ZH", digestLang: "ZH" }),
  };
  const collected = await collectPodcastEpisodes("embodied intelligence", { client });
  assert.deepEqual(calls, ["embodied intelligence", "具身智能"]);
  assert.equal(collected.searchFailed, true);
  assert.equal(collected.episodes.length, 1);
  const markdown = renderFrontierPodcastMarkdown(view({ episodes: collected.episodes, queries: collected.queries, searchFailed: true }));
  assert.ok(!markdown.includes("部分扩展检索失败"));
  assert.ok(!markdown.includes("结果不完整"));
});

test("a query the library refuses is an error, not an empty report", async () => {
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({}) as typeof fetch });
  await assert.rejects(() => client.search("短"), (error: unknown) => error instanceof PodcastSourceError && error.code === "podcast_query_invalid");
  await assert.rejects(() => client.search("x".repeat(200)), (error: unknown) => error instanceof PodcastSourceError && error.code === "podcast_query_invalid");
  await assert.rejects(() => client.episode("missing"), (error: unknown) => error instanceof PodcastSourceError && error.code === "podcast_episode_missing");
});

test("Personal AI and recursive self improvement use the existing query expansion path", async () => {
  const searched: string[] = [];
  const client = {
    async search(query: string) { searched.push(query); return { matches: [], count: 0, partial: true, searchedRecent: 300 }; },
    async episode() { throw new Error("no episodes expected"); },
  };
  for (const query of ["Personal AI", "recursive self improvement"]) {
    let expanded = 0;
    await collectPodcastEpisodes(query, { client, expandQuery: async () => { expanded += 1; return ["模型扩展词"]; } });
    assert.equal(expanded, 1, `${query} invokes the existing expansion callback`);
  }
  assert.deepEqual(searched, ["Personal AI", "模型扩展词", "recursive self improvement", "模型扩展词"]);
});

test("all usable matches are included and an unreadable episode is counted, not silently dropped", async () => {
  const many = { ...SEARCH_PAYLOAD, count: 10, results: Array.from({ length: 10 }, (_, index) => ({ slug: `ep-${index}`, title: `第 ${index} 集`, shows: { name: "节目" } })) };
  const episodes = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`ep-${index}`, { ...EPISODE_PAYLOAD, slug: `ep-${index}` }]));
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch(episodes, many) as typeof fetch });
  const collection = await collectPodcastEpisodes("具身智能", { client });
  assert.equal(collection.episodes.length, 10, "there is no six-episode product cap");
  assert.equal(collection.partial, true);
  assert.equal(collection.failed, 0);

  const withGap = { ...many, results: [{ slug: "gone", title: "读不到的一集", shows: { name: "节目" } }, { slug: "ep-0", title: "第一集", shows: { name: "节目" } }] };
  const gapped = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch(episodes, withGap) as typeof fetch });
  const partial = await collectPodcastEpisodes("具身智能", { client: gapped });
  assert.equal(partial.episodes.length, 1);
  assert.equal(partial.failed, 1, "a missing episode is counted so the report can say so");
  assert.equal(partial.failureCode, "podcast_episode_missing", "the reason travels with the result");
});

test("a library that matches nothing is an empty topic, not a broken source", async () => {
  const client = createPodcastClient({ baseUrl: "https://podcasts.example", fetchImpl: stubFetch({}, { q: "x", count: 0, results: [], partial: true, searched_recent: 300 }) as typeof fetch });
  const collection = await collectPodcastEpisodes("毫无相关", { client });
  assert.equal(collection.episodes.length, 0);
  assert.equal(collection.failed, 0);
  assert.equal(collection.failureCode, null, "nothing was read, so nothing failed");
});

test("the expert is a runnable builtin that takes a topic, not an entity", () => {
  assert.equal(FRONTIER_PODCAST_EXPERT_SLUG, "frontier-podcast");
  assert.equal(FRONTIER_PODCAST_EXPERT.name, "前沿播客");
  assert.deepEqual(FRONTIER_PODCAST_EXPERT.missingDependencies, []);
  assert.ok(QUERY_EXPERT_SLUGS.has(FRONTIER_PODCAST_EXPERT_SLUG));
  assert.ok(HTML_PREVIEW_EXPERT_SLUGS.has(FRONTIER_PODCAST_EXPERT_SLUG));
  assert.ok(HTML_PREVIEW_EXPERT_SLUGS.has(PANORAMA_EXPERT_SLUG));
  assert.match(FRONTIER_PODCAST_EXPERT.skillMd, /未提供/);
  assert.doesNotMatch(FRONTIER_PODCAST_EXPERT.skillMd, /结果不完整|检索回退到最近/);
});

test("the article reads as one article: masthead, lead, callouts, contents, sections, closing note", () => {
  const html = renderFrontierPodcastHtml(view());
  for (const part of [
    "ra-hero", "ra-hero__eyebrow", "ra-hero__title", "ra-hero__subtitle", "ra-hero__meta",
    "ra-lead", "ra-toc", "ra-toc__list", "ra-section", "ra-section__index", "ra-section__title",
    "ra-quote", "ra-subsection__title", "ra-conclusion", "ra-colophon",
  ]) assert.ok(html.includes(part), part);
  assert.ok(html.includes("前沿播客"));
  assert.ok(html.includes("具身智能"));
  assert.ok(html.includes("晚点聊 LateTalk"));
  assert.ok(html.includes('href="#ep-1"'), "the contents page links to the episode");
  assert.ok(html.includes('id="ep-1"'));
  assert.ok(html.includes("<strong>第一点要点。</strong>"), "the library's bold lead-in is kept");
  assert.ok(html.includes("小节标题"));
  assert.ok(!html.includes("结果不完整"), "a partial-search warning is not shown to employees");
  assert.ok(!html.includes("最近 300 集"));
  assert.ok(!html.includes("检索回退到"));
  assert.ok(!html.includes("匹配结果限制"));
  assert.ok(!html.includes("<strong>范围</strong>"), "the hero has no completeness scope chip");
  assert.ok(html.includes("https://podcast.latepost.com/182"));
  assert.ok(html.includes(podcastSummaryUrl("https://bidclub.ai", "latetalk-182")));
});

test("the article is self-contained: no script, no outside stylesheet, font or image", () => {
  const html = renderFrontierPodcastHtml(view({ episodes: [episode({ title: '<script>alert("x")</script> & "危险"' })] }));
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!/@import/i.test(html));
  assert.ok(!/url\(/i.test(html), "no remote resource is fetched");
  assert.ok(!/\son[a-z]+=/i.test(html), "no inline event handler");
  assert.ok(html.includes("default-src 'none'; style-src 'unsafe-inline'"));
  assert.ok(html.includes("&lt;script&gt;"), "a title that carries markup is escaped, not executed");
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;"));
});

test("the article carries the press theme's tokens rather than a look of its own", () => {
  const html = renderFrontierPodcastHtml(view());
  for (const token of ["--ra-color-bg:#fbf7ee", "--ra-color-accent:#7b1e22", "--ra-color-text:#211e18", "--ra-font-body", "--ra-space-7", "--ra-measure:46rem"]) {
    assert.ok(html.includes(token), token);
  }
  assert.ok(html.includes('data-theme="press"'));
});

test("an article without a readable episode says so instead of showing an empty digest", () => {
  const html = renderFrontierPodcastHtml(view({ episodes: [], failed: 2 }));
  assert.ok(html.includes("没有可展示的节目"));
  assert.ok(html.includes("另有 2 集读取失败未收录"));
  assert.ok(!html.includes('href="#ep-1"'), "an empty result has no contents page");
});

test("the Markdown product keeps the full text and source without search warnings", () => {
  const markdown = renderFrontierPodcastMarkdown(view({ episodes: [episode({ digest: "- ".padEnd(25_000, "长") })] }));
  assert.ok(markdown.startsWith("# 前沿播客 · 具身智能"));
  assert.ok(markdown.includes("## 1. 182: 对话梁琛奇"));
  assert.ok(markdown.includes("- 来源：Podcast · https://podcast.latepost.com/182"));
  assert.ok(markdown.includes("- 参与者：梁琛奇、程曼祺"));
  assert.ok(markdown.includes("### 要点"));
  assert.ok(markdown.includes("### 摘要"));
  assert.ok(!markdown.includes("结果不完整"));
  assert.ok(!markdown.includes("检索回退到"));
  assert.ok(!markdown.includes("匹配结果限制"));
  assert.ok(markdown.includes("不构成投资建议"));
});

test("the task card shows the podcast article in the same sandboxed frame as the sector dashboard", () => {
  const detail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
  assert.ok(detail.includes('srcDoc={task.result.html} sandbox=""'));
  assert.ok(detail.includes("HTML_PREVIEW_EXPERT_SLUGS.has(task.expertSlug)"));
  assert.ok(detail.includes('task.expertSlug === PANORAMA_EXPERT_SLUG ? "全景图报告"'));
  assert.ok(detail.includes("podcast_query_required"));
  assert.ok(!detail.includes("检索回退到最近若干集"), "the task card does not show a partial-search alert");
});
