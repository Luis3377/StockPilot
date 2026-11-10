# AI Inventory Scanner (private beta)

Take or upload a photo of an item and Claude suggests its **name, brand, model, category, condition and a short description**. The suggestions fill the normal Add Item form, marked with an “AI” badge. The user checks and edits everything, enters the cost and quantity, and saves through the existing Add Item flow. The scanner **never** fills in cost, quantity, asking price, estimated value, purchase date or sales history.

The scanner is **off in the production build**. It appears only in a build made with `VITE_SCAN_API_URL` set, and only works with a private-beta invite code. Nothing in this document has been deployed or switched on.

---

## 1. How it works

```
Phone / browser (StockPilot preview build)        Cloudflare Worker (worker/)                     Anthropic API
------------------------------------------        ---------------------------                     -------------
1. User takes/uploads a photo.
   Resized on the device to ≤1600px JPEG.
   Saved with the item like any photo.
   Nothing is sent yet.
2. User taps “Analyze photo”  ──── POST /v1/scan ───▶  • checks the invite code (hashed, lockout)
   (invite code as Bearer token,                       • checks per-minute, per-code daily,
    photo as base64 JSON)                                global daily and monthly-budget limits
                                                         in one atomic step, reserving the
                                                         worst-case cost
                                                       • validates the image (size, real format)
                                                       • sends it to Claude ─────────────────────▶  Claude (Sonnet 5.5
                                                         (API key lives only here)                  by default) returns
                                                       • validates the JSON answer  ◀─────────────  structured JSON
                                                       • settles the actual cost
3. App validates the answer again,  ◀──── result ─────  • forgets the photo (never stored or logged)
   fills only empty or AI-filled fields.
4. User reviews, edits, adds cost → Add item.
```

- **One shared result schema** (`src/ai/scanSchema.ts`) is used by the Worker, the app and the model-comparison script: the JSON schema sent to Claude (structured outputs), the prompt, and the validator. The validator drops unknown fields (so a price or quantity in a response is ignored), turns “unknown”-style answers into blanks, strips control characters, caps lengths and keeps the status consistent.
- **The form mapping** (`src/ai/applySuggestion.ts`) only touches name, category, condition and notes. A field the user typed in is never overwritten; a second scan replaces the earlier AI suggestions (and clears ones the new scan has nothing for).
- **Model**: Claude Sonnet 5.5 by default; Haiku 5.5 and Opus 5.5 are one setting away (`SCAN_MODEL`). Effort `low`, up to 2,048 output tokens, 25-second timeout, no automatic retries.
- **If anything fails** — no connection, timeout, AI outage, limits reached, a malformed answer — the user sees a plain message with “Try again” (when it can help) and “Enter details manually”. The normal Add Item form always works.

### Where the code lives

| Path | What it does |
| --- | --- |
| `src/ai/scanSchema.ts` | Result type, JSON schema, prompts, validator (shared) |
| `src/ai/applySuggestion.ts` | Which form fields a result may fill, and how |
| `src/ai/config.ts` | Build flag (`VITE_SCAN_API_URL`), timeout, privacy link |
| `src/ai/scanClient.ts` | Calls the Worker; error codes and messages |
| `src/ai/testerCode.ts` | Invite code kept in this browser only (never in backups) |
| `src/pages/dialogs/ScanPanel.tsx` | The “Scan with AI” panel in Add Item, invite-code form, privacy notes |
| `src/pages/ScannerSettings.tsx` | Settings → AI scanner (save, check, remove code) |
| `worker/src/handler.ts` | HTTP routes, CORS, order of checks, error mapping, logging |
| `worker/src/ledgerCore.ts` | Invite codes, limits and budget in a SQLite Durable Object |
| `worker/src/claude.ts` | The only code that talks to Claude (official Anthropic SDK) |
| `worker/src/image.ts`, `codes.ts`, `config.ts` | Image checks, code generation/hashing, settings and prices |
| `worker/scripts/admin.mjs` | Create, list and revoke invite codes; check usage |
| `worker/scripts/compare-models.ts` | Opt-in, billed comparison of the three models on your photos |

---

## 2. Safeguards

**API key.** Only in the Worker, as an encrypted Cloudflare secret. It is never in the app, the repository, the build or the logs.

