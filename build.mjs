// يشتغل مرة وحدة أثناء النشر في Netlify: يحط رابط موقعك الحقيقي في وسوم المعاينة (Open Graph)
import fs from "node:fs";
const site = (process.env.URL || "").replace(/\/$/, "");
const f = "public/index.html";
fs.writeFileSync(f, fs.readFileSync(f, "utf8").replaceAll("__SITE_URL__", site));
console.log("SITE_URL =", site || "(فاضي - تشغيل محلي)");
