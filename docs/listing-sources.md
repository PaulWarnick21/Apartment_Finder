# Listing sources

## Source continuity audit — November 18, 2026, afternoon

The user requested a source-by-source investigation after simplifying the desk. This audit
used a read-only database snapshot, saved search captures and offline replay. It made no
new source requests, cleared no pauses, and changed no apartments, decisions or routes.
The latest completed thirty-minute benchmark reported 62 new eligible homes with complete
galleries: 60 REW and two Zumper. One additional REW home retained an incomplete gallery
after the final worker save. That benchmark's approval is expired.

| Source | Current evidence and cause of shortfall | Next action |
| --- | --- | --- |
| REW | Producing new homes; 101 scoped candidates remained queued at the audit snapshot. Downtown and West End pagination remains unfinished. | Continue the saved frontier under a new approved allowance. |
| Zumper | Produced two completed new homes in the benchmark; scoped queue currently empty. Dynamic search coverage is unverified. | Check fresh results and validate whether the source exposes additional scoped pagination. |
| Craigslist | Produced earlier today; 48 scoped candidates remain. North/West intake is deferred by the configured Downtown share. | Preserve the user's mix, obtain more validated Downtown coverage, and recheck the retained queue in approved runs. Do not weaken the mix silently. |
| Apartments.com | Four new records in the preceding run, then a generic warning at November 18 18:33 UTC stopped intake; 285 scoped candidates remain. The 24-hour cooldown/manual-attention flag is imposed by this app, not a verified server Retry-After. The rejected capture was discarded, so the warning's exact cause is unknown. | Fixed overly broad availability-text detection and added retained warning evidence plus an explicitly approved single-page recovery check. Current pause is preserved pending live validation. |
| Zillow | Produced earlier today; the latest scoped pages returned only saved candidates. Further dynamic coverage is not established. | Validate selected-area pagination and other source-advertised selected-area routes. |
| VADA | Both selected North/West searches explicitly say “More Rentals Coming Soon” inside their results containers. Long FAQs prevented the old generic empty-page detector from recognizing this. | Scoped empty-result handling repaired offline; recheck for actual new vacancies in later approved cycles. Downtown remains outside its configured searches. |
| EasyRent | Both selected-area pages have href-less FacetWP Next buttons. North Vancouver advertises five pages/98 rows; West Vancouver four pages/68 rows. Only the first 20 rows in each search were visited, all marked rented. | Browser continuation now clicks the advertised Next control, retains its actual scoped URL, and accounts each page. Unsupported continuation remains incomplete rather than exhausted. Later pages and current availability still need live validation. |
| Austeville | All three saved selected-area captures remain at the search app's Loading spinner. The page advertises Google Maps, but its hosts were blocked by the transport's rendering allowlist. | Add the observed rendering dependencies and a bounded readiness wait. This repairs a plausible loading cause; a live test must establish whether it resolves the source. Broad REST inventory remains prohibited in filtered intake. |
| Facebook Marketplace | No supported selected-area route is configured. Earlier broad intake and saved assessments are not current geographic coverage. | Validate explicit source location controls, session access and scoped pagination before enabling new intake. |
| Kijiji | No supported selected-area route; 92 old broad-search candidates cannot establish current geographic provenance. | Validate source-advertised geographic filters and result scope, then configure only supported routes. |
| Hollyburn | No supported selected-area route; neighbourhood guides and map-centred searches are not proof of filtered unit inventory. Existing discovery primarily supports furnished ads and building pages. | Validate city/area controls and actual available-suite extraction; do not count a building advertisement as a new apartment. |
| Sunstar | Latest Downtown capture: 165 links, 160 rented, three already saved and two failing intake filters. No new qualifying candidate in that checked scope. | Fresh checks during approved cycles; additional selected-area routes require source evidence and validation. |

The Sources view now distinguishes missing geographic setup from runnable adapters, excludes
unscoped backlog from its queue count, limits inventory reporting to configured searches,
and does not present a completed saved-home assessment as a successful discovery scan.
`scripts/audit-sources.ts` provides a repeatable read-only snapshot; record/photo counts
are explicitly different from eligible-apartment admissions.

Private evidence is retained in `data/live/source-audit-2026-11-18/`: the baseline, selected
capture index, replay outcomes, final audit and test log. Eighty-two focused offline tests
passed, covering source scope, pagination, warning stops, pacing, queues and persistence.
Offline repairs are not new live coverage claims. Freshness and correct parsing can keep
sources useful; they cannot guarantee that every source has a new qualifying apartment.

### Proposed validation — separate approval required

Apartments.com follow-up: extension 0.5.1 no longer treats ordinary unit/amenity
“temporarily unavailable” text as a source-wide challenge. Explicit security/rate-limit
messages and whole-page outage headings still stop. ChromeJobs now retains the rejected
URL (without query), title, exact warning and up to 2,000 visible-text characters locally
in a ten-entry diagnostic history. Previously rejection happened before worker capture
storage, so no saved evidence establishes the cause of the November 18 warning. This is
a confirmed detector defect, not proof that this particular stop was a false positive.

The previously Zillow-only recovery workflow now supports Apartments.com through
`POST /api/browser/recover-apartments` with confirmation `APPROVE ONE APARTMENTS RECOVERY`.
Its plan allows one configured-area search page, five minutes, zero photo downloads,
zero AI, zero address lookups and zero imports. Recognition of rental links in a complete,
unchallenged capture is required before clearing only that source's pause. Failure,
truncation or cancellation retains the pause; saved inventory is never replaced. It does
not resume a listing scan. This check has been verified offline, not run against the site.

One 45-minute session across the 11 currently unpaused retained sources, with up to three
independent source workers and the existing shared Chrome lane. Aggregate caps: 120 page
visits (including filter setup), 80 candidate attempts, 600 photo attempts, zero AI and zero
address lookups. Target up to two new eligible, photo-collected apartments per available
source; shortfalls remain explicit. First validate missing geographic controls and dynamic
pagination; admit candidates only from proven selected-area searches. Retain the current
geographic allocation, all user decisions and existing grades. Do not refresh old homes,
replenish old galleries, bypass warnings, or enable recurring scans. Apartments.com stays
excluded while paused. Stop on the deadline or any aggregate allowance; report incomplete
galleries separately. A zero-new result with valid exhausted inventory is a valid outcome.

