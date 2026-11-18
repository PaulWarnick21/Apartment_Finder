# Supervised credit-limited scan — November 15, 2026

These completed runs and their authorization are archived. The two scan helpers allow
only `status`; the photo-continuation and gallery-slot repair helpers reject execution
before opening runtime data. Separate report scripts remain available. The implementation
below is retained as history, not as permission to restart or resume work. Any new scan,
assessment or repair requires a current bounded plan and fresh approval.

The user authorized a one-time attempt to collect and score up to twenty new
apartments per retained source, stopping with ten percent of the weekly allowance
remaining. Existing source pauses, five-page pass limits and rolling daily limits
still apply. No recurring scan or paid API fallback is authorized.

`scripts/credit-limited-scan.ts` records this run in the private data directory,
backs up SQLite before intake, and uses the regular app approval/worker route.
Across at most three passes it permits at most 180 pages, 240 candidate attempts,
1,800 image requests and 200 ChatGPT-plan review calls. Actual source allowances
can stop it much earlier. Failed, duplicate and unavailable candidates consume
attempts without satisfying the twenty-new-home target. Existing homes are skipped.

This is a supervised operation: the external account-usage tool supplies the
current weekly percentage to `tick`. It is not an autonomous account-usage API
integration. Never invent a reading or run an unattended loop with a fixed value.
Each checkpoint enables at most one further AI call. Gallery review waits for the
next checkpoint before sending another batch. Checkpoints older than ninety seconds,
invalid readings, and reported usage at or above 88 percent stop new work. The
two-point buffer protects the requested reserve from reporting delay and a request
already in flight; usage reporting is not a pre-call cost guarantee. A stopped
monitor does not authorize automatic resumption. Completed evidence remains saved.

The guard applies only to explicitly marked plans; ordinary offline tests and
unrelated plans are unchanged. Scheduled scans remain disabled.

The supervised run completed three intake passes plus bounded retained-photo
continuations. Source limits left overall coverage partial; private counts,
per-source outcomes, usage and the preservation audit are in the run's
`data/live/credit-limited-scan-2026-11-15/report.json`.

Live review exposed an HTTP 400 in text-only attribution. Its input now uses the
same message-array format as successful ChatGPT-plan photo calls. The corrected
request succeeded in the retained-photo continuation without re-downloading images.
Smaller six-photo continuation batches also completed reviews previously stopped
by the response-size bound. That bound was preserved. Twenty-three focused offline
tests and TypeScript checking passed; older apartment records remained unchanged.

## Subsequent twenty-per-source attempt

The user explicitly approved another attempt after the limit audit. It is tracked
separately by `scripts/twenty-per-source.ts` under
`data/live/twenty-per-source-2026-11-15/`, with its own pre-scan backup and baseline.
The target is twenty newly identified apartments per source; floor-plan offers
are recorded as skipped offers and do not satisfy the apartment target.

New approved plans explicitly name `trafficPolicy: session`. Fair shares now derive
from the approved totals, without the old five-page/15-page-per-day/100-photo-per-day
ceilings. Normal browser subresources are counted separately and cannot exhaust a
500-request listing allowance. Navigation and media pacing, actual access pauses,
full-gallery accounting, source isolation and cancellation remain enforced.
Older saved approvals without this policy retain their original limits.

This authorization permits up to 960 pages, 720 candidate attempts, 12,000 photo
downloads and 2,000 ChatGPT-plan calls in aggregate. These are
outer session bounds; the target and credit monitor stop work sooner. There is no
paid API fallback. Reported weekly usage at or above 88% stops further work, and
every additional AI request still requires a fresh external usage checkpoint.
Normal photo-review batches now contain at most six images to avoid the response
size failures seen in the previous run. Unchanged assessments remain reusable.

The implementation passed 245 offline tests, TypeScript checking and the production
build before launch. Pending feedback was reconciled against saved evidence before
the scan baseline; this did not authorize refreshing old photos or user decisions.

Live continuations exposed a response-stream accounting problem: the former 2 MB
bound counted repeated streaming metadata as if it were generated output. The
reader now separately bounds output at 2 MB, one stream event at 8 MB and total
transport at 20 MB, and still requires a completed terminal response. Successful
VADA and Zillow photo continuations verified the corrected reader.

The next continuation cycles up to five new apartments per source while preserving
the cumulative twenty-per-source target and aggregate allowances. Explicit resume
IDs restrict pending gallery work to new homes from this attempt. Account usage is
read afresh for every checkpoint; a stale monitor stops work safely and is reported
separately from exhausted credits or inaccessible inventory.

Same-source galleries retain distinct source URLs even when their image bytes are
identical. Hash-based assessment reuse remains available; gallery entries are not
dropped, which previously made a captured 40-entry gallery shrink to 33 records.
The complete 250-test offline suite and TypeScript checking pass with this repair.

Later live evidence showed that Zumper's first search page contained only building
ads. One building's floor plans consumed the initial candidate slice despite never
being eligible for this unit-only target. Unit-only runs now skip building routes
and continue search pagination. Excluded floor-plan offers remain charged to the
720 aggregate attempts, but do not consume the sixty-per-source allowance for
actual unit candidates. The aggregate page, request, photo, AI and credit bounds
are unchanged. Discovery exclusions are retained separately in run metadata.

An empty successful image response is recorded as an explicit inaccessible photo,
so remaining images and apartments can continue; HTTP access warnings still pause
the source. Timed-out photo reviews retain completed batches and may retry up to
twice with smaller batches within the same approved allowance. Every retry counts
as an AI call and requires a fresh credit checkpoint. HTTP failures and quota
errors are not retried. A later continuation retains the reduced batch size;
no images are silently skipped.

Continuation bookkeeping distinguishes a scheduled gallery resume from an actual
attempt. Stopping a phase before it reaches a source cannot mark that source's
pending homes as already retried. Actual progress markers, including legacy saved
gallery markers tied to the appropriate plan, determine whether a media retry ran.

A saved Craigslist candidate explicitly offered a private bedroom in an owner-shared
condo. It remains in the audit but is excluded from whole-apartment totals and the
remaining target is recalculated accordingly. New-only intake rejects explicit room
offers before photos; shared building amenities or roommate-friendly whole apartments
do not trigger that exclusion. Scores explain the shared-accommodation rejection.

This attempt is finished. Each source either reached its target or exhausted the
new eligible inventory in its configured search. The four smaller inventories were
checked once more at the end, within the original session and credit allowances.
The private `data/live/twenty-per-source-2026-11-15/report.json` records the final
source counts, incomplete galleries, usage, exclusions and preservation audit.
The fixes passed 259 offline tests, TypeScript checking and the production build.
