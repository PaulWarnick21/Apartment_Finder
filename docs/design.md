# Design

November 19 availability monitor: an opt-in, persistent daily timer in the app runs at
noon America/Toronto (DST-aware), catching up after noon when the app is running and the
exclusive source lock becomes free. Startup itself stays offline. A persisted local-day
claim prevents duplicate runs across app instances/restarts; incomplete runs do not silently
retry that day. The schedule is separate from scanSchedule and is configured with
scripts/configure-availability.ts --enable / --disable. It first becomes eligible at the next
noon after enabling. The app and normal Chrome extension must remain running for Chrome sources.

Each day snapshots Interested-and-later active homes and every confirmed posting, including
aliases excluded from scoring aggregation. Bounds are 240 saved pages and 60 minutes, with
zero discovery, photo downloads, address lookups or AI. Existing shared source pacing,
access pauses, stop-on-warning and scan locks apply. Older observations get priority if
capacity is insufficient. Incomplete and inaccessible checks are recorded as unknown.

Availability observations are keyed by source + source ID, outside listing/decision fields;
merges and splits therefore aggregate the current confirmed membership. Explicit scoped
closure notices or matching structured closure states establish unavailable ads. 404/410,
redirects, parse errors, missing units and challenges do not. Every confirmed ad must be
unavailable to mark the home unavailable; any current live ad wins, and unresolved possible
duplicates prevent a definitive closure. Observations expire to unknown after 36 hours.
Only confirmed unavailable homes show an availability notice: cards use red styling plus
status text, and details expose checked times and per-ad evidence. Available, unchecked and
uncertain homes have no apartment-level availability badge.
Activity exposes schedule and last-run coverage. Live adapter availability coverage is not
claimed by the offline fixture tests; unsupported closure layouts remain unverified.


Full-review duplicate preflight (`review-duplicates.ts`) runs in both queue admission and
the selected-review worker, including direct plans, after photo collection and on completion.
It extends exact identity matching with cached perceptual signatures of immutable local
images: difference hashes plus a color-grid comparison, non-flat images, distinct one-to-one
matches, at least four photos and three attributed interiors, and 80% of the smaller gallery.
Known bedrooms, closely matching size/rent and substantial specific-description overlap
must corroborate image matches; contradictory street/unit/floor facts block this path.
An identical substantial specific rental description with exact street/rent/size can match
a missing-gallery cross-post when the other gallery has attributed interiors. Multi-suite,
floor-plan and representative advertising is excluded, including when described in text.
The manual audit's duplicate multi-suite advertisement is intentionally not generalized.

The check does no network or model work. Image signatures persist in local metadata and
are reused across submissions. Files are read with bounded concurrency. Missing images
remain insufficient evidence. Before merging after asynchronous reads, a transaction
rechecks listing snapshots, current stages, aliases and explicit different-home decisions.
Among active records the more advanced stage wins, with age breaking ties; separate rating
feedback or conflicting/nontransferable appointments prevent automatic merging. Existing
exact matching to closed decisions remains in force. Recoverable aliases, posting markers
and merge history retain saved scores and notes, and cancel redundant scoring jobs.

Discovery recognizes source bedroom labels including `bd`, hyphenated counts and written
numbers, while ranges stay unknown. Empty links cannot overwrite later card bedroom
facts, and empty visible Zumper fields cannot overwrite its structured search evidence.
Saved discovery queues reapply the current intake checks before detail visits. Native
bedroom search routes start their own pagination; prior geographic provenance and
frontiers remain retained until filtered responses are validated.

Zumper address pages can put a sibling apartment in their primary detail object. Unit
extraction matches the requested permanent/listing identity against scoped active units;
only that exact unit's facts and gallery are admitted. Missing or ambiguous identities
fail explicitly instead of attaching sibling data to the requested URL.

A user-authorized deadline extension resumes the same run snapshot with an appended authorization history. Preserve baseline IDs, accumulated plans/usage, retry state and inventory frontiers; never overwrite the original before-scan backup. Stop only the verified old supervisor, let its existing worker finish under its original bounded plan, and create later plans with the new stopAt. One replacement supervisor owns the run; no second scan or budget reset occurs.

The scan coordinator waits for any approved/running work, scan lock or parallel-review
membership before requesting a batch. A racing approval conflict may cancel only its own
unchanged, zero-usage draft; that local deferral never becomes a website cooldown. Actual
worker failures and user cancellations retain their normal guards. Resume-attempt counts
advance only after approval. A same-run coordinator handoff verifies the old PID stopped,
backs up current state separately, and can wait alongside existing cached user reviews
without changing their plans or locks.

Facebook inventory accumulates only public cards from the current Marketplace results container and a uniquely matched current feed. Every ordinary scroll spends the existing page/request allowance and respects persistent source pacing. Saved captures omit account/navigation state. Virtualized cards are unioned by canonical item URL, including a separate set of previously rendered URLs so cycling old cards is not progress. Maximum observed scroll depth survives batches; because there is no validated resumable page URL, later bounded batches replay visible results before extending deeper. No-progress is unverified coverage, never market exhaustion.

Long-run snapshot replacement retries transient Windows file-sharing errors. A prolonged snapshot lock retains the last valid JSON and stops new approvals while the existing bounded worker can finish; it does not manufacture a website cooldown or reset counters. A failed supervisor restart requires evidence distinguishing a system cancellation from a user cancellation and preserves the original failure snapshot.

November 19 discovery repair supersedes the strict source-filter exclusion below: approximate Vancouver routes may supply candidates without asserting that a broad search proves a Downtown address. Keep exact search provenance distinct from approximate fallback, favor supported local location evidence, and retain uncertainty rather than silently dropping a major source. Validate deployment as well as code: the running Chrome bridge version must be observable before relying on capture/warning changes.

Source search routes are neighbourhood subsets of the user's selected region, not proof
of complete region coverage. The November 18 boundary clarification is recorded privately.
Add source-advertised missing routes to the private configuration and apply it while scans
are idle. `inventoryRoutes` gives added routes their own pending frontier without resetting
existing routes or treating earlier exhausted searches as exhaustion of the additions.

Overnight quick-run recovery keeps one fixed deadline and aggregate budget across all
continuation plans. Failed sources retry after five minutes, fifteen minutes, then at most
once per hour; source-health cooldowns and attention flags take precedence. Quiet sources
can be refreshed every thirty minutes. Every plan persists the same deadline. A known-closed
worker releases only its own scan/area claims and becomes interrupted; this cleanup does
not itself approve or restart work. Ordinary user cancellation ends the supervisor.

