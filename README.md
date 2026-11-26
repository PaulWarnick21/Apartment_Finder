# Apartment Finder

Apartment Finder discovers Vancouver rental listings directly from housing websites and
helps one person sort, score and follow up on promising apartments. It runs as a local
web app with a background worker and keeps the desk in SQLite. Codex helps maintain
the project and can prepare bounded scan plans. The app can run with Codex closed.

**Paused as of November 26, 2026.** Recurring discovery, saved-listing availability
checks and Codex health checks are off. The original app host is stopped and its ChatGPT
connection is signed out. A fresh clone starts with both app schedules off. Ask for a
new bounded scan or explicitly re-enable a recurring schedule when you are ready to search again.

## What it does

- **Discover and rank.** Adapters collect facts and photos directly from rental sites.
  Quick intake uses local eligibility rules and letter grades to put qualifying rentals
  in Unreviewed. It makes zero AI calls or address lookups. Source pacing, traffic
  budgets and cooldowns protect approved runs. Sources and Activity show gaps and slowdowns.
- **Review with evidence.** Marking a home Interested queues full scoring. It reviews
  every accessible gallery photo, reuses unchanged evidence and checks the advertised
  address against the downtown Vancouver search boundary, including City Gate. The app
  shows incomplete galleries and uncertain findings separately. The configured workflow
  applies a single supported poor-view deduction of up to one point.
- **Manage the shortlist.** Search, sort, compare and move homes through Interested,
  Serious Candidates, Ready to Apply, In Progress and Closed. Save ratings, notes,
  Revisit Later decisions and follow-up dates. Inquiry drafts and calendar downloads
  support the next step. The app leaves sending inquiries to you.
- **Keep listings and decisions straight.** Verified cross-posts of a unit share one
  record. Separate units can share a building card and notes while keeping their own
  scores and decisions. A removed posting triggers a check for verified live replacements
  when availability monitoring is enabled. Inconclusive checks preserve uncertainty.

## Design decisions

React and Vite serve the Sorting Desk through a local Node and TypeScript app. A separate
worker handles scan traffic so desk actions stay responsive. SQLite keeps decisions,
evidence and history. It survives restarts, and source updates preserve the user's
stages, notes and duplicate decisions.

Code applies scoring rules, traffic limits and usage budgets. A replaceable multimodal
provider assesses visual evidence through structured output. Interested assessments use
the connected ChatGPT plan with a usage reserve and no automatic paid fallback. Routine
review, backup and recovery of saved data can run locally.

## Restart on a new computer

Install Git and Node.js 24 with npm on your PATH. Then open a terminal in the new workspace
or ask Codex to run the following. This restores the saved desk from GitHub locally and
keeps discovery and availability checks off.

```powershell
git clone https://github.com/PaulWarnick21/Apartment_Finder.git
cd Apartment_Finder
npm ci
npx tsx scripts/portable-desk.ts --restore
npm run build
npm start
```

Open [the local Sorting Desk](http://127.0.0.1:4317). On Windows, after building, you can
also use `Open Apartment Finder.cmd` and `Stop Apartment Finder.cmd`. To try the app
with fictional apartments, use `npm run demo` and open
[the isolated demo](http://127.0.0.1:4318).

### Recovery files

The public GitHub repository contains [the compact desk snapshot](backups/desk.json.gz)
with apartment records, saved history, notes, ratings and detailed search/scoring
preferences. The restore command installs it before the first normal launch. It
leaves galleries, credentials and browser sessions out. The
[plain JSON shortlist](backups/shortlist.json) is also available to read directly.
[Recovery formats and Git hooks](backups/README.md)

Restored apartments without local galleries are available as historical records in
Excluded or Closed. Their saved stages and notes are preserved. Recollect photos only
from still-live postings after the listing is verified and a new run is approved.

See the [search preferences](backups/search-preferences.md) for a readable record of the
choices behind the saved scoring settings. Confirm the criteria again when the search resumes.

For a full restore with photo galleries, transfer a verified private backup from the
old PC to the new one. On the old PC, `npm run backup` creates and verifies a dated
bundle under `data/backups/` with the database, referenced galleries and private
reference files. Keep the bundle in a private location the new PC can access.

To use the private bundle, use the following command for the restore step after
`npm ci` and before `npm start`. It verifies the unpacked bundle, installs the desk and
keeps both schedules off. It requires `data/live` to be absent.

```powershell
npx tsx scripts/restore.ts 'C:/private/apartment-backup' --install
```

### Reconnect optional services

- **Photo assessment.** On Windows, use **Preferences → Continue with ChatGPT** to sign
  in, allow plan usage and select an image-capable model. For a restored desk, sign in
  to the same ChatGPT account in both Apartment Finder and Codex, then run
  `npm run configure:review-account` with the app idle. This restores the account link
  and keeps the saved review limits. Credentials are machine/user-bound and excluded from backups.
- **Live sources.** Install the Playwright browser with
  `npx playwright install chromium --only-shell` and install Google Chrome for sources
  that need a visible browser. Apartments.com and Zillow use the normal Chrome bridge.
  Load the `extension` folder in Chrome and pair it again.
  [Chrome extension setup](extension/README.md)
- **Phone access.** The app listens on loopback. Set up private Tailscale Serve again
  if you want to use the same desk from your phone.
  [Phone setup and shutdown](docs/mobile-access.md)

Opening the saved desk after the pause or on a fresh clone makes no automatic model calls,
scans or availability checks. Re-enable scheduled work only after a new explicit
authorization. Keep the retired catch-up automation disabled.

When the search resumes, treat the saved apartments as historical records until their
availability has been checked. Before returning one to the active Sorting Desk, get approval
for a bounded revalidation pass, check its original ads and verified cross-posts, and use a
bounded other-source search when needed. Confirm that a live replacement is the same unit
and meets the new search criteria. Keep unverifiable records and prior decisions as history.

## Maintenance and project notes

Run `npm test`, `npm run check` and `npm run build` for offline validation.
Tests use fixtures and loopback servers. Live access and coverage can change by source.

`npm ci` installs the Git hooks. They refresh the plain JSON shortlist on commit and
verify it before push. Refresh the larger desk snapshot at backup and migration checkpoints.
Full runtime files stay outside Git.

- [Requirements and decisions](docs/requirements.md)
- [Architecture, scheduling and backup design](docs/design.md)
- [Sources, access policy and live validation history](docs/listing-sources.md)
- [Project conventions](AGENTS.md)
