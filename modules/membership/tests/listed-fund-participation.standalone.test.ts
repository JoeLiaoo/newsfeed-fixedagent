import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_SLUGS, HTML_PREVIEW_EXPERT_SLUGS, LISTED_FUND_PARTICIPATION_EXPERT, LISTED_FUND_PARTICIPATION_EXPERT_SLUG } from "../experts/catalog.ts";
import {
  ANNOUNCEMENT_KEYWORDS,
  LISTED_ISSUER_SEED_SOURCE,
  buildListedFundReport,
  extractAnnouncementText,
  extractParticipationRows,
  fetchIssuerAnnouncements,
  lookupFundRegistrations,
  parseListedFundInput,
  renderListedFundHtml,
  renderListedFundMarkdown,
  resolveListedIssuers,
  type ListedAnnouncement,
} from "../experts/listed-fund-participation.ts";

test("listed-fund expert is a visible runnable builtin with employee-safe copy", () => {
  assert.equal(LISTED_FUND_PARTICIPATION_EXPERT_SLUG, "listed-fund-participation");
  assert.ok(BUILTIN_SLUGS.has(LISTED_FUND_PARTICIPATION_EXPERT_SLUG));
  assert.ok(HTML_PREVIEW_EXPERT_SLUGS.has(LISTED_FUND_PARTICIPATION_EXPERT_SLUG));
  assert.equal(LISTED_FUND_PARTICIPATION_EXPERT.version, "1.0.0");
  assert.match(LISTED_FUND_PARTICIPATION_EXPERT.skillMd, /不是全市场 LP 排名/);
  assert.doesNotMatch(`${LISTED_FUND_PARTICIPATION_EXPERT.description}\n${LISTED_FUND_PARTICIPATION_EXPERT.skillMd}`, /新华|巨潮|中基协|DeepSeek|cninfo|AMAC/i);
});

test("listed-fund inputs validate the region, dates, and stock-code pool", () => {
  const input = parseListedFundInput({ region: "浙江省", year: 2024, stockCodes: "600120, 600126" }, new Date("2026-10-26T00:00:00Z"));
  assert.equal(input.startDate, "2024-01-01");
  assert.equal(input.endDate, "2024-12-31");
  assert.deepEqual(input.stockCodes, ["600120", "600126"]);
  assert.throws(() => parseListedFundInput({ region: "浙江省", stockCodes: "60012x" }), /listed_fund_stock_code_invalid/);
  assert.throws(() => parseListedFundInput({ region: "浙江省", year: 1989 }), /listed_fund_year_invalid/);
  assert.throws(() => parseListedFundInput({ region: "浙江省", startDate: "2025-02-01", endDate: "2025-01-01" }), /listed_fund_date_range_invalid/);
});

test("region resolution discloses finite seed scope and refuses to invent a region universe", () => {
  const input = parseListedFundInput({ region: "浙江省" }, new Date("2026-10-26T00:00:00Z"));
  const result = resolveListedIssuers(input);
  assert.equal(result.issuers.length, 5);
  assert.match(LISTED_ISSUER_SEED_SOURCE, /不是完整地区名录/);
  assert.equal(resolveListedIssuers({ ...input, region: "四川省" }).issuers.length, 0);
  assert.match(resolveListedIssuers({ ...input, region: "四川省" }).gaps[0]!, /补充证券代码/);
});