**Invite codes** (private beta access, not user accounts):
- Random 100-bit codes like `SP-7KQ2M-…`, created with the admin tool. The Worker stores only an HMAC-SHA256 hash (keyed with the `CODE_PEPPER` secret), so a leaked database doesn't reveal codes.
- Each code has a label, a daily limit (default 20) and an expiry (default 30 days, max 90). Revoking takes effect on the next request.
- Brute force: 10 wrong codes in 15 minutes from one network (IPv4 address, or IPv6 /64) locks it out for the rest of the window. Codes are looked up by their hash; the admin token is compared in constant time.
- Codes are kept in the tester's browser storage only, never in backups or exports. Anyone holding a code can use its daily allowance, so treat codes like a password and revoke any that leak.

**Limits, checked on the server in a single atomic step** (one SQLite Durable Object processes every check-and-update as a transaction, so simultaneous requests can't slip past a limit — tested with 400 concurrent requests in unit tests and 10 concurrent scans in the real Workers runtime):

| Limit | Default | Setting |
| --- | --- | --- |
| Scans per code per minute | 6 | `SCANS_PER_MINUTE_PER_CODE` |
| Scans per code per day | 20 | per code (`--daily`), default `DAILY_SCANS_PER_CODE` |
| Scans per day, all testers | 200 | `DAILY_SCANS_GLOBAL` |
| AI spend per calendar month | $10 | `MONTHLY_BUDGET_USD` |

Days and months are UTC (daily limits reset at midnight UTC). Failed scans are refunded to the daily counts; their actual AI cost (if any) still counts toward the budget.

**Budget enforcement.** Before every AI call the Worker reserves the worst-case cost of that scan (6,500 input + 2,048 output tokens at the model's price: Haiku $0.0017, Sonnet $0.0335, Opus $0.067). A scan is refused if the month's settled spend plus all in-flight reservations plus this reservation would exceed the budget. After the call the reservation is replaced by the actual cost from the API's token counts. A timed-out call is charged at the worst case (the provider may have billed it), and a reservation that is never settled is charged in full after 10 minutes. Prices are in `worker/src/config.ts`; update them if Anthropic's published prices change.

**Spending safeguards, in layers.** The Worker's budget is the main control, but it is software that depends on correct prices and configuration, so also use these backstops:
1. The Worker's enforced monthly budget and scan limits (above).
2. A dedicated Anthropic workspace for the scanner with its own API key, and a monthly spend limit on that workspace if the Console offers one for your account.
3. Prepaid credits with **auto-reload turned off**, so the API stops when the credit runs out. This is a last-resort backstop, not a guarantee: billing is not instantaneous, so do not rely on it alone.
4. The kill switch (`SCANNER_ENABLED=false`) and key revocation in the Console, which stop all AI calls immediately.

**Images.** Accepted only as JPEG, PNG or WebP, detected from the file's actual bytes (not its name or declared type), 512 bytes to 4 MB, exactly one per request. A request that declares a body over the limit is refused before the body is read; others are checked as they're read. The image is held in memory for the request only — never written to storage, logs or analytics.

**Other.** Only the preview site served by the Worker itself and origins listed in `ALLOWED_ORIGINS` can call the API from a browser. Admin endpoints require the `ADMIN_TOKEN` secret, refuse browser requests and don't exist when the token isn't set. Logs record event type, code id, model, status, token counts, cost and timing — never the image, the invite code or the AI's text. The AI answer is validated twice (Worker and app) before anything reaches the form.

**Refusals.** If Claude declines to analyze a photo (`stop_reason: "refusal"`), the user sees “Couldn’t identify this item” and enters details by hand. Server-side refusal fallbacks to another model are deliberately **not** enabled: they would bill a second model inside one request, which the per-scan cost reservation doesn't cover.

---

## 3. What happens to photos (privacy)

Shown to users in the scan panel and in Settings → AI scanner:

- Nothing is sent until the user taps **Analyze photo**. Choosing a photo alone sends nothing.
- The StockPilot Worker passes the photo to Anthropic and does not store or log it.
- **Anthropic's API retention:** Anthropic automatically deletes API inputs and outputs within 30 days and does not use them to train models by default. Content flagged by its safety systems can be kept longer. Zero data retention is available from Anthropic by agreement. Policy: <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data> (re-check it before launch; policies change).
- The photo is also saved with the item **on the device**, like any other item photo.

Tell testers not to photograph people, documents, addresses or anything sensitive. Update the privacy policy before any public launch.

---

## 4. Costs

### AI (Anthropic, pay per use)

Published prices per million tokens (input / output): **Haiku 5.5 $0.10 / $0.50**, **Sonnet 5.5 $2 / $10**, **Opus 5.5 $4 / $20**.

A typical scan sends a ~1600×1200 photo (~2,500 image tokens) plus ~800 tokens of instructions and schema, and gets back ~250–800 output tokens (the JSON answer plus brief reasoning at low effort). These are estimates; the comparison script measures the real numbers.

| Model | Typical cost per scan | Worst case per scan | Scans per $10 (typical) | Cost at the 200/day limit for a month (6,000 scans) |
| --- | --- | --- | --- | --- |
| Haiku 5.5 | ~$0.0005–0.0007 | $0.0017 | ~14,000+ | ~$3–4 (the daily limit binds before the budget) |
| Sonnet 5.5 | ~$0.009–0.015 | $0.0335 | ~650–1,100 | ~$55–90 → the $10 budget stops scanning first |
| Opus 5.5 | ~$0.018–0.03 | $0.067 | ~330–550 | ~$110–175 → the $10 budget stops scanning first |

So with Sonnet, **$10/month covers roughly 650–1,100 scans** (about 20–35 a day). That suits a beta of a handful of testers; with 10 active testers doing 5 scans a day (~1,500 a month) the budget would run out around day 15–20, after which scanning pauses until the next month (manual entry keeps working). Raise `MONTHLY_BUDGET_USD` or lower limits as needed.

Running the model comparison on 30 photos with all three models costs about **$1 typically, $3.06 at most**.

### Hosting (Cloudflare)

- **Workers Free plan ($0):** 100,000 requests/day, SQLite-backed Durable Objects included. A scan is one Worker request plus three small ledger calls, so the beta uses a tiny fraction of this. Serving the preview app's static files is free.
- **Risk:** the free plan allows 10 ms of CPU time per request. The Worker does little computing (waiting on Claude doesn't count), and it stayed well within this in local testing, but large photos could push it close. If Cloudflare reports “exceeded CPU time” errors, switch to **Workers Paid ($5/month)**, which allows far more.

**Expected total for the beta: about $10/month for AI (capped) + $0–5/month for Cloudflare.**

---

## 5. Activating the private testing version

The private testing version is a **separate copy of the app** served by the Worker at `https://stockpilot-scanner.<your-subdomain>.workers.dev`, with the scanner switched on. The production site on GitHub Pages is not touched. Because it's a different web address, the browser keeps its data **separately** from the production app: testers start empty (or restore a backup made in the production app).

You need: a computer with Node.js 20+ (22 recommended), git and a terminal; an Anthropic account; a Cloudflare account. About 30 minutes.

### Step 1 — Anthropic (API key and spending backstops)

1. Sign in to the Claude Console (<https://platform.claude.com>) and set up billing.
2. **Billing:** buy a small prepaid credit (e.g. $10–15) and make sure **auto-reload is OFF**.
3. **Workspaces:** create a workspace named e.g. “StockPilot scanner beta”. If the Console offers a spend limit for it, set it to $10/month.
4. **API keys:** create a key **in that workspace**, named e.g. “scanner-worker”. Copy it once into your password manager. Never paste it into chat, code, the app or a commit.

### Step 2 — Get the code and tools

```bash
git clone https://github.com/Luis3377/StockPilot.git
cd StockPilot
git checkout feature/ai-scanner      # until the scanner PR is merged
npm ci
cd worker
npm ci
npx wrangler login                   # opens Cloudflare in the browser
```

### Step 3 — Deploy the Worker and preview app

```bash
npm run deploy:preview               # builds the preview app with the scanner on, then deploys
```

If Wrangler asks you to pick a workers.dev subdomain, choose one (e.g. your name). The output prints the address, e.g. `https://stockpilot-scanner.<your-subdomain>.workers.dev`. At this point scanning is **off**, because the secrets aren't set (`/health` says `"scanner":"unavailable"`).

### Step 4 — Add the secrets

Generate two long random values (keep them in your password manager):

```bash
openssl rand -hex 32                 # → use as CODE_PEPPER
openssl rand -hex 32                 # → use as ADMIN_TOKEN
```

Then, still in `worker/`, enter each one when prompted:

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key from Step 1
npx wrangler secret put CODE_PEPPER
npx wrangler secret put ADMIN_TOKEN
```

Keep `CODE_PEPPER` stable: changing it invalidates every existing invite code.

### Step 5 — Check it's ready

```bash
curl https://stockpilot-scanner.<your-subdomain>.workers.dev/health
# {"ok":true,"scanner":"ready","model":"claude-sonnet-5-5"}

export SCANNER_URL=https://stockpilot-scanner.<your-subdomain>.workers.dev
read -s SCANNER_ADMIN_TOKEN && export SCANNER_ADMIN_TOKEN    # paste the ADMIN_TOKEN, press Enter
npm run admin -- usage
# Scanner: ready · claude-sonnet-5-5 · effort low
# Today (…): 0/200 scans
# This month (…): $0.0000 spent, $0.0000 in flight, budget $10.00
```

### Step 6 — Create invite codes

```bash
npm run admin -- create "Luis" --days 30 --daily 20
npm run admin -- create "Tester: Maria" --days 14
```

Each code is printed **once**. Send it privately (not in a group chat). One code per tester, so you can see and revoke individually.

### Step 7 — Try it yourself first

On your phone, open the workers.dev address → choose a mode → **Inventory → Scan with AI** → take a photo → enter your invite code → **Analyze photo**. Check the suggestions, add a cost, save. Then `npm run admin -- usage` to see the scan and its cost.

### Everyday operations

| Task | Command / action |
| --- | --- |
| List codes and today's use | `npm run admin -- list` |
| Turn a code off | `npm run admin -- revoke <id>` |
| Today's scans, month's spend, config status | `npm run admin -- usage` |
| Live logs (no photos or codes) | `npx wrangler tail` |
| Switch model | Edit `SCAN_MODEL` in `worker/wrangler.toml` (`claude-haiku-5-5`, `claude-sonnet-5-5` or `claude-opus-5-5`), then `npm run deploy:preview` |
| Change limits or budget | Edit the values in `[vars]` in `wrangler.toml`, then `npm run deploy:preview` |
| Update the preview app after code changes | `npm run deploy:preview` |
| **Stop all AI calls now** | Fastest: Cloudflare dashboard → Workers → stockpilot-scanner → Settings → Variables → `SCANNER_ENABLED` = `false`. Then make the same change in `wrangler.toml` so the next deploy keeps it. For a hard stop, also delete the key in the Claude Console. |
| Remove everything | `npx wrangler delete`, then delete the API key in the Console |

Note: every deploy uses the values in `wrangler.toml`, overriding variables changed in the Cloudflare dashboard. Keep `wrangler.toml` as the source of truth. Secrets are not affected by deploys.

To run the app somewhere other than the Worker (e.g. `npm run dev` on your computer against the deployed Worker), build it with `VITE_SCAN_API_URL=https://stockpilot-scanner.<you>.workers.dev` and add that site's origin to `ALLOWED_ORIGINS`.

### Turning it on in production (later, needs your decision)

Not done, and not needed for the beta. It would mean building the GitHub Pages site with `VITE_SCAN_API_URL` set and adding `https://luis3377.github.io` to `ALLOWED_ORIGINS`. Before that: finish the model comparison, review costs and limits, update the privacy policy, and replace invite codes with real accounts (see `PRODUCTION_READINESS.md`).

---

## 6. Choosing the model (Haiku vs Sonnet vs Opus)

`worker/scripts/compare-models.ts` runs your photos through each model with **exactly** the production prompt, schema, effort and validation, and records the answers, speed, tokens and cost.

1. **Collect 25–30 real photos** across shoes, electronics, clothing, collectibles and tools, including a few hard ones (blurry, unbranded, partly hidden, several items). Put them in one folder as JPEG/PNG/WebP. For a fair cost comparison, resize to 1600px on the long side like the app does — on a Mac: `mkdir resized && sips -s format jpeg -Z 1600 *.HEIC --out resized/` (iPhone HEIC photos must be converted to JPEG anyway; the script reads the file contents, so the kept `.HEIC` name is fine).
2. *(Optional)* a `labels.csv` with lines like `IMG_0412.jpg,Nike Air Jordan 1 Chicago size 10` — shown next to each photo while you judge.
3. **Dry run** (free — prints the plan and worst-case cost):
   ```bash
   cd worker
   npm run compare-models -- --photos ~/scanner-photos --labels ~/scanner-photos/labels.csv
   ```
4. **Real run** (billed; stops if the worst case is above `--max-usd`, default $5):
   ```bash
   read -s ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
   npm run compare-models -- --photos ~/scanner-photos --labels ~/scanner-photos/labels.csv --confirm-cost
   unset ANTHROPIC_API_KEY
   ```
5. Open `compare-results-…/review.html`, mark each answer **right / partly / wrong**; the accuracy tally per model updates as you go. `summary.md` has median and 90th-percentile time, tokens and cost per scan; `results.csv` has every answer.

**How to decide:** pick the cheapest model whose accuracy is within a few points of the best, with a median time you're happy to wait on a phone (under ~5–6 seconds feels fine). Also look at *how* models fail: a model that says “couldn’t identify” is better than one that confidently names the wrong product. Watch for errors in the results — a `max_tokens` error means the 2,048-token output cap was too low for that model. Then set `SCAN_MODEL` and redeploy.

---

## 7. Safe testing plan

1. **You first.** A day of scanning your own items; check `usage` and the Console's usage page agree on spend.
2. **2–3 trusted testers** with 14-day codes. Tell them: the beta sends photos you analyze to Anthropic's Claude; don't photograph people, documents or anything private; AI suggestions can be wrong — always check before saving; the preview app keeps its data separately from the main app.
3. **Check daily for the first week:** `npm run admin -- usage` and `list`, and the Anthropic Console's usage and cost pages. Revoke codes of testers who stop testing.
4. **Widen gradually**, adjusting limits to the budget (see the cost table).
5. **When the beta ends:** revoke all codes, set `SCANNER_ENABLED = "false"`, delete or rotate the API key.

---

## 8. Known limitations

- AI suggestions can be wrong or incomplete; the user must review them. Confidence labels come from the model and aren't calibrated.
- Invite codes are a beta gate, not authentication: anyone holding a code can use its daily allowance until it's revoked or expires. Real accounts are required before a public launch.
- The model choice is still open until the comparison is run with real photos and a real key; Sonnet 5.5 is the provisional default.
- Budget tracking relies on token counts reported by the API and on the prices in `worker/src/config.ts`; if prices change, update that file.
- Not yet tested on real phones and cameras (all tests use desktop and iPhone-sized Chromium). Check camera capture on iPhone Safari and Android Chrome before inviting testers.
- The Workers free plan's 10 ms CPU limit hasn't been measured on Cloudflare itself (only locally); see Costs for the $5 fallback.
- All limits reset on UTC days and months.
- One Durable Object handles every scan's bookkeeping: fine for a beta (hundreds of scans a day), not designed for very high traffic.
- The preview app keeps its data separately from the production app (different web address).

---

## 9. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `/health` says `"unavailable"` | Run `npm run admin -- usage` to see why (missing `ANTHROPIC_API_KEY`, `SCANNER_ENABLED` false, unknown `SCAN_MODEL`). If `admin` returns “Not found”, `ADMIN_TOKEN` or a `CODE_PEPPER` of 32+ characters is missing. |
| “That invite code isn’t valid” | Typo, or the code was created before `CODE_PEPPER` changed. Create a new one. |
| “Too many incorrect codes” | Lockout after 10 wrong codes in 15 minutes from one network. Wait 15 minutes. |
| “AI scanning is paused for the rest of this month” | The monthly budget is used up. Wait for the 1st (UTC), or raise `MONTHLY_BUDGET_USD` and run `npm run deploy:preview`. |
| “The AI service had a problem” every time | Check `npx wrangler tail`. An `auth` detail means the API key is wrong or revoked; a `bad request` detail names the problem. |
| Browser console shows a CORS error | The app is running on an origin not in `ALLOWED_ORIGINS`. Add it and run `npm run deploy:preview`. |
| “exceeded CPU time” in `wrangler tail` | Move the Worker to Workers Paid ($5/month). |

---

## 10. Tests (no AI charges)

All automated tests mock the AI; none reach Anthropic.

- `npm test` (root): schema validation, unknown/partial/malformed answers, prices and quantities dropped, field mapping and re-scan rules.
- `npm run test:e2e`: `e2e/scanner.spec.ts` runs against a second build with the scanner on (port 4175) and a mocked API — shoes, electronics, clothing, collectibles and tools; unrecognized and partial results; ignored price/quantity fields; malformed answers; non-image and corrupt uploads (nothing sent); no request before Analyze; invite code entry, rejection and replacement; daily limit, budget, AI outage with retry, no connection, timeout, cancel; user corrections kept across re-scans; saving with photo; Settings; edit-item has no scanner; invite code never in backups; phone layout; and the standard build shows no scanner at all.
- `cd worker && npm test`: invite codes, image checks, Claude request/answer handling, limits and budget (including 400 concurrent requests), every HTTP route.
- `cd worker && npm run test:integration`: runs the real Worker locally (Cloudflare's `workerd` runtime) against a mock Anthropic server — end-to-end scans, the API key never reaching the browser, limits under concurrent load, the admin CLI, revocation, lockout and origin checks.
