# Catch-up and daily scans

## Test-first hold — latest November 18 instruction

Do not restart intake or catch-up automatically. The user wants a few real-listing tests
before deciding whether the new workflow works as expected. Obtain approval for each bounded
live test; passing offline checks or completing implementation does not authorize one.
Do not expand to full inventory scans until the user says they are satisfied and authorizes
that work. The unapproved 48-hour proposal is withdrawn pending those tests. The programme
and daily automation remain paused; reset credits remain unauthorized.

The historical `catchup-scan.ts init` command is archived and rejects execution before
opening runtime data. Its November 16 authorization cannot initialize a new programme.
Prepare a current bounded plan and obtain fresh approval for new work; the existing
programme's paused state remains authoritative for `next`.

## November 18 quick-first revision

The user now wants broad, fast intake with local letter grades, followed by full assessment
only after marking a home Interested. This supersedes the historical full-assessment-at-intake
sequence below; it does not restart the paused daily automation or redeem reset credits.
The target is to make broad Vancouver inventory available for review within two days. Treat
that as a goal, not an assurance of full coverage: queued URLs are not unique apartments,
and blocked or unvalidated pagination is never exhausted inventory.

- Quick plans set `assessmentMode: quick`, collect facts and attached photos, and make zero
  AI calls. The privately configured intake bounds apply inclusively to advertised rent;
  permitted bedroom counts and minimum distinct photo count are hard criteria. Missing or
  conflicting information remains flagged. Unknown or weak views and poor grades remain
  eligible for manual review. Fully scored historical evidence is preserved for reuse.
- Hard-eligible results enter Unreviewed. Interested is an explicit request for one bounded
  full assessment of that home, persisted with job status. Full plans set `assessmentMode:
  full` and scope their work to the authorized home IDs. Completed evidence remains durable
  across pauses and failures; Ready to Apply is unavailable until the full review completes.
- Full-review credit checks use fresh account readings and retain the 95% weekly stop. Source
  warnings, the shared worker lock and bounded media/page/AI allowances remain enforced.
  No paid fallback, automatic reset redemption, unsolicited inquiry or application is allowed.
- Interested-job bounds are 24 listing/gallery pages, 240 image downloads and 120 plan calls
  for that apartment, plus at most two public address/building-record requests. Cached findings
  are reused. Remaining evidence at a bound is paused for explicit retry; no new inventory is
  discovered by a full-review job. Account usage is read through the local Codex app-server,
  independently of an open chat, and matched to the configured profile/account.
- The scheduler uses recent user-interest yield, tempered for small samples. Three bounded
  priority phases are followed by one exploration phase at another available source. Persist
  phase selections; repeatedly previewing status must not consume an exploration turn.
  Attribute cross-posts once to their primary source. Actual Interested / Not Interested choices
  take precedence over model scores, decay with age, and are recalculated before each batch.
  Note edits and listing refreshes cannot renew an old success. Saved assessments provide a
  starting point only before user feedback exists. With no supported positives, rotate.
  Drained sources leave the work selection. After checked inventory is caught up, each new
  maintenance cycle surveys every available source before favoring a newly found backlog.
  In quick mode, incomplete collection affects catch-up status; deferred full scoring does not.
- This allocation is by bounded phases, not a guarantee of exactly 75% of final apartments
  from one source: access pauses, source exhaustion and different phase yields affect output.
  Keep independent inventory expansion and assessment histories and never clear access pauses
  to make a preferred source available.
- App startup marks unfinished full-review jobs paused rather than starting live work. Tests
  and demos remain offline. An explicit new review/resume action is required after a restart.

The following sections retain the November 16 run bounds, evidence and execution history.
The dated allowance exceptions have expired; they do not authorize a new two-day run.

On November 16, 2026 the user authorized catching up with current Vancouver-area listings
on all 12 retained sources, targeting review readiness before Saturday November 21, then
continuing once daily in the morning. This supersedes earlier statements that recurring
scans were not authorized. The schedule is 08:00 America/Toronto, the user's configured
timezone. No startup scans, paid API fallback, deferred-source restoration or credit resets
are authorized. Existing personal ratings, decisions, notes and duplicate decisions persist.

