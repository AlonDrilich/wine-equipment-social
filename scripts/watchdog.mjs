// watchdog.mjs — verifies the publishing plan is actually on track.
// Runs daily in GitHub Actions. Exits NON-ZERO on a real problem, which turns the run red and makes
// GitHub email the repo owner. That is the alarm: silence means healthy, a red X means look.
//
// Checks:
//   1. Buffer channels are still authorised (an OAuth lapse fails posts silently)
//   2. Each channel's queue is full enough to reach the last date in schedule.json
//   2b. Facebook's live schedule still runs ahead of today and its queue is still draining
//   3. Nothing in schedule.json is left unscheduled once its date has passed
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

const TOKEN = (process.env.BUFFER_WINE_TOKEN || "").trim();
const ORG = "6a5e982e9f3f91036e762820";
const CH = { youtube: "6a5e99b7e2638b94d7a38135", linkedin: "6a5ef716e2638b94d7a6df0c" };
const SCHED = JSON.parse(readFileSync(join(__dir, "..", "schedule.json"), "utf8"));
// The horizon we promise to cover is the last date in schedule.json, so extending the plan by a
// month is a data edit. A hardcoded end date silently reports "all clear" past its own runway.
const END = SCHED.map(s => s.date).sort().pop();
const today = new Date().toISOString().slice(0, 10);

const gql = (q, v) => fetch("https://api.buffer.com", {
  method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q, variables: v }),
}).then(r => r.json());

const problems = [];
const note = [];

// 1. channel authorisation
if (!TOKEN) note.push("buffer: skipped (no BUFFER_WINE_TOKEN)");
const h = TOKEN ? await gql(`query($org:OrganizationId!){ channels(input:{organizationId:$org}){ id service name isDisconnected } }`, { org: ORG }) : {};
if (h.errors) { problems.push(`Buffer API unreachable or token rejected: ${JSON.stringify(h.errors).slice(0, 120)}`); }
for (const c of (h.data?.channels || [])) {
  if (c.isDisconnected) problems.push(`${c.service} "${c.name}" is DISCONNECTED — reconnect it in Buffer or its posts will keep failing`);
  else note.push(`${c.service} connected`);
}

// 2. per-channel queue depth vs. the runway still needed
const daysLeft = Math.max(0, Math.round((Date.parse(END) - Date.parse(today)) / 86400000));
for (const [plat, id] of (TOKEN ? Object.entries(CH) : [])) {
  const j = await gql(`query($org:OrganizationId!,$ch:ChannelId!){ posts(input:{organizationId:$org, filter:{channelIds:[$ch], status:scheduled}}){ edges{ node{ dueAt } } } }`, { org: ORG, ch: id });
  if (j.errors) { problems.push(`${plat}: could not read the queue`); continue; }
  const dates = (j.data?.posts?.edges || []).map(e => e.node.dueAt.slice(0, 10)).sort();
  const last = dates[dates.length - 1];
  note.push(`${plat}: ${dates.length} scheduled, through ${last || "-"}`);
  // Buffer's free plan caps at ~10. Fewer than 5 queued with runway left means the refill is not keeping up.
  if (daysLeft > 0 && dates.length < 5) problems.push(`${plat}: only ${dates.length} scheduled with ${daysLeft} days to ${END} — the refill is not keeping up`);
  // Buffer keeps a post that failed to publish in status `error`, and only tells you by email.
  // Nothing else in this pipeline notices, so the slot is simply lost. Surface it here.
  const e = await gql(`query($org:OrganizationId!,$ch:ChannelId!){ posts(input:{organizationId:$org, filter:{channelIds:[$ch], status:error}}){ edges{ node{ dueAt } } } }`, { org: ORG, ch: id });
  const errs = (e.data?.posts?.edges || []).map(x => x.node.dueAt).sort();
  // Alarm only on failures since roughly the last daily run. A wider window would hold the check
  // red for a week over one incident, and a permanently red alarm is ignored exactly as fast as a
  // permanently green one. Older failures stay visible as a note.
  const fresh = errs.filter(d => Date.parse(d) > Date.now() - 36 * 3600000);
  const older = errs.filter(d => Date.parse(d) <= Date.now() - 36 * 3600000
                              && Date.parse(d) > Date.now() - 14 * 86400000);
  if (fresh.length) problems.push(`${plat}: ${fresh.length} post(s) FAILED to publish since yesterday (${fresh.map(d => d.slice(0, 16)).join(", ")}) — Buffer only emails about these, and the slot is lost once its time passes`);
  if (older.length) note.push(`${plat}: ${older.length} older failure(s) in the last fortnight (${older.map(d => d.slice(0, 10)).join(", ")}) — recurring failures mean the channel needs reconnecting`);

  // gap inside the queue
  if (dates.length > 1) {
    const gaps = [];
    for (let d = new Date(dates[0]); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (!dates.includes(s)) gaps.push(s);
    }
    if (gaps.length) problems.push(`${plat}: gap(s) inside the queue → ${gaps.join(", ")}`);
  }
}

