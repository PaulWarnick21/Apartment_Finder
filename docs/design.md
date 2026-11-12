# Design

Updated 2026-11-11 following the user's confirmed direction. This plan implements
[requirements.md](requirements.md) as a standalone apartment-search application. The first local
version is implemented; see README for tested scope and outstanding work. The architecture below describes the target; remaining preferences
are listed at the end.

## 1. Product and architecture

Find new Vancouver rentals, evaluate them against private criteria, and keep a useful,
explainable shortlist. The user opens a private Sorting Desk in a browser to review apartments
and manage inquiries, viewings, and applications.

```text
Listing websites -> source adapters -> normalize -> prefilter -> deduplicate
                                                                  |
                                                       building research
                                                                  |
                                                       AI ratings + evidence
                                                                  |
                                                       code-computed scores
                                                                  |
                                                         SQLite database
                                                                  |
                                                backend API <-> Sorting Desk
```

- **Web app:** a responsive React interface, built with Vite, for desktop and phone layouts.
- **Backend:** a TypeScript/Node service serving the app, API, and private thumbnails.
- **Worker:** a separate process for discovery, extraction, research, and scoring. It shares
  storage code with the backend and runs from a scheduler or a queued Scan now request.
- **Storage:** SQLite and local image storage for the initial single-user installation.
- **AI:** a replaceable multimodal model behind a server-side provider interface. The application
  owns the data, rubric, and score arithmetic.

Direct website discovery is the primary intake. Mailboxes, saved-search alerts, proprietary
connectors, and user-supplied descriptions or screenshots are not prerequisites. Optional manual
entry remains useful for an apartment found elsewhere.

## 2. Discovery and extraction

Candidate websites and adapter acceptance criteria live in [listing-sources.md](listing-sources.md).
Validate a small set against real pages before expanding coverage.

- Use ordinary HTTP and structured page data where available; use Playwright for pages needing
  browser rendering or interaction. Prefer deterministic parsers over AI navigation.
- Collect source ID/URL, address/unit, coordinates where available, rent, beds/baths, size,
  description, photos, amenities, available date, lease term, furnishing, mandatory costs, and
  incentives. Preserve provenance and retrieval time; missing fields remain unknown.
- Distinguish individual apartments from building advertisements with many units or rent ranges.
- Initially discover current inventory. Later use stable IDs, overlap windows, checkpoints,
  and content fingerprints to process new or materially changed listings.
- Refresh active shortlisted homes selectively. Re-score only when relevant evidence,
  criteria, or the scoring rubric changes.
- Follow the conservative access policy in listing-sources.md: shared source budgets, sequential
  navigation, persistent sessions and caching. A source warning stops its queued requests and
  persists a cooldown; scheduled/manual runs and restarts cannot bypass that pause.
- Report incomplete coverage. A failed fetch or absence from search results is not evidence
  that an apartment was rented.

The application obtains details itself. If a source cannot provide photos or a field, identify
the gap on the card and preserve uncertainty in the score.

## 3. One scan

**Current approval gate:** the user must approve the source and page/listing/photo/AI limits
before the first live scan. Startup performs no scans or catch-up work. Approval is for one run
only, expires after one hour, and does not authorize recurring scans. Defaults are one apartment,
two pages, twelve photos, zero AI calls. Larger galleries stay pending instead of being sampled
and labelled complete. Subsequent scheduler/catch-up behavior below remains a future opt-in.

1. Claim queued work with a database-backed lock so scheduled and manual scans cannot overlap.
2. Discover postings from enabled sources, recording progress and source failures. Check known
   source IDs and confident apartment matches using discovery metadata before fetching details.
3. Fetch new/changed details, normalize facts, and record evidence and fingerprints.
4. Apply hard filters in code: definite budget, area, unit-type, lease, move-in, or must-have
   violations. Unknowns pass through.
5. Match postings to apartments and resolve certain duplicates.
6. Research buildings and surroundings, using cached findings when still relevant.
7. Reuse compatible cached assessments for unchanged evidence. Request structured AI ratings
   only for new or materially changed evidence, and validate the response.
