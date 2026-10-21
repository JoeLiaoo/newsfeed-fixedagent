import { useState, type FormEvent } from "react";
import { Link } from "react-router";

export default function RegisterPage() {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/membership/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), realName: form.get("realName"), password: form.get("password") }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error === "username_taken" ? "用户名已被使用。" : result.message ?? "注册失败，请检查填写内容。"); return; }
    setDone(true);
  }
  return <main className="mx-auto max-w-md px-5 py-12"><h1 className="text-2xl font-semibold">员工注册</h1>{done ? <section className="mt-6 rounded border p-4"><p>注册已提交，管理员审核通过后即可登录。</p><Link className="mt-3 inline-block text-red-700 underline" to="/login">返回登录</Link></section> : <form onSubmit={submit} className="mt-8 grid gap-4"><label className="grid gap-1">用户名<input name="username" minLength={3} maxLength={40} required autoComplete="username" className="rounded border p-3" /></label><label className="grid gap-1">真实姓名<input name="realName" minLength={2} maxLength={80} required className="rounded border p-3" /></label><label className="grid gap-1">密码（至少 12 位）<input name="password" type="password" minLength={12} maxLength={200} required autoComplete="new-password" className="rounded border p-3" /></label><button className="rounded bg-red-700 p-3 text-white">提交审核</button>{message && <p role="alert">{message}</p>}</form>}</main>;
}
