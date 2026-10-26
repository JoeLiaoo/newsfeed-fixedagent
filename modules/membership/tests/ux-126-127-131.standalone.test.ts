import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expertsPage = readFileSync(new URL("../pages/experts.tsx", import.meta.url), "utf8");
const morePage = readFileSync(new URL("../../../apps/web/app/routes/more.tsx", import.meta.url), "utf8");

test("every expert card renders the catalog status badge without a slug exception", () => {
  assert.match(expertsPage, /const badge = expertStatusBadge\(expert\.status\)/);
  assert.match(expertsPage, /<Badge variant=\{badge\.variant\}>\{badge\.label\}<\/Badge>/);
  assert.doesNotMatch(expertsPage, /SECTOR_PEER_EXPERT_SLUG/);
  assert.doesNotMatch(expertsPage, /expert\.status !== "available"/);
});

test("the account page groups appearance, font, and logout under platform settings", () => {
  assert.match(morePage, /<Group title="平台设置">/);
  assert.match(morePage, /外观/);
  assert.match(morePage, /字体/);
  assert.match(morePage, /退出登录/);
  assert.doesNotMatch(morePage, /个人设置|settings\/profile/);
  assert.match(morePage, /"工具与入口"/);
});