8. Compute weighted scores in code and assess red flags separately.
9. Commit listing updates without modifying user decisions.
10. Record completion, source health, and noteworthy findings in the desk's activity feed.

Steps are resumable and safe to repeat. Only successful discovery advances a source checkpoint.
Partial runs retain successful items and resume unfinished work only within source budgets and
after any cooldown or required access recovery. Scoring failure produces an Unscored card,
never an automatic rejection.

## 4. Identity and duplicates

A **posting** is identified by source and listing ID. A **home** is the apartment, potentially
represented by several postings. Building advertisements remain distinguishable from units.

Deduplicate before building research and AI photo analysis, not just before displaying cards.
Keep one assessment per confirmed apartment and relevant evidence/rubric version. When discovery
metadata is insufficient, fetch only the details needed to establish identity and detect changes;
do not skip unknown listings based on a building-level match. Retain source-specific facts and
timestamps so a duplicate ad can contribute a new photo, price update, or availability conflict.
Cache image assessments by content fingerprint and assessment version; near-identical images
may identify reuse candidates but do not alone prove apartment identity. Recalculate code-based
scores for price/criteria changes without repeating unaffected visual assessments. New photos or
changed condition/view evidence require the affected assessments to be refreshed.

| Situation | Handling |
| --- | --- |
| Same source and listing ID | Update the posting; do not create another card. |
| Same normalized address/unit with compatible facts | Merge into one home with all source links, unless evidence suggests a scam copy. |
| Same building without unit, similar text, or matching distinctive photos | Show Possible duplicate with Same place / Different actions. |
| Copied photos with conflicting address/contact or suspicious price | Keep separate and flag a possible scam copy. |
| Same building, different units | Keep separate; link as related homes. |

Lobby, gym, exterior, stock, model-suite, and floor-plan images are insufficient for automatic
merging. Keep uncertain matches visible to avoid hiding a good apartment. Remember user
duplicate decisions, preserve notes during merges, and support undoing a merge.

Not Interested is final by default: suppress confirmed reposts of that home. Uncertain matches
can appear with a reference to the rejected home. Price-drop resurfacing is optional and off
unless enabled. Retain identity history for the duration of the search.

## 5. Scoring and evidence

Hard filters, price calculations, location tiers, and score arithmetic run in code. AI assesses
view, light/condition, layout, building, and surroundings against the private rubric.
Distinguish confirmed disqualifiers, strong preferences, small bonuses, and unknown facts.
Preferences must not become hard filters merely because their wording is emphatic.

For each criterion, store a rating or unknown, a plausible range, evidence, and whether it is
observed in a photo, stated in a listing, or inferred from research. Code calculates a weighted
base score and applies explicit overall-point bonuses from private configuration, with low/high
estimates. Apply confirmed-failure caps and hard exclusions, then clamp the final score to
0.1-5.0. Unknown ratings use the range midpoint for the headline estimate; unknown bonus
eligibility remains provisional and must not be shown as an earned bonus.

- Suitable listings appear with reasons and source links.
- Keep a listing if its upper estimate reaches 3.0, even when the headline score is lower;
  badge it Uncertain and display the unknowns.
- If its upper estimate is below 3.0, place it in an Auto-rejected bin with reasons and Rescue.
  Hard-filter rejections retain their reasons too.
- Failed assessments appear as Unscored and can be retried.
- Apply configured confirmed-failure rules before the ordinary weighted-score threshold. A
  confirmed failure of the required nature outlook caps the headline and upper score below 3.0
  (at most 2.9), regardless of price or convenience bonuses. Record the evidence and rejection
  reason in the Auto-rejected bin. Incomplete photo coverage cannot trigger this cap.

Weights live in private configuration. Changing them does not require repeating unchanged AI
assessments. The earlier example weights are superseded by the user's expanded private criteria
and calibration examples. Location, price, and nature-view quality are the major drivers;
bedroom suitability and parking matter, while furnishings and extra amenities provide smaller
bonuses. Keep exact weights provisional while more criteria are arriving.