An inventory route that fetched successfully but recognized no cards retains its frontier
and retries after five minutes, fifteen minutes, then hourly. Successful recognition clears
that route's failure count. This narrow retry does not reopen access warnings, cancellation
or budget stops. Other configured routes continue while a route waits. Hollyburn's map
search waits up to fifteen seconds for its observed loading indicator to disappear and
scoped building links to render; a timeout remains incomplete coverage.

Austeville's filtered page currently crashes on an invalid suite-to-suite parent relation.
Its advertised JSON configuration must match the requested neighbourhood exactly before
the inventory adapter reads the advertised property feed. Only published, available suite
rows with a published top-level parent in that neighbourhood are admitted. Missing,
conflicting and nested parent evidence is excluded; the full feed is never merged into a
geographically scoped queue. A full 100-row page is incomplete, not exhausted coverage.

`initialMoveShortTermException` opts into a narrow, 3.5-capped alternative to the nature
view preference. The alternative uses non-view fit less the existing view-compromise
deduction. It requires confirmed furnishing and short lease, supported modern interiors,
complete reviewed photos with unit attribution, no known cramped layout or conflicting
price/lease/furnishing/interior facts, and known recurring cost below `premiumRentThreshold`.
Ordinary nature scoring can still win. Location, laundry, parking, floor and other hard
requirements apply afterward. The feedback interpreter knows this rule, preventing the
resolved preference from becoming a recurring global feedback blocker.

Full-review preflight feedback waits carry `waitingForFeedback` and keep the existing queue
timer alive. Each tick checks local feedback state, updates actionable blocker details, and
queues the assessment once all latest feedback is resolved. Account/usage checks and plan
authorization still run before any work. Only unstarted preflight waits auto-resume;
partial/completed plans cannot acquire fresh allowances from this mechanism. Restart clears
automatic-wait markers and retains evidence without starting network work.

Current scan policy selects only Downtown Vancouver; inactive North/West routes remain
stored for future re-enablement. `scanAreaExclusion` applies current source scope to regular
scan refreshes and pending galleries without the saved-home exemption used by the desk.

The review stages are Unreviewed, Interested, Serious Candidates, Ready to Apply, then
In Progress. Shared transition rules and server validation prevent skipping stages.
The one-time Serious Candidates migration renames existing Ready to Apply records,
historical stage labels and merge-restoration snapshots, increments affected revisions
to reject stale decisions, and preserves notes, scores, grades, photos and entry dates.
Later Ready to Apply decisions are never remigrated. These promotions do not start scans
or repeat the completed full assessment.

Mainland-only location gate: `mainland-location.ts` recognizes advertised island locations
in location fields and explicit rental-location prose. The gate runs before grandfathered
area exemptions, in discovery filtering, quick eligibility and full scoring. Desk exclusion
overrides preserved ranks and Interested display without rewriting historical decisions.
No address lookup, live source request or AI call is needed for explicit location evidence.

Source continuity audit (November 18): scoped VADA empty-result messages are recognized
without treating unrelated FAQs as inventory. EasyRent inventory walks its advertised
FacetWP Next buttons, preserving the actual selected-area URL and shared page/request
allowances. A visible unsupported pager cannot establish exhaustion. Austeville permits
its observed Google Maps rendering dependencies and waits briefly for its search app;
timeout remains incomplete discovery. No broad REST fallback is enabled. Source status
uses current geographic scope and separates saved-home reviews from discovery attempts.
Read-only audit snapshots are available through `scripts/audit-sources.ts`.

The Sorting Desk no longer renders scan status or a scan-plan dialog. Its summary shows
active, Interested and Serious Candidates apartment counts; decision-save status still appears
when needed. Scan coordination stays available through the existing backend for Codex.

Furnishing follow-up: `furnishingForListing` distinguishes explicit advertised terms
from an assumed-unfurnished default when saved description text is silent. Missing or
visibly truncated descriptions do not trigger that assumption. `scoringFacts` uses the
same resolution for descriptions and explicit terms, so stale furnishing booleans cannot
override available listing text. Raw records and preserved quick ranks are unchanged.

November 18 detail-view cleanup: key the apartment dialog by home ID and let its distinct
child components retain their own identities. Rating, map and gallery siblings must not
reuse the same React key. Listing conflicts have one display location. Furnishing badges
reuse explicit listing-text evidence beside price; completed assessment notices and the
view/warning card strip are omitted from Interested. Existing affordability arithmetic
and furnishing bonuses remain unchanged and have an equal-view comparison regression.

November 18 throughput upgrade: new session quick plans snapshot adaptive pacing.
Page gaps warm from 10 to 7.5 to 5 seconds after five and ten successful responses;
photo gaps warm from 1 to 0.75 to 0.5 seconds after twenty and forty successes.
State is per source/kind and persists across batches; thirty idle minutes resets it.
Slow successful responses or transport failures reset warmup and slow access for five
minutes. Two photo downloads may overlap per source, sharing one paced request clock;
all siblings settle before gallery progress is saved. Existing approvals without the
policy retain conservative pacing. An optional persisted stopAt deadline is checked
before every budget reservation, independently of the supervisor.

Chrome bridge 0.5.0 uses authenticated localhost long polling during active work,
with the existing alarm only waking idle workers. Source navigation remains serial
and its actual start times persist in extension storage. Photo transport failures get
one accounted retry in adaptive mode, then a five-minute pause. Real access warnings
still stop immediately for at least 24 hours, honor longer Retry-After values, and
retain manual-attention flags. No warning is retried or cleared by this upgrade.
REW's advertised /page/N continuation now preserves the exact configured area;
unscoped continuation is rejected before fetching. See scan-throughput.md.

Updated 2026-11-18 for quick intake and interested-apartment assessments. This document
describes the implemented local architecture and explicitly identifies remaining work.
The user's requirements remain in [requirements.md](requirements.md), private preferences
in `private/criteria.md`, and source acceptance/history in [listing-sources.md](listing-sources.md).
The review upgrades were validated offline; they do not constitute a new live access or
model-quality trial.

