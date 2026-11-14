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
- The Sources view must distinguish recorded test results, saved/active listing counts,
  app scanning support, assisted-only sources, and active access pauses. A successful test
  does not establish an unattended discovery workflow; a success note is not a pause.

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

- Every apartment detail view supports a personal score and a short reason. Keep the app's
  score at submission, listing/criteria snapshots, all feedback, and review outcomes.
  Review each explicit submission through the connected ChatGPT plan, with no paid API fallback.
  General preference changes must improve agreement across saved examples, preserve correct
  interest bands, and remain small and reversible. One-off exceptions and uncertain listing facts
  must not silently become global rules. Failed reviews retain feedback and require an explicit retry.
  Each new submission must immediately affect comparable-listing scoring, using the latest rating
  per apartment and preserving prior submissions. Apply explicit supported general preferences
  immediately. Clearly show unresolved interpretation and pause new scan requests until resolved;
  never silently mark an unimplemented scoring instruction as handled. Keep evidence ceilings and
  hard requirements above learned adjustments, and do not let downward feedback undo stricter
  penalties. Audit historical chat and app feedback without new scans or paid AI requests.
- Show furnishing prominently with a supporting listing statement: furnished, unfurnished,
  optional/partial, conflicting, or not confirmed. Staged furniture, display suites and building
  guest suites do not establish inclusion. Award a furnishing bonus only for an explicit rental
  claim; generic floor-plan information must remain distinguished from confirmed unit terms.

- Score every listing from 0.1 to 5.0, where 5.0 is a perfect apartment.
- Score meanings: 3.0–3.9 is okay and worth a look, but unlikely to be pursued; 4.0–5.0 is a
  strong match the user is likely to want to move into. Below 3.0 is almost certainly unwanted.
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
- Keep uncertainty labels and evidence, but automatically place every headline score below
  3.0 in Excluded. A higher upper estimate or prior rescue cannot override this threshold.
- Reviewed, unit-attributed window photos showing buildings without any confirmed nature
  receive a substantial configured deduction and a below-3 ceiling. This is a poor-fit
  assessment of available evidence, not a claim that every unseen window lacks nature.
- When only representative window evidence shows buildings and no interior-window photo
  shows qualifying nature, cap the provisional headline below 3.0 and exclude it as an
  unpromising match. Cheap rent does not overcome that evidence. Retain exact-unit uncertainty;
  exclusion for poor fit is not proof of every window's outlook. The stricter unit rule wins.
- A building-dominated nature glimpse (best verified interior view quality at most 2/5)
  caps the headline at 3.3, or 3.1 when interiors are assessed as dated. Preserve the
  partial-nature evidence; a narrow glimpse is not equivalent to an unobstructed outlook.
- Moderate partial nature views (quality above 2 and below 4) limit the total score using
  a configured ceiling that increases gradually for better partial views. Confirmed furnishing,
  short leases, gas cooking, and a second bedroom modestly extend it. Rent, workspace, and modern
  finishes cannot turn a mediocre view into a near-perfect match. A flexible sleeping area or
  ambiguous "Euro 2" label does not establish a second bedroom; preserve the conflict for review.
- For weaker partial views, higher rent also lowers the view-based ceiling. Apply the strongest
  cost deduction to weak outlooks, tapering it as partial views improve; keep ordinary rent
  scoring active. Broad mountain panoramas should not be equated with narrow urban water glimpses.
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
- Apply a modest configured deduction when interiors are assessed as dated. Unknown condition
  receives neither this deduction nor a modern-interior bonus. User photo assessments take
  precedence over generic renovation claims in listing text.
- Record stove/cooktop fuel type with supporting evidence and support a separate gas-cooking
  bonus from private criteria. Do not infer stove fuel from a gas fireplace or included utilities.
- Record the apartment's outlook direction and supporting evidence. Support an additive
  preferred-orientation bonus configured in private criteria, awarded once per apartment.
  Unknown or ambiguous exposure stays uncertain; other directions are not a hard exclusion.

## R5 Sorting Desk (private web app)

- Listings scored 3.0 or above go to a "Sorting Desk" web app where the user works through them.
  Uncertain listings remain active only when their headline score is at least 3.0.
