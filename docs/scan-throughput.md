# Scan throughput and the next benchmark

## Approved overnight continuation — November 18–19, 2026

The evening check-in found repeated Windows file-open errors while rewriting an already
saved, hash-valid photo. Photo storage now verifies and reuses identical existing bytes;
new files are published atomically using a temporary file and a no-overwrite hard link.
Concurrent writers cannot truncate media being served or decoded. A content mismatch
remains an explicit integrity error. The repair uses no extra source requests or budget
renewal and is loaded by subsequent workers; current source backoffs remain in force.

The user authorized source checks/repairs followed by continuous fast quick intake until
03:00 America/Toronto on November 19 (08:00 UTC). The private supervisor started at 17:01
Toronto on November 18. One aggregate authorization allows at most 6,000 pages, 4,000
candidate attempts and 80,000 photo attempts, with zero AI/address calls. Every batch uses
adaptive pacing and the same absolute deadline; counters are summed across batches.
Current Downtown-only geography, user decisions, source warnings and disabled recurring
scans remain unchanged. VADA returned Vancouver listings and was retained.

Recovery isolates sources, waits five minutes after the first failure, fifteen after the
second, and an hour after further consecutive failures. Health cooldowns and attention flags
always take precedence. Gallery collection retains saved progress and can resume up to four
times per new home. Ten minutes without traffic progress cancels a stalled batch and waits
for worker cleanup. A known-closed child releases only its own locks; this does not itself
authorize another scan. Quiet inventory refreshes at thirty-minute intervals. User cancellation
ends the run. In-flight work can finish after cutoff, but no further budget reservations pass.

Runtime evidence is stored under `data/live/overnight-scan-2026-11-18/`, including the baseline
backup, atomic run summary, batch IDs, retries and logs. A temporary Windows keep-awake request
lasts only for the runner; no permanent power setting or recurring scan is enabled.

The November 18 user instruction authorizes implementation after the current one-hour
run, followed by a **separately approved** thirty-minute benchmark. It does not authorize
starting that benchmark or restarting daily scans. No request rate guarantees freedom
from website blocks; failed discovery and unknown pagination are coverage gaps.

The completed one-hour baseline admitted 91 new eligible homes, all with complete
saved galleries, using 186 page visits, 127 candidate attempts and 1,488 photo attempts.
It used no AI or address lookups. Apartments.com displayed an access warning; its
pause remains in force. The last part of the window waited on unresolved preferred-area
coverage rather than exhausting its traffic allowance. Private run artifacts retain
timestamps and apartment identities. These counts do not establish complete market coverage.

The approved thirty-minute benchmark finished at its deadline with 62 new eligible
homes with complete galleries (60 REW, two Zumper), plus one REW home whose gallery
remained incomplete. It used 113 pages, 74 candidate attempts and 1,159 photo attempts,
with zero AI calls and no recorded new access warnings. Existing source pauses remained.
The final worker save occurred after the supervisor's summary, so the incomplete home
is reported separately rather than changing the completed-gallery count.

Post-run inspection found an implementation rollout omission: the staged browser
transport had not been copied to the working app. Parallel photo collection and REW
pagination were active, but that transport did not record adaptive success and therefore
stayed at baseline pacing. This was corrected after the run, with regression tests that
first reproduced the missing success records and Retry-After handling, then passed with
the corrected transport. The benchmark is not full live validation of adaptive pacing;
any further scan still requires a new bounded approval.

## Implemented controls

- New quick session plans use adaptive pacing, with up to three sources and one shared
  Chrome navigation lane. Existing approvals without the new policy stay conservative.
- Pages begin ten seconds apart, reach 7.5 seconds after five successes, and five seconds
  after ten. Images begin one second apart, reach 0.75 seconds after twenty successes,
  and 0.5 seconds after forty. These are start gaps, not a guarantee of completed speed.
- Pacing history persists across batches/restarts. Thirty idle minutes resets warmup.
  A page taking over fifteen seconds or a photo over ten resets warmup and doubles the
  base gap for five minutes. Chrome gallery durations are not treated as page latency.
- At most two photo downloads per source overlap; every accessible gallery photo remains
  required. All started downloads settle before progress is saved, including on failure.
  Image attempts and retries consume the same approved photo/request allowances.
- One transport-only photo retry is allowed in adaptive mode. A second failure pauses
  the source for five minutes. HTTP errors/challenges are not transport retries.
- Real access warnings retain the minimum 24-hour cooldown, longer server instructions,
  and manual-attention flags. This change never clears an existing source pause.
- Chrome 0.5.0 receives jobs through authenticated localhost long polling rather than
  waiting for the next 30-second alarm during a run. Polls last at most twenty seconds;
  idle startup only polls localhost and cannot start source or model work.
- REW pagination accepts source-advertised `/page/N` links within the configured search.
  Other neighbourhoods, arbitrary descendants and new query overrides remain rejected.
- A persisted plan deadline rejects further budget reservations even if the benchmark
  supervisor fails. In-flight requests may finish; saved results remain durable.

## Proposed thirty-minute benchmark — not approved

Use all retained sources whose selected-area searches are supported and whose current
access state allows work. Report every excluded source and reason. Preserve the current
geographic mix and all existing stages, notes, grades and duplicate decisions.

One aggregate window: thirty minutes, at most 600 page visits, 400 candidate attempts,
8,000 photo attempts, zero AI calls and zero address lookups. Continue bounded batches
within that same allowance, without repeating failed discovery as proof of exhaustion.
Start the clock only when the approved run actually starts. Do not reuse an old approval.

Record distinct new eligible homes with saved photos, complete saved galleries, elapsed
wall time, per-source traffic and outcomes, access warnings, duplicates/exclusions and
remaining checked inventory. Existing homes and duplicate ads do not count as new results.
Report active collection rate separately from time waiting on unavailable geographic work.
This is a real-inventory comparison, not a controlled claim of a guaranteed speed multiplier.

Private preparation and execution artifacts live under `data/live/`; the benchmark launcher
requires an explicit approval argument. Preparing it makes no external requests.

Protocol references: [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
and [HTTP Retry-After semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).
