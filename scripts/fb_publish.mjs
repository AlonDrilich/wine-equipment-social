// FB queue-drain: schedules a daily batch of the remaining wine.equipment Facebook photo posts
// (Aug 14-31) via the Graph API, respecting Facebook's ~daily creation cap. Runs from a daily cron;
// each run schedules up to FB_BATCH unposted items with their fixed scheduled_publish_time, marks them
// posted in fb-queue.json (committed back), and STOPS early if Facebook rate-limits — the next daily
// run resumes where it left off. Drains 89 posts in ~2 runs.
//
// Secrets:  FB_PAGE_ID, FB_PAGE_TOKEN  (long-lived Page token with pages_manage_posts + pages_read_engagement)
// Optional: FB_IMG_BASE  (public base URL to /pool/*.png; defaults to this repo's raw.githubusercontent URL)
//           FB_BATCH     (max posts per run; default 45)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, "..");
// Every fb-queue*.json in the repo root is a month of posts, drained oldest-first. Adding a month
// is dropping in a new file — no code change — which is what keeps publishing from stopping dead
// the day one month's queue empties.
const QUEUES = readdirSync(REPO).filter((f) => /^fb-queue.*\.json$/.test(f));
const V = "v21.0";

const PAGE = process.env.FB_PAGE_ID, TOKEN = process.env.FB_PAGE_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || "", ref = process.env.GITHUB_REF_NAME || "main";
const IMG_BASE = process.env.FB_IMG_BASE || (repo ? `https://raw.githubusercontent.com/${repo}/${ref}/pool` : "");
const BATCH = Number(process.env.FB_BATCH || 45);
const nowSec = Math.floor(Date.now() / 1000);

if (!PAGE || !TOKEN) { console.log("• FB drain skipped (no FB_PAGE_ID / FB_PAGE_TOKEN secret)"); process.exit(0); }
if (!IMG_BASE) { console.log("• FB drain skipped (no FB_IMG_BASE and no repo context for raw URLs)"); process.exit(0); }

// Drain in CHRONOLOGICAL order, not filename order — "fb-queue-2026-09.json" sorts before
// "fb-queue.json" as a string ('-' < '.'), which would post September ahead of August.
const soonest = (q) => Math.min(...q.filter((p) => !p.posted).map((p) => p.scheduled_publish_time), Infinity);
const files = QUEUES
  .map((f) => ({ f, path: join(REPO, f), q: JSON.parse(readFileSync(join(REPO, f), "utf8")) }))
  .sort((a, b) => soonest(a.q) - soonest(b.q));
const totalPending = files.reduce((n, x) => n + x.q.filter((p) => !p.posted).length, 0);
console.log(`FB queues (drain order): ${files.map((x) => x.f).join(", ") || "(none)"}`);
console.log(`${totalPending} pending across ${files.length} file(s). Scheduling up to ${BATCH} this run.`);

let ok = 0, done = 0, stopped = false;
const all = files.flatMap((x) => x.q.map((p) => p));
for (const p of all) {
  if (stopped) break;
  if (p.posted) continue;
  if (done >= BATCH) break;
  // FB requires scheduled_publish_time >= 10 min out and <= 6 months. Skip anything already past.
  if (p.scheduled_publish_time <= nowSec + 700) { console.log(`  skip (past): ${p.image}`); p.posted = true; p.id = "SKIPPED_PAST"; continue; }
  done++;
  const body = new URLSearchParams({
    url: `${IMG_BASE}/${p.image}`,
    caption: p.caption,
    published: "false",
    scheduled_publish_time: String(p.scheduled_publish_time),
    access_token: TOKEN,
  });
  try {
    const r = await fetch(`https://graph.facebook.com/${V}/${PAGE}/photos`, { method: "POST", body });
    const j = await r.json();
    if (j.id || j.post_id) { p.posted = true; p.id = j.id || j.post_id; ok++; }
    else {
      // Any failure at this point is almost always the daily/queue cap (or a transient blip).
      // Stop the run and resume next day — this avoids burning the batch on repeated cap errors,
      // and never risks duplicates.
      console.log(`  ❌ ${p.image}: ${JSON.stringify(j.error || j).slice(0, 160)}`);
      stopped = true; break;
    }
  } catch (e) { console.log(`  ❌ ${p.image}: ${e.message}`); stopped = true; break; }
}
for (const x of files) writeFileSync(x.path, JSON.stringify(x.q, null, 1));
const left = files.reduce((n, x) => n + x.q.filter((p) => !p.posted).length, 0);
for (const x of files) {
  const l = x.q.filter((p) => !p.posted).length;
  console.log(`   ${x.f}: ${x.q.length - l}/${x.q.length} done`);
}
console.log(`✅ scheduled ${ok} this run.${stopped ? " (stopped early — likely daily cap; resumes next run)" : ""} ${left} still pending.`);
