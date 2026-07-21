# wine-social-cron — auto-post Reels/Shorts to Instagram + YouTube

A tiny GitHub Actions cron that posts one wine.equipment reel every **Mon/Wed/Fri** (3/week) to
**Instagram Reels** and **YouTube Shorts**, from a fixed schedule, through **Aug 31 2026**. It recycles
the 6 stage reels with fresh captions. Facebook is handled separately (native scheduling via Composio).

**Why a cron?** Instagram/LinkedIn/YouTube can't be auto-published from the Cowork session (they need
OAuth tokens). This repo holds the content + code; once you add your API tokens as **GitHub Secrets**,
the cron runs in GitHub's cloud with no machine of yours on.

## What's here
```
wine-social-cron/
├── .github/workflows/publish-reels.yml   ← the cron (Mon/Wed/Fri 16:00 UTC) + manual "Run workflow"
├── scripts/
│   ├── build_schedule.mjs   ← regenerate schedule.json (3/week through Aug 31)
│   └── publish.mjs          ← posts the next due reel to IG + YouTube; marks it posted
├── schedule.json            ← the dated plan (reel + IG caption + YouTube title/description per slot)
└── reels/                   ← the 6 stage reels (1080×1920, 30fps, narration+music+captions)
```

## Setup (one time)
1. **Create a GitHub repo** and push this folder:
   ```bash
   cd wine-social-cron
   git init && git add -A && git commit -m "wine.equipment social cron"
   gh repo create wine-social-cron --private --source=. --push   # or make it public (see IG note)
   ```
2. **Add Secrets** — repo → *Settings → Secrets and variables → Actions → New repository secret*.
   Each platform is **independent**: add only what you have and that platform turns on.

   **Instagram Reels** (needs an IG **Business/Creator** account linked to the wine.equipment FB Page):
   - `IG_USER_ID` — the IG Business account id (Graph API: `GET /me/accounts` → page → `instagram_business_account`).
   - `IG_ACCESS_TOKEN` — a **long-lived** Page access token with `instagram_content_publish` + `pages_read_engagement`.
   - **Video hosting:** IG needs a public URL to the .mp4. If the repo is **public**, it uses
     `raw.githubusercontent.com/...` automatically. If **private**, set `REEL_BASE_URL` to your own
     public base URL (e.g. a CDN/bucket where you upload `reels/`).

   **YouTube Shorts** (OAuth for your channel):
   - `YT_CLIENT_ID`, `YT_CLIENT_SECRET` — from a Google Cloud OAuth client (YouTube Data API v3 enabled).
   - `YT_REFRESH_TOKEN` — from the OAuth consent flow with scope `https://www.googleapis.com/auth/youtube.upload`.

   (LinkedIn can be added the same way later — the LinkedIn API needs an approved app + `w_member_social`.)

   **Facebook remainder** (optional — only if the local Composio run couldn't finish all posts):
   - `FB_PAGE_ID` = `1111872395344358`, `FB_PAGE_TOKEN` = a long-lived Page token with
     `pages_manage_posts` + `pages_read_engagement`.
   - `FB_IMG_BASE` (optional) = public base URL to `/pool/*.png` (defaults to this repo's raw URL if public).
   - The `fb-drain` workflow (daily 06:00 UTC) schedules ~45 queued posts/run until `fb-queue.json` is
     empty — this works around Facebook's daily scheduling cap that blocked the last ~90 posts in the
     initial bulk run. Remove the workflow (or leave the queue empty) once done.
3. **Enable Actions** (repo → Actions tab → enable). The reel cron runs on its schedule; the fb-drain
   runs daily until the queue drains.

## Test it now (no waiting for the cron)
Actions tab → **publish-reels** → **Run workflow** → optionally set `run_date`. Watch the log:
platforms without secrets are skipped; ones with secrets post the next due reel. Re-run to post the next.

## Change the plan
- Edit copy/cadence in `scripts/build_schedule.mjs`, then `node scripts/build_schedule.mjs` and commit.
- Add reels: drop a 1080×1920 mp4 in `reels/`, add it to `REELS` in the builder, rebuild.
- The cron posts the **oldest unposted due slot, one per run**, so a missed run self-heals on the next.

## Cost / safety
- GitHub Actions minutes: trivial (a few minutes, 3×/week). Free tier covers it.
- No cost per post from IG/YouTube APIs. Facebook (separate, Composio) is the only paid-per-post lane.
- The script never double-posts (it marks `posted` in schedule.json and commits it back).
