# Desk recovery

`desk.json.gz` is the compact desk snapshot authorized for this public repository on
November 26, 2026. It includes saved apartment records, history, decisions, notes,
ratings and detailed search/scoring preferences. It omits images, credentials, browser
sessions and raw source captures. After `npm ci` in a fresh clone, run
`npx tsx scripts/portable-desk.ts --restore` before starting the app. Both schedules
stay off. Review the [restart instructions](../README.md#restart-on-a-new-computer).

## Plain JSON shortlist

`shortlist.json` is the lightweight recovery index. The owner
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

## Git hooks

After `npm ci` (Node 24), the prepare script installs the versioned `.githooks` locally.
For an existing dependency installation, run `npm run setup:hooks` once. Each normal commit
refreshes and stages the JSON shortlist from the local live database without source or AI
requests. Pre-push checks each outgoing ref against the live shortlist and blocks stale copies.
Refresh the compressed desk separately at migration checkpoints to limit repository growth.
Run `npx tsx scripts/portable-desk.ts --export` to refresh it from the live database and
review the result before staging it. `npx tsx scripts/portable-desk.ts --verify` checks the
published format. Both commands run locally.
If apartments changed after the commit, make another commit (an empty commit is sufficient
to trigger refresh) and retry the push. Do not bypass hooks with `--no-verify`.

Restore the desk before committing from a new clone. A missing database or an empty desk
with an existing saved shortlist blocks the commit to protect the backups. The hooks
run locally. GitHub receives each update after a successful push. `AF_NODE` can select
an explicit Node 24 executable.
