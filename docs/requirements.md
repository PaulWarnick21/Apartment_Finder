# Requirements

November 18 initial-move exception: the user confirmed that a nice, reasonably priced,
furnished short-term apartment may score above 3.0 without a verified nature view.
Implement a narrow alternative fit up to 3.5, requiring supported furnishing/short lease,
complete photo review and modern actual-unit interiors, no confirmed cramped layout,
and known rent plus known parking below the existing premium threshold. Preserve hard
requirements and the 4.0+ elevated-nature-view gate. Missing/conflicting listing facts
remain unresolved evidence; this preference clarification does not invent those facts.

November 18 feedback-wait recovery: a selected apartment blocked before scoring by pending
rating feedback must remain monitored and resume automatically when that feedback resolves.
Show the specific feedback blocker and automatic-resume behavior. A cancelled/rejected
home must never revive. This does not renew spent allowances or authorize work on startup.

November 18 automatic duplicates: check saved addresses/units and photo fingerprints
before full scoring, and again as gallery evidence becomes available. Confident duplicates
keep the oldest home and its stage, score and review; newer references become recoverable
aliases. Remember source IDs/URLs to skip repeat discovery. Respect explicit different-home
decisions, conflicting unit facts and separate rating feedback. Use local indexed evidence,
without extra source requests or model calls solely for duplicate detection.

November 18 scan-area narrowing: future scans are Downtown Vancouver only (West End,
Coal Harbour, Yaletown and Gastown included). Disable North/West Vancouver without deleting
their saved routes; re-enable only on user request. No North/West fallback when Downtown
inventory is exhausted. Preserve saved decisions and ranks, while applying the new scope
to ordinary scan refreshes and pending gallery work as well as discovery.

November 18 final-review stage: rename the former Ready to Apply stage to Serious
Candidates and move all existing records in that stage there. Add a new Ready to Apply
stage after it. Enforce Unreviewed → Interested → Serious Candidates → Ready to Apply
→ In Progress in UI and backend, without skipping or going backwards. Not Interested
remains available throughout review. Full assessment must finish before promotion out of
Interested; the final Serious Candidates decision is the user's own thorough review.
Scoring in Progress remains between Unreviewed and Interested on the desk: choosing
Interested queues the full assessment there. Queued, running, paused or failed assessments
remain in Scoring in Progress; completion moves them into Interested automatically.
The new Serious Candidates stage does not bypass or replace this scoring section.

November 18 mainland-only correction: homes off mainland BC are a hard exclusion,
including existing Interested homes and records grandfathered under older area settings.
Apartment #354's explicit Bowen Island description must be caught before photo collection
or scoring. Read scoped description/title location statements as well as structured fields;
do not confuse island outlooks or ferry destinations with the apartment's location.
Retain saved notes, photos and historical ranks while applying current eligibility.

November 18 source audit: investigate every retained source's ability to supply fresh,
qualifying candidates. Distinguish access pauses, missing geographic filters, parsing or
pagination defects, user-allocation deferrals and genuinely checked inventory with no new
matches. Repair supported defects offline and validate source coverage in a separately
approved bounded run. New-candidate guarantees must not override finite inventory, search
criteria, geographic allocation or source warnings.

November 18 desk simplification: scan planning is handled through Codex chats. Remove
the scan-status banner, scan-status pill and scan-plan entry points from the Sorting Desk,
including empty views. Keep the desk focused on apartment review and lifecycle counts.
This presentation change does not start, stop or authorize any scan.

November 18 furnishing clarification: use saved listing descriptions during scoring.
When an available description does not advertise furniture inclusion, assume unfurnished
and label that inference explicitly. Missing or visibly truncated descriptions remain
unconfirmed; optional, partial, floor-plan-only and conflicting statements stay distinct.
Furnishing shown in photos does not establish inclusion. Display and scoring share the
same text assessment, retaining raw source facts and preserved quick ranks.

November 18 detail-view cleanup: render each map, rating form, photo gallery and
listing-conflict warning once, including after automatic refreshes. Interested cards
omit completed-scoring notices, view-summary lines and score-warning chips. Show explicit
furnishing status beside rent on Interested cards and in full details; unknown, optional
and conflicting terms must stay distinct from unfurnished. Equal-view comparisons retain
the existing affordability deduction and small confirmed-furnishing bonus, so otherwise
comparable expensive unfurnished apartments score below cheaper unfurnished apartments.

