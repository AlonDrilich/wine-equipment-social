// buffer_refill.mjs — daily top-up of wine.equipment reels to Buffer YouTube + LinkedIn.
// Buffer's free plan holds only ~10 scheduled posts per channel. This runs daily: it queries what's
// already scheduled, then schedules the next unscheduled day(s) from schedule.json until each channel
// is full again (as published posts free slots). Idempotent — never duplicates.
//
// Token:  BUFFER_WINE_TOKEN env (GitHub secret) — falls back to /tmp/bw.token for local runs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const TOKEN = (process.env.BUFFER_WINE_TOKEN || (() => { try { return readFileSync("/tmp/bw.token", "utf8"); } catch { return ""; } })()).trim();
if (!TOKEN) { console.log("• Buffer refill skipped (no BUFFER_WINE_TOKEN secret)"); process.exit(0); }

const SCHED = JSON.parse(readFileSync(join(__dir, "..", "schedule.json"), "utf8"));
const RAW = process.env.REEL_BASE_URL || "https://raw.githubusercontent.com/AlonDrilich/wine-equipment-social/main/reels";
const ORG = "6a5e982e9f3f91036e762820";
const CH = { youtube: "6a5e99b7e2638b94d7a38135", linkedin: "6a5ef716e2638b94d7a6df0c" };
const today = new Date().toISOString().slice(0, 10);

const gql = (q, v) => fetch("https://api.buffer.com", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: v }) }).then(r => r.json());
const LISTQ = `query($org:OrganizationId!,$ch:ChannelId!){ posts(input:{organizationId:$org, filter:{channelIds:[$ch], status:scheduled}}){ edges{ node{ id dueAt } } } }`;
const CREATE = `mutation($input: CreatePostInput!){ createPost(input:$input){ __typename ... on PostActionSuccess { post { id } } ... on LimitReachedError { message } ... on InvalidInputError { message } ... on RestProxyError { message } ... on UnauthorizedError { message } ... on UnexpectedError { message } } }`;

async function scheduledDates(ch) {
  // Retry a few times; return null (not empty) if we can't reliably read — caller then SKIPS
  // (never assume "nothing scheduled", which would risk duplicates).
  for (let a = 0; a < 3; a++) {
    const j = await gql(LISTQ, { org: ORG, ch });
    if (!j.errors && j.data?.posts?.edges) return new Set(j.data.posts.edges.map(e => e.node.dueAt.slice(0, 10)));
  }
  return null;
}

const inputFor = (plat, s) => plat === "youtube"
  ? { channelId: CH.youtube, schedulingType: "automatic", mode: "customScheduled", dueAt: `${s.date}T15:00:00Z`, text: s.yt_description, metadata: { youtube: { title: s.yt_title.slice(0, 100), categoryId: "22", privacy: "public", madeForKids: false, notifySubscribers: false, isAiGenerated: true } }, assets: [{ video: { url: `${RAW}/${s.reel}` } }] }
  : { channelId: CH.linkedin, schedulingType: "automatic", mode: "customScheduled", dueAt: `${s.date}T16:00:00Z`, text: s.ig_caption.replace(/%PLAT%/g, "linkedin"), assets: [{ video: { url: `${RAW}/${s.reel}` } }] };

// Health check first — a channel whose OAuth has lapsed still ACCEPTS scheduled posts and then
// fails silently at publish time. Detect it, shout, and don't waste queue slots on a dead channel.
const health = await gql(`query($org:OrganizationId!){ channels(input:{organizationId:$org}){ id service name isDisconnected } }`, { org: ORG });
const dead = new Set((health.data?.channels || []).filter(c => c.isDisconnected).map(c => c.id));
for (const c of (health.data?.channels || [])) {
  if (c.isDisconnected) console.log(`⚠️  ${c.service} "${c.name}" IS DISCONNECTED — Buffer has lost authorization. Reconnect it in Buffer → Channels, or its posts will keep failing.`);
}

let added = { youtube: 0, linkedin: 0 };
for (const plat of ["youtube", "linkedin"]) {
  if (dead.has(CH[plat])) { console.log(`• ${plat}: skipped — channel disconnected (fix the auth, then re-run this workflow).`); continue; }
  const have = await scheduledDates(CH[plat]);   // channel ID, not the platform name
  if (have === null) { console.log(`• ${plat}: could not read the scheduled queue (Buffer API) — skipping this run to avoid duplicates`); continue; }
  // Only future slots. Today's slot time (15:00Z / 16:00Z) may already have passed —
  // Buffer rejects those outright, so filter on the real datetime, not just the date.
  const slotHour = plat === "youtube" ? "15:00:00Z" : "16:00:00Z";
  const cutoff = Date.now() + 15 * 60 * 1000;
  // The runway is whatever schedule.json covers — adding a month is editing data, not code.
  const todo = SCHED.filter(s =>
    !have.has(s.date) && Date.parse(`${s.date}T${slotHour}`) > cutoff);
  for (const s of todo) {
    const r = await gql(CREATE, { input: inputFor(plat, s) });
    const t = r.data?.createPost?.__typename;
    if (t === "PostActionSuccess") { added[plat]++; console.log(`✅ ${plat} ${s.date} ${s.reel}`); }
    else if (t === "LimitReachedError") { console.log(`• ${plat} full (${have.size + added[plat]} scheduled) — stop`); break; }
    else { console.log(`❌ ${plat} ${s.date}: ${t} ${r.data?.createPost?.message || JSON.stringify(r.errors)?.slice(0,120)}`); break; }
  }
}
console.log(`\nRefill done — added YouTube ${added.youtube}, LinkedIn ${added.linkedin}.`);
