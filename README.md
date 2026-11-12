# Apartment Finder

A personal apartment-search assistant for Vancouver: discover new rentals, filter and score
them against private criteria, remove duplicates, and manage promising homes in a Sorting
Desk through to signing a lease.

The application is a standalone private web app with a background scanner. It runs
independently of a coding assistant or chat session.

## Status

The first local version is implemented. **No live scan has been run.** Startup and demo mode
never scan. Each live run requires explicit approval of a single bounded plan. Recurring scans
are disabled. See the implementation scope and remaining work below.

## Run locally

For everyday use on this PC, double-click **Apartment Finder** on the Desktop, or
`Open Apartment Finder.cmd` in the project folder. The app starts quietly and opens in your
default browser. Opening it again reuses the running server. No build commands are needed
each time, and opening the app never starts a scan.

Closing the browser leaves the local app running. Double-click `Stop Apartment Finder.cmd`
to stop it when finished; saved data is retained. The stop button refuses to interrupt an active
scan. Logs are in the gitignored `data/launcher/` directory. Nothing starts automatically when
Windows starts. The commands below are for development or a fresh installation.

Requires Node 24. Dependencies are pinned in `package-lock.json`.

```powershell
npm ci
npx playwright install chromium --only-shell
npm run build
npm start
```

Open `http://127.0.0.1:4317`. For fictional apartments in an isolated database:

```powershell
npm run demo
```

The demo uses `http://127.0.0.1:4318` and cannot start live scans. On this Windows installation,
the launcher also finds the installed Node runtime when the shell shim is inactive:

```powershell
powershell -File scripts/start.ps1
powershell -File scripts/start.ps1 -Demo -Dev
```

Stop the server with Ctrl+C. Nothing is installed into Windows startup or Task Scheduler.

## Implemented

- Sorting Desk with search, sorting, comparison, shortlist/stages, notes, follow-up/viewing
  dates, inquiry drafts, calendar downloads, rejection explanations and Rescue.
- SQLite persistence, source-posting identity, exact address/unit deduplication, change history,
  user-decision undo, export and database backups. Scanner updates preserve user decisions.
- Deterministic scores with hard laundry/budget/view gates, explicit uncertainty and bonuses.
  The private initial settings calibrate the user's price/location examples; public defaults
  contain no personal budget. Historic reference IDs #1–#13 are reserved in the live database;
  historical listings remain in the private research ledger and are not imported automatically.
- Strict single-run approval, page/listing/photo/AI-call caps, persisted counters, cancellation,
  source cooldowns, request allowlists, sequential pages and persistent browser profiles.
  Bounded page snapshots are saved privately for adapter debugging without repeat visits.
- Craigslist and VADA parser/worker implementations awaiting capped live validation. The other
  twelve candidate sources are listed but disabled; their adapters remain to be implemented.
  liv.rent and PadMapper are excluded.
- Full enumerated-gallery processing with pending/unavailable states, local images and assessment
  reuse by image hash/model rubric. An optional OpenAI Responses photo provider sits behind a
  replaceable interface. Credentials and a model must be configured separately; none are supplied.

## First scan and cost control

Preparing a plan makes no external requests. Approval expires after one hour and cannot be
reused. The requested live trial is **three apartments per implemented source**, with every
accessible gallery photo reviewed unless the apartment already fails a hard requirement.
The discovery page counts as one page. A cap leaves remaining work explicitly pending.
No live trial has run yet; account connection and model selection are still needed.

**ChatGPT plan usage is the default.** In Preferences, select **Continue with ChatGPT**, sign in,
and allow use of your ChatGPT plan. Then load the available models and choose one that supports
images. This uses the documented local personal-app integration; account eligibility and live
photo inference remain unverified until the user connects and a request completes.

In ChatGPT Settings → Usage, set an app limit and turn off purchased-credit overflow if shown.
The app cannot change that setting or read the remaining weekly allowance. Scans enforce a
local AI-call cap and stop analysis on errors or usage limits. There is no automatic paid API
fallback. No API payment method or API key is needed for this sign-in route.

Credentials are encrypted with Windows DPAPI for the current Windows user and saved under
gitignored `data/live/chatgpt/`. Sign-out clears tokens but preserves the host/client registration
for reconnection. The app supports saved accounts and a model picker. This connection currently
requires Windows; credentials cannot be moved to another Windows account by copying the folder.

Optional paid API mode requires explicitly setting `AI_PROVIDER=api`, `OPENAI_API_KEY` and
`OPENAI_MODEL` in `.env`, restarting, and preparing a new plan. Only that mode uses dollar
reservations (estimates, not billing guarantees). Existing API keys are ignored in ChatGPT mode.

Official references: [local app integration](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt),
[account usage controls](https://learn.chatgpt.com/docs/sign-in-with-chatgpt).

Cancelled work retains its results. A crashed worker leaves a persistent lock; Activity can
recover it after ten minutes without progress. Recovery never resumes a scan. Create and
approve a new plan to continue. Access challenges require manual resolution, never a bypass.

## Private data and backups

`private/settings.json` is imported on the live database's first startup. Later changes are
saved in SQLite through Preferences. `private/criteria.md` remains the detailed reference.
Both are gitignored, as are `.env`, `data/` and cached browser sessions. Only localhost is bound;
do not expose this unauthenticated single-user application publicly.

Preferences can export the desk or create a database backup; `npm run backup` also backs up the
live database. A full backup includes the database, `data/live/media`, private settings and any
credentials stored separately and securely. To restore, stop all app/worker processes, preserve
the current data directory, then restore the database and matching media from your backup.

## Validation and next phases

```powershell
npm test
npm run check
npm run build
```

Tests use fictional fixtures, mocked photo analysis and loopback HTTP only. Browser checks use
the isolated demo. Live adapter behavior and AI assessment quality are **not yet validated**.

Still to implement after the first approved trial: the remaining source adapters, richer field
extraction and unit/building-ad distinction, verified geography/airport routing, building research,
review of all-outlook coverage, manual duplicate merge/split, full incremental discovery cursors,
scheduled runs and retention/restore tooling. The current view gate deliberately cannot infer
that every apartment window fails from a single obstructed photo. Modernity/workspace/layout
stay unknown when extraction has no supported evidence. Optional hosting and notifications
remain later phases. The design document describes the target, not completed coverage.

## Project documents

The [normal Chrome scanner](extension/README.md) discovers Apartments.com listings,
captures their full photo viewers, and imports and scores candidates within an approved
scan budget. Install the local `extension` folder using Chrome's **Load unpacked** option,
then pair through **Preferences → Normal Chrome connection**. The optional connection
test is a separate single-page read. Normal scans require the local app and Chrome to
remain running; recurring scans are disabled.

- [Requirements](docs/requirements.md): intended behavior.
- [Design](docs/design.md): architecture, workflow, implementation defaults, and phases.
- [Listing sources](docs/listing-sources.md): candidates and adapter validation plan.
- [Source test results](docs/source-smoke-test-2026-11-11.md): access checks and known limits.
- [Project instructions](AGENTS.md): implementation conventions.

Personal criteria remain in `private/criteria.md`, outside version control.
