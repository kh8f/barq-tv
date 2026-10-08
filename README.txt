MASOUB STORE - موقع معلومات البرامج (نسخة Netlify)
==================================================
الهيكل:
  netlify.toml
  package.json
  netlify/functions/api.mjs   (الـ API: قراءة/حفظ/دخول)
  netlify/functions/seed.mjs  (البيانات الأولية)
  public/  index.html, admin.html, logo.svg, favicon.svg, data.json

خطوات النشر:
1) ارفع كل محتويات المجلد (مع netlify.toml في جذر المشروع) على مستودع GitHub.
2) في Netlify: Add new site > Import an existing project > اختر المستودع (الإعدادات تنقرأ من netlify.toml).
3) Site configuration > Environment variables > أضف:
      ADMIN_PASSWORD = باسوردك
4) اعمل Deploy من جديد (Deploys > Trigger deploy) عشان الباسورد ينطبق.

الاستخدام:
  الموقع:    https://موقعك.netlify.app
  الداشبورد: https://موقعك.netlify.app/dashboard
  أي حفظ من الداشبورد يظهر فوراً على الموقع بدون نشر جديد.