November 18 scan-throughput direction: after the current one-hour run ends, improve
throughput using bounded overlap and measured pacing, without bypassing website warnings.
Prepare a thirty-minute benchmark, but wait for the user's separate approval before
starting it. Friday evening is a coverage target, not verified inventory exhaustion.
Keep all selected-area rules, full-gallery collection, existing ranks and user decisions.
Daily scans remain paused.

## Current workflow — November 18, 2026

Future quick scans should target the user's configurable geographic distribution, tracked
using distinct newly admitted apartments with saved photos rather than request counts.
Prioritize the preferred area and retain deferred candidates for later capacity. Allow
other selected areas to fill capacity when checked preferred-area inventory is exhausted;
failed or unverified discovery does not establish exhaustion. The setting applies to future
intake only, preserves existing ranks and decisions, and does not enable scanning.

Photo navigation should feel immediate on desktop and mobile. Preload nearby saved photos,
use appropriately sized display copies, and retain the current image until the next one is
decoded. Bound background downloads and decoded memory; retain original files for zoom and
the existing scoring evidence. This does not authorize source downloads or AI calls.

Standing performance preference: use bounded parallel processing for future scans and
assessments wherever independent work can safely overlap. Default to three scan sources,
one shared Chrome lane, and up to two independent saved-gallery assessments. Preserve every
photo review, fresh per-call account checks and the weekly reserve. Source/browser work that
cannot safely overlap remains serialized. Quick ranks stay local and cached; existing ranks
and user decisions remain unchanged. This preference does not enable daily scans or authorize
AI assessments without the existing Interested/retry or explicit bounded approval.

The user requested parallel execution where possible for the active five-per-source test.
Use at most three independent source workers, keeping the shared Chrome lane serial and
all per-source/aggregate limits unchanged. Preserve completed sequential measurements and
label the parallel portion separately. Do not increase request rate within a source.

Latest bounded test authorization: investigate source latency, then compare five **new,
desk-eligible, photo-collected** apartments per retained source. Use selected website areas,
zero AI and zero address lookups. The comparison records first-result and per-source elapsed
times, exclusions and failures. Limits: twelve minutes, sixty pages, forty candidate attempts
and four hundred photo attempts per source; three hours overall. Preserve source pauses and
all existing ranks/decisions. Unsupported geographic filters or insufficient accessible new
inventory are explicit shortfalls, not successful five-apartment results. Daily scans remain off.

Latest intake direction: use the websites' geographic search filters, without individual
address verification. Carry the selected source area into new listings as search provenance,
not an independently verified address. Continue rejecting explicit outside-area facts and
the existing bedroom, rent, whole-apartment and collected-photo failures. Keep old ranks and
decisions. Broad legacy queues cannot acquire area provenance retroactively. Sources lacking
a configured geographic search stay out of restricted intake until their filters are supported.
The current one-off test remains capped at 30 new qualifying apartments under its original
aggregate/time limits; this change does not enable scheduled scans.

Future searches must respect the user's selected geographic areas in private configuration.
Apply the restriction to new candidates and queued discovery without changing existing
apartments or ranks. Filter clear location mismatches early; unresolved locations remain
outside the active desk until supported within the selected area. Preserve paused scans.

Studio apartments must fail the configured bedroom requirement before photo collection or
assessment. Use the advertised unit facts; sample tours and building inventory cannot supply
a bedroom count. Apply the current bedroom gate to saved apartments independently of their
preserved ranks, retaining original records, notes and user decisions.

Exclude apartments with zero collected photos from the active desk automatically, including
existing records. Attached URLs and advertised gallery counts do not satisfy this requirement.
Keep the saved record, rank, notes and user stage; closed decisions remain closed. Pending
photo collection remains resumable only in an approved scan, and the photo exclusion clears
once a listing photo is saved. Do not trigger a full assessment from a photo-less card.

Interested / Not Interested decisions must update the desk immediately, allowing rapid
successive clicks while saves and assessments continue in the background. Show pending
saves and recoverable errors, protect against stale refreshes and duplicate writes, and
preserve other apartments' decisions when one save fails.

Latest quick-ranking refinement: preserve every existing apartment's letter grade and
ordering value. Apply stricter grades only to future apartments. S is reserved for an
exceptional, high-confidence overall match, supported by a verified address, convincing
actual-unit nature-view evidence and no major unresolved concerns. Advertising bonuses
alone cannot earn S. New intake performs a quick bounded public address lookup instead of
leaving an available street address uninvestigated; ambiguous or failed matches remain
explicitly unverified. This authorizes implementation, not a new listing scan or AI review.

