# Requirements

Captured from the user on 2026-11-10. This file covers what the program must do. The user's
personal search criteria (budget, areas, must-haves) are kept out of git in `private/criteria.md`.

## R1 Listing sources

- Find the apartment listing websites worth scanning for rentals in Vancouver, BC.
- The user's starting list: Zillow, Apartments.com, PadMapper, Facebook Marketplace and similar.
  Claude evaluates these and others against the requirements below and recommends which to use
  (see [listing-sources.md](listing-sources.md)).

## R2 Scheduled, incremental scanning

- Scan the chosen sites on a regular schedule (for example, every morning) and parse the details
  of listings that meet the user's criteria.
- After the initial scan, recurring scans only check for new listings instead of re-processing
  listings already seen.

## R3 De-duplication

- The same apartment must not be shown twice, whether it appears twice on one site or on two
  different sites.
- If it's uncertain whether the user has already seen an apartment, show it anyway and let the
  user decide.

## R4 Automatic scoring

- Score every listing from 0.1 to 5.0, where 5.0 is a perfect apartment.
- Below 3.0 means unsuitable: those listings are dropped and not worth investigating.
- Scoring uses the listing's photos, its description, and a search of the address and the
  surrounding area.
- When the score is uncertain (for example, it can't be determined whether there's a view of the
  mountains), don't drop the listing automatically. Show it with its uncertainties so the user
  can decide.

## R5 Sorting Desk (Claude Artifact)

- Listings scored 3.0 or above go to a "Sorting Desk" artifact where the user works through them.
- The desk is a lifecycle (state machine). Stages named so far:
  1. **Unreviewed**: scored automatically, not yet reviewed by the user.
  2. **Interested**: reviewed, and the user wants to seriously consider it.
  3. **Inquiry Sent**: the user has contacted the landlord for details or to start an application.
  - **Not Interested**: terminal. Kept so the same listing is never re-scored or re-shown.
- Proposals for additional stages are welcome.

## R6 Desk card contents

- A few photo thumbnails, enough to judge at a glance whether the apartment is worth a closer
  look. If getting the images is too difficult, leave them out; the user can open the listing.
- High-level pros and cons (e.g. pro: "this apartment is affordable"; con: "the view of the
  ocean is partially obscured").
- A short overview and a link to the original listing.

## How the program is used

- Driven from the Claude Code desktop app. Results are shown in a Claude Artifact that's
  updated as the program runs.

## Later

- The full criteria list (coming once the initial program is set up).
- Possibly email delivery of findings.
