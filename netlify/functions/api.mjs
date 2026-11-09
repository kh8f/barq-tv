// دالة Netlify: بيانات الموقع + الدخول + الحفظ + النسخ + فحص الروابط + الإحصائيات + المراقبة
import { store, clean, json, sleep, safeEq, makeToken, isAuthed, loginGuard, pushVersion, currentData, SEED } from "../lib/common.mjs";
import { runMonitor, getReport, sendTelegram } from "../lib/monitor.mjs";

export const config = { path: "/api/*" };

const MAX_BODY = 300_000;
const readJson = async req => {
  const t = await req.text();
  if (t.length > MAX_BODY) throw Object.assign(new Error("الحجم كبير"), { status: 413 });
  try { return JSON.parse(t || "{}"); } catch { throw Object.assign(new Error("صيغة JSON غير صحيحة"), { status: 400 }); }
};
const needAuth = req => { if (!isAuthed(req)) throw Object.assign(new Error("انتهت الجلسة، سجّل دخول من جديد"), { status: 401 }); };

/* ---------- فحص الروابط ---------- */
const blockedHost = h => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1)/.test(h);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const ft = (u, o, ms) => fetch(u, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en" }, ...o, signal: AbortSignal.timeout(ms) });
async function checkOne(u) {
  let x;
  try { x = new URL(u); } catch { return { url: u, state: "bad", note: "رابط غير صحيح" }; }
  if (!/^https?:$/.test(x.protocol) || blockedHost(x.hostname)) return { url: u, state: "bad", note: "رابط غير مسموح" };
  try {
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(x.hostname)) {
      const r = await ft("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(u), {}, 4500);
      if (r.ok) return { url: u, state: "ok", note: "الفيديو شغال" };
      if ([400, 401, 403, 404].includes(r.status)) return { url: u, state: "bad", note: "الفيديو محذوف أو خاص" };
      return { url: u, state: "warn", note: "ما قدرت أتأكد (" + r.status + ")" };
    }
    let r = await ft(u, { method: "HEAD" }, 4000).catch(() => null);
    if (!r || [0, 400, 403, 405, 501].includes(r.status) || r.status >= 500) {
      r?.body?.cancel?.();
      r = await ft(u, { method: "GET", headers: { "user-agent": UA, range: "bytes=0-0" } }, 4000);
    }
    r.body?.cancel?.();
    const s = r.status;
    if (s < 400) return { url: u, state: "ok", status: s, note: "شغال" };
    if ([401, 403, 429, 999].includes(s)) return { url: u, state: "warn", status: s, note: "الموقع يمنع الفحص الآلي (غالبًا شغال)" };
    if (s === 404 || s === 410) return { url: u, state: "bad", status: s, note: "الصفحة غير موجودة (" + s + ")" };
    return { url: u, state: s >= 500 ? "bad" : "warn", status: s, note: "حالة " + s };
  } catch (e) {
    return { url: u, state: "bad", note: e?.name === "TimeoutError" ? "انتهت المهلة" : "لا يمكن الوصول للموقع" };
  }
}
async function checkLinks(urls) {
  const list = [...new Set(urls.map(u => String(u).trim()).filter(Boolean))].slice(0, 80);
  const deadline = new Promise(r => setTimeout(() => r("t"), 9000));
  const out = await Promise.all(list.map(u => Promise.race([checkOne(u), deadline.then(() => ({ url: u, state: "bad", note: "انتهت المهلة" }))])));
  return out;
}

/* ---------- إحصائيات خفيفة (بدون بيانات شخصية) ---------- */
const clip = (v, n = 40) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
async function track(b) {
  const st = store();
  const s = (await st.get("stats", { type: "json" }).catch(() => null)) || { since: new Date().toISOString(), total: 0, views: {}, clicks: {}, days: {} };
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  if (b.t === "view") {
    const d = clip(b.d) || "unknown";
    if (Object.keys(s.views).length < 60 || d in s.views) s.views[d] = (s.views[d] || 0) + 1;
    s.total++; s.days[day] = (s.days[day] || 0) + 1;
    for (const k of Object.keys(s.days).sort().slice(0, -60)) delete s.days[k];
  } else if (b.t === "click") {
    const k = clip(b.d) + "|" + clip(b.b, 60);
    if (Object.keys(s.clicks).length < 300 || k in s.clicks) s.clicks[k] = (s.clicks[k] || 0) + 1;
  } else return;
  await st.setJSON("stats", s);
}

/* ---------- المسارات ---------- */
export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const st = store();

  try {
    if (path === "/api/data" && req.method === "GET") {
      const d = await currentData(st);
      if (!d.updatedAt) d.updatedAt = SEED.updatedAt || "";
      return json(d);
    }

    if (path === "/api/track" && req.method === "POST") {
      await track(await readJson(req)).catch(() => {});
      return json({ ok: true });
    }

    if (path === "/api/login" && req.method === "POST") {
      if (!PASSWORD) return json({ error: "ما تم ضبط ADMIN_PASSWORD في إعدادات Netlify" }, 500);
      const g = await loginGuard(req);
      if (g.locked) return json({ error: `محاولات كثيرة، جرّب بعد ${g.locked} دقيقة` }, 429);
      const { password } = await readJson(req).catch(() => ({}));
      if (!safeEq(password ?? "", PASSWORD)) { await g.fail(); await sleep(700); return json({ error: "الباسورد غلط" }, 401); }
      await g.ok();
      return json({ ok: true, token: makeToken() });
    }

    /* ---- كل اللي تحت يحتاج تسجيل دخول ---- */
    if (path === "/api/save" && req.method === "POST") {
      needAuth(req);
      const next = clean(await readJson(req));
      if (!next.cards.length) return json({ error: "لازم يبقى كارت واحد على الأقل" }, 400);
      const cur = await currentData(st);
      const strip = o => JSON.stringify({ ...o, updatedAt: "" });
      if (strip(cur) !== strip(next)) await pushVersion(st, cur);
      next.updatedAt = new Date().toISOString();
      await st.setJSON("data", next);
      return json({ ok: true, data: next });
    }

    if (path === "/api/versions" && req.method === "GET") {
      needAuth(req);
      const { blobs } = await st.list({ prefix: "versions/" });
      const items = [];
      for (const k of blobs.map(b => b.key).sort().reverse()) {
        const v = await st.get(k, { type: "json" }).catch(() => null);
        if (v?.data) items.push({ id: k.slice(9), savedAt: v.savedAt, cards: v.data.cards.length, buttons: v.data.cards.reduce((t, c) => t + c.buttons.length, 0) });
      }
      return json({ items });
    }

    if (path === "/api/restore" && req.method === "POST") {
      needAuth(req);
      const { id } = await readJson(req);
      if (!/^\d{15}$/.test(String(id))) return json({ error: "رقم نسخة غير صحيح" }, 400);
      const v = await st.get("versions/" + id, { type: "json" }).catch(() => null);
      if (!v?.data) return json({ error: "النسخة غير موجودة" }, 404);
      await pushVersion(st, await currentData(st));
      const data = clean(v.data); data.updatedAt = new Date().toISOString();
      await st.setJSON("data", data);
      return json({ ok: true, data });
    }

    if (path === "/api/reset" && req.method === "POST") {
      needAuth(req);
      await pushVersion(st, await currentData(st));
      const data = clean(SEED); data.updatedAt = new Date().toISOString();
      await st.setJSON("data", data);
      return json({ ok: true, data });
    }

    if (path === "/api/check-links" && req.method === "POST") {
      needAuth(req);
      const { urls } = await readJson(req);
      return json({ results: await checkLinks(Array.isArray(urls) ? urls : []) });
    }

    if (path === "/api/stats" && req.method === "GET") {
      needAuth(req);
      return json((await st.get("stats", { type: "json" }).catch(() => null)) || { since: "", total: 0, views: {}, clicks: {}, days: {} });
    }

    if (path === "/api/monitor") {
      needAuth(req);
      if (req.method === "GET") return json({ report: await getReport(), telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
      if (req.method === "POST") {
        const b = await readJson(req).catch(() => ({}));
        if (b.test) { const t = await sendTelegram("✅ اختبار: تنبيهات MASOUB STORE شغالة."); return json(t, t.ok ? 200 : 400); }
        return json({ report: await runMonitor({ notify: false }), telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
      }
    }

    return json({ error: "غير موجود" }, 404);
  } catch (e) {
    return json({ error: e.status ? e.message : "صار خطأ في السيرفر" }, e.status || 500);
  }
};
