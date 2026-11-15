# Apartment Finder

A personal apartment-search assistant for Vancouver: discover new rentals, filter and score
them against private criteria, remove duplicates, and manage promising homes in a Sorting
Desk through to signing a lease.

The application is a standalone private web app with a background scanner. It runs
independently of a coding assistant or chat session.

## Status

The local application has completed bounded live source and photo-review trials. Startup and
demo mode never scan. Each live run requires explicit approval of a single bounded plan;
recurring scans remain disabled. The November 14 final validation found 15 new rental
candidates (including two unit-unverified floorplan offers); three reached the active desk.
It was a partial pass: expanded routes, request overhead and stale inventory still limit
several sources. Captured-page fixes have regression coverage; see the dated source results
before approving another live test.

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
- SQLite persistence, per-posting evidence, conservative address/unit deduplication, reversible
  manual merge/split with retained IDs and history, user-decision undo, export and verified
  database/media/criteria backups. Scanner updates preserve user decisions.
- Deterministic scores with hard laundry/budget/view gates, explicit uncertainty and bonuses.
  The private initial settings calibrate the user's price/location examples; public defaults
  contain no personal budget. Historic reference IDs #1–#13 are reserved in the live database;
  historical listings remain in the private research ledger and are not imported automatically.
- Context-aware feedback learning with monotone rent/view behavior, explicit correction clearing,
  scoped floor evidence and an offline calibration report. The limited personal ratings remain
  insufficient to establish accuracy for the most desirable apartments.
- Strict single-run approval, page/listing/photo/AI-call caps, persisted counters, cancellation,
  source cooldowns, request allowlists, sequential pages and persistent browser profiles.
  Bounded page snapshots are saved privately for adapter debugging without repeat visits.
- All 12 retained sources are connected to the approved scan runner. Current access failures,
  incomplete galleries and queued inventory are recorded per source. Apartments.com uses the
  paired normal-Chrome extension. Rentals.ca, RentFaster, liv.rent and PadMapper are excluded.
- Fresh discovery alongside queued work, preserved pagination, individual extraction quarantine,
  separate Zumper offerings and optional bounded factual refresh of active apartments. Expanded
  Apartments.com/Hollyburn discovery is opt-in and labeled unvalidated until a live trial.
- Full enumerated-gallery processing with pending/unavailable states, local images and assessment
  reuse by image hash/model rubric. An optional OpenAI Responses photo provider sits behind a
  replaceable interface. Credentials and a model must be configured separately; none are supplied.
- Incremental gallery review in bounded batches, separate visual/attribution reuse and supported
  photo evidence for modernity, cramped rooms, gas, workspace, layout and laundry. Incomplete
  galleries and uncertain views are distinct; representative photos cannot verify a unit.
- Compact conditional desk refreshes, indexed/cached scoring reads, protected preference patches
  and a separate scanner process keep the Sorting Desk responsive during approved runs.
- Known recurring-cost totals with unknown fees shown explicitly, plus optional exact-address
  geography and public building-permit research. Airport/transit links open current route planners;
  travel times and walking distances are not inferred or added to the score.

## Scan approval and cost control

Preparing a plan makes no external requests. Approval expires after one hour and cannot be
reused. Every accessible gallery photo is reviewed unless the apartment already fails a hard
requirement; a cap leaves remaining work explicitly pending. Discovery, detail, pagination and
optional refreshes share the plan's limits. Earlier bounded source trials are saved locally.
Fresh discovery does not authorize an unbounded crawl or recurring runs. Factual refreshes
preserve saved photos and decisions; historical photo backfills require separate authorization.

**ChatGPT plan usage is the default.** In Preferences, select **Continue with ChatGPT**, sign in,
and allow use of your ChatGPT plan. Then load the available models and choose one that supports
images. The existing local connection has completed live gallery reviews. A new installation
must connect its own account and verify model access.

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

Preferences can export the desk or create a complete backup; `npm run backup` creates the same
kind of bundle. It contains a consistent SQLite snapshot, referenced local media (including
history and rating evidence), private criteria/settings and a checksum manifest. Credentials
are excluded: reconnect after restoring. A missing referenced photo fails verification rather
than silently producing an incomplete backup.

```powershell
npx tsx scripts/restore.ts data/backups/<bundle>
npx tsx scripts/restore.ts data/backups/<bundle> data/restore-check
```

The first command verifies a bundle; the second verifies and restores it into a **new staging
folder**, never over the running app. To activate a restore, stop all app/worker processes,
preserve the current data directory, and move the staged database/media to the live directory.
The staged `private` folder contains the separate private reference files. Reconnect accounts
and the Chrome extension as needed.

## Validation and next phases

```powershell
npm test
npm run check
npm run build
```

Tests use fictional fixtures, mocked photo analysis and loopback HTTP only. Browser checks use
an isolated demo. Source trials document observed coverage, not universal current access.
The final live validation exercised gallery review and exposed several extraction and visual
classification errors. Corrected saved evidence and regression tests cover the repairs; failed
routes still need a focused approved retest, and future personal ratings are needed to measure
ranking accuracy. The offline calibration tool reads saved evidence without making requests:

```powershell
npx tsx scripts/scoring-evaluation.ts --database data/live/apartments.sqlite --out private/review/scoring-evaluation.json
```

The view gate cannot infer that every apartment window fails from a single obstructed photo.
Modernity/workspace/layout stay unknown without supported evidence. Public permit records do
not establish current noise, defects or unit condition. Precise transit/walking calculations,
broader building research, scheduled runs, optional hosting and notifications remain later work.

## Project documents

The [normal Chrome scanner](extension/README.md) discovers Apartments.com and Zillow listings,
captures their full photo viewers, and imports and scores candidates within an approved
scan budget. Install the local `extension` folder using Chrome's **Load unpacked** option,
then pair through **Preferences → Normal Chrome connection**. The optional connection
test is a separate single-page read. Normal scans require the local app and Chrome to
remain running; recurring scans are disabled. Reload the unpacked extension after updating to
version 0.4.0. An interrupted gallery may retain a tab for a later separately approved run;
retained tabs do not continue scanning in the background.

- [Requirements](docs/requirements.md): intended behavior.
- [Design](docs/design.md): architecture, workflow, implementation defaults, and phases.
- [Listing sources](docs/listing-sources.md): candidates and adapter validation plan.
- [Source test results](docs/source-smoke-test-2026-11-11.md): access checks and known limits.
- [Project instructions](AGENTS.md): implementation conventions.

Personal criteria remain in `private/criteria.md`, outside version control.
