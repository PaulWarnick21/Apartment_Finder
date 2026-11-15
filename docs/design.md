# Design

Updated 2026-11-14 after the project review and approved improvements. This document
describes the implemented local architecture and explicitly identifies remaining work.
The user's requirements remain in [requirements.md](requirements.md), private preferences
in `private/criteria.md`, and source acceptance/history in [listing-sources.md](listing-sources.md).
The review upgrades were validated offline; they do not constitute a new live access or
model-quality trial.

## 1. Product and architecture

Apartment Finder discovers Vancouver rentals directly, evaluates saved evidence against
private criteria, and presents promising apartments in a persistent Sorting Desk.
It does not require a mailbox, saved-search alerts, proprietary connectors, manual detail
collection, or an open coding-assistant chat.

```text
Approved scan -> source adapters -> scoped facts/gallery manifests -> hard prefilter
                                                                  -> identity matching
                                                                  -> cached/new visual findings
                                                                  -> deterministic scores
                                                                  -> SQLite -> Sorting Desk

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

Scheduled scans, startup scans, and catch-up runs remain disabled. The Windows launcher
starts the app quietly and reuses its running local server; it installs no startup task.
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

- One active source and navigation at a time; at most five top-level page visits per
  source/run with pacing and shared daily limits.
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

## 3. Discovery, refresh, and resumability

Adapters collect source ID/URL, unit/address, rent, room counts, size, lease/availability,
amenities, descriptions, photo references, and supporting statements. Deterministic
parsing is preferred over model navigation. Building or floor-plan offerings remain
distinguished from confirmed individual suites.

The scan sequence is:

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
| Same normalized address/unit with compatible facts | Combine source links and evidence. |
| Matching address/unit but incompatible room count, size, or price evidence | Keep separate for review. |
| Same address with a missing unit | Show possible-duplicate candidates; do not merge automatically. |
| Same building with distinct explicit units | Keep separate. |
| Similar text or matching photos alone | Do not merge automatically. |

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

The current tabs are **Unreviewed**, **Interested**, **In Progress**, **Excluded**, and
**Closed**. Backend and frontend share the transition rules:
Unreviewed → Interested → In Progress → Closed. Any active stage may close; ordinary
saves cannot skip or move backward. Explicit Reopen is the only Closed → Unreviewed
transition. In Progress retains inquiry/viewing/application substages. Score-based
exclusion does not overwrite these user stages.

Cards and pinned detail headers identify sources and stable apartment references.
Window-view evidence is preferred as the lead photo; promotional graphics appear later.
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

Live criteria/research are in gitignored `private/` and `data/`; optional API credentials
are in `.env`. Connected ChatGPT credentials are Windows-DPAPI protected for the current
Windows user. Credentials never enter browser bundles, model prompts, or ordinary logs.
The app binds to loopback and uses origin/CSRF checks for mutations. Remote/phone access
would require a separately designed authenticated deployment.

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

- Scan times/timezone, scheduling/catch-up policy, and whether continuous hosting is wanted.
- Additional unique-source trials and long-running source reliability validation.
- Move-in timing, minimum size, lease duration, pets/cooling/noise preferences, budget basis,
  station walking/airport tolerance, parking exclusions, and studio exceptions where unset.
- Broader verified building/noise research and transit travel-time calculation.
- More labelled evaluation examples, model comparisons, and out-of-sample scoring checks.
- Authenticated phone access, external notifications, richer due-action tools, and retention.
- Perceptual duplicate suggestions and safe validator-aware cross-home download reuse.

These refine the confirmed product direction; they do not require reopening the architecture.