November 18 workflow update: intake uses deterministic letter grades with no AI requests.
Only confirmed hard failures exclude a candidate from Unreviewed. Marking Interested queues
a bounded, resumable full assessment; the user then chooses Serious Candidates or Not Interested,
and later promotes a Serious Candidate to Ready to Apply after a final personal review.
The source allocator favors supported yield for three phases, then reserves one phase for
other available sources. The existing daily automation remains paused. Offline implementation
does not establish complete market coverage or a guaranteed two-day catch-up.

### Quick-first data and policy

- `areaMixPolicy` stores the private future-intake share and a baseline of existing homes.
  Distinct new, hard-eligible homes with saved photos enter a sticky area ledger. Decisions
  and duplicate merges do not inflate counts. Atomic reservations limit secondary-area work
  across concurrent workers; deferred candidates stay queued and release their worker slot.
  The coordinator retries them after allocation progress without repeating fresh discovery
  or increasing approved budgets. Inventory and catch-up select geographic work before
  source-yield preference. Only explicitly exhausted configured primary-area routes, with
  no remaining primary candidates or gallery work, permit fallback beyond the target share.
  The Preferences area target has its own revision protection and future-only counting window;
  changing it does not recalculate scores, alter decisions, or enable scans.

- Photo navigation uses private cached WebP display copies (800px cards, 1600px previews),
  asynchronous local media streaming, and a shared three-request preload/decode queue. Visible
  cards warm adjacent images; the enlarged viewer progressively upgrades saved display copies
  to the original file. Stale queued work is cancelled, decoded memory is bounded, and the
  previous image remains visible during a miss. Original and analysis files are unchanged.

- Standing concurrency defaults are three independent quick-scan sources and two full
  assessments of distinct homes whose entire accessible gallery is already saved. Cached
  assessments reserve home-specific resources, require fresh model-call credit checks, and
  cannot spend page/photo/request allowances. Jobs requiring source collection remain exclusive.
  A full assessment is still authorized by an Interested decision or explicit retry.
- Quick-rank arithmetic shares the listing/criteria cache. Fact changes, including those made
  by another worker, invalidate the cache; preserved ranks continue to override recalculation.

- Multi-source quick plans process up to three sources concurrently by default, with one
  shared Chrome lane for Zillow/Apartments.com. Persisted source allowances share the approved
  aggregate budget. Separate quick plans can also join one explicitly coordinated group;
  these intake members have no AI, address-lookup or saved-home refresh allowance. Up to two
  cached assessments may join available group slots, with at most three members overall.
  Membership locks retain the global scan sentinel until all siblings release, preventing
  unrelated work from overlapping. Chrome cancellation is owner-scoped. Plans requiring source
  collection for a full assessment or paced address lookups remain serial. The speed comparison
  records execution mode.
- Catch-up quick phases select up to three sources from the same phase, sharing the previous
  aggregate page, candidate and photo ceilings and a total target of at most thirty new homes.
  Inventory listing slots only satisfy plan-schema capacity; inventory creates no homes and
  consumes no listing, photo or AI allowance. The maintained catch-up schedule remains paused.

- `scripts/source-speed-test.ts` runs the separately authorized five-per-source comparison.
  It snapshots existing homes, counts owned new admissions independently of raw creation
  counters, uses per-source traffic/time ceilings, and writes timing/outcome reports. It does
  not change the daily schedule. Chrome polling and gallery pacing stay unchanged so the
  comparison measures the existing collection path; only scope/coverage defects are repaired.

- `searchAreaPolicy.mode=source-filters` replaces per-listing geocoding with privately configured
  source geographic routes. Discovery records route and region on each candidate; workers carry
  that provenance through detail and gallery collection. Broad saved queues and unconfigured
  sources are excluded from new intake. Explicit out-of-area facts still win. Quick plans force
  zero address lookups, including when a caller supplies an older nonzero default. The earlier
  address mode remains supported for configurations that explicitly use it.
- `scripts/configure-source-filters.ts` applies local route configuration only while scans are
  idle and freezes existing quick ranks. It does not start a scan or alter scheduling. Routes
  and selected areas remain private; source-filter claims do not establish exact addresses.

- `searchAreaPolicy` stores selected regions and a fixed set of pre-policy home IDs. Discovery,
  queued candidates and source-advertised inventory routes respect this area limit. Detail
  intake checks scoped municipality/neighbourhood facts, then rechecks after the bounded
  address lookup before downloading images. Unresolved new locations remain in Excluded
  with an explicit unconfirmed-location reason and can resume within a later approved scan.
  Existing homes are exempt; their ranks, records and decisions are unchanged. Dormant
  inventory routes retain progress. The scan dialog displays the configured area, and the
  local configuration script does not enable scans or modify the schedule. Personal selected
  areas live in `private/search-area-policy.json` and runtime metadata.

- Current bedroom eligibility also populates `Home.deskExclusion`, independently of preserved
  ranks. Explicit studio unit titles override bedroom counts borrowed from sample tours;
  Austeville extraction scopes bedroom facts before tours and building copy. Search titles
  and detail intake reject studios before image/AI work when zero bedrooms is disallowed.
  Saved records retain their raw evidence and decisions; displayed bedroom facts are corrected
  without rewriting the historical rank. Unknown or genuinely conflicting counts stay uncertain.

- Collected-photo gate: `Home.deskExclusion` is derived from actual saved-photo references,
  independently of quick rank or advertised gallery size. Zero collected photos puts an
  active home in Excluded; a closed user decision remains Closed. The API rejects new
  Interested / Ready to Apply decisions until a photo is saved. This does not change ranks,
  user stages or the intake prefilter: approved workers can still finish pending downloads,
  which automatically clears the photo gate. The same reason appears on cards and details.

- November 18 rank refinement: the store's one-time `quickRankPolicyV2` migration snapshots
  all existing quick ranks with the prior formula. Those snapshots preserve letter, ordering
  value, reasons and flags across refreshes/restarts; no listing, numeric score or decision is
  rewritten. New homes use the stricter policy. S needs at least 92 points, a verified address,
  complete saved photo review, an attributed strong unit-window nature outlook with all
  outlooks covered, supported modern/non-cramped interiors, a suitable confirmed floor and
  parking, and no conflicting or missing key facts. Premium rent needs exceptional evidence.
  New unassessed photos and marketing claims alone cannot establish S; no AI review is added.
