// The 播客 chip keeps the category key tip. A source tagged 播客 is always tip; tip on any other
// source is the old tutorial bucket and is published as opinion. These checks do not touch a database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { normalizeStructure } from "@aihot/backend/editorial/analyze";
import { buildMaterial, type AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { CATEGORY_GUIDE, resolvePublishedCategory } from "@aihot/backend/editorial/vocabulary";

const PODCAST_SOURCES = ["json-bidclub", "rss-overseas-unicorn", "rss-latepost-talk"] as const;

function article(tags: string[]): AnalyzeInputArticle {
  return {
    id: "episode",
    revision: 1,
    title: "A conversation about models",
    url: "https://example.org/episode",
    author: null,
    publishedAt: null,
    bodyText: "This episode discusses a model release and a financing round.",
    excerpt: null,
    xPost: null,
    media: [],
    source: { name: "Fixture", kind: "json_list", tier: "T2", firstParty: false, tags },
  };
}

test("the tip chip is labeled 播客 and the seeded podcast sources carry that source tag", async () => {
  assert.equal(CATEGORY_LABELS.tip, "播客");
  assert.equal(CATEGORY_LABELS.opinion, "观点");
  const sources = JSON.parse(await readFile(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
    sources: { id: string; tags?: string[] }[];
  };
  for (const id of PODCAST_SOURCES) {
    const source = sources.sources.find((row) => row.id === id);
    assert.ok(source, id);
    assert.ok(source.tags?.includes("播客"), id);
  }
});

test("a 播客 source is published as tip and keeps topic and entity tags", () => {
  assert.deepEqual(
    resolvePublishedCategory("industry", ["行业动态", "人工智能", "entity:openai"], ["播客", "投研"]),
    { category: "tip", tags: ["播客", "人工智能", "entity:openai"] },
  );
  assert.deepEqual(resolvePublishedCategory(null, [], ["播客"]), { category: "tip", tags: ["播客"] });
});

test("tip on a source that is not a podcast is published as opinion and keeps 教程/实践", () => {
  assert.deepEqual(
    resolvePublishedCategory("tip", ["教程/实践", "entity:openai"], ["官方", "教程"]),
    { category: "opinion", tags: ["教程/实践", "entity:openai"] },
  );
  assert.deepEqual(resolvePublishedCategory("ai-products", ["产品更新"], ["官方", "教程"]), {
    category: "ai-products",
    tags: ["产品更新"],
  });
});

test("structure normalization applies the same rule the model cannot override", () => {
  const podcast = normalizeStructure(
    { scope: "single", category: "industry", tags: ["行业动态"], subjects: [], fact: null },
    article(["播客"]),
  );
  assert.equal(podcast.category, "tip");
  assert.equal(podcast.tags[0], "播客");
  assert.ok(!podcast.tags.includes("行业动态"));

  const tutorial = normalizeStructure(
    { scope: "single", category: "tip", tags: ["教程/实践"], subjects: [], fact: null },
    article(["官方", "教程"]),
  );
  assert.equal(tutorial.category, "opinion");
  assert.ok(tutorial.tags.includes("教程/实践"));
  assert.ok(!tutorial.tags.includes("播客"));
});

test("the structure step is told the source tags and the new category boundaries", async () => {
  assert.match(buildMaterial(article(["播客"])), /来源标签：播客/);
  assert.match(CATEGORY_GUIDE, /tip（播客）/);
  assert.match(CATEGORY_GUIDE, /教程、提示词、工具用法、工程复盘和技术讲解归观点/);
  const prompt = await readFile(new URL("../industry/prompts/structure.md", import.meta.url), "utf8");
  assert.match(prompt, /不归 tip/);
  assert.match(prompt, /来源标签含「播客」/);
  assert.doesNotMatch(prompt, /归教程/);
});
