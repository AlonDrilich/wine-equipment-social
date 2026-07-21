// Publisher: posts the next due reel to Instagram (Reels) + YouTube (Shorts).
// Runs from the GitHub Actions cron (Mon/Wed/Fri). Posts the OLDEST unposted due slot, one per run.
// Marks slots posted in schedule.json (the workflow commits it back). Each platform is optional:
// if its secrets are absent, that platform is skipped — so you can enable IG and YouTube independently.
//
// Secrets (GitHub repo → Settings → Secrets and variables → Actions):
//   Instagram:  IG_USER_ID, IG_ACCESS_TOKEN            (long-lived token; IG Business account linked to the FB Page)
//   YouTube:    YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
//   Optional:   REEL_BASE_URL  (public base URL to the /reels/*.mp4; defaults to this repo's raw.githubusercontent URL)
import { readFileSync, writeFileSync, statSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const SCHED = join(__dir, "..", "schedule.json");
const IG_VER = "v21.0";

const today = (process.env.RUN_DATE || new Date().toISOString().slice(0, 10));
const repo = process.env.GITHUB_REPOSITORY || "";
const ref = process.env.GITHUB_REF_NAME || "main";
const REEL_BASE = process.env.REEL_BASE_URL || (repo ? `https://raw.githubusercontent.com/${repo}/${ref}/reels` : "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function loadDue() {
  const sched = JSON.parse(readFileSync(SCHED, "utf8"));
  const due = sched
    .filter((s) => s.date <= today && (!s.posted.instagram || !s.posted.youtube))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { sched, item: due[0] || null };
}

// ---------- Instagram Reels (Graph API) ----------
async function postInstagram(item) {
  const uid = process.env.IG_USER_ID, tok = process.env.IG_ACCESS_TOKEN;
  if (!uid || !tok) return log("• Instagram: skipped (no IG_USER_ID / IG_ACCESS_TOKEN secret)");
  if (!REEL_BASE) return log("• Instagram: skipped (no public REEL_BASE_URL; set it or make the repo public)");
  const videoUrl = `${REEL_BASE}/${item.reel}`;
  const caption = item.ig_caption.replace(/%PLAT%/g, "instagram");
  // 1) create container
  let r = await fetch(`https://graph.facebook.com/${IG_VER}/${uid}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: tok }),
  });
  let j = await r.json();
  if (!j.id) throw new Error("IG container failed: " + JSON.stringify(j));
  const cid = j.id;
  // 2) poll until FINISHED (reels transcode; up to ~5 min)
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const s = await (await fetch(`https://graph.facebook.com/${IG_VER}/${cid}?fields=status_code&access_token=${tok}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("IG processing error: " + JSON.stringify(s));
    log(`  IG processing… (${s.status_code})`);
  }
  // 3) publish
  r = await fetch(`https://graph.facebook.com/${IG_VER}/${uid}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cid, access_token: tok }),
  });
  j = await r.json();
  if (!j.id) throw new Error("IG publish failed: " + JSON.stringify(j));
  log("✅ Instagram Reel published:", j.id);
  return true;
}

// ---------- YouTube Shorts (Data API v3, resumable upload) ----------
async function ytAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN, grant_type: "refresh_token",
  });
  const j = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body })).json();
  if (!j.access_token) throw new Error("YT token failed: " + JSON.stringify(j));
  return j.access_token;
}
async function postYouTube(item) {
  if (!process.env.YT_CLIENT_ID || !process.env.YT_CLIENT_SECRET || !process.env.YT_REFRESH_TOKEN)
    return log("• YouTube: skipped (no YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN secret)");
  const token = await ytAccessToken();
  const file = join(__dir, "..", "reels", item.reel);
  const size = statSync(file).size;
  const meta = {
    snippet: { title: item.yt_title.slice(0, 100), description: item.yt_description,
      tags: ["winemaking", "winery equipment", "wine"], categoryId: "24" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
  // init resumable session
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YT resumable init failed: " + (await init.text()));
  // upload bytes
  const buf = readFileSync(file);
  const up = await fetch(uploadUrl, { method: "PUT",
    headers: { "Content-Length": String(size), "Content-Type": "video/mp4" }, body: buf });
  const j = await up.json();
  if (!j.id) throw new Error("YT upload failed: " + JSON.stringify(j));
  log("✅ YouTube Short uploaded:", j.id);
  return true;
}

// ---------- main ----------
(async () => {
  const { sched, item } = loadDue();
  if (!item) { log(`No due reel slot for ${today} — nothing to post.`); return; }
  log(`Due slot: ${item.date} · ${item.stage} · ${item.reel}`);
  let changed = false;
  try { if (!item.posted.instagram && (await postInstagram(item))) { item.posted.instagram = true; changed = true; } }
  catch (e) { log("❌ Instagram:", e.message); }
  try { if (!item.posted.youtube && (await postYouTube(item))) { item.posted.youtube = true; changed = true; } }
  catch (e) { log("❌ YouTube:", e.message); }
  if (changed) { writeFileSync(SCHED, JSON.stringify(sched, null, 2)); log("schedule.json updated."); }
  else log("No changes (both platforms skipped or already posted).");
})();
