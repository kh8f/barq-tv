// دالة Netlify: تقرأ وتحفظ بيانات الموقع في Netlify Blobs (تحديث فوري بدون إعادة نشر)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import SEED from "./seed.mjs";

export const config = { path: ["/api/data", "/api/login", "/api/save"] };

const str = (v, n) => String(v ?? "").trim().slice(0, n);
const url = v => { v = str(v, 500); return /^https?:\/\//i.test(v) ? v : ""; };
const icon = v => { v = str(v, 60); return /^fa-(solid|brands|regular) fa-[a-z0-9-]+$/.test(v) ? v : "fa-solid fa-tv"; };
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function clean(d) {
  d = d || {};
  return {
    brand: str(d.brand, 60), title: str(d.title, 100), subtitle: str(d.subtitle, 200), footer: str(d.footer, 200),
    cards: arr(d.cards, 40).map(c => ({
      badge: str(c.badge, 40), tag: str(c.tag, 30), icon: icon(c.icon), title: str(c.title, 100), notice: str(c.notice, 300),
      steps: arr(c.steps, 20).map(s => str(s, 300)).filter(Boolean),
      servers: arr(c.servers, 20).map(s => ({ label: str(s.label, 60), value: str(s.value, 80) })).filter(s => s.label || s.value),
      buttons: arr(c.buttons, 20).map(b => ({ text: str(b.text, 60), url: url(b.url), type: ["download", "video", "link"].includes(b.type) ? b.type : "link" })).filter(b => b.text)
    }))
  };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export default async (req) => {
  const path = new URL(req.url).pathname;
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const store = () => getStore({ name: "masoub-site", consistency: "strong" });

  try {
    if (path === "/api/data" && req.method === "GET") {
      let d = null;
      try { d = await store().get("data", { type: "json" }); } catch { /* نرجع للبيانات الأساسية */ }
      return json(clean(d || SEED));
    }

    if (path === "/api/login" && req.method === "POST") {
      if (!PASSWORD) return json({ error: "ما تم ضبط ADMIN_PASSWORD في إعدادات Netlify" }, 500);
      const { password } = await req.json().catch(() => ({}));
      if (!safeEq(password ?? "", PASSWORD)) { await sleep(700); return json({ error: "الباسورد غلط" }, 401); }
      return json({ ok: true });
    }

    if (path === "/api/save" && req.method === "POST") {
      if (!PASSWORD) return json({ error: "ما تم ضبط ADMIN_PASSWORD في إعدادات Netlify" }, 500);
      if (!safeEq(req.headers.get("x-pw") ?? "", PASSWORD)) { await sleep(700); return json({ error: "الباسورد غلط" }, 401); }
      const data = clean(await req.json());
      await store().setJSON("data", data);
      return json({ ok: true, data });
    }

    return json({ error: "غير موجود" }, 404);
  } catch (e) {
    return json({ error: "صار خطأ في السيرفر" }, 500);
  }
};
