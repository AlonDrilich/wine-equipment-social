// Lead alarm that runs in GitHub's cloud, so it does not depend on anyone's laptop being awake.
//
// Why: the hourly Claude task only runs while the founder's Mac is on — it missed 2026-09-27 → 2026-10-01 entirely —
// and the server-side notify-inquiry function cannot send until RESEND_API_KEY is set. This job asks the database one
// question every hour, "how many quote requests are waiting?", and turns a new answer into a GitHub issue that
// @mentions the owner plus a failed run. GitHub emails the owner about both.
//
// It reads ONE number (public.pending_lead_count(), granted to the public anon role) and writes nothing but that
// number to GitHub. This repo is public: no name, address or message may ever appear in an issue or a log line.
// The public key is the one the website already ships to every browser; it is read from the live bundle at run time
// and checked to be the anon role, so no credential is stored here and a rotated key needs no change.
import { execFileSync } from "node:child_process";

const SITE = "https://wine.equipment";
const SUPABASE = "https://nmnvdlaqedbldbdztjih.supabase.co";
const OWNER = "AlonDrilich";
const LABEL = "lead-alarm";
const SIMULATE = Math.max(0, Number(process.env.SIMULATE || 0) | 0); // manual runs only: tests the alert path

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const openIssues = () => JSON.parse(gh("issue", "list", "--label", LABEL, "--state", "open", "--json", "number,title"));

async function publicKey() {
  const html = await (await fetch(`${SITE}/`)).text();
  const scripts = [...new Set([...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((m) => m[0]))];
  for (const path of scripts) {
    const js = await (await fetch(SITE + path)).text();
    for (const m of js.matchAll(/"(eyJ[\w-]+\.([\w-]+)\.[\w-]+)"/g)) {
      try {
        const claims = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
        if (claims.role === "anon") return m[1];
      } catch { /* not a JWT */ }
    }
  }
  throw new Error("the site's public key was not found in its JavaScript bundle");
}

async function pendingCount() {
  const key = await publicKey();
  const r = await fetch(`${SUPABASE}/rest/v1/rpc/pending_lead_count`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`pending_lead_count answered HTTP ${r.status}`);
  const n = Number(await r.json());
  if (!Number.isInteger(n) || n < 0) throw new Error("pending_lead_count returned something that is not a count");
  return n;
}

const titleCount = (t) => Number((t.match(/:\s*(\d+)\s+quote request/) || [])[1] || 0);

async function main() {
  gh("label", "create", LABEL, "--color", "B60205", "--description", "A wine.equipment quote request is waiting", "--force");
  const brokenTitle = "wine.equipment lead alarm cannot reach the database";

  let n;
  try {
    n = await pendingCount();
  } catch (err) {
    console.log(`alarm broken: ${err.message}`);
    if (!openIssues().some((i) => i.title === brokenTitle)) {
      gh("issue", "create", "--label", LABEL, "--title", brokenTitle, "--body",
        `@${OWNER} — the hourly lead check could not read the count of waiting quote requests: ${err.message}.\n\n` +
        "Until this is fixed, nothing in the cloud is watching for new leads. Ask Claude to look at " +
        "`scripts/lead_alarm.mjs` and `public.pending_lead_count()`. This issue closes itself when the check works again.");
      process.exitCode = 1; // a red run is the second channel: GitHub emails the owner about it
    }
    return;
  }

  const open = openIssues();
  for (const i of open.filter((i) => i.title === brokenTitle)) gh("issue", "close", String(i.number), "--comment", "The lead check reaches the database again.");
  const alerts = open.filter((i) => i.title !== brokenTitle);

  const effective = Math.max(n, SIMULATE);
  const test = SIMULATE > 0 && SIMULATE >= n;
  console.log(`waiting quote requests: ${n}${SIMULATE ? ` (simulated ${SIMULATE})` : ""}`);

  if (effective === 0) {
    for (const i of alerts) gh("issue", "close", String(i.number), "--comment", "Every waiting quote request is now marked handled.");
    return;
  }

  const title = `${test ? "TEST — " : ""}wine.equipment: ${effective} quote request${effective === 1 ? "" : "s"} waiting`;
  const body =
    `@${OWNER} — ${effective} quote request${effective === 1 ? " has" : "s have"} not been marked handled.` +
    (test ? " **This is a test of the alarm; no real request is waiting.**" : " The site promises a reply within one business day.") +
    "\n\nRead them in Supabase:\n\n```sql\nSELECT name, email, company, created_at, message\nFROM public.inquiries WHERE notified_at IS NULL ORDER BY created_at;\n```\n\n" +
    "or ask Claude. Nothing about the request itself is ever written here — this repository is public. " +
    "The issue closes itself once every request has `notified_at` set.";

  if (alerts.length === 0) {
    gh("issue", "create", "--label", LABEL, "--title", title, "--body", body);
    process.exitCode = 1;
  } else if (effective > titleCount(alerts[0].title)) {
    gh("issue", "edit", String(alerts[0].number), "--title", title);
    gh("issue", "comment", String(alerts[0].number), "--body", `@${OWNER} — now ${effective} waiting.`);
    process.exitCode = 1;
  } else {
    console.log(`already alerted (issue #${alerts[0].number}); not repeating`);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