Latest user instruction: do not restart scans automatically after implementation. First run
only separately approved, bounded tests with real apartment listings. Full inventory scans
must wait until the user is satisfied with those tests and explicitly authorizes expansion.
The proposed 48-hour catch-up has not been approved; daily scanning remains paused.

The user replaced full assessment during intake with **quick ranking → user interest →
full assessment → application readiness**. This section supersedes older score-based desk
exclusions and the earlier Unreviewed → Interested → In Progress workflow below.

- Intake collects apartment facts and attached photos, then computes a local, deterministic
  letter grade: S, A, B, C, D, E or F. S is a particularly promising preliminary match, A is decent,
  and F is unlikely to interest the user. A grade is an ordering aid, not a completed visual
  assessment or a conversion of the full numeric score. Intake makes no AI calls.
- Apply only established hard failures before admitting a candidate: an actual whole-apartment
  rental, configured inclusive advertised-rent bounds, permitted bedroom counts, minimum distinct
  attached-photo count, confirmed laundry requirements and the Vancouver search region. Personal
  values live in `private/` and runtime criteria. Conflicting or missing facts remain flagged;
  an incompletely enumerated gallery is not proof that the listing has too few photos.
- Keep every hard-eligible candidate in Unreviewed regardless of grade, missing view confirmation,
  or a low historical numeric score. Distance from downtown reduces the grade. Use saved supported
  features and clearly labelled advertising claims for priority, without claiming newly verified
  views. Only the bounded address lookup described above runs during quick intake; deeper
  research waits for interest. Never silently mark a deferred candidate Not Interested.
- Unreviewed defaults to highest grade first: S → A → B → C → D → E → F. Within a grade,
  show the higher quick-rank value first; low grades remain available at the bottom.
- Recalculate source priority from the user's recent Interested / Not Interested decisions before
  each catch-up batch. A source with stronger recent interest should receive more intake work;
  the lead must shift as preferences and source results change. Older decisions carry less weight.
  Temper small samples and count each distinct apartment once on its primary discovery source.
  Unreviewed apartments and unfinished assessments are not negative decisions; model scores never
  override recorded user feedback. Use saved assessments only before any user feedback exists.
- Give the leading available source three bounded catch-up phases, then rotate one phase among
  the other sources. Remove drained sources from work selection, so all remaining inventory can
  be collected regardless of past yield. With no supported positives, rotate among available
  sources. Once checked inventory is caught up, each maintenance cycle checks every available
  source for new listings before favoring a newly discovered backlog. Access/coverage gaps remain
  explicit; exhausted checked searches do not establish that every Vancouver listing is known.
- The Unreviewed detail view focuses on price, location, photos, quick grade and Interested /
  Not Interested actions. Existing notes, ratings, source links, IDs and duplicate decisions persist.
- Marking Interested authorizes and queues one bounded full assessment of that apartment,
  automatically and durably. Put it in **Scoring in Progress**, between Unreviewed and Interested,
  until its full assessment completes; then move it automatically into Interested. Show queued,
  running, paused and failed status in Scoring in Progress, retaining interrupted jobs there with
  retry controls. The process continues when the detail view closes. Retain completed evidence across interruptions.
  New listing scans remain a separate bounded authorization, and startup never starts a scan.
- Full assessment retains the established numeric score, every-accessible-photo review,
  actual-unit attribution, uncertainty and evidence requirements. Reuse compatible saved findings.
  Source pauses, shared budgets, fresh account-usage checks and the 95% weekly stop still apply.
  A low full score does not remove an apartment the user marked Interested; the user makes the
  next decision in Interested: Ready to Apply or Not Interested. Ready to Apply requires a
  completed full assessment, and does not send an inquiry or application.
- An app restart pauses unfinished full-assessment jobs for explicit resumption; it never silently
  starts source or AI work. Failed jobs retain their errors and saved evidence.
- The user's goal is broad intake within two days. This is a target, not a verified coverage or
  completion guarantee: unfinished pagination, source access failures, unknown inventory and
  photo-collection gaps must remain visible. Preserve the existing daily-scan pause until a new
  bounded run or an explicit schedule change is approved. Do not redeem account reset credits.