Calibrate the formula against the approximate outcomes in `private/criteria.md`, including
otherwise comparable homes at different prices and an exceptional home outside the preferred
area. Report deviations rather than claiming a formula matches examples without calculating
them. Do not tune every example independently with hidden adjustments.

### Location, value, and unit preferences

- Use a strong preferred-area rating and meaningful deductions for more distant/inconvenient
  locations. Homes outside the preferred area remain eligible; proximity to preferred landmarks
  or useful transit are alternative benefits rather than requirements to satisfy simultaneously.
- Verify walking access and actual airport routing, transfers, and travel time when evaluating
  transit convenience. Do not equate proximity to any station with an equally convenient journey.
- Separate the desired bedroom count, extra-bedroom bonus, and studio penalty. Studio exceptions
  require exceptional combined value and verified view quality, not low rent alone.
- For units without a second bedroom, award the configured overall-point bonus for a usable
  den/home office. Verify workspace suitability; an ambiguous flex/storage label remains
  **Workspace Unsure**. Do not stack this bonus with the second-bedroom benefit.
- Short-term leases earn the configured overall-point bonus; long-term leases remain eligible.
  Do not filter out a listing merely because its lease is short-term. Record minimum commitment,
  actual duration, mandatory end date, renewal options, and the rent for the offered term.
  Unknown terms produce **Lease Term Unsure**. The preferred duration is not yet defined.
- Show base score and additive adjustments separately. Do not also reward the same benefit
  inside a weighted criterion. Bonuses cannot override a confirmed nature-view failure or any
  other hard exclusion. Calibrate them alongside the earlier overall-score examples.
- Store parking count, availability, inclusion, recurring fee, and evidence independently.
  Use **Parking Unsure** when availability or inclusion is unclear. Unknown is not unavailable;
  no automatic rejection for lack of parking is currently configured.
- Store laundry location, washer/dryer inclusion, exclusivity and unit-specific evidence.
  Distinguish shared-only facilities from shared amenities offered alongside in-unit machines;
  hookups or generic building amenities cannot confirm in-unit laundry. Apply the private
  laundry eligibility rule as a hard filter. Unknown/conflicting evidence produces Laundry
  Unsure; confirmed failures remain excluded regardless of bonuses. Reevaluate existing homes
  when the requirement changes, preserving historical assessments, IDs and user-managed stages.
- Record unit internet provider/service, connection type, download/upload speeds, dedicated
  versus shared service, inclusion and cost when stated, with evidence provenance. Generic
  "high-speed internet" or building-wide service does not establish actual unit performance.
  Missing information is Internet Unsure, with no automatic exclusion or score deduction.
  Support a manual pre-lease check of service availability, speeds, reliability and cost;
  performance thresholds and any score adjustment remain private configuration choices.
- Furnishings receive a small bonus. The price premium remains part of the normal value score;
  optional furnishing-cost comparisons must disclose the assumed tenancy and setup cost rather
  than double-counting those costs in the score.

Distinguish advertised rent from effective monthly cost, including known mandatory charges and
incentives, and the cost of the desired parking. Disclose unknown costs. Which measure the cap
uses remains unresolved; preserve base rent and total-cost estimates separately.

### Views and photos

Review every accessible photo in the listing's full gallery, not just a sample, and include
new photos from confirmed duplicate ads. Reuse valid assessments of unchanged images. Do not
stop once a favorable or unfavorable view appears. Qualifying
evidence must show the scenery through windows of the actual apartment. Separate these from
rooftop, amenity, balcony-only, exterior, stock, and other-unit images. If the image cannot be
attributed to the unit, or the scenery cannot be identified confidently, leave it unverified.

