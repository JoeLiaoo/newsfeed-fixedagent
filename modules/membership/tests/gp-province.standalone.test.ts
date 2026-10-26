import assert from "node:assert/strict";
import {test} from "node:test";
import {provinceFromAddress} from "../gp/province.ts";

test("province helper returns only an unambiguous provincial-level region",()=>{
  assert.equal(provinceFromAddress("江苏省苏州市工业园区"),"江苏省");
  assert.equal(provinceFromAddress("内蒙古自治区呼和浩特市"),"内蒙古自治区");
  assert.equal(provinceFromAddress("苏州市工业园区"),null);
  assert.equal(provinceFromAddress("江苏省与浙江省"),null);
  assert.equal(provinceFromAddress(null),null);
});