Historical scan authorization (November 16): catch up on current listings across all 12 retained
sources, aiming for November 21, then scan once daily in the morning. On November 16 the user
explicitly lifted the previous 88% stop for today's catch-up, permitting up to 100% of the
current weekly allowance until local midnight. The user then set a recurring 95% stop from
Wednesday November 18's weekly reset (07:36:11 America/Toronto), leaving 5% thereafter.
The user subsequently reduced today's stop to 99% and paused the daily 08:00 automation
pending a review of scan efficiency, saved results and remaining inventory. Stop the current
run safely at 99%; do not restart daily scans until the user re-enables them after that review.
The future 95% stop remains configured for resumed scans. The previous 88% policy remains
between today's exception and that reset, but does not override the requested pause. See
[catchup-scans.md](catchup-scans.md) for explicit bounds and execution requirements. This
supersedes historical notes below that scheduled scans were still off.

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
- Prefer recent or undated postings over ads older than the configured posting-age threshold,
  before detail visits and expensive gallery review. Use source posting dates, never the date
  the app discovered an ad, a move-in date, or a last-update timestamp. Age is a scan priority,
  not a score penalty, availability claim or automatic exclusion. Retain lower-priority work.
- Allocate more intake effort to sources that produce more recent user interest, following
  the current workflow above. Model-assessed strong matches supply a starting point only before
  user feedback exists. Show hits and
  sample sizes, distinguishing completed assessments, factual exclusions and unfinished work.
  Compare results per assessed unit and per measured time/AI effort; AI-call counts are not
  exact account-credit costs. Treat small samples cautiously, keep some exploration of other
  sources, and continue cheap inventory coverage across retained sources. Duplicate postings,
  floorplan/building ads, provisional scores and access failures must not inflate or masquerade
  as assessed-apartment outcomes. A source's priority changes work allocation, never its
  listings' scores, evidence requirements or access cooldowns.
- Use conservative per-source page/request budgets and pacing, one source at a time by default,
  and persistent browser sessions where needed. Share limits across manual and scheduled runs.
  Cache unchanged content and size a bounded session for the explicitly requested target.
  Normal approved sessions must not inherit hidden trial-sized page or daily-image quotas.
  Report coverage limits and distinguish candidate attempts, new apartments, floor-plan offers,
  hard-filter scores and complete photo assessments.
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

The following numeric-score rules apply to full assessments. In the November 18 quick-first
workflow they do not filter Unreviewed, hide Interested apartments or replace manual stages.

- Latest view-first preference supersedes the earlier interior tradeoff and permissive
  partial/unverified-view desk rules below. When `requireNiceViewForDesk` is enabled,
  require a reviewed actual-unit window nature view of quality >=4 with resolved attribution
  and no conflicting view evidence. Otherwise cap at 2.9 and place in Excluded, preserving
  manual access, original personal scores, notes and stages. Distinguish insufficient
  confirmation from a known poor view. Neither bonuses nor learned ratings can bypass this.

- Scale the extra-bedroom benefit down as monthly cost rises. Premium-priced apartments
  need an exceptional verified elevated nature view and photo-supported modern, spacious
  interiors to escape the affordability ceiling. Unknown quality and luxury marketing do
  not qualify. Apply the ceiling to all bedroom counts and preserve it through calibration.

- Reserve 4.0 and above for a good, photo-confirmed nature outlook through the actual
  unit's windows from floor 3 or higher. Require a complete gallery review, nature-dominant
  view quality (at least 4/5), resolved unit attribution and nonconflicting floor/view facts.
  Otherwise cap at 3.9, retaining any stricter existing limits. Unknown floor or marketing
  claims cannot qualify. Bonuses, interior tradeoffs and personal calibration cannot bypass
  this gate. A qualifying view permits, but does not guarantee, a high overall score.

- Parking penalties distinguish confirmed unavailability from strong or moderate negative
  evidence. Apply them after score ceilings, retain the score floor, and prevent positive
  learned calibration from undoing them. Missing information alone is not negative evidence;
  no included parking does not prove paid parking is unavailable. Weights live in private criteria.

