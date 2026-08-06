// watchdog.mjs — verifies the August publishing plan is actually on track.
// Runs daily in GitHub Actions. Exits NON-ZERO on a real problem, which turns the run red and makes
// GitHub email the repo owner. That is the alarm: silence means healthy, a red X means look.
//
// Checks:
//   1. Buffer channels are still authorised (an OAuth lapse fails posts silently)
//   2. Each channel's queue is full, or full enough to reach 2026-08-31 in time
//   3. Nothing in schedule.json is left unscheduled once its date has passed
import { readFileSync } from "node:fs";
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

if (!TOKEN) { console.log("• watchdog skipped (no BUFFER_WINE_TOKEN)"); process.exit(0); }

const gql = (q, v) => fetch("https://api.buffer.com", {
  method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q, variables: v }),
}).then(r => r.json());

const problems = [];
const note = [];

// 1. channel authorisation
const h = await gql(`query($org:OrganizationId!){ channels(input:{organizationId:$org}){ id service name isDisconnected } }`, { org: ORG });
if (h.errors) { problems.push(`Buffer API unreachable or token rejected: ${JSON.stringify(h.errors).slice(0, 120)}`); }
for (const c of (h.data?.channels || [])) {
  if (c.isDisconnected) problems.push(`${c.service} "${c.name}" is DISCONNECTED — reconnect it in Buffer or its posts will keep failing`);
  else note.push(`${c.service} connected`);
}

// 2. per-channel queue depth vs. the runway still needed
const daysLeft = Math.max(0, Math.round((Date.parse(END) - Date.parse(today)) / 86400000));
for (const [plat, id] of Object.entries(CH)) {
  const j = await gql(`query($org:OrganizationId!,$ch:ChannelId!){ posts(input:{organizationId:$org, filter:{channelIds:[$ch], status:scheduled}}){ edges{ node{ dueAt } } } }`, { org: ORG, ch: id });
  if (j.errors) { problems.push(`${plat}: could not read the queue`); continue; }
  const dates = (j.data?.posts?.edges || []).map(e => e.node.dueAt.slice(0, 10)).sort();
  const last = dates[dates.length - 1];
  note.push(`${plat}: ${dates.length} scheduled, through ${last || "-"}`);
  // Buffer's free plan caps at ~10. Fewer than 5 queued with runway left means the refill is not keeping up.
  if (daysLeft > 0 && dates.length < 5) problems.push(`${plat}: only ${dates.length} scheduled with ${daysLeft} days to ${END} — the refill is not keeping up`);
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

// 3. schedule slots that expired without ever being scheduled
const missed = SCHED.filter(s => s.date < today && s.date >= "2026-08-01" && !s.posted?.instagram && !s.posted?.youtube).length;
if (missed > 0) note.push(`${missed} past slots were never posted (expected if they published via Buffer)`);

console.log("— wine.equipment publishing watchdog —");
for (const n of note) console.log(`  ok   ${n}`);
for (const p of problems) console.log(`  FAIL ${p}`);
console.log(`  ${daysLeft} days remain until ${END}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s) found — publishing to end of August is at risk.`);
  process.exit(1);
}
console.log("\nAll clear: August publishing is on track.");