test("announcement adapter maps fixture list records, applies title/date filters, and never requires live HTTP", async () => {
  const input = parseListedFundInput({ region: "浙江省", startDate: "2024-01-01", endDate: "2024-12-31", maxAnnouncements: 10 });
  const requests: URL[] = [];
  const fetchFixture: typeof fetch = async (url) => {
    const parsed = new URL(String(url)); requests.push(parsed);
    return new Response(JSON.stringify({ data: { total_pages: 1, list: [
      { title: "关于参与设立产业基金的公告", art_code: "a-1", notice_date: "2024-06-13 00:00:00" },
      { title: "关于参与设立产业基金的公告", art_code: "a-2", notice_date: "2025-01-02 00:00:00" },
      { title: "年度审计报告", art_code: "a-3", notice_date: "2024-06-13 00:00:00" },
    ] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { items } = await fetchIssuerAnnouncements({ code: "600120", name: "浙江东方集团股份有限公司", region: "杭州市" }, input, { fetch: fetchFixture });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.origin, "https://np-anotice-stock.eastmoney.com");
  assert.equal(requests[0]!.searchParams.get("stock_list"), "600120");
  assert.equal(requests[0]!.searchParams.get("page_index"), "1");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.date, "2024-06-13");
  assert.equal(items[0]!.announcementId, "a-1");
  assert.equal(items[0]!.url, "https://pdf.dfcfw.com/pdf/H2_a-1_1.pdf");
  assert.ok(ANNOUNCEMENT_KEYWORDS.some((keyword) => items[0]!.title.includes(keyword)));
});

test("announcement adapter separates empty results from list service failures", async () => {
  const input = parseListedFundInput({ region: "浙江省", year: 2024 });
  const issuer = { code: "600120", name: "浙江东方集团股份有限公司", region: "杭州市" };
  const empty = await fetchIssuerAnnouncements(issuer, input, { fetch: async () => new Response(JSON.stringify({ data: { list: [], total_pages: 0 } }), { status: 200 }) });
  assert.equal(empty.items.length, 0);
  assert.match(empty.gaps[0]!, /空列表.*不能确认不存在/);
  const failed = await fetchIssuerAnnouncements(issuer, input, { fetch: async () => new Response("", { status: 503 }) });
  assert.match(failed.gaps[0]!, /HTTP 503.*未能读取披露列表/);
});

test("PDF extraction accepts the configured disclosure hosts and rejects other hosts before fetching", async () => {
  const requested: string[] = [];
  const fetchFixture: typeof fetch = async (url) => { requested.push(String(url)); return new Response("", { status: 404 }); };
  await assert.rejects(extractAnnouncementText("https://pdf.dfcfw.com/pdf/H2_a-1_1.pdf", { fetch: fetchFixture }), /listed_fund_pdf_http_404/);
  await assert.rejects(extractAnnouncementText("https://static.cninfo.com.cn/a.pdf", { fetch: fetchFixture }), /listed_fund_pdf_http_404/);
  await assert.rejects(extractAnnouncementText("https://evil.example/a.pdf", { fetch: fetchFixture }), /listed_fund_pdf_url_invalid/);
  assert.equal(requested.length, 2);
});

test("fund master adapter accepts only exact normalized-name matches and reports no configured source", async () => {
  const absent = await lookupFundRegistrations(["杭州产业基金"]);
  assert.equal(absent.records.length, 0);
  assert.match(absent.gaps[0]!, /未配置/);
  const result = await lookupFundRegistrations(["杭州产业基金"], {
    endpoint: "https://gs.amac.org.cn/api/search",
    fetch: async () => new Response(JSON.stringify({ records: [
      { fundName: "杭州产业基金", registrationNumber: "F-001", managerName: "示例管理人" },
      { fundName: "杭州产业基金一期", registrationNumber: "F-002", managerName: "其他管理人" },
    ] }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(result.records.map((record) => record.registrationNumber), ["F-001"]);
});

test("participation parser keeps missing fields unknown, separates rows, and reports parsing gaps", () => {
  const issuer = { code: "600120", name: "浙江东方集团股份有限公司", region: "杭州市" };
  const announcements: ListedAnnouncement[] = [
    { issuer, title: "参与基金公告", date: "2024-06-13", url: "https://static.cninfo.com.cn/a.pdf", announcementId: "1", text: "公司拟作为有限合伙人参与杭州产业基金，认缴人民币 5000 万元。" },
    { issuer, title: "未解析公告", date: null, url: "https://static.cninfo.com.cn/b.pdf", announcementId: "2", text: null },
  ];
  const parsed = extractParticipationRows(announcements, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.role, "有限合伙人");
  assert.equal(parsed.rows[0]!.subscribedAmount, "人民币 5000 万元");
  assert.equal(parsed.rows[0]!.paidAmount, null);
  assert.equal(parsed.rows[0]!.registrationNumber, null);
  assert.match(parsed.gaps[0]!, /正文未解析/);
});

test("report HTML and Markdown retain coverage, gaps, and safe escaped text", () => {
  const input = parseListedFundInput({ region: "杭州市", year: 2024 }, new Date("2026-10-26T00:00:00Z"));
  const issuer = { code: "600120", name: "浙江东方 <集团>", region: "杭州市" };
  const report = buildListedFundReport(input, [issuer], [{ issuer, title: "参与基金公告", date: "2024-06-13", url: "https://static.cninfo.com.cn/a.pdf", announcementId: "1", text: "公司作为有限合伙人参与杭州产业基金。" }], [], ["备案主数据未提供"], "2026-10-26T00:00:00.000Z");
  const html = renderListedFundHtml(report);
  const markdown = renderListedFundMarkdown(report);
  assert.match(html, /&lt;集团&gt;/);
  assert.match(html, /不是全市场 LP 排名或完整工商穿透/);
  assert.match(html, /备案主数据未提供/);
  assert.match(markdown, /认缴/);
  assert.match(markdown, /浙江东方 &lt;集团&gt;/);
  assert.match(markdown, /不完整/);
});

test("report summaries count issuer and manager activity and only list shared funds across issuers", () => {
  const input = parseListedFundInput({ region: "浙江省", year: 2024 }, new Date("2026-10-26T00:00:00Z"));
  const issuers = [
    { code: "600120", name: "浙江东方集团股份有限公司", region: "杭州市" },
    { code: "600126", name: "杭州钢铁股份有限公司", region: "杭州市" },
  ];
  const announcements = issuers.map((issuer, index) => ({ issuer, title: `参与公告${index}`, date: "2024-06-13", url: `https://static.cninfo.com.cn/${index}.pdf`, announcementId: String(index), text: "公司作为有限合伙人参与杭州产业基金。" }));
  const report = buildListedFundReport(input, issuers, announcements, [{ fundName: "杭州产业基金", registrationNumber: "F-1", managerName: "杭州管理人", status: "在册" }], [], "2026-10-26T00:00:00.000Z");
  assert.equal(report.issuerHeat.length, 2);
  assert.deepEqual(report.managerHeat, [{ manager: "杭州管理人", count: 2 }]);
  assert.equal(report.coInvestFunds[0]!.issuerCount, 2);
  assert.match(renderListedFundMarkdown(report), /多家发行人共同参与/);
});
