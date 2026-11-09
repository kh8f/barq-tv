// فحص تلقائي يومي لموقع المصدر (الساعة 6 صباحًا UTC = 9 صباحًا بتوقيت السعودية)
import { runMonitor } from "../lib/monitor.mjs";

export default async () => {
  await runMonitor({ notify: true });
  return new Response("ok");
};

export const config = { schedule: "0 6 * * *" };
