# Listing sources

Updated 2026-11-11. Apartment Finder discovers rentals directly from listing websites and
collects their details for filtering, scoring, and the Sorting Desk.

The previous source strategy has been superseded at the user's request. This document is an
adapter evaluation plan, not a claim that automated access or coverage has been validated.
Earlier inventory counts and access conclusions are not implementation assumptions.

The [2026-11-11 manual source smoke test](source-smoke-test-2026-11-11.md) retrieved
listing details from 14 of 15 tested sites; liv.rent presented a verification challenge.
Read the per-source limits: these are manual access results, not completed adapters.

## Initial application trial — 2026-11-11

Follow-up trial: the visible Chrome sessions captured three candidates each from Zillow,
REW and Facebook Marketplace. Their scoped structured galleries yielded 85, 50 and 43
reviewed photos respectively; one REW candidate failed the shared-laundry requirement
before image retrieval. This added eight ChatGPT-plan gallery calls, without paid API
fallback. The completed trial now contains 36 candidates across all 12 remaining sources.
Apartments.com automatically discovered and processed three candidates through normal Chrome:
two eligible-for-review candidates had all 41 and 15 gallery photos reviewed; a third
failed the rent ceiling before gallery retrieval. Version 0.2.3 follows the actual photo
viewer and excludes separate building/map previews. Incomplete galleries defer AI review.
The final repair used cached images and two ChatGPT-plan gallery calls. All current
candidate galleries total 607 reviewed images. Recurring scans remain disabled. See private
`data/live/remaining-trial/coverage.json` for per-source results.

Zumper clarification: the earlier “floor-plan candidates” wording described unit-type ads,
not galleries containing only floor-plan drawings. The three saved galleries contain
17, 22 and 45 interior photographs respectively. Exact-suite attribution remains unverified.
The desk now requires reviewed interior photographs; floor-plan-only and missing-photo
records remain outside the active list without losing their history.

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

The newer sources used captured-page extraction during this validation. This does
not establish reliable incremental discovery: their normal scan adapters remain
disabled. Craigslist gallery extraction and VADA's discovery URL/gallery scoping
were corrected against the live pages. Tests cover gallery enumeration, unrelated
gallery exclusion, negative laundry statements, and complete AI result coverage.

Private snapshots, extracted facts, photo findings, per-source outcomes, and database
backups are stored under gitignored `data/`. The current report is
`data/live/initial-trial/final-report.json`; the Sources screen shows its summary.

## Visible Chrome access test — 2026-11-11

The user explicitly authorized a supervised recovery test using visible, installed
Chrome and dedicated persistent profiles. One previously known listing URL was
visited per affected source, with no listing imports or AI requests. This was a
specific recovery authorization, not an automatic retry policy or scheduled scan.

- Zillow and REW listing pages loaded with rental details.
- Facebook required the user to sign in. After sign-in, native browser inspection
  confirmed account controls, the requested Marketplace listing, and an apartment
  photo. The test window closed normally; the dedicated profile is retained.
  Automated extraction and persistence across reopening remain unvalidated.
- Apartments.com returned HTTP 403 for the main document.
- Rentals.ca returned 403 for supporting API requests, including similar rentals
  and account-specific endpoints. RentFaster returned 403 for a saved-search endpoint.
  These observations do not establish that the public listing pages are inaccessible.

The visible mode permits normal HTTPS subresources within a bounded request budget.
Diagnostics distinguish main documents from supporting requests and omit URL queries
and credentials. No stealth modifications, proxy rotation, or CAPTCHA solving were
used. Browser choice, resource loading and direct listing URLs changed together, so
this test does not isolate which change restored access. Normal source adapters
remain disabled until discovery and extraction are validated. Private results and
profiles live under gitignored `data/live/chrome-access-test/` and `chrome-profiles/`.

## Candidates

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
