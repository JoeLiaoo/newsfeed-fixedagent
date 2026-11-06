import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loginPendingMessage, registerDescription, registerResultMessage, registerSubmitLabel } from "../registration.ts";
import { memberSessionCookie, sessionCookieIsSecure } from "../session-cookie.ts";

test("the member session is Secure only when the site address is https", () => {
  const site = process.env.SITE_URL;
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.SITE_URL = "http://10.236.133.2";
  assert.equal(sessionCookieIsSecure(), false);
  assert.equal(memberSessionCookie("token", 60).includes("Secure"), false);
  process.env.SITE_URL = "https://intranet.example/";
  assert.equal(sessionCookieIsSecure(), true);
  assert.match(memberSessionCookie("a b", 0), /Secure$/);
  process.env.SITE_URL = "HTTPS://intranet.example";
  assert.equal(sessionCookieIsSecure(), true);
  delete process.env.SITE_URL;
  assert.equal(sessionCookieIsSecure(), false);
  if (site === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = site;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
});

test("register and login copy follow the approval switch", () => {
  assert.equal(registerDescription(true), "注册后即可登录。");
  assert.equal(registerDescription(false), "提交后由管理员审核账号。");
  assert.equal(registerSubmitLabel(true), "注册");
  assert.equal(registerSubmitLabel(false), "提交审核");
  assert.equal(registerResultMessage("active"), "注册成功，请使用用户名和密码登录。");
  assert.equal(registerResultMessage("pending"), "注册已提交，管理员审核通过后即可登录。");
  assert.equal(loginPendingMessage(true), "账号尚未开通，请联系管理员。");
  assert.equal(loginPendingMessage(false), "账号等待管理员审核。");
  const register = readFileSync(new URL("../pages/register.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../pages/login.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../module.ts", import.meta.url), "utf8");
  assert.match(register, /registerDescription/);
  assert.match(login, /loginPendingMessage/);
  assert.equal(register.includes("提交后由管理员审核账号"), false);
  assert.equal(register.includes("注册已提交，管理员审核通过后即可登录"), false);
  assert.match(routes, /path: "register", file: "pages\/register.tsx"/);
});