Later on November 16 the user reduced today's stop to **99% used**, then requested a pause
to review throughput, saved results and remaining source inventory. The daily 08:00 automation
is **PAUSED** until the user explicitly re-enables it after that review. At 99%, safely stop
the current worker, confirm the lock is released, set the programme disabled and keep all
saved homes visible in their existing Sorting Desk categories. The future 95% policy remains
configured; it does not itself authorize restarting the paused schedule.

Execution status on November 16: the monitor observed 99% weekly usage at 22:40 UTC,
stopped the worker and verified its lock was released. The programme is disabled and the
daily automation remains paused. Saved results and pending work are retained. The frozen
efficiency review and Sorting Desk verification are in `data/live/catchup-2026-11-16/`.
No further listing scans or scoring phases are authorized by the old catch-up instruction
until the user resumes them after reviewing progress.

## Source yield requirement for the revised workflow

The user clarified on November 16 that equal effort across sources is not the objective:
sources producing more confirmed high-scoring apartments should receive more assessment
capacity. The November 18 revision above implements phase allocation and an explicitly
provisional fallback while confirmed strong matches are absent. It does not resume any scan.

- Measure unique individual apartments with complete assessments and qualifying current
  scores. The personal strong-match threshold is recorded in `private/criteria.md`.
  Recompute outcomes under the same current scoring rules when comparing sources.
- Show the hit rate with its denominator and sample size. Report fully assessed apartments,
  factual exclusions and incomplete evidence separately; failures or unfinished galleries
  are not completed negative assessments. Do not count repeated attempts, floorplan offers,
  building ads or duplicate cross-posts as additional apartment successes. Make attribution
  of a shared apartment's discovery explicit.
- Prefer sources with stronger supported yield while considering measured assessment time
  and AI effort. A small lucky sample must not monopolize work. Raw AI-call counts are only
  a cost proxy; they do not measure exact weekly credits. Keep technical access/monitoring
  failures separate from apartment suitability.
- Keep cheap inventory discovery across all retained sources and a continuing exploration
  share for sources with little evidence or lower observed yield. Allocate deep reviews
  adaptively within freshness priorities and the authorized credit/source-access bounds.
  Refresh the comparison as new completed outcomes arrive and criteria change.
- If no source has a qualifying success yet, report insufficient evidence for a winner.
  Promising provisional leads can be tracked separately without relabelling them as confirmed
  strong matches. Preserve all score thresholds and photo/view confirmation requirements.

## Bounded execution

The live app and paired Chrome bridge must be running. The Codex daily automation supervises
account usage; local scheduling also requires the computer and Codex app to remain running.
It is a practical dependency of this account-aware schedule, not a requirement to keep a
person interacting with the chat. The worker does the extraction and assessment itself.

Each local calendar day permits at most 600 page visits, 400 candidate attempts, 8,000
photo downloads and 1,500 AI calls. These are ceilings, not targets or a guarantee of
completion. Use sequential source sessions, existing pacing and stop-on-warning pauses.
Never clear a source's access pause automatically. Do not claim all listings are covered
when search pagination, dynamic loading or extraction is unverified.

For November 16 only, the user's instruction to continue through the remaining weekly
allowance permits work until local midnight or the revised 99% weekly stop, whichever comes first.
The dated `runOverride` allows up to 3,000 AI calls today; page, candidate and photo ceilings
remain as above. This replaces today's usual eight-hour/1,500-call execution bound. It expires
at 2026-11-17 05:00 UTC and cannot enlarge a later day's allowance. `status.executionPolicy`
and `tick.executionPolicy` expose the currently effective caps and optional absolute deadline.

- Inventory phases: one source, up to eight search pages, no photos or AI. Traverse
  advertised pagination even while a detail backlog exists; retain regional catalogue
  links discovered on supported sources. Save each route and pagination frontier.
  After an initial pass across accessible sources, alternate expansion with assessment
  so a large search catalogue cannot postpone all scoring. Craigslist uses ordinary
  visible scrolling and its observed URL position to resume; dynamic sources without a
  validated continuation remain explicit coverage gaps.
- Assessment phases: one source, up to 90 pages, 60 candidate attempts, 1,500 photos and
  200 AI calls, seeking up to 30 new apartments per phase. Continue additional phases
  within the daily allowance; 30 is not a total per-source limit. Waiting work and promising
  candidates alternate within posting-age priority tiers, with source rotation. Inventory
  and assessment use independent visit histories: expanding a source's catalogue must not
  postpone that source's assessment turn. Never-assessed waiting sources go first within
  the same age tier, followed by those least recently assessed. The private
  `listingAgePriorityMonths` setting puts known older ads behind recent/undated candidates.
  If age is learned only on a detail page, retain the facts and defer gallery spending while
  current/undated work remains. Age alone never excludes an ad or reduces its match score.
  Hard factual failures skip expensive reviews.
