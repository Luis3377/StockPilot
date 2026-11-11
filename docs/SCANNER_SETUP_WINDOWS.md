# Setting up the AI scanner test version (Windows)

This guide takes you from nothing to your first real AI scan, on a Windows PC. It sets up a **separate, private test copy** of StockPilot with the AI scanner switched on. Your live site at `luis3377.github.io/StockPilot` is not touched by anything here.

**Time:** about 45 minutes the first time.
**Cost:** a small prepaid AI credit (e.g. $10) plus about 1–1.5 cents per scan. Cloudflare is free for this.
**You'll end up with:**
- a private web address like `https://stockpilot-scanner.yourname.workers.dev`
- an invite code
- your first scanned item

> **Keep these secret, always:** the Anthropic **API key**, the **admin token** and the **code pepper** (you'll create all three). Store them in a password manager (Bitwarden, 1Password, the Microsoft Edge/Google password manager, etc.). Never paste them into chat, email, a text file on the desktop, a screenshot, or any file in the StockPilot folder. Invite codes are less sensitive but still private: send each one only to the person it's for.

Menus on the Cloudflare and Anthropic websites change from time to time. If a label below doesn't match exactly, look for the closest one.

---

## Part 0: Install the tools (one time)

### 0.1 Install Node.js
1. Go to <https://nodejs.org> and download the **LTS** version for Windows (the `.msi` installer).
2. Run it and accept the defaults (Next → Next → Install). You don't need the optional "Tools for native modules".

### 0.2 Install Git
1. Go to <https://git-scm.com/download/win> and download **Git for Windows**.
2. Run it and accept the defaults.

### 0.3 Open PowerShell
Press the **Windows key**, type **Terminal** (Windows 11) or **PowerShell** (Windows 10), and open it. All commands in this guide are typed there: type or paste a line and press **Enter**. To paste, use **Ctrl+V** or right-click.

Check both tools are installed:

```powershell
node --version
git --version
```

You should see `v22.12.0` or higher (v24 or v26 are fine too) and `git version 2.x`. If you see "not recognized", close PowerShell, open it again, and retry. If Node is older than 22.12, install the current LTS from nodejs.org over it: Cloudflare's tools need 22.12 or newer.

### 0.4 Allow npm to run (one time)
Windows blocks some scripts by default, including the one that runs `npm`. Allow scripts for your user account only:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Type **Y** and press Enter if asked.

### 0.5 Download StockPilot's code

```powershell
cd $HOME
git clone https://github.com/Luis3377/StockPilot.git
cd StockPilot
git checkout feature/ai-scanner
npm ci
cd worker
npm ci
```

This puts the code in `C:\Users\<you>\StockPilot`. If Git asks you to sign in to GitHub, do so in the browser window that opens. `npm ci` downloads the building blocks and takes a minute or two; warnings are normal.

**From now on, run commands from the `worker` folder.** If you open a new PowerShell window later, go back there first:

```powershell
cd $HOME\StockPilot\worker
```

---

## Step 1: Create a Cloudflare account

Cloudflare runs the small backend (the "Worker") that holds the API key and enforces the limits. The free plan is enough.

1. Go to <https://dash.cloudflare.com/sign-up>, enter your email and a password, and confirm your email. You don't need a domain or a credit card.
2. In PowerShell (in the `worker` folder), connect your computer to the account:

   ```powershell
   npx wrangler login
   ```

   A browser window opens and asks you to allow Wrangler (Cloudflare's tool). Click **Allow**. Back in PowerShell you'll see "Successfully logged in". To check:

   ```powershell
   npx wrangler whoami
   ```

## Step 2: Create an Anthropic API account

Anthropic makes Claude, the AI that looks at the photos. The API account is separate from any Claude.ai chat subscription, and it's billed separately.

1. Go to <https://platform.claude.com> (the Claude Console) and sign up with your email or Google account.
2. Follow the prompts: confirm your email, add your name, and create an organization (e.g. "StockPilot").

## Step 3: Set a small prepaid AI testing budget

You'll set several independent limits. Each one catches what the others might miss.

1. **Prepaid credit with auto-reload OFF.**
   - In the Console, go to **Settings → Billing**.
   - Add a payment card, then buy credit: **$10** is plenty for testing (or the minimum the Console allows).
   - Make sure **auto-reload is turned off**. When the credit runs out, the API stops working until you add more.
2. **A separate workspace with a spend limit.**
   - Go to **Settings → Workspaces → Create workspace**, and name it `StockPilot scanner beta`.
   - If the workspace has a **spend limit** setting (sometimes under "Limits"), set it to **$10 per month**.
3. **The Worker's own budget**, already set in the code: $10 a month, 20 scans per tester per day, 200 scans per day in total.

> **Good to know:** the Worker's budget is a **software safeguard, not an absolute guarantee**. It calculates costs from Anthropic's published prices. Anthropic's billing is the real record and updates with a short delay. That's why the prepaid credit and workspace limit are also in place, and why Step 8 shows how to compare the two.

## Step 4: Create the API key and the backend secrets (and keep them safe)

You'll create three secrets and store them in your password manager. You'll put them into Cloudflare in Step 5.

1. **The API key.**
   - In the Console, go to **API keys → Create key**.
   - Choose the **StockPilot scanner beta** workspace and name the key `scanner-worker`.
   - Click **Copy** and paste it straight into your password manager, as "StockPilot – Anthropic API key". The Console shows it only once.
2. **The code pepper and the admin token.** In PowerShell, run this line **twice**:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Each run prints a different random 64-character value.
   - Save the first one as **"StockPilot – CODE_PEPPER"**. It protects the invite codes. Never change it later, or all invite codes stop working.
   - Save the second one as **"StockPilot – ADMIN_TOKEN"**. It's your password for managing invite codes.

   Then clear the screen so they're not left on display:

   ```powershell
   Clear-Host
   ```

## Step 5: Deploy the private test version

1. **Deploy.** In the `worker` folder:

   ```powershell
   npm run deploy:preview
   ```

   This builds the test copy of the app with the scanner switched on and uploads it with the Worker.
   - The first time, Wrangler may ask you to choose a **workers.dev subdomain**. Pick something short in lowercase, like your name.
   - At the end it prints your address, like `https://stockpilot-scanner.yourname.workers.dev`. Save it (it isn't secret).
   - **Scanning is still off at this point**, because the secrets aren't set yet. That's deliberate.

2. **Add the three secrets to Cloudflare.** Run each line. When it says `Enter a secret value:`, paste the matching value from your password manager and press Enter. Nothing appears as you paste; that's normal, it's hidden.

   ```powershell
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put CODE_PEPPER
   npx wrangler secret put ADMIN_TOKEN
   ```

   Each one should end with "Success!". Cloudflare stores them encrypted; they're never in the code or on the website.

3. **Check it's ready.** Open `https://stockpilot-scanner.yourname.workers.dev/health` in your browser (with your own address). You should see:

   ```
   {"ok":true,"scanner":"ready","model":"claude-sonnet-5-5"}
   ```

   If it says `"unavailable"`, a secret is missing. Step 5.4 shows which one.

4. **Connect the admin tool.** Run these in PowerShell, using your own address. The second line asks for the admin token: paste it from your password manager (it won't show) and press Enter.

   ```powershell
   $env:SCANNER_URL = "https://stockpilot-scanner.yourname.workers.dev"
   $t = Read-Host -AsSecureString "Admin token"
   $env:SCANNER_ADMIN_TOKEN = [System.Net.NetworkCredential]::new("", $t).Password
   node scripts/admin.mjs usage
   ```

   You should see something like:

   ```
   Scanner: ready · claude-sonnet-5-5 · effort low
   Prices used for the budget: $2 / $10 per million input / output tokens (compare with Anthropic's pricing page)
   Reserved per scan (worst case): $0.0348
   Today (2026-11-12 UTC): 0/200 scans
   This month (2026-11): $0.0000 spent, $0.0000 in flight, budget $10.00
   ```

   If it says `Scanner: OFF`, the reason follows (for example "ANTHROPIC_API_KEY secret is not set"). Repeat that part of step 2.

   These settings last only until you close the PowerShell window. Next time, run the four lines again.

## Step 6: Create your first tester invitation code

```powershell
node scripts/admin.mjs create "Luis" --days 30 --daily 20
```

This prints a code like `SP-7KQ2M-…` **once**. Save it in your password manager. The code works for 30 days, with up to 20 scans a day.

For each tester later, create their own code (e.g. `node scripts/admin.mjs create "Tester: Maria" --days 14`). Send it privately, not in a group chat. To see your codes (without revealing them) and turn one off:

```powershell
node scripts/admin.mjs list
node scripts/admin.mjs revoke code_abc123
```

## Step 7: Take your first real photo and scan it

1. **Open the test site on your phone.** Text or email yourself the address from Step 5 (it isn't secret; the invite code is what unlocks scanning) and open it.
   - Optional: use your browser's **Add to Home Screen** to get an app icon.
   - The test site keeps its data separately from your live StockPilot site, so it starts empty. Choose your mode and **Start with my own inventory**.
2. **Start a scan.** Go to **Inventory → Scan with AI → Take photo**.
3. **Take a good photo:** one item, good light, a plain background, and the brand or label visible.
4. **Enter your invite code** when asked, then tap **Save code**. You only need to do this once per phone.
5. **Tap Analyze photo.** This is the only moment the photo is sent. After a few seconds you'll see **Suggested details**, and the name, category, condition and notes are filled in with an **AI** badge.
6. **Check everything.**
   - Fix anything that's wrong; AI suggestions can be mistaken.
   - Enter the **cost** and **quantity** yourself (the scanner never guesses money or amounts).
   - Tap **Add item**.

## Step 8: Check actual usage and costs

1. **The Worker's count** (immediate):

   ```powershell
   node scripts/admin.mjs usage
   ```

   "This month: $0.0xxx spent" is the Worker's own calculation. One Sonnet scan is usually about **$0.01–0.015**.

2. **Anthropic's bill** (the real record; can take from a few minutes to a few hours to update): in the Claude Console, open **Usage** and **Cost**, and filter to the **StockPilot scanner beta** workspace.

3. **Compare them.**
   - They should be close. The Worker's figure may be **slightly higher**, because it charges failed attempts conservatively.
   - If **Anthropic's figure is clearly higher than the Worker's**, stop the scanner (below) and look into it before going on.
   - Do this daily during the first week of testing.

4. **Cloudflare's view.** In the Cloudflare dashboard, open **Workers & Pages → stockpilot-scanner** and look at **Metrics** (requests and errors) and **Logs**. For live logs while you scan, run `npx wrangler tail`; press **Ctrl+C** to stop. Logs never contain photos or invite codes.

---

## Emergency stop

Use either of these, whichever is quicker:

- **Turn the scanner off** (it can be turned back on): Cloudflare dashboard → **Workers & Pages → stockpilot-scanner → Settings → Variables and Secrets**. Set **SCANNER_ENABLED** to `false` and save/deploy.
  - Afterwards, also change `SCANNER_ENABLED = "true"` to `"false"` in `worker\wrangler.toml`, so the next deploy keeps it off.
- **Hard stop:** Claude Console → **API keys** → delete `scanner-worker`. All AI calls stop immediately. To resume, create a new key and repeat the `ANTHROPIC_API_KEY` line from Step 5.

## Later: updating the test version

When the code changes (for example after a fix), run this in PowerShell:

```powershell
cd $HOME\StockPilot
git pull
npm ci
cd worker
npm ci
npm run deploy:preview
```

Secrets and invite codes stay as they are.

## Optional: compare Haiku, Sonnet and Opus on your own photos

This runs 25–30 of your photos through all three models and costs about **$1** (at most about $3.18).

1. **Take the photos as JPEG.** Before taking them on an iPhone, set **Settings → Camera → Formats → Most Compatible**.
2. **Resize them to 1600 px** with Microsoft **PowerToys → Image Resizer** (custom size 1600 × 1600). Put them in a folder, e.g. `C:\Users\<you>\scanner-photos`.
3. **Do a free dry run**:

   ```powershell
   npx tsx scripts/compare-models.ts --photos $HOME\scanner-photos
   ```

4. **Do the real run.** The key is read without showing it, and removed afterwards:

   ```powershell
   $k = Read-Host -AsSecureString "API key"
   $env:ANTHROPIC_API_KEY = [System.Net.NetworkCredential]::new("", $k).Password
   npx tsx scripts/compare-models.ts --photos $HOME\scanner-photos --confirm-cost
   Remove-Item Env:ANTHROPIC_API_KEY
   ```

5. **Review the results.** Open the `review.html` file it creates and mark each answer right, partly or wrong. Details are in [AI_SCANNER.md](AI_SCANNER.md#6-choosing-the-model-haiku-vs-sonnet-vs-opus).

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "running scripts is disabled on this system" | Do step 0.4. |
| "'node' (or 'git') is not recognized" | Close and reopen PowerShell after installing. If it still fails, reinstall with the default options. |
| `npx wrangler login` doesn't open a browser | Copy the link it prints into your browser. |
| `/health` says `"unavailable"` | Run `node scripts/admin.mjs usage` to see which setting is missing, then repeat that part of Step 5. |
| The admin tool says "Not found" or "Admin token required" | The admin token you pasted doesn't match the one in Cloudflare. Paste it again (step 5.4), or set it again with `npx wrangler secret put ADMIN_TOKEN`. |
| "That invite code isn't valid" | Check for typos (capital or small letters, spaces and dashes don't matter), or create a new code. |
| "You've used all of today's scans" | The daily limit is reached; it resets at midnight UTC (evening in the US: 7 pm Eastern in winter, 8 pm in summer). |
| "AI scanning is paused for the rest of this month" | The $10 monthly budget is used up. Scanning resumes on the 1st. Manual entry always works. |
| Anything else | See the troubleshooting table in [AI_SCANNER.md](AI_SCANNER.md#9-troubleshooting). |