// 2b. Facebook: is the queue still draining, and does the live schedule reach far enough?
// Buffer being healthy says nothing about Facebook — the drain can stall silently and the first
// symptom would be an empty feed weeks later.
const FB_PAGE = (process.env.FB_PAGE_ID || "").trim(), FB_TOK = (process.env.FB_PAGE_TOKEN || "").trim();
if (FB_PAGE && FB_TOK) {
  const queues = readdirSync(join(__dir, "..")).filter(f => /^fb-queue.*\.json$/.test(f));
  const pending = queues.reduce((n, f) =>
    n + JSON.parse(readFileSync(join(__dir, "..", f), "utf8")).filter(p => !p.posted).length, 0);
  let live = [], url = `https://graph.facebook.com/v20.0/${FB_PAGE}/scheduled_posts?fields=scheduled_publish_time&limit=100`, guard = 0;
  while (url && guard++ < 25) {
    const j = await (await fetch(url, { headers: { Authorization: `Bearer ${FB_TOK}` } })).json();
    if (j.error) { problems.push(`facebook: ${j.error.message}`); break; }
    live.push(...(j.data || [])); url = j.paging?.next || null;
  }
  const dates = live.map(p => new Date(p.scheduled_publish_time * 1000).toISOString().slice(0, 10)).sort();
  const lastFb = dates[dates.length - 1];
  note.push(`facebook: ${live.length} scheduled through ${lastFb || "-"}, ${pending} still queued`);
  // A gap in the live schedule means a day with no posts at all.
  for (let dt = new Date(dates[0] || today); dt.toISOString().slice(0, 10) < lastFb; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const s = dt.toISOString().slice(0, 10);
    if (!dates.includes(s)) { problems.push(`facebook: no posts scheduled on ${s}`); break; }
  }
  // Runway: the drain tops up as posts publish, so the live schedule should always sit a few days
  // ahead of today. Under three days ahead with a queue still pending means the drain has stalled.
  const daysAhead = lastFb ? Math.round((Date.parse(lastFb) - Date.parse(today)) / 86400000) : 0;
  if (pending > 0 && daysAhead < 3) problems.push(`facebook: only ${daysAhead} days scheduled ahead with ${pending} queued — the drain has stalled`);
  if (pending === 0 && daysAhead < 7) problems.push(`facebook: queue is empty and only ${daysAhead} days remain — build the next month`);
} else {
  note.push("facebook: skipped (no FB_PAGE_ID / FB_PAGE_TOKEN)");
}

// 3. schedule slots that expired without ever being scheduled
const missed = SCHED.filter(s => s.date < today && s.date >= SCHED[0].date && !s.posted?.instagram && !s.posted?.youtube).length;
if (missed > 0) note.push(`${missed} past slots were never posted (expected if they published via Buffer)`);

console.log("— wine.equipment publishing watchdog —");
for (const n of note) console.log(`  ok   ${n}`);
for (const p of problems) console.log(`  FAIL ${p}`);
console.log(`  ${daysLeft} days remain until ${END}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s) found — publishing through ${END} is at risk.`);
  process.exit(1);
}
console.log(`\nAll clear: publishing through ${END} is on track.`);