November 18 throughput follow-up: the one-hour quick run encountered an Apartments.com
access warning and retained its pause. A discovered REW defect rejected its advertised
/page/2 links as unscoped; the corrected matcher accepts positive numbered pages only
beneath the exact configured area, with no query-based area override. Offline regression
coverage is not live validation. New quick plans can gradually accelerate healthy sources
and overlap two photo downloads; actual warnings still stop the source. Transport-only
failures use one bounded retry and a short backoff rather than automatically treating a
network timeout as a day-long access warning. Existing pauses are never rewritten.
The separately approved thirty-minute benchmark subsequently completed; see the audit above.

November 18 restricted intake: website geographic searches replace individual address
verification. Configured routes are stored in private source-search-filters.json. Broad saved
queues do not establish geographic scope. The current route set uses source-advertised REW,
Apartments.com and Sunstar routes from saved pages, plus indexed Craigslist North/West Vancouver,
Zumper Downtown/West Vancouver and Zillow Downtown pages. A route's existence is not successful
live adapter validation or complete coverage. Sources without supported area filters are held
out of restricted intake. Apartments.com was deferred during the earlier thirty-apartment
test and was included in the subsequent source-speed comparison.

The completed November 18 comparison collected twenty-four qualifying new apartments with
complete saved galleries and zero AI or address-lookup calls: five each from Craigslist,
REW, Zumper and Apartments.com, and four from Zillow. The other seven sources had geographic
filter, discovery or checked-inventory shortfalls. The first two sources ran sequentially;
subsequent work used up to three source workers with one shared Chrome lane. Per-source times
were approximately two, three, three, ten and six minutes respectively. Private run artifacts
retain exact timings, source outcomes and apartment IDs; this bounded result does not establish
complete market coverage.

Future discovery is restricted by the user's private search-area policy. Broad catalogues
may still be needed to find permitted listings, but clearly outside-area routes and cards
are skipped, and a candidate's location is checked before photo downloads. This filter
does not establish new source coverage or authorize resuming paused scans.

November 18 update: the current intake workflow collects facts/photos and computes quick
letter grades without AI. Source selection allocates three bounded phases to the leading
supported source, then one phase to another available source, rotating exploration across
the alternatives. Recalculate the leader from recent user Interested / Not Interested choices
before each batch, with older choices carrying less weight. These choices take precedence over
model scores; saved assessments are a starting point only before user feedback exists. No
supported positives means ordinary rotation. Count distinct homes on their primary discovery
source and retain sample sizes; unreviewed homes are not rejections. Drained sources leave work
selection, giving the remaining inventory all available work. After checked inventory is caught
up, maintenance checks every available source for new listings before favoring any new backlog.
This prioritization never changes apartment scores, source pacing, cooldowns or coverage
claims. Full-gallery assessment follows a user's Interested decision. The daily automation
remains paused and a new collection run still requires bounded authorization. The two-day
inventory target does not establish that dynamic searches can be fully traversed. Existing
retained/deferred source choices and historical access evidence below remain in effect.

November 16 update: the user authorized catch-up and daily morning scans across the 12
retained sources, within the weekly credit reserve. See [catchup-scans.md](catchup-scans.md).
Historical statements below that recurring scans were disabled describe earlier approvals.
The new inventory traversal records each route and exposes incomplete/dynamic coverage;
implementation alone does not establish successful live coverage.

Updated 2026-11-14. Apartment Finder discovers rentals directly from listing websites and
collects their details for filtering, scoring, and the Sorting Desk.

The previous source strategy has been superseded at the user's request. This document is an
implementation and validation record. A connected adapter does not establish complete
coverage or uninterrupted access. Historical trial outcomes below remain dated evidence.

## Current implementation — offline improvements on 2026-11-14

All 12 retained sources use the regular, single-approved-plan coordinator. Apartments.com
and Zillow use the paired normal-Chrome bridge; the other sources use their configured
persistent browser sessions. Scheduled scans remain disabled. Implementation first used
fixtures, mocked transports and offline captured pages, without live requests or photo
backfill. The separately approved live validation that followed is recorded in the next
section; it does not authorize further or recurring scans.

- Each eligible source checks fresh discovery during every approved run, even while an older
  backlog remains. Fresh candidates precede equally ranked older ones. The worker preserves
  explicit pagination separately, removes completed queue items, and shares the original
  page/listing/photo/request/AI limits. Pending galleries receive a bounded share alongside
  new candidates; with one candidate slot, the two kinds alternate when both are waiting.
- Search-card metadata supplies advertised price, city, area and posting date where scoped
  evidence exists. Definite over-budget prices and explicitly recognized cities outside the
  Vancouver region are skipped before a detail visit; ranges and missing facts stay uncertain.
  Downtown candidates receive priority without turning nearby locations into blanket exclusions.
- Individual extraction failures are quarantined, with URL, reason, timestamp and attempts.
  Other candidates can continue. **Retry Extraction** requeues local work for a future approved
  plan; it makes no request and clears no access pause. A genuine source warning still stops
  that source immediately. Failed or missing pages never prove that a saved apartment is gone.
- Optional **facts-only active-listing refresh** is disabled by default and has an explicit
  per-plan limit. It uses the same approved page/listing budget to revisit Interested and
  In Progress homes. Facts can change; existing images, assessments, notes and workflow remain
  preserved. It does not authorize refreshing the older trial photographs.
- Explicit **new-listings-only validation** separates candidate-attempt limits from the
  target number of newly created homes. It snapshots existing home IDs, skips old pending
  galleries and facts refreshes, and rejects known postings or confirmed duplicate homes
  before downloading their photographs. Failures and duplicates consume their bounded
  attempts without satisfying the new-home target. Building-only and explicitly unavailable
  advertisements do not satisfy the target.
- Zumper retains every advertised floorplan offering with its own source identity, instead of
  selecting one cheapest type. A floorplan remains distinct from a confirmed available suite.
  Remaining offerings from an already captured page are queued without another detail fetch.
  Known building URLs can receive a bounded inventory-facts check after 24 hours to discover
  newly advertised offerings; this occurs only inside a newly approved run and never refreshes
  the known offerings' photographs automatically.