Store view verification separately from quality: unverified, photo-confirmed nature view,
or photo-assessed outlook without visible nature. Record scenery type, room/window, supporting
photo reference, visible obstructions, and whether nature or buildings dominate the outlook.
One photographed window does not establish the outlook from every room.
Record compass direction by room/window where supported, distinguishing the main outlook
from secondary exposures. Use unit-specific descriptions, oriented floor plans or reliable
geographic evidence; brightness and generic scenery claims do not establish direction.
Apply the private orientation bonus once when supported. Ambiguous exposure is Orientation
Unsure, with no earned bonus; direction alone cannot establish a qualifying nature view.
Street-level trees alone do not establish the desired nature view. Distinguish distant forest
from nearby landscaping. When sufficient unit-specific evidence confirms only building/street
outlooks and no qualifying nature, apply the confirmed-failure rule above. Partial qualifying
nature views remain eligible and receive a lower view-quality rating.

Suggested quality rubric, applied only to assessed window views and the private preferences:

- 5: preferred nature dominates a broad, mostly unobstructed outlook.
- 4: substantial nature view with limited obstruction; buildings do not dominate.
- 3: meaningful but partial nature view with noticeable obstruction.
- 2: buildings dominate, with at most a small glimpse of nature, or a city/tower outlook.
- 1: close wall, lane, or similarly restricted outlook with little visual openness.

A marketing claim, view tag, location, or floor height supplies no confirmed view rating.
Without qualifying photos, keep the rating unknown with an explicitly provisional range;
never turn an advertised view into a rating of 3. A midpoint used for overall score arithmetic
is an estimate, not visual confirmation. A cropped or zoomed glimpse cannot establish that
nature dominates the normal outlook; keep quality uncertain unless wider context supports it.

Enumerate the gallery and make numbered contact sheets covering all retrieved photos. Inspect
every image; examine originals at sufficient resolution wherever windows, scenery, reflections,
or ambiguous details need closer review. Classify interior/unit views separately from amenities,
balcony-only views, and photos with uncertain provenance. Retain supporting photo references and a
short evidence description. Surface a representative window-view image on the card when
available. Distinguish advertised claims, photo findings, and user feedback in summaries.
Missing images must not discard a potentially suitable listing, but its view stays unverified.

Store a gallery manifest with source photo IDs/URLs, fingerprints, expected count (or unknown),
retrieval/review status for each image, assessment version, and failure/defer reason. A batch or
model context limit must split the gallery into resumable batches, not silently omit images.
Aggregate findings across rooms, noting obstructions and disagreements. Full gallery review does
not prove that every actual window was photographed; absence of evidence alone cannot reject a
home. View certainty and review completeness are independent fields.

When page/media budgets or source warnings interrupt retrieval, save progress and show Photo
review pending or Photos inaccessible. Resume within allowed limits; do not issue extra visits
just to finish a gallery in one scan. Complete local analysis of already retrieved images without
further site requests. Test large galleries, missing images, changed/duplicate photos, conflicting
room views and interrupted/resumed reviews before enabling full scoring.

### Research and scoring reliability

Research by address/building name without disclosing personal criteria. Investigate building
age/type, documented issues, construction, and noise sources. Cite sources and dates and
separate evidence from inference. Cache durable facts; refresh time-sensitive findings sooner.

The scorer receives listing and research data but no browsing, shell, messaging, or database
tools. External content is untrusted. Validate structured output and evidence references;
unsupported claims become unknown. Render external text safely.

Record model, prompt, and rubric versions. Build a user-labeled set of representative listings
to test later changes, particularly whether good apartments are rejected. Rejection reasons
can inform proposed weight changes, never silent changes. Support reviewing and rescuing
rejected listings, with near-misses first.

## 6. Scam and other red flags

Suitability and risk are separate: a suspicious listing may otherwise score highly. Show
warnings with evidence; do not present a suspected scam as the best new find.

Signals include copied photos with conflicting facts, unusually low prices, pressure to pay
before viewing, refusal to allow viewings, unusual payment instructions, and inconsistent
contact details. A single weak signal is not proof.