- Review all accessible gallery photos, reuse unchanged findings, preserve unknowns and
  record inaccessible or incomplete galleries. Marketing view claims only affect priority.
  Confirmed street-level units already excluded by the configured floor ceiling also
  skip photo/AI spending; unknown or conflicting floors do not trigger this prefilter.
- The next day refreshes newest results and resumes an unfinished pagination frontier.
  Known postings are deduplicated; new units/floorplans must retain separate identity.

Use the currently authorized credit policy. On November 16 the user explicitly lifted the
88% reserve for today's catch-up, initially allowing 100%, then revised today's stop to 99%
to reserve time for the requested efficiency and inventory review.
The stored override expires at 2026-11-17 00:00 America/Toronto (05:00 UTC); it does not
carry into the November 18 reset. The user subsequently set a recurring **95% stop** from
that reset, measured at 2026-11-18 07:36:11 America/Toronto (12:36:11 UTC). The previous 88%
policy remains until then, outside today's exception. `status.creditPolicy` reports the
effective limit and temporary expiry; `programme.scheduledLimit` retains the future change.

Read fresh account usage using `get_usage_limits` before
starting each phase and before permitting each AI call. Use the 10,080-minute Codex weekly
window. Stop at **95% used** after Wednesday's reset; the earlier reserve is **88%** until
then, except for today's explicitly authorized **99%** override. The daily automation remains
paused regardless of the credit policy until the user re-enables it. Never
estimate usage, assume an old reading is still fresh, spend reset credits or fall back to
paid API billing. Missing usage information stops work. Checkpoints expire after 90 seconds.
An account-level refusal to allow ordinary usage also stops work, even if weekly usage
is below the threshold. Cancel with `stop-phase` when a safe reading cannot be established;
do not record a fabricated account usage percentage.
One additional AI call is permitted per checkpoint; an in-flight request may finish.

## Operator commands

Run from the repository using Node 24. If the PATH shim is unavailable, use the full path
to your local Node installation:

```powershell
node --import tsx scripts/catchup-scan.ts status
```

`init PERCENT` creates the programme and a database backup once. `next PERCENT` starts
the next bounded phase. `tick PERCENT` records freshly measured usage and grants the next
AI permit, or cancels at the reserve. PERCENT must come from a usage-tool reading immediately
before the command. Use a newly measured value for every tick; do not run a fixed-value loop.
`summary` prints concise counts; `status` writes and prints the full coverage report.
`stop-phase` cancels only the current programme phase, preserving its lock until the worker
finishes safely and preserving recurring authorization. Never force-delete a live lock.
Check usage/tick roughly every 10 seconds while active. Never leave an active run unattended
without this monitor. An expired checkpoint fails closed and preserves completed work.

For each daily run, continue phases until the daily allowance, credit reserve, eight hours
of elapsed execution (or a currently authorized `executionPolicy.until` override), an
unresolved feedback review, or lack of accessible work stops it.
At a time boundary, finish the current bounded phase while supervised or cancel it, then
verify the lock is released. Once the user re-enables the paused schedule, resume from persisted
queues on the next morning; do not restart
finished photo reviews. Interrupted-worker recovery uses the existing API and its ten-minute
staleness check, only after confirming the worker is absent. Never remove the lock directly.
For a local launcher failure explicitly reporting `CreateProcessSecurityEnvironment failed`,
the command has not started: allow at most two brief launch retries, with a new account-usage
check before retrying `tick` or `next`. This is not permission to retry source access warnings
or AI refusals. If monitoring still fails, cancel the phase and preserve the actual interruption
reason; do not record a fabricated 100% account measurement as the cause.
Check `summary.latestPlan` before launching another phase. An AI authentication, account or
quota refusal must stop further scoring until its cause is resolved. A November 16 HTTP 401
was followed by successful renewal through the existing connection and a model-catalog check;
no new sign-in or paid API fallback was needed. Gallery review now obtains current credentials
for the same account before each visual or attribution batch, rather than retaining one token
for a potentially long gallery. A model change stops the review without spending another AI
call. Failed AI requests are not automatically retried; saved remaining images can resume in
a newly bounded phase after ordinary account access is verified.