- The desk is a lifecycle (state machine). Stages named so far:
  1. **Unreviewed**: scored automatically, not yet reviewed by the user.
  2. **Interested**: reviewed, and the user wants to seriously consider it.
  3. **Inquiry Sent**: the user has contacted the landlord for details or to start an application.
  - **Not Interested**: terminal. Kept so the same listing is never re-scored or re-shown.
- Proposals for additional stages are welcome.

## R6 Desk card contents

- Opening an apartment detail shows an address-based location map below its key
  facts, with a larger-map link. Incomplete locations use an explicitly approximate
  area view without an apartment pin; failed or missing address matches remain
  unconfirmed. Map lookups use only public listing locations, are cached and paced,
  and do not run during scanning, startup, offline demos, or ordinary list refreshes.

- Detail-gallery photos open in a full-viewport viewer with zoom, scrolling for close inspection,
  and Close/Escape to return to the same listing position. Keep the detail close control visible
  while scrolling; closing a photo must not close the listing or discard unsaved notes.
- Preserve the exact downloaded source image alongside the bounded analysis/card copy; use the
  source file in the enlarged viewer. Prefer larger variants explicitly advertised by each listing,
  show pixel dimensions and distinguish legacy previews from preserved source files. Fit never
  stretches a small image automatically; Actual size shows one image pixel per CSS pixel.
- Apply higher-quality photo collection to future scans. The user declined refreshing the
  existing trial apartments on 2026-11-14; retain their cached photos and do not backfill them
  unless explicitly requested later. The user will manage their desk stages personally.
- Previous/Next and arrow-key navigation operate only within the open apartment's gallery.
  Stop at both ends; never silently open another listing. Keep apartment ID, price and score
  visible in the viewer and in the pinned detail header while scrolling.

- Prefer a reviewed photo showing the outlook through the apartment's windows as the card
  image and first detail-gallery image. Use building-facing window photos when that is what
  the evidence shows; never substitute a rooftop or shared-amenity view for a unit view.
- Prefer clean window photos, then ordinary apartment interiors, over promotional overlays,
  bonus-offer graphics, or advertisements. Keep promotional photos at the end of the gallery.

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

## November 14 updates: scan preparation and desk stages

- All 12 retained sources participate in the normal approved scan workflow. Select all by default; keep deferred sources excluded and scheduled scans off. No scan starts during setup, startup, or testing.
- Share a bounded total across sequential sources, reserving a fair allowance for each. Report a separate outcome for every selected source, including pauses and incomplete discovery. Queue undiscovered work and unfinished new galleries for later approved runs. Previously saved trial apartments must not have their images refreshed.
- Rename Inbox to Unreviewed and Shortlist to Interested. Remove the Vancouver / Your Search header text. Provide Interested and Not Interested card actions.
- Enforce Unreviewed → Interested → In Progress → Closed in the backend. Any active stage can close; no skipped or backward stages. An explicit Reopen action is the sole Closed → Unreviewed transition. Preserve notes and history. Automatic score-based Excluded classification remains independent of these user stages.

- Detailed-view decision buttons sit beside score feedback. A changed score and reason are saved before the decision; validation or save failures keep the apartment open and retain the draft. Show Score Breakdown and Still to Confirm above the photos, followed by a four-sentence factual summary below the photos. The summary uses saved evidence and makes no additional AI calls.

- Hide the numeric uncertainty range in apartment details; retain the main score. Label the move-in field as Availability, including when its value is Unknown.

- Keep the detailed feedback form concise: omit the expanded scoring-review results block and the furniture-in-photos reminder. Retain saved feedback and retry/undo actions within collapsed Rating history.

- Excluded and Closed are always ordered by most recent entry into that section, oldest at the bottom. Notes and refreshes do not change that order; a reopened and subsequently closed home receives a new entry time.
- Keep Your Rating compact: score, one-line expandable reason, decision buttons and collapsed history. Omit the score comparison, score-band explanation and submission/AI explanatory copy.
- Show Furnishing in the compact facts row with Laundry, Parking, Lease and Internet, without a separate furnishing section.
- Use title case for interface headings and labels where appropriate (Your Rating, Score Breakdown, Still to Confirm, Not Confirmed). The furnishing fact is labeled Furnished, with Yes, No, or the unconfirmed/optional status.
- Highlight each apartment’s source on its card and pinned detailed-view header; show all sources for confirmed cross-postings. Scan plans can enforce a per-source apartment cap independently of the shared total.
