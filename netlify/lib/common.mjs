import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import SEED from "../functions/seed.mjs";

export { SEED };
// (globalThis.__MASOUB_STORE__ تستخدم للاختبار المحلي فقط)
export const store = () => globalThis.__MASOUB_STORE__ || getStore({ name: "masoub-site", consistency: "strong" });

/* ---------- تنظيف البيانات ---------- */
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const url = v => { v = str(v, 500); return /^https?:\/\/\S+$/i.test(v) ? v : ""; };
const icon = v => { v = str(v, 60); return /^fa-(solid|brands|regular) fa-[a-z0-9-]+$/.test(v) ? v : "fa-solid fa-tv"; };
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export function clean(d) {
  d = d || {};
  const tr = {};
  if (d.translations && typeof d.translations === "object" && !Array.isArray(d.translations)) {
    for (const [k, v] of Object.entries(d.translations).slice(0, 600)) {
      const kk = str(k, 300), vv = str(v, 300);
      if (kk && vv) tr[kk] = vv;
    }
  }
  return {
    brand: str(d.brand, 60), title: str(d.title, 100), subtitle: str(d.subtitle, 200), footer: str(d.footer, 200),
    updatedAt: str(d.updatedAt, 40),
    support: {
      phone: String(d.support?.phone ?? "").replace(/\D/g, "").slice(0, 15),
      message: str(d.support?.message, 300)
    },
    translations: tr,
    cards: arr(d.cards, 40).map(c => {
      let sBest = false, bBest = false;
      return {
        badge: str(c.badge, 40), tag: str(c.tag, 30), icon: icon(c.icon), title: str(c.title, 100), notice: str(c.notice, 300),
        steps: arr(c.steps, 20).map(s => str(s, 300)).filter(Boolean),
        servers: arr(c.servers, 20).map(s => {
          const o = { label: str(s.label, 60), value: str(s.value, 80), best: false };
          if (s.best === true && !sBest && o.value) { o.best = true; sBest = true; }
          return o;
        }).filter(s => s.label || s.value),
        buttons: arr(c.buttons, 20).map(b => {
          const type = ["download", "video", "link"].includes(b.type) ? b.type : "link";
          const o = { text: str(b.text, 60), url: url(b.url), type, best: false };
          if (b.best === true && !bBest && type !== "video") { o.best = true; bBest = true; }
          return o;
        }).filter(b => b.text)
      };
    })
  };
}

/* ---------- ردود ---------- */
export const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
export const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/* ---------- جلسة دخول (توكن موقّع بدل إرسال الباسورد مع كل طلب) ---------- */
const b64u = s => Buffer.from(s).toString("base64url");
const secret = () => crypto.createHash("sha256")
  .update("masoub-session|" + (process.env.SESSION_SECRET || "") + "|" + (process.env.ADMIN_PASSWORD || "")).digest();
const sign = p => crypto.createHmac("sha256", secret()).update(p).digest("base64url");

export const SESSION_MS = 24 * 60 * 60 * 1000;
export function makeToken() {
  const p = b64u(JSON.stringify({ exp: Date.now() + SESSION_MS, n: crypto.randomBytes(6).toString("hex") }));
  return p + "." + sign(p);
}
export function isAuthed(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [p, s] = t.split(".");
  if (!p || !s) return false;
  try {
    const a = Buffer.from(sign(p)), b = Buffer.from(s);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now();
  } catch { return false; }
}

/* ---------- حد محاولات الدخول ---------- */
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const ipOf = req => (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "unknown").trim();
export async function loginGuard(req) {
  const key = "rl/" + sha(ipOf(req)).slice(0, 20), st = store();
  const r = (await st.get(key, { type: "json" }).catch(() => null)) || { fails: 0, first: 0, until: 0 };
  return {
    locked: r.until > Date.now() ? Math.ceil((r.until - Date.now()) / 60000) : 0,
    async fail() {
      const now = Date.now();
      if (now - r.first > LOCK_MS) { r.fails = 0; r.first = now; }
      r.fails++;
      if (r.fails >= MAX_FAILS) { r.until = now + LOCK_MS; r.fails = 0; r.first = 0; }
      await st.setJSON(key, r).catch(() => {});
    },
    async ok() { if (r.fails || r.until) await st.delete(key).catch(() => {}); }
  };
}

/* ---------- النسخ السابقة ---------- */
export const MAX_VERSIONS = 10;
export async function pushVersion(st, data) {
  await st.setJSON("versions/" + String(Date.now()).padStart(15, "0"), { savedAt: new Date().toISOString(), data });
  const { blobs } = await st.list({ prefix: "versions/" });
  const keys = blobs.map(b => b.key).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS))) await st.delete(k).catch(() => {});
}
export async function currentData(st) {
  let d = null;
  try { d = await st.get("data", { type: "json" }); } catch { /* نرجع للبيانات الأساسية */ }
  return clean(d || SEED);
}
