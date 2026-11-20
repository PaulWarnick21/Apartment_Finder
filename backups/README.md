# Shortlist recovery

`shortlist.json` is the latest lightweight backup. This repository is public; the owner
authorized publishing this file, including apartment choices, notes and personal ratings,
on November 20, 2026. Credentials, private criteria, full descriptions and photos are omitted.

Download this file or clone this repository and give the JSON to another tool, including
Claude. Ask it to rebuild a shortlist using the apartment IDs, stages, URLs, score snapshots,
notes and basic facts. Cross-post URLs and alias IDs refer to the same saved home.
`assessmentStatus` identifies unfinished assessments; a score is not proof of completion.
Listing websites may remove their pages. This file preserves the saved metadata but cannot
recreate expired photos/descriptions. It is not a complete database restore or automatic import.

Coverage: current Interested, Serious Candidates, Ready to Apply, In Progress, Inquiry Sent,
Viewing Booked, Applied, Leased and Closed. Scoring in Progress uses underlying Interested
and is included. Unreviewed and Not Interested are excluded. Use Git history to retrieve
earlier snapshots, including homes subsequently rejected or merged.

After `npm ci` (Node 24), the prepare script installs the versioned `.githooks` locally.
For an existing dependency installation, run `npm run setup:hooks` once. Each normal commit
refreshes and stages this file from the local live database, without source or AI requests.
Pre-push checks each outgoing ref against the live shortlist and blocks stale/missing backups.
If apartments changed after the commit, make another commit (an empty commit is sufficient
to trigger refresh) and retry the push. Do not bypass hooks with `--no-verify`.

The live database and dependencies must be present for these safeguards. On a recovery-only
clone, read the JSON first and restore/rebuild local data before committing; missing data
fails safely instead of overwriting the backup. Hooks are local and can be bypassed by Git
options or GitHub web edits; they are not server-enforced. GitHub receives updates only when
a push succeeds, not on each desk click. `AF_NODE` can select an explicit Node 24 executable.