- Every apartment detail view supports a personal score and a short reason. Keep the app's
  score at submission, listing/criteria snapshots, all feedback, and review outcomes.
  Review each explicit submission through the connected ChatGPT plan, with no paid API fallback.
  Queue its review immediately on submission, without a separate review click, scan or chat
  request. The server continues when the apartment detail view closes; queued reviews run
  in order. Show review progress and its outcome beside the rating, including any failure
  or clarification needed. Each submission authorizes one review; retries remain explicit.
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
  normally receive a substantial configured deduction and a below-3 ceiling, subject to
  the supported-interior tradeoff below. This is a poor-fit assessment of available evidence,
  not a claim that every unseen window lacks nature.
- When only representative window evidence shows buildings and no interior-window photo
  shows qualifying nature, normally cap the provisional headline below 3.0. Cheap rent alone
  does not overcome that evidence. Retain exact-unit uncertainty; representative interiors
  alone cannot establish the actual-unit evidence required by the supported-interior tradeoff.
- A building-dominated nature glimpse (best verified interior view quality at most 2/5)
  caps the ordinary view-based score at 3.3, or 3.1 when interiors are assessed as dated,
  subject to the interior alternative below. Preserve the partial-nature evidence; a narrow
  glimpse is not equivalent to an unobstructed outlook.
- Moderate partial nature views (quality above 2 and below 4) limit the ordinary view-based
  score using a configured ceiling that increases gradually for better partial views. Confirmed furnishing,
  short leases, gas cooking, and a second bedroom modestly extend it. Rent, workspace, and modern
  finishes cannot turn a mediocre view into a near-perfect match. A flexible sleeping area or
  ambiguous "Euro 2" label does not establish a second bedroom; preserve the conflict for review.
- For weaker partial views, higher rent also lowers the view-based ceiling. Apply the strongest
  cost deduction to weak outlooks, tapering it as partial views improve; keep ordinary rent
  scoring active. Broad mountain panoramas should not be equated with narrow urban water glimpses.
- Apply the expanded private criteria and user-provided example scores when calibrating price,
  location, view quality, unit type, workspace, parking, furnishing, and lease preferences. Exact weights remain
  provisional; personal values and example prices stay in private configuration.
- Show a separate Outside Downtown Core deduction for confirmed non-downtown locations,
  enforce the configured minimum, and retain any larger distance deduction without counting it
  twice. Nearby transit does not erase the location cost; unknown locations remain flagged.
- Support an explicitly enabled interior tradeoff: a sufficiently supported combination of
  furnishing, open layout, modern interiors, and usable workspace can make an apartment worth
  reviewing despite a poor or absent nature outlook. Require a known advertised rent and reviewed actual-unit interiors;
  cheap rent or furnishing alone is insufficient. Count workspace only when the known bedroom
  count establishes that no second-bedroom benefit is being counted instead.
- The tradeoff uses the apartment's ordinary non-view value, retains a configured view deduction,
  and has a modest review-band ceiling. Rent, location, dated condition and cramped-layout effects
  remain active. Apply the same alternative across view qualities so improving a view cannot
  lower a score; retain a higher ordinary view-based score when justified. Preserve view evidence,
  uncertainty and gallery-completeness labels without relabelling buildings as nature.
- Confirmed absence of a qualifying nature outlook otherwise remains below the review threshold.
  The interior tradeoff cannot bypass budget, laundry, actual-rental, availability or interior-photo
  requirements, nor the configured distance, street-level and expensive-weak-view limits. Personal
  thresholds and calibration examples belong in private configuration. Missing or inconclusive
  photos do not establish absence, and no new photo collection is required to rescore saved evidence.
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

- Cap pinned apartment titles at two lines so long source text cannot cover the mobile
  detail view. Keep the full title available in expandable, scrollable content and the
  close button visible at the top.

- In the current quick-first workflow, hard-eligible listings enter Unreviewed with letter grades.
  Numeric-score thresholds from earlier versions no longer decide their desk visibility.
- The desk is a lifecycle (state machine). Stages named so far:
  1. **Unreviewed**: quick-ranked automatically, not yet reviewed by the user.
  2. **Interested**: chosen by the user; full assessment is queued, running or completed.
  3. **Serious Candidates**: full assessment completed; selected for the user's final review.
  4. **Ready to Apply**: the user has completed that final review and wants to proceed.
  5. **In Progress**, including Inquiry Sent and existing later stages.
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
- Support Chrome on iPhone through a private Tailscale connection to the Windows PC.
  Keep one shared database and restrict remote access to the owner's configured account.
  This uses the free Personal plan and is separate from the user's existing Codex remote
  connection. The PC and app remain running; enabling phone access does not approve scanning.
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