Verify any tenancy-law rules against current authoritative BC guidance during implementation,
recording sources and review dates. Viewing checklists and inquiry drafts help resolve unknowns.
The app does not automatically contact landlords or make payments.

## 7. Sorting Desk

Required stages: **Unreviewed**, **Interested**, **Inquiry Sent**, and **Not Interested**.
The plan extends these with **Viewing Booked**, **Applied**, and **Leased**, plus closed reasons
such as Gone, Landlord declined, No reply, Withdrew, and Leased elsewhere.

Allow skipping stages, going back, undoing actions, and reopening closed cards. Uncertain,
Possible duplicate, Suspected scam, Price drop, and Follow-up due are badges, not stages.
Listing removal is a reported fact; closing a user-managed card remains the user's decision.

### Layout

- **Today:** new listings, due follow-ups, upcoming viewings, and decisions awaiting review.
- **Tabs:** Inbox, Shortlist, In progress, and Closed, with counts and filters.
- **Short card:** thumbnail, score/range, rent/effective cost, beds/baths, area, availability,
  view evidence, first-seen date, badges, summary, and Interested / Not interested buttons.
- **Expanded card:** photos, pros/cons, unknowns, ratings, research/risk evidence, source links,
  map link, notes, and stage history.
- **Header:** last successful scan, running/overdue status, and per-source health.

Use stage buttons and responsive layouts. Scan now queues background work and displays progress.

### Follow-through

- Not interested supports undo and optional reason chips.
- Draft inquiry produces a message from unresolved questions for the user to copy/send.
- Mark sent records date/channel and can set a follow-up, initially two days later.
- Viewing Booked records time/timezone, offers a calendar file, and builds a viewing checklist.
- Compare shows two or three homes side by side.
- Notes form a timestamped log with an optional pinned summary.
- Leased offers to pause scans and close other homes, with confirmation of those bulk changes.

## 8. Storage and ownership

The backend is the only route for browser writes. Backend and worker share storage code,
migrations, transactions, and bounded handling of SQLite write contention.

| Data | Owner/purpose |
| --- | --- |
| Homes and postings | Worker-managed facts, links, fingerprints, availability, and merges |
| Assessments and research | Versioned ratings, evidence, scores, risks, and cached findings |
| Decisions and notes | User-managed stages, reasons, viewing/follow-up dates, and history |
| Duplicate feedback | User-confirmed Same place / Different relationships |
| Jobs, checkpoints, source health | Work queues, retries, locks, coverage, and activity |
| Media | Private files with database references and retention metadata |

Scanner updates never overwrite user-managed fields. Use transactions and revision checks
for concurrent edits. Durable IDs connect the desk to its records; scanning updates data
without republishing the interface.

## 9. Running and accessing the app

Start locally on the user's Windows computer. Serve the app on localhost and launch the worker
using Windows Task Scheduler. The backend can start at sign-in. Closing the browser or coding
assistant does not stop background work while the computer and relevant services are running.

Use a configurable schedule, initially three scans per day. Store the scan timezone explicitly;
America/Vancouver is the planning default for the rental market. Label times so they are not
confused with the user's current local timezone.

Sleep/power-off delays scans. On restart, queue one catch-up run from the last successful
checkpoints and report coverage gaps. For continuous operation, the same app/worker can later
move to an always-on private host.

Responsive layout supports phones, but localhost is reachable only on the host. Phone access
requires an authenticated private connection or hosted deployment. Do not expose an
unauthenticated desk publicly.

Start with an in-app activity feed and due-action indicators. Optional external notifications
can follow, limited to useful matches, reminders, and failures, with quiet hours.
Email delivery remains a later feature.

## 10. Technology and cost

| Need | Implementation default |
| --- | --- |
| Language/runtime | TypeScript on supported Node LTS; verify installed version at setup |
| Sorting Desk | React with Vite; backend serves production build |
| Backend/worker | Node HTTP API plus job worker sharing domain/storage code |
| Extraction | Playwright; ordinary HTTP where a browser is unnecessary |
| Persistence | SQLite; choose driver against the pinned Node release |
| Validation | Zod schemas for adapters, API inputs, and AI output |
| Photos | Sharp for thumbnails/contact sheets |
| AI | Provider-neutral interface for text, images, and structured ratings |
| Scheduling | Windows Task Scheduler initially; host-native scheduler for a later server |
| Tests | Node unit/integration tests and Playwright for critical desk workflows |

