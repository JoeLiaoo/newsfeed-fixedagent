import assert from "node:assert/strict";
import { test } from "node:test";
import { autoApproveEnabled } from "../registration.ts";

test("the approval step is skipped only when the environment turns it on", () => {
  assert.equal(autoApproveEnabled({}), false, "an unset switch keeps the admin review");
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "" }), false);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "false" }), false);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "0" }), false);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "no" }), false);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "true" }), true);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "TRUE" }), true);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "1" }), true);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: "yes" }), true);
  assert.equal(autoApproveEnabled({ MEMBERSHIP_AUTO_APPROVE: " yes " }), true, "spaces and case do not matter");
});

test("the switch is read from the environment on every use", () => {
  const prior = process.env.MEMBERSHIP_AUTO_APPROVE;
  try {
    delete process.env.MEMBERSHIP_AUTO_APPROVE;
    assert.equal(autoApproveEnabled(), false);
    process.env.MEMBERSHIP_AUTO_APPROVE = "true";
    assert.equal(autoApproveEnabled(), true);
    process.env.MEMBERSHIP_AUTO_APPROVE = "false";
    assert.equal(autoApproveEnabled(), false);
  } finally {
    if (prior === undefined) delete process.env.MEMBERSHIP_AUTO_APPROVE;
    else process.env.MEMBERSHIP_AUTO_APPROVE = prior;
  }
});