- Gallery enumeration, image availability, visual review and unit attribution are separate.
  Accessible downloaded images can be reviewed in resumable batches while other evidence remains
  pending. Permanent 404/410 image failures remain explicit and are not downloaded on every run.
  Source-specific pending work prevents a new duplicate ad from authorizing a backfill of an
  older source's gallery. Identical image downloads can share retained source bytes within the
  same approved run; a reused URL alone is not considered proof of freshness across runs.
- Chrome bridge **0.4.0** returns pagination explicitly and can retain up to three partially
  collected Apartments.com gallery tabs for a later approved continuation. It performs no
  navigation or gallery interaction while waiting. The user may close those tabs; enumeration
  restarts conservatively when required, retaining cached files. A reload in Chrome's extension
  manager activates this version; pairing need not be repeated. Browser-generated subrequests
  and background page requests remain a limitation of this bridge's request accounting.

**Expanded coverage is an optional, unvalidated trial mode**, not a default change. The
Apartments.com trial rotates its advertised Vancouver one-bedroom, two-bedroom and general
apartment search routes. Hollyburn's trial uses its advertised Vancouver unfurnished search.
Their exact routes were observed in saved source pages; offline routing support is not evidence
that live extraction succeeds. Hollyburn building-only advertisements keep unknown unit terms,
uncertain prices and incomplete gallery attribution until a specific suite is established.
Normal source paths remain unchanged; broader Sunstar and nearby-municipality routes are still
unimplemented. Deferred Rentals.ca, RentFaster, liv.rent and PadMapper remain excluded.

## Final validation after improvements — 2026-11-14

The user authorized a bounded test targeting two new rentals per retained source. It ran in
two phases under that same authorization: the first stopped after an Apartments.com issue;
the continuation excluded that paused source and used only the remaining allowance. Across
both phases, the application used **32 top-level page visits, 19 candidate attempts, 197 photo
retrieval attempts and 23 ChatGPT-plan calls**. No paid API requests or fallback were used.
Attempts include failed or subsequently disqualified work; they are not counts of successful
downloads, available apartments or fully reviewed galleries.

The corrected result is **15 new rental candidates**, including two explicitly identified
Zumper floorplan offers. A candidate is not necessarily an eligible match, and a floorplan
offer is not proof of a distinct available physical suite. Three additional saved records
were a building advertisement and two already-rented advertisements; they are excluded from
the candidate total.

| Source | New rental candidates | Bounded validation outcome |
| --- | ---: | --- |
| Craigslist | 2 | Two new candidates captured; remaining inventory stays queued. |
| VADA | 2 | Two new candidates captured; remaining inventory stays queued. |
| Zillow | 2 | Normal-Chrome discovery and capture supplied two new candidates. |
| Zumper | 2 | Two floorplan offers; exact suites remain unconfirmed. Shared images were reused. |
| Facebook Marketplace | 2 | Two new candidates captured through the retained authenticated session. |
| Kijiji | 2 | Two candidates captured; conflicting facts were corrected from saved evidence. |
| Austeville | 2 | Two candidates captured; unit-header geography was corrected from saved evidence. |
| REW | 1 | The local browser-request cap stopped the second attempt; unfinished work remains queued. |
| Apartments.com | 0 | Expanded search exposed a building advertisement; a subsequent photo-fetch failure paused the source. The building is excluded from the rental-candidate total. |
| Hollyburn | 0 | Expanded search rendered its filter page without recognizable inventory links. This is incomplete discovery, not evidence of no vacancies. |
| EasyRent | 0 | Both captured advertisements explicitly said rented. Their records remain auditable but do not count as available candidates. |
| Sunstar | 0 | Fresh bounded discovery left no unseen eligible URLs to process. This does not establish complete source coverage. |

Several sources report **partial** even after meeting the two-new-candidate target because
additional inventory remains queued. Read that status alongside the target count and source
detail: REW, Apartments.com, Hollyburn, EasyRent and Sunstar did not meet the target in this
test. Access warnings and local traffic limits were respected; no caps were increased to
force completion and no paused source was retried.

The live evidence prompted narrow offline repairs and selective reconciliation of this test's
new records:

- Apartments.com multi-plan community pages now remain building advertisements with unknown
  exact-unit terms and representative photo provenance. Expanded Apartments.com and Hollyburn
  routes remain **unvalidated for production coverage**.
- EasyRent reads availability and unit facts from their labeled DOM rows, including explicit
  floor statements. Rented/leased/unavailable status now excludes a candidate before further
  gallery processing or counting it as a newly available rental; failed fetches still do not
  imply removal.
- Explicit parking inclusion and monthly fees are retained; a fee without a billing cadence
  stays uncertain. Zero included parking spaces does not prove that paid parking is unavailable.
  Studio labels retain zero bedrooms, conflicting advertised monthly rents remain unknown,
  and Austeville's actual unit header supplies its civic address and geographic classification.
- Condition assessments reuse supporting image evidence across shared galleries and combine
  batches without allowing an amenity-only batch to erase assessed interior condition.
  Independent inspection of saved photographs also corrected one unsupported nature-view
  classification to a building-dominated view, without asserting that every outlook was known.

The original **63 saved homes remained unchanged**, including their photo records, user
decisions and feedback. Corrections used retained pages and images; they did not refresh old
galleries or make additional source or AI requests. Private captures, the two plans, baseline,
correction history and independent audit are retained under
`data/live/final-validation-2026-11-14/`. This bounded sample does not prove full inventory
coverage, unattended reliability or scoring accuracy for every future listing. Scheduling
remains disabled.

The [2026-11-11 manual source smoke test](source-smoke-test-2026-11-11.md) retrieved
listing details from 14 of 15 tested sites; liv.rent presented a verification challenge.
Read the per-source limits: these are manual access results, not completed adapters.

## Initial application trial — 2026-11-11

At this historical trial stage, all 12 retained sources supplied three saved candidates.
Apartments.com, Craigslist and VADA had app scan paths; the other nine used the assisted
captured-page workflow. Regular-runner integration below subsequently connected all twelve.
The Sources screen reports saved results separately from the available scanning method.
An informational success note is not an access pause: only an active cooldown or an unresolved
attention flag should display that state. Scheduled scans remain off for every source.