Choose the model through a small real-listing comparison of evidence quality, uncertainty,
latency, and cost. Credentials are needed before live scoring. Provider and spending ceiling
remain open preferences. Do not assume a chat subscription funds API use or reuse unverified
model/pricing estimates.

The user subsequently selected existing ChatGPT Pro usage without additional purchases.
The local implementation now defaults to OpenAI's documented Sign in with ChatGPT plan-usage
flow, with account consent, a model catalog, and Windows-protected credentials. This is separate
from API-key billing and the API-credit benefit. It has no automatic paid-key fallback. Usage
shares the account's existing allowance; the user controls app limits and purchased-credit
overflow in ChatGPT settings. Live account eligibility and inference still need validation.

Track usage per run and enforce an application-level spending limit. Reduce work with hard
filters, duplicate detection, content fingerprints, cached research, and reuse of unchanged
photo assessments. Full gallery coverage remains required for assessed apartments. Estimate
monthly costs after a representative batch.

Technical references checked on 2026-11-11:
[Vite](https://vite.dev/guide/), [Playwright](https://playwright.dev/docs/intro),
[Node SQLite](https://nodejs.org/api/sqlite.html), and
[Windows Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page).
Verify APIs against pinned versions during implementation.

## 11. Privacy and retention

- Criteria in gitignored `private/`, credentials in `.env`, runtime data in `data/`.
  Never ship credentials to the browser.
- Bind to localhost initially; require authentication for remote access.
- Minimize stored contact details. Use keyed fingerprints for contact matching where needed
  and keep unnecessary personal details out of logs and prompts.
- Initial retention: raw snapshots seven days; thumbnails fourteen days after closure;
  closed homes archived from the active desk after sixty days. Retain minimal identity and
  rejection history through the search so discarded homes do not return.
- Offer export, backup/restore, and full purge when the search ends.

## 12. Implementation phases

| Phase | Deliverable and completion condition |
| --- | --- |
| 1. Foundation and source trial | App/backend/worker skeleton, private config, migrations, one working direct adapter; real facts and available photos on basic cards |
| 2. Useful shortlist | Filters, AI scoring/evidence, uncertainty, research, duplicates, persistent stages; assess usefulness with real listings |
| 3. Scheduled discovery | More validated adapters, checkpoints, retries, refresh, scheduling, health, restart recovery; repeat scans preserve decisions and avoid repeated scoring |
| 4. Follow-through | Drafts, follow-ups, calendar files, comparison, richer duplicate detection, scoring calibration |
| 5. Optional access/delivery | Authenticated phone access, always-on hosting, external notifications if wanted |

Prove direct discovery and useful scoring before expanding features. The first usable version
does not depend on every source or every later workflow feature.

## 13. Remaining preferences

These refine the plan; they do not reopen the confirmed direction or require another general
architecture approval.

- Further criteria: move-in dates, budget basis, minimum size, preferred short-term duration,
  pets, cooling, noise tolerance, and other must-haves. Initial bedroom, workspace, laundry,
  parking, furnishing, and short-term lease criteria are captured in private configuration.
- Exact station walking limits and airport journey tolerance; relative preference among
  qualifying nature types. Area priorities and the poor rating of building-only views are set.
- Whether confirmed lack of parking should become a hard exclusion, studio exception thresholds,
  and the tenancy horizon/furnishing budget for cost comparisons.
- AI provider/model and spending ceiling, informed by a representative trial.
- Scan times/timezone, whether the PC stays awake, and need for continuous operation.
- Whether authenticated phone access is needed at launch or can follow the local version.
- Whether to enable price-drop resurfacing or a Not this building action.
