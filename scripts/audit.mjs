// audit.mjs — answers one question: is every platform actually PUBLISHING?
//
// The watchdog asks "is anything broken right now". This asks the different and more important
// question: over the last two weeks, did posts really go out, on which days, and where are the
// holes. Read-only; run it from the audit workflow whenever you want the true picture.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

const TOKEN = (process.env.BUFFER_WINE_TOKEN || "").trim();
const ORG = "6a5e982e9f3f91036e762820";
const CH = { youtube: "6a5e99b7e2638b94d7a38135", linkedin: "6a5ef716e2638b94d7a6df0c" };
const FB_PAGE = (process.env.FB_PAGE_ID || "").trim();
const FB_TOK = (process.env.FB_PAGE_TOKEN || "").trim();

const SCHED = JSON.parse(readFileSync(join(__dir, "..", "schedule.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const WINDOW = 14;

const gql = (q, v) => fetch("https://api.buffer.com", {
  method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q, variables: v }),
}).then(r => r.json());

const bar = n => "█".repeat(Math.min(n, 20)) + (n > 20 ? `+${n - 20}` : "");

console.log(`\n=== wine.equipment publishing audit · ${today} ===`);
console.log(`Looking at the last ${WINDOW} days of actual sends, then what is still queued.\n`);

// ---------- Facebook ----------
if (FB_PAGE && FB_TOK) {
  const page = async (path) => {
    let out = [], url = `https://graph.facebook.com/v20.0/${FB_PAGE}/${path}`, guard = 0;
    while (url && guard++ < 30) {
      const j = await (await fetch(url, { headers: { Authorization: `Bearer ${FB_TOK}` } })).json();
      if (j.error) { console.log(`  ! ${j.error.message}`); break; }
      out.push(...(j.data || [])); url = j.paging?.next || null;
    }
    return out;
  };
  const pub = await page("published_posts?fields=created_time&limit=100");
  const sch = await page("scheduled_posts?fields=scheduled_publish_time&limit=100");
  const byDay = {};
  for (const p of pub) {
    const d = p.created_time.slice(0, 10);
    if (d >= daysAgo(WINDOW)) byDay[d] = (byDay[d] || 0) + 1;
  }
  console.log("FACEBOOK — published");
  let missed = 0;
  for (let i = WINDOW; i >= 0; i--) {
    const d = daysAgo(i), n = byDay[d] || 0;
    if (n === 0 && d < today) missed++;
    console.log(`  ${d}  ${n ? bar(n) : "—"} ${n || ""}`);
  }
  const sd = sch.map(p => new Date(p.scheduled_publish_time * 1000).toISOString().slice(0, 10)).sort();
  const queues = readdirSync(join(__dir, "..")).filter(f => /^fb-queue.*\.json$/.test(f));
  const pending = queues.reduce((n, f) =>
    n + JSON.parse(readFileSync(join(__dir, "..", f), "utf8")).filter(p => !p.posted).length, 0);
  console.log(`  → ${pub.length} published all-time · ${missed} silent day(s) in the window`);
  console.log(`  → ${sch.length} scheduled, ${sd[0]} to ${sd[sd.length - 1]} · ${pending} still in the queue file\n`);
} else {
  console.log("FACEBOOK — skipped (no FB_PAGE_ID / FB_PAGE_TOKEN)\n");
}

// ---------- Buffer channels ----------
if (TOKEN) {
  const chans = await gql(`query($org:OrganizationId!){ channels(input:{organizationId:$org}){ id service name isDisconnected } }`, { org: ORG });
  const live = Object.fromEntries((chans.data?.channels || []).map(c => [c.id, c]));
  for (const [plat, id] of Object.entries(CH)) {
    const c = live[id];
    console.log(`${plat.toUpperCase()} — ${c ? (c.isDisconnected ? "DISCONNECTED" : "connected") : "channel not found"}`);
    for (const status of ["sent", "scheduled", "error"]) {
      const j = await gql(`query($org:OrganizationId!,$ch:ChannelId!,$st:PostStatus!){ posts(input:{organizationId:$org, filter:{channelIds:[$ch], status:$st}}){ edges{ node{ dueAt } } } }`,
        { org: ORG, ch: id, st: status });
      const all = (j.data?.posts?.edges || []).map(e => e.node.dueAt).sort();
      if (status === "sent") {
        const recent = all.filter(d => d.slice(0, 10) >= daysAgo(WINDOW));
        console.log(`  sent in window: ${recent.length}`);
        const set = new Set(recent.map(d => d.slice(0, 10)));
        const holes = [];
        for (let i = WINDOW; i >= 1; i--) { const d = daysAgo(i); if (!set.has(d)) holes.push(d); }
        console.log(`  days with no send: ${holes.length ? holes.join(", ") : "none"}`);
      } else if (status === "scheduled") {
        console.log(`  scheduled ahead: ${all.length}${all.length ? ` (through ${all[all.length - 1].slice(0, 10)})` : ""}`);
      } else if (all.length) {
        console.log(`  FAILED: ${all.map(d => d.slice(0, 10)).join(", ")}`);
      }
    }
    console.log();
  }
} else {
  console.log("BUFFER — skipped (no BUFFER_WINE_TOKEN)\n");
}

// ---------- Instagram ----------
console.log("INSTAGRAM — no publishing path exists");
console.log("  The Page has no linked Instagram Business account, so neither Buffer nor the Graph");
console.log("  API can post there. Nothing has ever published. Founder action, see launch-ops.md.\n");

// ---------- plan coverage ----------
const last = SCHED.map(s => s.date).sort().pop();
const future = SCHED.filter(s => s.date >= today).length;
console.log(`PLAN — schedule.json covers to ${last} (${future} reel slots still ahead)`);