Follow-up trial: the visible Chrome sessions captured three candidates each from Zillow,
REW and Facebook Marketplace. Their scoped structured galleries yielded 85, 50 and 43
reviewed photos respectively; one REW candidate failed the shared-laundry requirement
before image retrieval. This added eight ChatGPT-plan gallery calls, without paid API
fallback. The completed trial now contains 36 candidates across all 12 remaining sources.
Apartments.com automatically discovered and processed three candidates through normal Chrome:
two eligible-for-review candidates had all 41 and 15 gallery photos reviewed; a third
failed the rent ceiling before gallery retrieval. Version 0.2.3 follows the actual photo
viewer and excludes separate building/map previews. At this stage, incomplete galleries
deferred all AI review; the newer resumable review behavior is described above.
The final repair used cached images and two ChatGPT-plan gallery calls. All current
candidate galleries total 607 reviewed images. Recurring scans remain disabled. See private
`data/live/remaining-trial/coverage.json` for per-source results.

Zumper clarification: the earlier “floor-plan candidates” wording described unit-type ads,
not galleries containing only floor-plan drawings. The three saved galleries contain
17, 22 and 45 interior photographs respectively. Exact-suite attribution remains unverified.
The desk now requires reviewed interior photographs; floor-plan-only and missing-photo
records remain outside the active list without losing their history.

### Earlier trial attempts (superseded by the completed follow-up above)

All 14 configured sources were checked under the user's three-candidates-per-source
authorization. The application saved 24 candidates and reviewed all 373 retrieved
photos using 20 gallery requests through the connected ChatGPT plan. No API-key
fallback was used. Further scans await user review; recurring scans remain disabled.

| Source | Trial outcome |
| --- | --- |
| Craigslist, VADA, Kijiji, Hollyburn, Austeville, EasyRent, Sunstar | Three captured candidates per source |
| Zumper | Three priced one-bedroom floor-plan candidates; specific suites unconfirmed |
| Zillow, Apartments.com, REW, Rentals.ca, RentFaster | HTTP 403 access warnings; paused without retries |
| Facebook Marketplace | Authenticated scanner session required; no listing access established |

Three candidates failed hard requirements before photo retrieval. One Kijiji ad
provided no images. Every other captured gallery was retrieved and reviewed in full.
Representative images, display suites, balcony-only vistas, and unclear window
outlooks remain explicitly unverified. Zumper's three galleries contained 119 images;
its sequential daily image allowance was bounded at 150 for this trial.

The newer sources used captured-page extraction during this validation. It did
not establish reliable incremental discovery; their normal scan adapters were
disabled at that stage. Craigslist gallery extraction and VADA's discovery URL/gallery scoping
were corrected against the live pages. Tests cover gallery enumeration, unrelated
gallery exclusion, negative laundry statements, and complete AI result coverage.

Private snapshots, extracted facts, photo findings, per-source outcomes, and database
backups are stored under gitignored `data/`. The completed initial-trial report is
`data/live/remaining-trial/coverage.json`; earlier results remain in
`data/live/initial-trial/final-report.json`. The Sources screen derives current saved and
active counts from the database rather than displaying obsolete trial counts.

## Visible Chrome access test — 2026-11-11

The user explicitly authorized a supervised recovery test using visible, installed
Chrome and dedicated persistent profiles. One previously known listing URL was
visited per affected source, with no listing imports or AI requests. This was a
specific recovery authorization, not an automatic retry policy or scheduled scan.

- Zillow and REW listing pages loaded with rental details.
- Facebook required the user to sign in. After sign-in, native browser inspection
  confirmed account controls, the requested Marketplace listing, and an apartment
  photo. The test window closed normally; the dedicated profile is retained.
  Automated extraction and persistence across reopening were unvalidated at this stage.
- Apartments.com returned HTTP 403 for the main document.
- Rentals.ca returned 403 for supporting API requests, including similar rentals
  and account-specific endpoints. RentFaster returned 403 for a saved-search endpoint.
  These observations do not establish that the public listing pages are inaccessible.

The visible mode permits normal HTTPS subresources within a bounded request budget.
Diagnostics distinguish main documents from supporting requests and omit URL queries
and credentials. No stealth modifications, proxy rotation, or CAPTCHA solving were
used. Browser choice, resource loading and direct listing URLs changed together, so
this test does not isolate which change restored access. Normal source adapters
remained disabled until subsequent discovery/extraction work. Private results and
profiles live under gitignored `data/live/chrome-access-test/` and `chrome-profiles/`.

## Original candidate evaluation priorities (historical)

The table records the initial investigation order. Current integration and bounded
live-validation results are recorded above and in the dated November 14 sections below.

| Candidate | What to assess | Priority |
| --- | --- | --- |
| Zillow | Vancouver inventory, units versus building results, descriptions, photos, IDs | Trial |
| Apartments.com | Local coverage, managed buildings, unit details, overlap | Trial |
| Zumper | Vancouver coverage, freshness, unit details, photos, and neighborhood search | Selected for the Zumper/PadMapper network; adapter trial still required |
| Facebook Marketplace | Local rentals, photos, authentication, unattended-session requirements | Early feasibility trial |
| Craigslist Vancouver | Private-landlord listings, reposts, detail extraction, IDs | Trial |
| REW.ca | Rental inventory, unit addresses, condo and view listings | Trial |
| Kijiji | Unique listings and repost frequency | Evaluate after first working adapters |
| Property managers including Hollyburn and VADA | Available units, photos, inventory missed by portals | Add where coverage warrants it |

Priorities describe investigations, not guaranteed launch integrations. Start with a small set
of working sources and expand where a source adds useful unique apartments.

## Deferred sources

- **Rentals.ca and RentFaster**: removed from active scan configuration at the user's
  request on 2026-11-11. Exclude them from upcoming trials and recurring discovery;
  reconsider only if requested. Historical access results above are retained. The
  remaining configured source list contains 12 sources; configuration is not a claim
  that all 12 have validated automated adapters.
- **liv.rent**: removed from the planned scanners at the user's request on 2026-11-11,
  following the access challenge in the manual test. Exclude it from implementation and
  recurring discovery for now; reconsider only if the user asks to restore it. Historical
  test results remain in the smoke-test report.

## Zumper / PadMapper decision

On 2026-11-11, select **Zumper only** for this network and remove PadMapper from planned
recurring discovery. The user requested one source where the two duplicate listings.

