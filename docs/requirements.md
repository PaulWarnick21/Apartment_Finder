# Requirements

Captured on 2026-11-10; direction updated on 2026-11-11. This file covers what the program must do. The user's
personal search criteria (budget, areas, must-haves) are kept out of git in `private/criteria.md`.

## R1 Listing sources

- Find the apartment listing websites worth scanning for rentals in Vancouver, BC.
- The current candidate list includes Zillow, Apartments.com, Zumper, Facebook Marketplace and similar.
  Evaluate these and others against the requirements below and select sources through direct-access trials
  (see [listing-sources.md](listing-sources.md)).
- Use Zumper only for the shared Zumper/PadMapper network; PadMapper is excluded from planned
  recurring discovery following the user's source-consolidation request.
- Rentals.ca, RentFaster and liv.rent are deferred at the user's request. Do not include
  them in new scans or access trials unless the user asks to restore them.
- Avoid separate recurring scans of sources demonstrated to duplicate the same inventory.
  Evaluate additional sources for unique apartments, useful evidence, freshness, and cost;
  shared ownership or partial syndication alone does not establish full redundancy.

## R2 Scheduled, incremental scanning

- Scan the chosen sites on a regular schedule (for example, every morning) and parse the details
  of listings that meet the user's criteria.
- After the initial scan, recurring scans only check for new listings instead of re-processing
  listings already seen.
- Collect listing facts, descriptions, and photos where available so the program can assess
  apartments without requiring the user to gather their details.
- Refresh known listings selectively for material changes or availability; avoid repeating a
  full assessment when relevant content is unchanged.
- Use conservative per-source page/request budgets and pacing, one source at a time by default,
  and persistent browser sessions where needed. Share limits across manual and scheduled runs.
  Cache unchanged content and spread initial discovery over multiple runs rather than crawling
  dozens of results pages. Report coverage limits instead of silently increasing traffic.
- Pause a source at the first access warning, rate limit, unexpected error page, or abnormal
  slowdown; record the cause and notify the user in the app. Persist the pause across restarts
  and manual scans. See the source plan for cooldown and recovery rules.

## R3 De-duplication

- The same apartment must not be shown twice, whether it appears twice on one site or on two
  different sites.
- Deduplicate before expensive research/photo analysis/scoring. Reuse unchanged assessments
  across confirmed duplicate ads, retaining all source links and checking for material updates.
- If it's uncertain whether the user has already seen an apartment, show it anyway and let the
  user decide.
- Assign each apartment a stable, simple sequential reference ID (Apartment #1, #2, etc.) for
  chat and desk use. Preserve it across rescoring and duplicate source ads; never renumber by
  score/rank or reuse removed IDs. Preserve references as aliases when duplicate records merge.

## R4 Automatic scoring

- Score every listing from 0.1 to 5.0, where 5.0 is a perfect apartment.
- Below 3.0 means unsuitable: those listings are dropped and not worth investigating.
- Scoring uses the listing's photos, its description, and a search of the address and the
  surrounding area.
- Actual apartment interior photographs are required for the active desk. Floor-plan-only,
  exterior-only and amenity-only galleries are excluded. Missing or not-yet-reviewed photos
  remain held out until interior photos are verified. Preserve records and user decisions;
  do not confuse this photo requirement with proof that a nature view is absent. Representative
  interiors must remain clearly labelled as unit-unverified and cannot confirm the unit's view.
- Review every accessible photo attached to each apartment being assessed, including the full
  gallery and additional photos on confirmed duplicate ads. Do not stop at the first good or
  bad window photo. Reuse compatible assessments of unchanged images rather than repeating work.
- Track gallery completeness separately from view certainty: all photos reviewed, review pending,
  photos inaccessible, or unit attribution uncertain. Record expected/retrieved/reviewed counts
  when known. Missing or deferred photos keep the assessment explicitly incomplete.
- A nature view is confirmed only after reviewing listing photos that show the relevant
  scenery through the actual apartment's windows. Advertising labels, neighborhood, floor
  height, and shared-amenity views cannot substitute for this evidence.
- Assess view quality separately from whether nature is visible at all: mostly unobstructed
  nature views rank above partial glimpses, particularly when buildings dominate the outlook.
  Apply the user's detailed scenery preferences from private configuration.
- Record the supporting photo and what it shows. If photos are unavailable, ambiguous, or
  cannot be attributed to the unit, label the view unverified and do not claim a confirmed match.
- When the score is uncertain (for example, it can't be determined whether there's a view of the
  mountains), don't drop the listing automatically. Show it with its uncertainties so the user
  can decide.
- Apply the expanded private criteria and user-provided example scores when calibrating price,
  location, view quality, unit type, workspace, parking, furnishing, and lease preferences. Exact weights remain
  provisional; personal values and example prices stay in private configuration.
- Confirmed absence of the required nature outlook caps the overall score below 3.0 and removes
  the unit from the active desk. Missing or inconclusive photos do not establish failure.
- Unknown parking produces a **Parking Unsure** flag. Keep factual uncertainty distinct from
  confirmed absence, and distinguish hard exclusions from preferences and small bonuses.
- Extract unit-specific laundry facilities and evidence, distinguishing in-unit machines,
  shared/building-only facilities, hookups only, none, and unknown/conflicting information.
  Apply the laundry hard requirement in private configuration before ranking. A confirmed
  failure excludes the apartment regardless of its score; unknowns show **Laundry Unsure**
  pending verification. Preserve historical scores and user workflow decisions when criteria change.
- Record advertised internet service and supporting details for work-from-home suitability.
  Unspecified internet is **Internet Unsure**, with no automatic exclusion or score deduction;
  surface it as a manual check before signing a lease. Do not treat included internet or vague
  speed claims as proof of adequate performance. Thresholds and scoring weights remain unset.
- Support explicit additive overall-score bonuses for a usable den/office in a unit without
  a second bedroom, and for a short-term lease, using the provisional values in private criteria.
  Avoid double-counting benefits. Keep the final score at or below 5.0; bonuses cannot override
  hard exclusions. Short-term leases are eligible and preferred, not an automatic rejection.
- Support modest evidence-based bonuses for modern kitchens/appliances/bathrooms and an
  open-concept layout. Keep personal bonus amounts in private criteria; flag unknown condition
  or layout rather than awarding unsupported bonuses.
- Record stove/cooktop fuel type with supporting evidence and support a separate gas-cooking
  bonus from private criteria. Do not infer stove fuel from a gas fireplace or included utilities.
- Record the apartment's outlook direction and supporting evidence. Support an additive
  preferred-orientation bonus configured in private criteria, awarded once per apartment.
  Unknown or ambiguous exposure stays uncertain; other directions are not a hard exclusion.

## R5 Sorting Desk (private web app)

- Listings scored 3.0 or above go to a "Sorting Desk" web app where the user works through them.
  Potentially suitable listings with uncertain scores remain visible as required by R4.
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
- The apartment's stable reference ID, also used when presenting or discussing it in chat.

## How the program is used

- Open a private, responsive web app to review listings, update stages, and keep notes.
- A background worker scans on a schedule and updates the desk's persistent database.
  The user can also start a scan from the app.
- Operation does not depend on keeping a coding assistant or chat session open.
- Direct website discovery is the primary intake. A mailbox, saved-search alerts, proprietary
  connectors, or manually supplied listing details are not prerequisites.

## Later

- The full criteria list (coming once the initial program is set up).
- Possibly email delivery of findings.