Programme state is in SQLite `scanProgramme`; route coverage is `inventoryCoverage:<source>`.
The command writes `data/live/catchup-2026-11-16/status.json`. The Sources panel displays
each checked route, continuation/gap and queue counts. Mark the schedule enabled only after
the automation is actually created, saving its returned ID in programme and `scanSchedule`.

## Completion and limitations

Candidate URLs are not unique available apartments. Separately report discovered links,
candidate attempts, saved new homes, factual exclusions, fully reviewed galleries, pending
evidence and inaccessible sources. A missing Next link on dynamic search pages remains
unverified. Finite catalogue exhaustion applies only to that source route and check time.
Source coverage must be validated from real captures, including additional regional routes.
Kijiji traversal was validated against all six contiguous pages and the source's reported
209 results on November 16. Required rendering assets were previously blocked. An expired
Craigslist listing's HTTP 410 was also incorrectly classified as a 24-hour source failure;
410 now follows the unavailable-listing path. The exact false cooldown was corrected with
an audit record; real access challenges, rate limits and source-warning pauses remain intact.
Hollyburn neighbourhood guides can advertise a separate geographic apartment-search link.
Follow those source links while retaining the guide's unverified coverage status, instead
of treating a guide as an empty or broken unit catalogue. The saved West End capture supplied
one such link without a new request. A subsequent eight-page live inventory phase followed
six guides and validated the advertised West End and Kitsilano geographic searches, each
exposing the same 22 building candidates. These added 22 distinct queued links; they are not
22 confirmed available apartments or completed assessments. Unit details and dynamic inventory
coverage remain unverified.
The later Hollyburn assessment added 30 unit records: 24 complete galleries and six initially
incomplete galleries. Saved captures showed the six omissions were the same image appearing
in both the target masthead and its popup under `/drive/uploads/`, which the parser's former
`/suite-images/` filter excluded. Extraction now accepts allowed-host images from both folders
while retaining target-popup membership, clone exclusion and host checks. The six new records
were reconciled from saved pages without network or AI work; their existing reviews were
preserved and the recovered image was queued for each. A later bounded recovery completed
all six galleries and the remaining Craigslist image after normal account-token renewal:
seven resumed galleries, one additional image download and two AI calls, with no new listing
discovery. All 30 new Hollyburn galleries are now complete. Display-suite provenance still
cannot verify an actual-unit view.
Zillow properties explicitly marked `FOR_SALE` are non-rental candidate failures, not parsing
failures. Three retained captures established that classification; their original check times
and correction audit remain saved. Unknown statuses still require extraction review, and no
saved home's availability or workflow stage is changed by this candidate classification.
Numbered `?page=` links stay on their catalogue's existing pagination frontier; they must not
also create regional routes. Saved Zumper evidence on November 16 showed 26 visits across
17 distinct contiguous search pages. Its 18 overlapping route entries were consolidated into
one frontier at the source-advertised page 18, retaining all visited URLs, request counts and
the original route history in an audit record. This avoids revisiting earlier pages; it does
not establish that the remaining catalogue has been traversed.

Photo timeouts teach a smaller batch size for subsequent galleries on that model/rubric.
The first live six-photo timeout completed successfully after splitting to three photos;
all accessible photos are still reviewed and cached findings are retained. This limits
repeated timeout overhead, without changing the selected model or silently sampling images.
Repeated source descriptions are sent once per distinct posting context within a batch;
every image retains its own context reference so cross-post attribution stays separate.
If a gallery response fails evidence/schema validation, request one corrected response for
the same photos within the existing AI allowance and fresh usage guard. Do not cache invalid
findings, relax evidence checks, or retry HTTP/quota refusals. A second invalid response leaves
the gallery unfinished. Repeated three-photo timeouts now teach a two-photo default for the
next gallery; a particular gallery can retry individual images without skipping any.
Do not promise literally every rental on the internet or a firm completion date while gaps
remain. The catch-up phase ends only when checked inventory is exhausted and queued work,
recoverable evidence and extraction issues are resolved; otherwise show the remaining gaps.

After catch-up, the same daily run discovers new listings and scores new units, using cached
photos and posting identity to avoid repeated review. Poor/unknown views remain in Excluded
under the user's current criteria; only supported nice unit-window views reach the active desk.