- [Zumper's official help article](https://help.zumper.com/hc/en-us/articles/360045262634-What-other-apartment-search-sites-will-Zumper-list-my-property-on)
  states that listings published on Zumper are also published on PadMapper.
- [Zumper's listing plans](https://www.zumper.com/manage/premium-listings) also identify
  PadMapper as an automatic distribution destination.
- [PadLister's migration notice](https://padlister.com/) says its landlord accounts moved
  to Zumper Pro. This supports choosing Zumper as the upstream publishing platform.

These sources establish shared listing distribution, not an exhaustive guarantee that every
Vancouver search result is identical at every moment. Using one adapter is a practical
consolidation decision; no quantified coverage-parity or superior extraction claim has been
validated. Test Zumper's current availability signals and photo extraction before enabling
scheduled scans. Do not add a separate PadMapper scanner or automatic fallback.

## Other source overlap and processing policy

Research checked 2026-11-11:

- **PadMapper versus Zillow:** no authoritative evidence found that they mirror the same full
  inventory. [Zillow identifies Zillow, Trulia and HotPads as its rental network](https://www.zillow.com/rentals-network/),
  while [Zumper documents distribution to PadMapper](https://help.zumper.com/hc/en-us/articles/360045262634-What-other-apartment-search-sites-will-Zumper-list-my-property-on).
  This does not prove zero overlap or exact Vancouver coverage. Keep Zillow as a separate
  candidate; keep PadMapper excluded in favor of Zumper. Do not add Trulia or HotPads scanners
  without evidence of useful unique local coverage.
- **Canadian shared feeds:** [Zumper's Canada documentation](https://help.zumper.com/hc/en-us/articles/360011031413-Can-I-post-listings-on-Zumper-and-PadMapper-in-Canada)
  identifies Rentsync as its service for larger Canadian listing providers.
  [Rentsync's update schedules](https://help.rentsync.com/when-do-my-ads-get-updated) describe
  distribution to Rentals.ca, RentFaster, Zumper/PadMapper and other sites including REW and
  Kijiji, with different update times. Shared feeds establish overlapping inventory, not
  identical complete inventories or equally fresh facts. Retain these as evaluation candidates.

Before enabling additional sources, compare a bounded sample of current Vancouver units
against enabled sources. Record confirmed duplicates, genuinely new apartments, uncertain
matches, additional useful facts/photos, freshness, and processing cost. Select one reliable,
complete source per confirmed redundant group; defer sources adding no useful coverage or
evidence in the trial. Do not claim an entire site is redundant from ownership alone or a
small sample with incomplete coverage.

For sources retained because they add unique apartments, perform cheap identity/change checks
first. Share one apartment record and assessment across confirmed duplicate ads. Reuse unchanged
photo assessments and research; inspect only new evidence and recalculate affected criteria for
material changes. Preserve source links, conflicting facts, timestamps, and uncertain duplicates.
Some lightweight discovery and detail fetching is necessary to detect duplicates and updates;
avoid repeated expensive analysis rather than promising zero repeated requests.

## Access and extraction

Each source gets an adapter for search discovery and listing details. Use ordinary HTTP for
usable HTML or structured page data, and Playwright for pages requiring browser rendering.
Keep parsing deterministic wherever possible.

Record for each candidate:

- Representative search/listing URLs, filters, pagination, and date-ordering behavior.
- Current access conditions, terms, authentication needs, and observed rate limits.
- Whether unattended runs work and what interaction, if any, is required.
- Available ID, address/unit, rent, beds/baths, size, dates, description, photos, and amenities.
- Whether a result is a specific apartment or a building advertisement with multiple units.
- How to recognize reposts, edits, and explicit rented/removed notices.
- Expected request volume, cache strategy, photo handling, and failure signals.

Login prompts and access challenges are source failures needing attention. Do not use CAPTCHA
solving, identity rotation, or other access-control bypasses. An unreliable source is shown as
unavailable; it does not silently change the product's intake model.

## Incremental scans

### Conservative access policy

These are initial engineering defaults, not a guarantee against blocks or a claim that browser
automation is indistinguishable from a person. Adjust source-specific limits only with evidence
from ordinary access trials; prioritize fewer requests and caching over faster navigation.

- Start with at most five top-level page visits per source per run, including discovery,
  details, refreshes and gallery pages, and at least ten seconds between navigations. Use
  one active source and one navigation at a time by default, with no concurrent tabs on the
  same source. Configure daily limits too so additional manual runs cannot multiply traffic.
- Count gallery/API requests and image retrieval separately from top-level visits; page count
  alone understates traffic. Set bounded per-source media/request budgets during adapter trials,
  avoid speculative prefetches, and limit scanner-initiated media retrieval concurrency. Normal
  browser subresources still consume traffic. Queue unfinished galleries for later runs.
- Use a persistent, private browser profile per source when browser rendering/authentication is
  needed, with normal cookies and the same host/network under ordinary operation. Do not rotate
  proxies, identities or fingerprints, reset cookies to evade limits, or attempt CAPTCHA bypass.
  Use simpler supported HTTP access where validated; all access paths share the same budgets.
- At the first unusual-traffic notice, challenge, rate-limit response, unexpected error page,
  or abnormal slowdown, stop further requests to that source, including pending media requests.
  Persist reason, last successful step and paused-until time. Default cooldown is at least
  24 hours from the warning, longer if the source requests it. No immediate retry loop, alternate
  identity, or fallback endpoint to get around the warning. Other sources may continue.
- An ordinary listing-not-found page is handled as a listing status observation, not automatically
  a site-wide block; generic error pages remain source failures. Define slowdown/error signals in
  each adapter rather than interpreting all slow responses as harmless.
- After a rate-limit/transient-error cooldown, allow one ordinary recovery request; pause again
  if it fails. Authentication and human-verification challenges need access recovery before
  resuming, not repeated daily challenge attempts. Manual scans and restarts respect this state.
- Show a prominent source-paused notice in the desk and one activity notification when it happens,
  including the reason, incomplete coverage and next eligible check. Do not repeatedly notify
  unchanged status. External delivery remains optional until configured.
- Cache fetched facts/photos and reuse assessments across confirmed duplicates. Process cached
  images locally without further page visits. Full-gallery review may span runs: record exactly
  what remains pending instead of sampling photos or raising site traffic to finish sooner.

Verify budgets, sequential access, stop-on-warning behavior, persisted cooldowns, manual-run
limits and interrupted-gallery recovery with focused tests. No assumption is made that blocks
will be temporary or that these settings are acceptable to every site.

### Discovery and refresh

Initially discover current inventory in manageable slices. Later discover recent results,
compare stable source IDs and content fingerprints, and fetch new or changed details. Use an
overlap window to catch delayed/reordered results. If a source cannot sort reliably by date,
scan bounded result pages and deduplicate by ID; report when bounds leave coverage incomplete.

Refresh shortlisted listings selectively for price and availability. Failures or incomplete
pagination must not advance successful-scan checkpoints or mark homes gone. Preserve successful
items from partial runs and resume unfinished work only within the access policy above.

## Adapter acceptance criteria

Completed normal-Chrome trial (2026-11-11): automatic discovery, bounded listing visits,
full gallery capture and ChatGPT-plan review succeeded for the three-candidate trial.
The two candidates below the rent ceiling matched their advertised gallery counts exactly
(41/41 and 15/15). The earlier prototype results below are historical. Normal Chrome and
the local app must remain running; access warnings still pause the source. This successful
trial does not guarantee uninterrupted future access or enable recurring scans.

Normal Chrome bridge prototype (2026-11-11): the user confirmed that the Apartments.com
Coopers Lookout listing opens in their regular Chrome, while the dedicated scanner received
a main-document 403. The local `extension/` prototype supports a paired, explicitly approved
read of that already-open page. It saves cleaned markup and loaded image URLs locally for
extractor validation; it does not navigate, download photos, score or import apartments.
Pairing expires after ten minutes and each capture authorization is single-use. Full gallery
coverage remains false, source pauses are preserved, and automated source readiness remains
pending until installation and real-page extraction have been verified. This is a connection
test toward direct scanning, not a replacement requiring ongoing manual intake.

The first installed-extension capture succeeded without an access warning. It advertised
20 photos but exposed only five distinct listing photos in the initial capture. Offline
extraction recovered rent, room counts, amenities and parking, with lease/availability
conflicts preserved. The capture sanitizer had removed the listing header; version 0.1.1
preserves it and reads additional existing gallery metadata. Full gallery retrieval,
AI review and automated discovery remain unvalidated; no readiness flag or pause is cleared.

Installed version 0.1.1 was subsequently validated against two matching captures: the
listing header is intact and nine distinct gallery image references are available against
20 advertised photos. The connection test is complete; repeating the same static capture
does not provide the missing images. Remaining work is gallery interaction/enumeration,
bounded image retrieval and review, followed by discovery integration. The user has completed
the setup successfully and should not be asked to repeat an unchanged connection test.

1. A real search produces identifiable rentals with working source links.
2. Core facts, descriptions, and available photos are checked against actual listing pages.
3. Repeat scans create no duplicate cards and do not re-score unchanged content.
4. Edited listings update facts without overwriting user stages or notes.
5. Missing fields stay unknown; blocked/malformed pages are not mistaken for empty inventory.
6. Field completeness, errors, timestamps, and discovery coverage appear in source health.

Manual entry is an optional convenience, not a requirement for normal operation.

## Regular runner integration — 2026-11-14

All 12 retained adapters are now connected to the regular approved-plan coordinator, including mixed-source plans containing Apartments.com. The earlier assisted-only status describes the historical implementation. Sources default to selected in the plan dialog; recurring scheduling is still disabled.

Offline validation covers scoped discovery links for all 12 sites, all-source dispatch, source pauses, budget fairness, and interrupted-gallery resumption. Existing captured pages were re-parsed without contacting sources. This established implementation behavior; the separately approved live tests in this document supply the access and extraction evidence. No access challenge is bypassed and no paused source is silently enabled.

## Earlier two-per-source test — 2026-11-14

This earlier approved test captured two new apartments from each of 11 retained sources (22 apartments total). Zillow returned HTTP 403 on its search-data request and was paused without retries at that stage. The other sources were Apartments.com, Craigslist, VADA, Zumper, Facebook Marketplace, REW, Kijiji, Hollyburn, Austeville, EasyRent and Sunstar. The later normal-Chrome recovery and final validation after improvements are separate dated evidence below and above.

Six candidates failed rent or laundry requirements before image retrieval. All 345 distinct photos from the other 16 rental galleries were reviewed. There were 17 ChatGPT-plan reviews overall, including one non-rental Craigslist ad caught during discovery debugging; that ad is excluded and does not count as an apartment. No paid API fallback was used. Eight new apartments remained in Unreviewed and 14 were excluded at test completion. Private evidence and counts are in `data/live/final-test-report.json`.

Repairs validated during the test:

- Craigslist now uses its current search URL, dedicated Chrome rendering, and a rental-category guard. Restricted loading had left the page on its generic for-sale results. Its 18-slot gallery containing 17 distinct photos is treated as complete only after all advertised slots are accounted for.
- Sunstar discovery skips portfolio rows explicitly marked rented.
- REW and Facebook's initial failures came from local browser-request limits, not site access blocks. Browser image/media/font loading is suppressed so full gallery images are fetched once through the accounted media path. Both sources subsequently supplied their remaining candidates; this REW sample failed the rent gate before gallery review.
- Placeholder rents cannot earn affordability points. Contradictory photo provenance is kept unconfirmed, and an unverified unit nature outlook cannot earn a strong-match score.

Source labels appear on apartment cards and pinned detail headers. Remaining inventory stays queued; this completed test does not authorize a full or recurring scan.

## Zillow normal-Chrome recovery — 2026-11-14

The user authorized implementing and testing Zillow discovery through their regular
Chrome session. Extension 0.3.0 adds that source to the paired Chrome bridge.
The app routes Zillow search and unit pages through it, extracts only the matching
property's public fields and original gallery, and uses the existing bounded
photo-review/scoring pipeline. Source pauses, daily limits, user stages and notes
remain preserved. An explicit one-page recovery operation may clear Zillow's pause
only after discovering valid unit links; empty or challenged pages retain it.

Offline validation covers source authorization, origin matching, warning isolation,
scoped capture, full-size image references, incomplete galleries, recovery and regular
worker dispatch. Live validation succeeded after the user reloaded the extension:

- One search page discovered five individual rental links and a next-page link.
- The initial two listings failed the rent ceiling before photo downloads or AI.
- The user approved two additional listing visits within the unused 100-photo and
  two-review allowance. Both galleries were fully downloaded and reviewed: 15/15
  and 16/16 images. Original source files and dimensions were retained.
- All four test listings were excluded under the current criteria. A missed
  "laundry room in the building" phrase was corrected from the cached listing,
  with regression coverage so future matching listings fail the laundry gate early.
- Total: five page visits, four listings, 31 image downloads, two ChatGPT-plan
  reviews, no paid API requests. No access warning occurred. The remaining
  inventory stays queued; plan status is partial because inventory remains beyond
  the approved slice, not because the tested galleries failed.

The earlier 403 occurred on the dedicated browser's search-data request. Normal
Chrome succeeded on the same rental search; this establishes a working session
route, not Zillow's exact reason for rejecting the earlier request. No connector,
proxy, fingerprint modification or challenge bypass was needed. Zillow uses the
normal-Chrome bridge in future approved scans; Chrome and the local app must stay
open. This test does not enable scheduled scans. Private results are recorded in
`data/live/zillow-chrome-test-report.json`.

## Final new-listing validation — 2026-11-15

The user authorized another two-new-listings-per-source test after the scoring
calibration and a GitHub backup. This was a new-only intake: known homes were not
refreshed and their unfinished galleries were not resumed. Scheduled scans remain
disabled. The test is **partial**, rather than a successful two-per-source result.

| Source | New records | Result |
| --- | ---: | --- |
| Craigslist, VADA, Zillow, Facebook Marketplace, Kijiji, Austeville | 2 each | Target reached; eligible galleries reviewed, hard failures scored before image work. |
| Zumper | 2 | Distinct floor-plan offers at one building, not two independently confirmed physical suites; representative photos remain unit-unverified. |
| Hollyburn | 2 | Source provides representative display-suite photos. One large gallery remains incomplete under the daily image limit. |
| REW | 1 | The next listing exhausted the local browser-request allowance; remaining work stayed queued. This was not a site access warning. |
| Apartments.com | 0 | Existing photo-fetch failure cooldown respected; no source requests made. |
| EasyRent | 0 | All four attempted candidates were explicitly unavailable; none counted as new apartments. |
| Sunstar | 0 | Fresh discovery yielded no unseen qualifying candidates in the approved scope. |

Discovery produced 17 new records across the 12 sources, including the two Zumper
floor-plan offers. It used 31 page visits, 22 candidate attempts, 252 photo-retrieval
attempts and 24 ChatGPT-plan calls. Four records failed rent or laundry requirements
before image review. Three new records qualified for the active desk. No paid API
fallback was used. Original and continuation plans share the original authorization and aggregate
limits; no paused or request-exhausted source was retried. Private captures, plan
usage, scoring checks and the original-home preservation audit are retained under
`data/live/final-validation-2026-11-15/`.

Hollyburn's large gallery reached its source's daily image limit after 90 of 153
images were downloaded. All 90 retained images were reviewed, including a bounded
continuation using only saved files and seven ChatGPT-plan calls, with no further
source requests. The remaining 63 photos are explicitly pending; representative
photos do not confirm the listed unit's view. All other assessed galleries were
fully reviewed. The final three-phase preservation audit verified that all 81
pre-existing homes, their photos, criteria, feedback and user decisions were
unchanged, and every phase stayed within the original aggregate allowance.

Saved-page and photo review exposed extraction issues that were fixed with offline
regression coverage:

- Kijiji rent comes from the scoped price/structured offer, with conflicting rent
  claims retained as uncertain. Optional internet charges cannot become base rent.
- A den/flex label alone does not establish usable office space; converted closets
  and shared workspaces cannot earn a unit-office bonus.
- Craigslist reads the posting location and clearly scoped introductory address,
  unit and floor facts, retaining conflicting parking claims.
- Hollyburn furnished-unit facts come from the unit's own rental card, excluding
  building FAQs. Studio counts and supported three-month minimum terms are retained.
  Galleries follow the rental masthead's associated popup, excluding unrelated
  popups and cloned slides. A valid association still does not prove exact-unit
  provenance: the large captured source gallery itself contains 153 representative
  images, so it must not be silently reduced to a convenient subset.

Verified corrections were applied only to new test records and their source
manifests, preserving saved photos and model findings. These results establish the
tested routes and their current limits; they do not authorize recurring scanning.

## Discovery and limit audit — 2026-11-15

The user requested an investigation after the twenty-per-source attempt fell short.
This audit used the retained search/detail captures, the pre-run database backup,
plan outcomes and the current code. It made no source requests, AI calls or changes
to the live database. Private reproducible evidence is in
`data/live/source-audit-2026-11-15/replay.ts` and its `report.json`.

### Why sources returned zero or few new records

| Source | Evidence and cause | Correction or remaining work |
| --- | --- | --- |
| Apartments.com | The extension found 41 profile links. Backend discovery also accepted 16 `/building/.../.../` directory links because its URL pattern matched a suffix rather than the whole path. All four attempted details were directory pages, each lacking the unit-profile description/header expected by the extractor. Each directory linked to an actual profile. The search page had 23 unseen profiles that survived the search-card filters, plus pagination; these are candidates, not confirmed qualifying apartments. | Anchor profile routing and reject invalid legacy queue entries during fresh discovery. Preserve the stricter unit extractor. Offline replay and a worker regression verify the fix. |
| EasyRent | The saved page contained 24 distinct listing links: 15 explicitly rented cards, five cards with advertised availability and four additional links with unknown availability. Discovery ignored the rented labels, wasting all four attempted detail visits. Against the pre-run criteria and saved postings, the corrected queue retains three unseen candidates, whose current availability is unknown. | Read the scoped `Available:` field and remove rented candidates from both fresh discovery and the old backlog before spending detail visits. A word such as “rented” in the title alone is not a rejection. |
| Sunstar | Its downtown page contained 165 links: 159 rented, four within the search-card filters already saved, and two over budget. No unseen qualifying candidate remained in that scope. | Zero was a valid incremental result, not evidence of broken access. Other area portfolio links exist but are outside the implemented downtown route. Broader coverage needs adapter work and validation. |
| Hollyburn | The run made no new source request. The preceding test had already consumed the 100-image daily allowance, partly on one 153-image representative gallery. | This was a local capacity stop. The furnished route has worked; unfurnished inventory remains unvalidated. Do not report zero as an access failure. |
| Facebook / REW | The local 500-request cap aborted their browser sessions after two and one new candidates respectively. The counter includes scripts, styles and XHR/fetch calls, not just visited listings. | This was a local guard, not a site-issued block. Review request accounting and the fixed threshold before another larger run. |
| Craigslist / VADA / Zillow / Kijiji | These returned new listings; page or media allowances prevented reaching twenty. Craigslist reached the rolling daily page limit; the others reached media limits. | Scale approved session allowances to the requested work and distinguish intake from completed photo review. |
| Austeville | Eight candidates were retained. Earlier response-size and attribution-request errors interrupted passes; saved-photo continuations subsequently completed the outstanding assessments. The helper's three-pass bound then ended intake. | The attribution request was fixed and smaller batches addressed response size. The three-pass helper is historical run orchestration, not a source coverage rule. |
| Zumper | Twenty distinct floor-plan offers were retained and reviewed. | Report these separately from confirmed physical apartments; they do not establish twenty independently identified units. |

Earlier tests established working samples and routes. The November 15 final
validation already recorded partial results for Apartments.com, EasyRent, Sunstar,
REW and Hollyburn. Coordinator integration and a successful small trial did not
establish complete incremental discovery or capacity for twenty apartments per
source. The Sources view now includes the latest recorded scan attempt and future
discovery breakdowns, alongside historical test evidence. Discovery counts refer to
the last page; the queue count includes older pages and is not a count of scored homes.

### Which limits are necessary

The fixed quantities below are application defaults, not measured website allowances.
The weekly usage reading moved from 70% to 72% during the completed scan. Neither
the user's 90% ceiling nor the supervisor's earlier 88% stop ended that scan.

| Current rule | Effect | Assessment |
| --- | --- | --- |
| Five top-level pages per source per pass, enforced in both source allocation and browser transport | Usually one discovery plus four details. Apartments.com may need separate facts and gallery jobs. | A trial-sized ceiling conflicts with a twenty-apartment request. Replace it with an explicit session allowance derived from the target and route. |
| Fifteen page visits in a rolling 24 hours, shared with earlier tests | A new plan can immediately inherit an almost exhausted allowance. | No evidence establishes fifteen as a website-required limit. Remove this fixed trial quota from normal approved sessions; keep pacing, accounting and persisted actual access warnings. |
| Usually 100 downloaded images per source per day; 150 for Zumper and the Apartments downloader | A single 153-image gallery cannot finish, even with credit and a larger approved photo allowance remaining. The historical helper also incorrectly assumed 100 for Apartments.com. | Replace the fixed daily image bucket with a disclosed session media allowance and full-gallery progress. Reuse unchanged images and assessments. |
| 500 requests per source; total 500 times the selected-source count | Script-heavy browser pages exhaust it after very few listings. Normal-Chrome jobs and dedicated-browser sessions count different kinds of traffic. | This is not a consistent proxy for browsing intensity. Separate explicit scanner requests from normal page subresources. Count and diagnose both; use pacing and a transparent runaway/stall guard rather than this small shared count. |
| Plan schema: 60 pages and 120 candidate attempts maximum | A single plan cannot accommodate 240 new records, even before failed or duplicate attempts. The UI calls attempts an “Apartment limit.” | Increase/configure session capacity, use accurate labels and preflight target feasibility before presenting approval. Target counts and maximum attempts are different quantities. |
| Historical supervisor: three passes; skip further intake after certain zero-result or cap outcomes | A partial slice becomes a premature stopping condition, including after recoverable discovery defects. | Do not reuse these rules as evidence of exhausted inventory. Continue within the same approved aggregate session until target, explicit budget, true exhaustion, cancellation or access warning. |
| A failed/timed-out image can trigger the same 24-hour pause used for access warnings | A transient local/network failure can suppress a whole source on the next run. | Distinguish transient transport failures, local limits and real access warnings. Keep incomplete work and bounded retries/backoff; do not clear or bypass an actual challenge. |

Keep the user's credit reserve, a bounded approved session, cancellation, one active
source/navigation at a time, navigation/media pacing, persistent sessions, cache
reuse, and stops on actual rate limits or verification challenges. Keep response
size and job time limits as reliability guards; batch or resume within them instead
of letting a stalled page or malformed response consume unlimited resources.

Ordinary Chrome is not exempt from server rate limits. HTTP 429 can be based on a
session, cookie, user or IP, and can carry a `Retry-After` instruction; the fixed
application thresholds above do not come from that standard. See
[MDN's HTTP 429 reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429).
Also, only Apartments.com and Zillow currently use the user's paired ordinary
Chrome session. The other adapters use separate persistent browser profiles;
Craigslist, Facebook and REW are visible Chrome, while the others are headless.

The recommended normal-scan policy is target-led work under one visible approved
session and a monitored credit reserve, with source pacing and reactive pauses.
The source quotas have not been changed in this investigation. Replacing them is
a coordinated change to schema, coordinator, transports, Chrome jobs, supervisor
and plan UI; changing only the UI or five-page constant would leave other hidden
limits in force. Broader discovery routes likewise remain separate from this fix.

Validation: the full 240-test offline suite passed, including new discovery and
stale-queue regressions. API tests used temporary localhost servers. TypeScript and
the production frontend build passed. Saved evidence confirms the parsing fixes;
it does not certify current live access. The live database and source pauses were
not rewritten, and no new scan was started.

### Approved follow-up implementation

The user subsequently authorized another twenty-new-apartments-per-source attempt.
New plans now use the session policy described in `credit-limited-scans.md`: approved
aggregate allowances replace the old trial quotas, browser subresources are tracked
separately, and candidate attempts are labeled accurately. Pacing and real access
warnings still stop source work. The prior audit above describes the earlier state.

Continuation phases rotate through at most five new apartments per source until
the cumulative target, credit reserve, session allowance or accessible inventory is
exhausted. A phase is not a new twenty-apartment authorization. Only homes added by
this attempt can have interrupted gallery work resumed; prior user decisions and
photo assessments are outside its scope. Cached photo continuations make no source
requests. Private per-phase evidence and cumulative counts are retained with the run.

Live continuation found a second Zumper discovery defect: individual-unit cards
use `/listings/<id>p/...` URLs in `currentSearch.listables.listables`, while the
earlier extractor recognized building anchors and older unit routes. Safe JSON
parsing of that current-results list now recovers unit cards as well. Six saved
search pages contained nineteen unit URLs, fifteen within the discovery filters;
those candidates were recovered without another request. The corrected runner
then fetched individual-unit details and completed photo assessment successfully.
