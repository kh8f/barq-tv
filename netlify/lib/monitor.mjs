// مراقبة موقع المصدر: يقارن روابطه وأكواده وعناوين بطاقاته مع بياناتك، وينبّهك على تيليجرام لو تغيّر شي
import { store, currentData, sha } from "./common.mjs";

const SOURCE = () => process.env.SOURCE_URL || "https://how-barq.xyz/?lang=ar";

export function normUrl(u, base) {
  try {
    const x = new URL(u, base);
    // خطأ معروف في المصدر: https://how-barq.xyz/my.splayer.in  ->  https://my.splayer.in
    if (/(^|\.)how-barq\.xyz$/i.test(x.hostname) && /^\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(x.pathname))
      return normUrl("https://" + x.pathname.replace(/^\/|\/$/g, ""));
    if (/youtube\.com|youtu\.be/i.test(x.hostname)) x.searchParams.delete("si");
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    return x.protocol + "//" + host + x.pathname.replace(/\/+$/, "") + x.search;
  } catch { return ""; }
}
const ignoredLink = n => {
  try {
    const x = new URL(n);
    if (/(^|\.)(t\.me|telegram\.me)$/.test(x.hostname)) return true;
    if (x.hostname === "whatsapp.com" && x.pathname.startsWith("/channel")) return true;
    if (x.hostname === "wa.me") return true;
    if (x.hostname === "how-barq.xyz" && !x.pathname.startsWith("/app/")) return true;
  } catch { return true; }
  return false;
};

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const textOf = h => decode(h.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function parseSource(html, base) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = normUrl(decode(m[1]), base);
    if (href && !ignoredLink(href)) links.push({ text: textOf(m[2]), href });
  }
  const sections = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => textOf(m[1])).filter(Boolean);
  const lines = decode(html.replace(/<[^>]*>/g, "\n")).split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const codes = [];
  lines.forEach((l, i) => { if (/^\d{4,10}$/.test(l) && i > 0) codes.push({ label: lines[i - 1], value: l }); });
  return { links, sections, codes };
}

export function diff(src, ours) {
  const ourLinks = [], ourCodes = [];
  ours.cards.forEach(c => {
    c.buttons.forEach(b => { const h = normUrl(b.url); if (h) ourLinks.push({ text: b.text, href: h }); });
    c.servers.forEach(s => { if (/^\d{4,10}$/.test(s.value)) ourCodes.push({ label: s.label, value: s.value }); });
  });
  const uniq = (list, key) => { const m = new Map(); list.forEach(x => m.set(key(x), x)); return m; };
  const sl = uniq(src.links, x => x.href), ol = uniq(ourLinks, x => x.href);
  const sc = uniq(src.codes, x => x.label + "|" + x.value), oc = uniq(ourCodes, x => x.label + "|" + x.value);
  const ss = new Set(src.sections), os = new Set(ours.cards.map(c => c.title));
  return {
    newLinks: [...sl].filter(([k]) => !ol.has(k)).map(([, v]) => v),
    missingLinks: [...ol].filter(([k]) => !sl.has(k)).map(([, v]) => v),
    newCodes: [...sc].filter(([k]) => !oc.has(k)).map(([, v]) => v),
    missingCodes: [...oc].filter(([k]) => !sc.has(k)).map(([, v]) => v),
    newSections: [...ss].filter(x => !os.has(x)),
    missingSections: [...os].filter(x => !ss.has(x))
  };
}
const count = d => Object.values(d).reduce((t, a) => t + a.length, 0);

export function buildMessage(d) {
  const L = [];
  const sec = (title, items, fmt) => { if (items.length) { L.push("", title); items.slice(0, 15).forEach(i => L.push("• " + fmt(i))); if (items.length > 15) L.push(`… و${items.length - 15} غيرها`); } };
  L.push("🔔 فيه فروقات بين موقع المصدر وموقعك");
  sec("➕ روابط جديدة في المصدر:", d.newLinks, x => `${x.text || "بدون اسم"}: ${x.href}`);
  sec("➖ روابط عندك وما عادت في المصدر:", d.missingLinks, x => `${x.text}: ${x.href}`);
  sec("➕ أكواد جديدة في المصدر:", d.newCodes, x => `${x.label} = ${x.value}`);
  sec("➖ أكواد عندك وما عادت في المصدر:", d.missingCodes, x => `${x.label} = ${x.value}`);
  sec("➕ بطاقات جديدة في المصدر:", d.newSections, x => x);
  sec("➖ بطاقات عندك وما عادت في المصدر:", d.missingSections, x => x);
  if (process.env.URL) L.push("", "حدّث من الداشبورد: " + process.env.URL.replace(/\/$/, "") + "/dashboard");
  return L.join("\n").slice(0, 3900);
}

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, error: "تيليجرام غير مضبوط (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000)
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.description || "فشل الإرسال" };
  } catch (e) { return { ok: false, error: "تعذر الاتصال بتيليجرام" }; }
}

export async function getReport() {
  return (await store().get("monitor", { type: "json" }).catch(() => null)) || null;
}

export async function runMonitor({ notify = true } = {}) {
  const st = store(), prev = await getReport(), src = SOURCE();
  const rep = { checkedAt: new Date().toISOString(), source: src, ok: false, diff: null, total: 0, signature: prev?.signature || "", notified: prev?.notified || "", error: "", telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) };
  try {
    const r = await fetch(src, { headers: { "user-agent": "Mozilla/5.0 (compatible; MasoubMonitor/1.0)", "accept-language": "ar" }, signal: AbortSignal.timeout(9000), redirect: "follow" });
    if (!r.ok) throw new Error("المصدر رجّع حالة " + r.status);
    const parsed = parseSource(await r.text(), src);
    if (!parsed.links.length && !parsed.sections.length) throw new Error("ما قدرت أقرأ محتوى الصفحة (يمكن تغيّر شكلها)");
    rep.diff = diff(parsed, await currentData(st));
    rep.total = count(rep.diff);
    rep.signature = sha(JSON.stringify(rep.diff));
    rep.ok = true;
  } catch (e) { rep.error = e.message || "خطأ غير معروف"; }

  if (notify) {
    if (rep.ok && rep.total && rep.signature !== prev?.notified) {
      const t = await sendTelegram(buildMessage(rep.diff));
      if (t.ok) rep.notified = rep.signature; else rep.telegramError = t.error;
    } else if (!rep.ok && prev?.ok !== false) {
      const t = await sendTelegram("⚠️ ما قدرت أفحص موقع المصدر: " + rep.error);
      if (!t.ok) rep.telegramError = t.error;
    }
  }
  await st.setJSON("monitor", rep).catch(() => {});
  return rep;
}