- New quick scan plans disclose `maxAddressLookups`, defaulting to the candidate allowance.
  Old approved plans without this field authorize zero lookups. Quick web and Apartments.com
  intake use at most one eight-second request per candidate to the public BC Address Geocoder,
  paced at least 1.1 seconds apart, with persistent success/failure caching and warning pauses.
  Only exact civic-number/street/municipality matches qualify; coordinates are classified with
  the bundled Vancouver neighbourhood boundaries, with other confirmed regional cities farther
  from downtown. Missing/ambiguous/unavailable addresses retain explicit uncertainty. Existing
  preserved apartments are not looked up or regraded. Counts appear in scan plans/activity.
  See the [BC service description](https://digital.gov.bc.ca/bcgov-common-components/bc-address-geocoder/)
  and [official API guide](https://github.com/bcgov/api-specs/blob/master/geocoder/geocoder-developer-guide.md).
  Fixture validation establishes handling, not a live service availability guarantee.

- `criteria.quickIntake` holds the private rent, bedroom and minimum-photo limits independently
  of full-score preferences. `server/quick-rank.ts` computes grade, rank value, hard eligibility,
  reasons and uncertainty flags from saved facts. It neither requests images nor calls a model.
- `Home.quickRank`, `Home.reviewMode` and `Home.fullReview` are presentation/workflow state.
  A quick grade does not overwrite the numeric score, listing evidence or personal ratings.
  `reviewWorkflow` enables the new mode; old stores remain readable with legacy behavior.
- In quick-first mode, user-managed closed stages win over score exclusions. Interested stays
  Interested even after a low completed score. While that assessment is incomplete, the derived
  desk category is Scoring in Progress, including queued, running, paused and failed jobs. This
  section sits between Unreviewed and Interested and defaults to oldest entry first. Completion
  moves the home automatically into Interested without changing the saved user stage or notes.
  Serious Candidates requires completed full assessment; Ready to Apply requires the subsequent
  explicit user decision from Serious Candidates. Scanner
  refreshes cannot overwrite these decisions.
- Full-review jobs persist per home and use the existing shared worker lock, bounded plans,
  source cooldowns and per-call usage guard. A new Interested decision authorizes one job.
  Restarted unfinished jobs pause rather than launching work during startup. Completion is
  based on evidence coverage, not merely the presence of a computed numeric score.
- An Interested job is bounded to one apartment, at most 24 listing/gallery pages,
  240 image downloads and 120 ChatGPT-plan calls. It also authorizes at most two cached-or-new
  public address/building-record requests, accounted separately from listing traffic. Missing
  exact addresses or unavailable public research retain explicit uncertainty. The policy is
  stored locally and binds the existing ChatGPT profile to the usage account; paid fallback
  and reset redemption are unavailable. `server/account-usage.ts` reads the installed Codex
  app-server's account/rateLimits/read RPC without starting chats or model work. Tests use
  fixture readings. Actual calls require ordinary included usage and a fresh per-call reading.
- `server/source-yield.ts` attributes each distinct home to its primary discovery source.
  Recent explicit Interested / Not Interested decisions take precedence over model scores.
  `server/source-feedback.ts` reads actual stage-change dates, ignoring note edits, scanner
  refreshes and advancement to later application stages. Rejections replace earlier interest;
  reopening removes that home's outcome until a new decision. Merged aliases count once.
  Decisions use a 14-day half-life and a 90-day lookback; eight pooled pseudo-observations
  temper small samples. Unreviewed homes never enter the user-review denominator. Completed
  strong-match/provisional scores provide a fallback only before user feedback exists.
  Recalculate before each batch. Every fourth selection explores the least recently selected
  available non-leading source; no supported successes produces rotation. Drained sources
  leave selection, allowing remaining sources to receive all work. Persist selection progress
  only when dispatching a phase, never while displaying a plan.
- Quick catch-up completeness tracks inventory traversal and photo collection, independently
  of deferred full assessments. Unverified routes, parse failures and collection gaps prevent
  a caught-up claim. After checked inventory is caught up, the next maintenance cycle gives
  each available source a fresh discovery pass before prioritizing any new backlog. Source
  access pauses and the user's separate scan authorization still apply.
- Historical full-review text below still defines evidence quality and detailed-score rules.
  It no longer implies full image analysis during quick intake or automatic removal from the
  user's Interested section. Cached image findings, IDs, notes and duplicate decisions survive.

## 1. Product and architecture

Apartment Finder discovers Vancouver rentals directly, evaluates saved evidence against
private criteria, and presents promising apartments in a persistent Sorting Desk.
It does not require a mailbox, saved-search alerts, proprietary connectors, manual detail
collection, or an open coding-assistant chat.

```text
Approved quick scan -> source adapters -> facts/photos -> hard prefilter -> identity matching
                                                         -> local letter grade -> Unreviewed
User marks Interested -> Scoring in Progress -> bounded full-review job
                        -> all-photo evidence + detailed score -> Interested -> Ready to Apply

Explicit detail-view research -> verified address context / public permit records -> cache
```

- **Web app:** React and Vite; the backend serves the production build and private media.
- **Backend:** local Node HTTP API, input validation, user decisions, account settings,
  the authenticated normal-Chrome bridge, and on-demand public research.
- **Worker:** a separate Node process running the regular approved-plan coordinator.
  Backend and worker share SQLite/storage code. Browser commands cross local IPC to the
  backend's Chrome bridge; credentials do not travel in IPC messages.
- **Storage:** SQLite with WAL, bounded write contention, transactions/savepoints, and
  local content-addressed media. Domain schemas validate stored and incoming data.
- **AI:** provider interface with structured output validation. Code owns eligibility,
  arithmetic, score ceilings, budgets, and persistence. The scorer has no browser,
  shell, messaging, or database tools.

The user authorized backlog catch-up and daily morning scans on November 16. The bounded
workflow and credit supervision are documented in [catchup-scans.md](catchup-scans.md).
Startup scans remain disabled. The Windows launcher starts the app quietly and reuses
its running local server; it installs no startup task.
The PC, local app, and required Chrome session must remain available during an approved run.

## 2. Approval, budgets, and source access

Every scan requires a new bounded plan naming sources and maximum pages, apartments,
photos, and AI calls. The plan dialog displays totals, optional per-source apartment cap,
and facts-refresh scope before approval. Preparing a plan makes no external requests.
Approval expires after one hour, is consumed once, and does not authorize recurring work.

The child worker claims the approved plan and a database-backed lock. The backend and
worker both consult persistent state; cancellation, unfinished feedback interpretation,
source pauses, and exhausted budgets stop subsequent requests. A crashed run retains
completed results and its lock until explicit interrupted-run recovery. Recovery does
not restart the scan or renew approval.

Source access remains conservative:

- One active source and navigation at a time, with paced access under the approved
  session totals. Historical trial approvals retain their five-page and daily limits.
- Page, gallery/API, media, and AI allowances are accounted separately. Fair shares
  reserve work for remaining sources instead of allowing the first source to consume
  the entire plan.
- Persistent ordinary browser profiles or the paired normal-Chrome bridge are used
  where required. Apartments.com and Zillow use the normal-Chrome bridge.
- The first access warning, challenge, rate limit, or abnormal failure stops that
  source and persists a cooldown/attention state. Manual runs and restarts respect it.
  No CAPTCHA solving, identity rotation, proxy rotation, or challenge bypass is used.
- A failed fetch or incomplete discovery is not evidence that a listing was rented.
  Each selected source receives its own outcome and coverage explanation.

All twelve retained sources are wired into the coordinator. Deferred sources remain
excluded. Current adapter access must still be established by the next separately
approved live run; historical success is not a promise of uninterrupted access.

The November 15 [discovery and limit audit](listing-sources.md#discovery-and-limit-audit--2026-11-15)
found that the fixed trial quotas prevent twenty-per-source sessions. New session
plans now use visible aggregate allowances instead; old saved approvals retain
their original trial policy. Browser subrequests are observed separately from
scanner-initiated page, media and resource requests. The Sources view now
shows the latest scan attempt separately from earlier tests, plus the last discovery
page's known, unavailable and filtered counts when recorded by the updated worker.

## 3. Discovery, refresh, and resumability

Adapters collect source ID/URL, unit/address, rent, room counts, size, lease/availability,
amenities, descriptions, photo references, and supporting statements. Deterministic
parsing is preferred over model navigation. Building or floor-plan offerings remain
distinguished from confirmed individual suites.

The full-assessment scan sequence is listed below. Quick intake shares discovery, extraction,
identity, photo collection and persistence, but skips new visual findings and computes the
preliminary letter grade. It does not invoke the full-gallery reviewer before user interest.

The full-assessment sequence is:

1. Claim the plan and shared worker lock; verify feedback and source readiness.
2. Discover a bounded slice, preserving first-page opportunities as backlog is processed.
3. Retain queued URLs, pagination state, candidate failures, and pending galleries.
4. Fetch and normalize scoped listing facts; apply configured hard filters in code.
5. Resolve strong identity matches before expensive analysis. Keep ambiguous matches visible.
6. Apply cached verified address context when it still matches the advertised address.
7. Retrieve accessible gallery images within allowance; reuse compatible findings and
   review every remaining accessible image in bounded batches.
8. Compute scores in code and persist results without replacing user decisions.
9. Record per-source outcomes, unresolved work, and useful changes.

Known source IDs and fingerprints prevent duplicate imports. Queues persist across
partial runs, and source-specific candidate errors remain available for explicit retry.
Source posting dates are retained per ad. The private `listingAgePriorityMonths` setting
places older ads behind recent/undated work, including gallery resumptions and queued
offerings. Catch-up source rotation respects this ordering. Calendar-month boundaries are
used; unknown, invalid and future dates are neutral. Posting age never changes match scores.
When age is first learned on a detail page, retain its facts and defer photos/AI while
accessible current/undated queued work remains. Unknown dates do not establish freshness.
Fresh discovery also removes unsupported legacy routes and explicitly unavailable
search cards from the backlog before detail visits. Apartments.com directory pages
are not accepted as profile pages; EasyRent availability comes from each card's
scoped availability field.
The Chrome gallery workflow can resume bounded enumeration, including when a previously
retained tab has disappeared. Incomplete captures preserve earlier collected images.

A plan may explicitly include facts-only refreshes of interested/in-progress homes.
These preserve existing gallery images and assessments. Previously saved trial photos
are not automatically refreshed. New source evidence may add to a confirmed home's
gallery, but a fetch failure never removes a home or changes its user-managed stage.

## 4. Identity, postings, and duplicate decisions

A **posting** is identified by source and source listing ID. A **home** represents one
apartment and can have several postings. Stable sequential apartment references are
never reused or renumbered according to score.

| Evidence | Implemented handling |
| --- | --- |
| Same source/listing ID | Update its posting and preserve the home reference. |
| Same normalized address/unit with compatible facts | Automatically keep the oldest home and remember the newer posting. |
| Matching address/unit but incompatible room count, size, or price evidence | Keep separate for review. |
| Same address with a missing unit | Require at least four distinct matching photos, 80% gallery overlap, and two interiors with unit attribution; otherwise leave separate. |
| Same building with distinct explicit units | Keep separate. |
| Missing addresses on both listings | Require four matching unit-attributed interiors and 80% gallery overlap. |
| Similar text, stock images, amenities or repeated photo slots | Insufficient for automatic merging. |

`posting_details` retains each source's facts, capture time, and gallery manifest.
Aggregation uses the latest posting snapshots, so a resolved price or laundry conflict
can clear instead of preserving an obsolete aggregate. Unknown fields do not silently
override supported facts. Conflicting facts remain visible; conflicting rents use the
conservative known amount pending resolution.

Source-local photo IDs are not home-wide IDs. The combined gallery uses stable unique
references, preserving existing references while resolving collisions such as two ads
both calling an image `p1`. Original source references remain in their manifests.
Incomplete same-source captures union with previous images; a complete manifest is
authoritative. A merged gallery does not by itself establish exact-unit provenance.

The user can explicitly mark candidates different or confirm the same apartment.
Automatic merges retain the oldest listing/assessment and stage; newer source postings
remain in the database but are excluded from future assessment/refresh aggregation.
Newer notes are appended with their apartment reference. Separate rating feedback and
conflicting saved dates prevent automatic merging. Splitting marks the pair different,
including when either record later becomes an alias. The existing manual merge retains
its explicit conflict checks and combines evidence as before.

`automatic-duplicates.ts` uses normalized street/unit keys and saved content hashes,
original-image fingerprints and exact image URLs. SQLite triggers mark changed listings
for incremental indexing; source/URL lookup is indexed too. Intake remembers confirmed
cross-posts before gallery collection. Full review checks before queue admission, after
downloads and on completion, without extra network or AI work. The offline
`scripts/deduplicate-saved.ts` previews cleanup on a snapshot; `--apply` backs up first
and refuses cleanup while scans are approved or running.

A merge keeps the chosen reference, records the other as an alias, combines notes,
links and evidence, and retains feedback and a merge snapshot. Conflicting saved stages
or dates require reconciliation. A split restores the original records only while it
cannot overwrite newer conflicting edits or feedback; otherwise it refuses and explains
the conflict. Source refreshes cannot undo these decisions. Earlier records may have
only the canonical historical snapshot until an authorized capture supplies missing
per-posting details.

Perceptual image matching, broad text-similarity duplicate discovery, and automated scam
judgments are not implemented. Shared amenity/model-suite photos are never identity proof.

## 5. Photo evidence and AI review

Every accessible photo in an assessed gallery is reviewed, including new photos from
confirmed duplicate ads. A favorable or unfavorable first image does not end review.
Missing images, incomplete enumeration, pending analysis, and uncertain unit attribution
are distinct states. Missing photos do not prove that nature is absent.

The image collector retains exact downloaded source bytes and their dimensions/size,
plus a separate bounded JPEG for analysis and cards. It chooses larger variants only
when advertised by the source; it does not probe guessed CDN paths. Legacy previews
remain labelled as previews. Enlarged viewing uses the source copy when available.

The current gallery reviewer defaults to twelve images per call, with a hard maximum
of sixteen and a twelve-million-byte image-data bound per batch. Each successful batch
is applied and cached before the next. Each call consumes the approved AI allowance;
a large gallery can require several calls or runs. Every response must cover all
submitted IDs exactly once. Unavailable images do not block assessment of other accessible
images, but remain incomplete in the coverage record. There is no automatic paid fallback.

Visual cache keys include image hash and model/rubric version. Exact-unit attribution
is stored separately by stable home/source context and explicit provenance semantics:

- Ordinary description edits retain compatible attribution.
- Representative/display/other-suite evidence invalidates exact-unit certainty.
- A new context can receive a separately budgeted, text-only attribution review using
  saved visual findings, without repeating image analysis. Pending attribution remains
  explicit and resumable.
- Each photo's posting manifest supplies its context. A representative cross-post does
  not invalidate another source's verified photo from the actual unit.
- Reuse of interior condition findings checks the supporting image hashes as well as IDs.

Nature is confirmed only through actual apartment interior windows. Marketing claims,
floor height, area, shared amenities, balcony-only views, and other suites cannot substitute.
Quality distinguishes broad nature-dominated outlooks from narrow building-dominated
glimpses. Half-point quality ratings are supported. One window does not establish every
room's outlook; multiple batches are not assumed to prove complete all-window coverage.

Structured findings can establish gas cooking, usable workspace, open layout, and laundry
with supporting photo IDs when unit attribution is supported. Contradictions remain unknown.
Modern/dated condition and cramped space also retain photo references. A single washer,
hookups, an ambiguous flex closet, or a gas fireplace cannot establish a different feature.
Furniture visible in photos never establishes furnishing terms; furnishing requires a
scoped rental statement. Exact-URL download reuse across homes is not implemented because
mutable URLs can change their bytes; unchanged retained images and assessments are reused.

## 6. Scoring and learning

Code calculates headline scores from 0.1 to 5.0. Below 3.0 is Excluded; 3.0–3.9 is worth
a look but not a strong match; 4.0–5.0 is strong interest. Classification remains separate
from user stages. A prior rescue or higher uncertainty estimate cannot override a headline
below 3.0. Missing interior-photo verification remains outside the active desk.

Private configuration owns weights, price anchors, location preferences, bonuses, and
hard requirements. Confirmed budget/laundry failures take precedence. Views receive
evidence-based penalties/ceilings, including building-facing outlooks, weak glimpses,
partial nature, expensive modest views, and unverified views. Ordinary feature bonuses
cannot bypass evidence ceilings or hard filters; an explicit interior-tradeoff preference
provides the bounded alternative described below.
Workspace and second-bedroom benefits are not double-counted. Unknown features earn no
unsupported bonus; internet uncertainty alone has no automatic penalty.

`criteria.interiorTradeoff` is disabled by default and enabled only through an explicit
preference change. A qualifying combination of supported furnishing, open layout, modern
interiors and usable workspace must accompany a known advertised rent and reviewed actual-unit interior photographs.
Workspace contributes only when a known bedroom count establishes that the second-bedroom
benefit is not being counted instead. Neither cheap rent nor furnishing alone qualifies.
The alternate score is the non-view subtotal minus `interiorTradeoff.viewPenalty`, capped by
`interiorTradeoff.ceiling`; personal values and the calibration examples remain private.
Ordinary price, location, dated-interior and cramped-layout effects remain in that subtotal.
Compute this alternative across all view qualities and keep the higher of it and the ordinary
view-based score, so a better outlook cannot remove the interior benefit. The alternative can
relax poor/absent/unverified-view exclusion but does not manufacture nature evidence or change
gallery completeness. Distance, street-level, expensive-weak-view ceilings and actual hard
requirements still apply afterward. Rescoring uses saved evidence and rebuilds derived learning
baselines while preserving feedback snapshots, listing facts and user workflow decisions.

Personal scores/reasons retain immutable listing, score, and criteria snapshots. Each
submission immediately rebuilds bounded comparable-listing calibration from the latest
rating per home. An explicit one-off exception calibrates that home without teaching a
general preference. Supported explicit general rules apply immediately. Downward feedback
cannot raise an already stricter score.

Condition corrections are attached to stable home identity, with source aliases for old
snapshots/callers. Explicit later corrections can reverse a dated/cramped judgment;
silence about that field does not reverse it. User corrections remain separate from
advertiser facts and survive source changes.

A submission immediately queues one server-side ChatGPT-plan review, independently of
the detail view or this chat. Repeated delivery of the same submission ID cannot create
another review. The rating panel shows the current review state and completed outcome
outside the collapsed history, and refreshes while open. Genuine failures or unresolved
interpretation remain explicit rather than appearing to be a review that never ran.

A serial bounded ChatGPT-plan interpretation proposes at most three allowlisted numeric
changes. Code validates step limits, agreement with saved examples, and interest-band
preservation. Unsupported or unresolved instructions stay visible and block new scan
requests until resolved. Failed/interrupted reviews require explicit retry. Undo refuses
to overwrite newer preferences. Startup does not submit historical feedback to AI.

`scripts/scoring-evaluation.ts` evaluates saved examples offline, including leave-one-out
generalization and counterfactual ordering. Matching training examples alone is not proof
that future rankings improved. New behavior has regression coverage; live model evidence
quality still needs a separately approved trial.

Preferences saves patch only edited allowlisted fields using a criteria revision check.
A stale dialog cannot silently overwrite a completed feedback-derived update. The user
must reload current preferences and review their edits after a conflict.

## 7. Costs, location, and building context

Advertised rent stays distinct from known recurring cost. Scoped explicit statements
supply supported monthly parking/utilities/other charges; ambiguous charges remain
unconfirmed. Repeated or conflicting amounts are not silently added twice. One-time
deposits and incentives are not amortized into rent. The selected budget basis remains
an explicit preference, and incomplete costs are disclosed.

Detail maps perform an on-demand server-side Nominatim lookup of the public advertised
location. Exact pins require matching street/house-number evidence in the Vancouver
region; approximate areas have no apartment pin. Lookups are cached, serialized/paced,
and paused after access warnings. Demo/startup/list refreshes do not initiate map lookups.
Map failures do not prevent apartment review.

The separate building-research action requires approval for at most two public requests:
an address lookup if not cached, and a bounded City of Vancouver issued-permit query.
It sends the public address, never private criteria, and uses no AI. Exact geocoding plus
bundled official local-area boundaries may refine location. A protected cache reapplies
verified location context to later source refreshes only when the address still matches.

Permit records are cached for seven days, matched to the exact address, and labelled
with sources/check times. Results are limited to fifty records and report incomplete
coverage. No match is not proof of no issues; an issued permit does not prove current
construction, noise, defects, or unit condition. Building defects, current noise, and
verified station/airport journey times remain future research. Current transit links are
manual planning aids, not computed travel-time evidence.

## 8. Sorting Desk and data ownership

November 19 review reliability: opening quick details immediately displays the saved card
and loads full evidence separately, without the global busy flag. Closing/switching cancels
the old read, and late responses cannot reopen a dialog. Background state updates use React
transitions and retain unchanged home objects; memoized cards preserve photo selection and
avoid redrawing every gallery. New or newly eligible Unreviewed homes wait behind Show new
apartments while that review view remains open; other stages continue refreshing normally.
Routine whole-desk polls wait for five seconds without clicks, typing or scrolling; initial
load, returning to the visible tab, and explicit mutation refreshes remain immediate.
Failed saves have explicit Retry Save / Keep Current State controls on the affected card
and in its details, replacing the disabled decision row. Only genuinely queued/saving
requests display a waiting message. Immutable queue snapshots let memoized cards observe
status changes. This prevents a failed save from appearing indefinitely stuck as pending.

Decision transport reports unreadable/empty responses and HTTP errors explicitly. Recoverable
failures (including scanner revision conflicts) first read the current apartment: a confirmed
decision completes without another write, otherwise one revision-checked retry preserves the
latest untouched fields and refuses conflicting stages or edited notes/dates. A final read can
confirm a late commit; later polls also clear matching failed-save warnings. Retries are bounded,
and other apartments remain available throughout. No server restart, scan, or AI call is needed
to deploy these frontend changes. Offline desktop and phone-sized browser fixtures exercise
500-card reviews with delayed refresh/detail/save responses and malformed acknowledgements.

Interest decisions update the visible desk immediately and save through a browser queue
with at most two requests in flight. Only that apartment is locked while saving; other
cards and quick-detail decisions remain available. A header count shows pending saves.
Per-home overlays survive stale polls until the server acknowledges the saved revision.
Failed saves restore that home's last confirmed state and retain explicit Retry Save /
Keep Current State controls. Retries first read the current home, recognize an already-saved
decision after a lost response, and preserve concurrent notes or report conflicts. Pending
decisions stay in the open tab; navigating away warns while saves remain unresolved.
Edited full-detail ratings still validate and save before queuing a decision.

The current private view-first policy (`requireNiceViewForDesk`) disables the historical
interior tradeoff. Without a reviewed actual-unit window nature view rated >=4, resolved
attribution and nonconflicting view evidence, a 2.9 ceiling and explicit exclusion reason
keep the listing out of the main desk. Unknown views retain uncertainty rather than being
called poor. Excluded remains manually browsable; workflow stages and feedback are retained.

Affordability uses rent plus known separate monthly parking cost. The second-bedroom
bonus tapers between configured full/zero benefit prices across ordinary scoring and
view ceilings. Premium rent has a separate ceiling, lifted only by an exceptional elevated
view and photo-supported modern, open, non-cramped actual-unit interiors. Calibration
cannot override the ceiling; neither amenities lists nor luxury claims prove building quality.

The 4.0 strong-match boundary is an evidence gate in deterministic scoring: a complete
gallery, an actual-unit interior window photo with nature quality >=4, no pending attribution,
and a supported floor >=3 without floor/view conflicts. Other apartments retain a ceiling
of at most 3.9. Apply this after interior alternatives and before parking deductions; persist
the ceiling through calibration. A local versioned upgrade rebuilds saved calibration.

Parking confidence is assessed from saved unit terms. Confirmed absence, strong evidence
such as a waitlist, and absent inclusion with unconfirmed separate availability receive
distinct deductions after view/interior score caps. Missing facts alone receive no penalty.
The post-deduction score bounds positive calibration; a local versioned upgrade rebuilds
feedback baselines without replaying reviews or changing user decisions.

The current tabs are **Unreviewed**, **Interested**, **In Progress**, **Excluded**, and
**Closed**. Backend and frontend share the transition rules:
Unreviewed → Interested → In Progress → Closed. Any active stage may close; ordinary
saves cannot skip or move backward. Explicit Reopen is the only Closed → Unreviewed
transition. In Progress retains inquiry/viewing/application substages. Score-based
exclusion does not overwrite these user stages.

Cards and pinned detail headers identify sources and stable apartment references.
Open card details through the apartment title/address; omit the separate Review apartment
button to avoid accidental detail opens beside the decision buttons.
Window-view evidence is preferred as the lead photo; promotional graphics appear later.
Cards browse all saved photos with previous/next arrows, a photo counter, keyboard arrows
and horizontal touch swipes. Navigation stops at either end; vertical touch scrolling
remains available. Compact desk responses include lightweight saved-photo metadata;
only the selected image is loaded, and browsing does not open details or change decisions.
Details retain score breakdown, uncertainty checks, a factual summary, source evidence,
notes, ratings/history, source links, and gallery navigation scoped to that apartment.
The full-screen viewer supports fit, actual size, zoom, and previous/next without wrapping.

The app stores follow-up/viewing dates, produces calendar files and inquiry drafts, and
compares up to three homes. It never sends inquiries automatically. Rich reminders,
bulk follow-through actions, and external notifications remain future work.

Scanner facts, user decisions, and feedback are stored separately. Apartment edits use
revision checks; criteria patches have their own revision guard. Excluded/Closed order
uses category-entry time, unaffected by note edits. Merge/split and source refreshes
preserve reference history and user-owned data.

## 9. Query performance and process resilience

The desk requests compact card state and loads full apartment details on demand.
ETags suppress unchanged responses. Polling is non-overlapping and pauses while the
document is hidden. Refresh failures are visible instead of silently leaving stale state.

`Store.homes()` parses each listing once per changed raw value, groups duplicate candidates
by address, batches posting/decision reads, and caches scores against listing/criteria
content. `home(id)` uses a direct indexed query. Returned objects are copies, so worker/UI
callers cannot mutate shared cache contents. External worker database writes invalidate
cached results when their stored content changes.

Public ChatGPT connection status is coalesced/cached rather than decrypting credentials
twice per poll. Connection errors do not make the saved Sorting Desk unavailable. Account
mutations invalidate that public status. The separate worker prevents synchronous parsing
and scoring from occupying the HTTP server's event loop.

Chrome IPC carries approved plan IDs and bounded jobs, not arbitrary browser commands.
The backend rechecks plan/source state, allowed origins, daily access limits, and source
pauses. Raw worker stdout/stderr is not relayed into user-visible logs. Worker interruption
retains completed records and requires explicit recovery/new approval before further work.

## 10. Backups, privacy, and restoration

`npm run backup:shortlist` creates a small versioned JSON recovery index using a read-only
SQLite transaction. It includes canonical homes in Interested and later stages, including
Leased/Closed, their aliases and cross-post URLs, locally calculated score snapshots,
preserved quick grades, assessment status, latest user rating, notes and basic facts.
No galleries, descriptions, private criteria or credentials are exported. The file is
readable by other tools without Codex; it supports shortlist reconstruction, not a full
application restore. Existing destinations are refused. This command does not upload,
schedule work, contact listing sources or call AI. The user subsequently authorized the
same index at tracked `backups/shortlist.json` in the existing public repository.
Versioned Git hooks refresh/stage it on commits and compare outgoing ref contents against
a fresh read-only snapshot before pushes (ignoring only export time). Stale/missing backups
or unavailable databases stop the operation. npm prepare installs hooks on clones;
`npm run setup:hooks` installs them for existing dependencies. No source/AI requests or
schedules are added. Git history retains prior versions. Hooks are local safeguards, not
server enforcement. Full runtime data and private criteria remain gitignored.

Live criteria/research are in gitignored `private/` and `data/`; optional API credentials
are in `.env`. Connected ChatGPT credentials are Windows-DPAPI protected for the current
Windows user. Credentials never enter browser bundles, model prompts, or ordinary logs.
The app binds to loopback and uses origin/CSRF checks for mutations. Optional private phone
access uses Tailscale Serve with one configured HTTPS origin and one allowed Tailscale
login. Serve authenticates the device and supplies the verified user header; the app checks
that identity before serving any private page, API response or media. Localhost access stays
available. Remote mutations require the exact HTTPS origin and the existing CSRF token.
The desktop Chrome extension bridge stays local, as does initiating ChatGPT account sign-in.
Setup, startup and connection checks never authorize a scan. See `mobile-access.md`.

The backup action and `npm run backup` create a fresh bundle containing:

- A consistent SQLite snapshot, including feedback, decisions, source state, and history.
- Media referenced by current and historical saved listing/merge snapshots.
- Available `private/criteria.md` and `private/settings.json` reference files.
- A manifest with file lengths and SHA-256 checksums.

Creation verifies file checksums, referenced-media completeness, and SQLite integrity.
Credentials and browser profiles are excluded; account reconnection may be required.
The JSON desk export is convenient for inspection but is not a complete restore bundle.

`scripts/restore.ts <backup-folder>` verifies without restoring. Supplying a second,
nonexistent staging-folder path copies and re-verifies a restore there. It refuses to
overwrite an existing destination and never replaces the running live database. Switching
to a restored workspace remains a deliberate offline recovery operation after stopping
the app and preserving the previous data directory. Automatic retention/purge is not enabled.

## 11. Validation and remaining work

The implementation uses pinned TypeScript/React/Vite dependencies, Node 24 SQLite,
Playwright, Sharp, and Zod. Tests use representative fixtures, mocked model responses,
isolated SQLite databases, and loopback HTTP; live data and websites are not test fixtures.
Checks cover budgets/pauses, resumable discovery/gallery work, attribution/cache isolation,
score ordering and feedback, duplicate merges, persistence, preferences conflicts,
complete backup restoration, and the isolated worker's offline behavior.

The 2026-11-14 review improves existing paths; it does not authorize new scans, source
recovery attempts, photo refreshes, paid requests, or recurring schedules. Runtime access
and model quality must still be checked through a separately approved bounded plan.

Remaining choices/work include:

- Whether continuous hosting is wanted. Daily 08:00 America/Toronto catch-up/new-listing
  scans are now authorized and configured; see `catchup-scans.md`.
- Additional unique-source trials and long-running source reliability validation.
- Move-in timing, minimum size, lease duration, pets/cooling/noise preferences, budget basis,
  station walking/airport tolerance, parking exclusions, and studio exceptions where unset.
- Broader verified building/noise research and transit travel-time calculation.
- More labelled evaluation examples, model comparisons, and out-of-sample scoring checks.
- External notifications, richer due-action tools, and retention.
- Perceptual duplicate suggestions and safe validator-aware cross-home download reuse.

These refine the confirmed product direction; they do not require reopening the architecture.
