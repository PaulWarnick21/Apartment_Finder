# Design (proposal, awaiting approval)

How Apartment Finder meets [requirements.md](requirements.md). Nothing is built yet. Decisions you
still have to make are listed under **Open decisions** at the end.

This version reflects two inputs: the source research in [listing-sources.md](listing-sources.md),
and an independent review of the first draft from five angles (Vancouver renting and BC tenancy
law, data engineering, LLM scoring, product design, and reliability, compliance and cost).

## What changed after the research

1. **The sites' own alert emails replace scanning.** Every major listing site forbids automated
   scanning, and most actively block it. The sites will email new matches to a saved search, and
   working from your own email is much lower risk, though a couple of sites' terms still reach it
   (see [listing-sources.md](listing-sources.md)). So the main intake becomes: alerts arrive in a
   dedicated inbox, and Apartment Finder parses, de-duplicates, scores and files them. Alerts only
   cover listings posted after you set them up, so listings already on the market on day one need
   a one-time manual sweep.
2. **Automatic scores start from thinner data.** An alert email is expected to carry the title,
   rent, beds, area or address, sometimes a photo, and a link. That gets confirmed against real
   emails in the first week. Most sites' terms don't allow the tool to open the link. Automatic scores
   therefore lean on price, location and building research, and the photo-based checks (above all
   the view) happen when you add photos or screenshots of a listing you like. Unknowns widen the
   score range rather than dropping the listing, as R4 asks. In practice **the score will drop few
   listings at first**: with the view unknown, most listings could still turn out well. The hard
   rules in the prefilter (budget, area, unit type, dates) do most of the filtering, and the desk
   will hold more "Uncertain" cards than it would with full listing data.
3. **Scam and tenancy-law warnings are their own channel.** A scam listing is designed to look
   like a 5.0 (great view, low price), so red flags never feed into the score. They show as
   warnings and change how notifications are worded.
4. **De-duplication is stricter about "certain".** Buildings reuse the same marketing photos for
   many units, and scammers reuse real listings' photos at a lower price. Matching photos alone can
   therefore only make a "possible duplicate", never a silent merge. Alert emails rarely include
   unit numbers (REW is the exception), so **the same apartment will often appear twice at first**,
   as two cards linked by a "Possible duplicate" badge, until you tap Same place or Different. This
   falls short of R3's "never twice" on purpose: the alternative is risking a hidden listing.
5. **Your edits and the pipeline's edits are stored separately**, so a scan running while you
   move a card on your phone can never overwrite your change.
6. **Not Interested stays final, as R5 says.** Bringing a passed-on home back when its price drops
   is offered only as an option (open decision 7).

## Browser scanning (considered 2026-11-11)

The idea: Claude opens the listing sites in a browser, filters, scrolls and opens listings, and
collects the description, address and photos itself, the way ChatGPT's agent browsed Facebook for
you.

- **Technically it works.** Research found that a real browser on your home connection, at a
  human pace, is what these sites let through, and listing pages carry the description, address
  and photo links as data, so screenshots aren't even needed.
- **Claude isn't allowed to do it on sites whose terms forbid automated access.** Anthropic's
  Usage Policy (effective 2026-11-12) prohibits using Claude, agents included, to circumvent the
  terms of other platforms, and makes users responsible for what their agents do in a browser.
  You accepting the sites' risk doesn't change that. Every major listing site's terms forbid
  automated access, so Claude doesn't browse them, whether scheduled or on request.
- **Where it is allowed, it's used**: sites whose terms permit automated access, and official
  connectors such as Zillow's (section 2).
- **The consequence**: for listings from the big sites, the description and window photos come
  from you through the **Add details** step, and only for listings worth it.

## 1. Overview

```
 site alert emails ──┐
 pasted listings ────┼──► pipeline (Node) ──► prefilter ──► de-dup ──► score ──► red flags ──► Sorting Desk
 permitted sites ────┘      local SQLite        (rules)                (Claude)   (rules +      (Claude Artifact)
                                 ▲                                                Claude)            │
                                 └────────── your stage moves, notes, reasons, pasted listings ◄────┘
```

- **Code** does the mechanical work: reading email, parsing, storing, filtering, matching
  duplicates, combining ratings into a score, and checking rules. It is repeatable and testable.
- **Claude** does the judgment: reading a listing, rating it against each criterion, researching a
  building, writing pros and cons.
- **The Sorting Desk** is a private Claude Artifact with its own database. It is where you work,
  on desktop or phone, and it is the record of your decisions.

## 2. Getting listings in

### Zillow connector (main automatic source)

Tested 2026-11-11. Zillow's official Claude connector searches Vancouver, BC rentals: about 490
listed in the City of Vancouver at the time, about 30 new in a day, plus North Vancouver, Burnaby
and Port Moody.

- **What each result has**: the address (often with the unit number, so the floor), coordinates,
  rent, beds, baths, size, home type, a building name for some, an air-conditioning flag, and the
  Zillow link. Purpose-built buildings come back as one "building" result with a rent range and a
  unit count.
- **What it doesn't have**: photos, the description and the posting date. Its details tool only
  covers off-market homes. You see the photos by opening the Zillow link.
- **New listings only**: each run asks for listings posted in the last 1 to 2 days, and the
  pipeline remembers the Zillow IDs it has seen. The first run sweeps the current inventory in
  slices (by bedrooms and price), because one search shows at most 100 results.
- **Signals without the description**: the connector can filter by Zillow's view tags (water,
  mountain, city, park), by a search of the description ("ocean view", "mountain view"), and by
  amenities (in-suite laundry, air conditioning, parking, pets, furnished, short-term). Running the
  same search once per filter and noting which listings match tags each listing with those
  signals, which gives the scorer view evidence for many listings without the text.
- **Areas**: neighbourhood names didn't narrow the search in testing, so the pipeline filters by
  coordinates against your area tiers instead.
- **Saving results**: a hook saves each connector response to disk, so the data reaches the
  pipeline without Claude retyping it. This needs confirming in the unattended test.
- **Fair housing**: searches use only objective criteria (location, price, size, amenities,
  views), as Zillow's connector requires.

### Alert emails (other sites)

- You create a dedicated Gmail account and point each site's saved-search alerts at it
  (see [listing-sources.md](listing-sources.md)).
- Each run reads new emails read-only over IMAP, including the spam folder in case an alert gets
  misfiled. Every email is processed once, keyed by its Message-ID.
- A small parser per site pulls out {site, listing ID, link, title, rent, beds, area or address,
  image}. Anything it can't find becomes "unknown", never a reason to drop the listing. When a site
  changes its email layout, the result degrades to "title + link" instead of nothing.
- What the emails contain is publicly documented only for Zillow: one photo, rent, beds, baths,
  size, address and a link, with no description. For the other sites it's unknown until the
  first week of real alerts. Expect enough to identify a listing and apply the hard rules, often
  with one photo, but rarely enough to judge the view.
- The tool never follows listing links automatically, except for sources whose terms allow it.
- Parser health: if fewer than about 80% of a source's items yield a rent, the source is marked
  "degraded", and its items are held rather than flooding the desk with junk.
- Price changes are only seen when a site re-sends a listing in an alert or you paste it again,
  since the tool doesn't revisit listing pages.

### Starting inventory

Alerts only cover listings posted after the saved search exists. Listings already on the market
when you set up the alerts need a one-time sweep: browse each site once and paste anything
promising into the desk.

### Adding details yourself (any site, including Facebook Marketplace)

This is the photo step. Claude may not open most listing sites itself (see "Browser scanning"
above), so the description and window photos come from you, only for listings worth the minute.

- Every card has an **Add details** button, and the desk has an **Add listing** box for listings
  found elsewhere. Paste the link and the listing text, and drop in a few screenshots of the
  photos, the window views especially. On a phone: copy the text, take 3 or 4 screenshots, and
  pick them in the desk. About a minute per listing.
- It is scored on the next run, or straight away if you ask in a Claude session
  ("score my inbox").
- Listings from Rentals.ca, RentFaster or Realtor.ca are kept as **tracked only**: they get a card
  and a stage, but no Claude score, because those sites' terms forbid using AI on their listings.

### Direct sources and connectors (only where allowed)

- A browser agent may visit only sites whose terms allow automated access: currently just VADA
  Property Management, pending a final check. Other property managers' sites can be checked one by
  one and added.
- Official connectors are allowed: Zillow's is the main automatic source (see above).
- Every source has an entry in a reviewed policy table: access mode (alert email, direct, manual),
  terms URL and review date, robots.txt rules, maximum request rate, and any handling limits
  (for example Hollyburn: keep only the link and basic facts, no photos or text; Rentals.ca:
  tracked only).
- A block (403, 429, CAPTCHA or challenge page, login redirect) means **stop**. The adapter is
  switched off until you re-enable it. No retries, no changing identity, ever. The tool always
  identifies itself honestly.

## 3. What one run does

Every step is resumable and safe to repeat. A run lock means a catch-up run that starts while
another is still going simply exits.

1. **Pull your changes** from the desk: stage moves, notes, reasons, duplicate answers, pasted listings.
2. **Ingest** new alert emails, queued pasted listings, and permitted direct sources.
3. **Normalize** into one listing record. Beyond the basics (rent, beds, baths, size, address,
   unit, photos, description) it also records the available date, lease term, whole unit vs room,
   whether a kitchen or bath is shared with the owner, deposits and fees, incentives (e.g. one month
   free), parking and utility costs, building name, facing direction and floor.
4. **Prefilter** (no AI cost). Drop only definite violations of hard rules: rent definitely over
   the cap, definitely outside your areas, a room or shared unit, short-term or furnished-seasonal,
   available definitely outside your move-in window. Unknowns pass through. Rejected items are kept
   for 60 days, so a later price cut lets them back in.
5. **De-duplicate** (section 4).
6. **Research the building**, cached per building for about 6 months (section 5).
7. **Score** (section 5).
8. **Check red flags** (section 6).
9. **Publish** new and changed homes to the desk.
10. **Check liveness**, only for sources the tool may fetch. Others show "first seen N days ago".
11. **Write the heartbeat, then notify** if there is something worth knowing (section 8).

## 4. De-duplication

The canonical identity of a posting is (site, listing ID), extracted from its link. A "home" is
the apartment itself, which may have several postings.

| Outcome | Rule | What you see |
| --- | --- | --- |
| Same posting | Same site and listing ID | Nothing new; the existing home is updated (e.g. a price change, if an alert repeats it). |
| Certain duplicate | Same building address and same unit number, with matching beds and rent within ~2% | Merged: one card, every source link listed. |
| Possible duplicate | Matching distinctive photos; same building with no unit number; very similar description; same specs nearby | A separate card with a "Possible duplicate of …" badge (showing the other home's date, rent and thumbnail) and **Same place / Different** buttons. Your answer is remembered. |
| Copied listing | Photos or text match, but rent is much lower (~10-15%+), or the contact or address differs | Never merged. The newer or cheaper one gets a "Possible scam copy" red flag. |
| Same building | Same building, different unit | A "Same building as …" link, not a duplicate. |

Photo matching only counts **distinctive** photos. Shots that turn up across many listings (a
building's lobby, gym, rooftop, exterior or model suite), floor plans and near-blank images are
learned and ignored. Otherwise two units on different floors of one tower, with very different
views, would be merged.

**Homes you passed on.** As R5 asks, a home you marked Not Interested is never shown again when a
new posting is clearly the same unit (same listing, or same address and unit). A posting that only
*might* be the same home is shown with "Looks like one you passed on (date, old price)", because
R3 says to show it when unsure. The desk header shows "N reposts hidden" with a list, so nothing
disappears without a trace, and you can always reopen a closed card yourself.

**Proposed, off unless you want it (decision 7):** bring a passed-on home back when the fact
behind your decision changes. For example, you passed for price and the rent dropped by $100 or
more, or you passed on the date and the available date moved.

A merge is recorded on the pipeline's side. The desk shows the merged card with the most advanced
stage and all notes and links, and a **Split** button undoes it.

## 5. Scoring

### Hard gates first, in code

Rent cap, areas, whole unit, long-term, move-in window and your must-haves are rules, not
judgments, so the prefilter applies them. When an alert email doesn't say (pets allowed? in-suite
laundry?), a must-have passes as unknown and appears on the card as a question to ask. Location
and price ratings are also computed in code: location from your area tiers, and price from a curve
over the effective monthly cost (rent plus mandatory parking or utilities, minus incentives).

### Claude rates each criterion; code does the arithmetic

For each remaining criterion (view, light and condition, layout and size, building, surroundings,
plus anything in your full criteria list), Claude returns:

- a rating of 0 to 5 (0 means it fails that criterion completely), or "unknown"
- a plausible range for that rating (e.g. view unknown on the 23rd floor of a Coal Harbour tower: 2 to 5)
- what the rating rests on: verified in a photo, stated in the listing, inferred from research, or nothing
- one sentence of evidence

Code combines the ratings with your weights into the score: the weighted average, kept within 0.1
to 5.0. For an unknown rating, the headline score uses the middle of its range, and `score_low`
and `score_high` use its low and high ends. Doing the arithmetic in code keeps scores consistent
from listing to listing and day to day, and makes them explainable. Changing a weight re-ranks the
whole desk at the next run with no AI cost (weights live in your private config). Example weights
to start from (yours to set): view 30%, location 20%, unit 20%, value 10%, building 10%,
surroundings 10%. Location tiers only affect the location rating, so a stunning view in a
lower-tier area can still clear 3.0.

### Drop rule

- Dropped only if the code-computed `score_high` is below 3.0: unsuitable even in the best case.
  Dropped homes go to a hidden **Auto-rejected** bin.
- Otherwise the home goes to the desk. If the score is below 3.0, or a heavily weighted criterion
  (such as the view) is unknown, the card is badged **Uncertain**, with the unknowns written as
  questions to ask the landlord.
- If scoring fails (bad output, refusal, timeout), the home is shown as **Unscored**, never dropped.

### The view, specifically

The view carries the most weight and is the easiest to get wrong, so it has strict rules:

- 5: water and/or the North Shore mountains fill most of the main window, in a photo taken from
  inside the unit. 4: a clear but partial view, photo-verified. 3: a sliver or peek in photos, or a
  claim made plausible by floor and location. 2: city or tower view. 1: a wall, lane or courtyard,
  or at grade.
- A claim in the listing alone (the description, or Zillow's water or mountain view tag) can never
  rate above 3. A 4 or 5 needs a photo taken from the unit.
- Rooftop and amenity photos, aerial stock shots and photos of other units don't count as the
  unit's view.
- Vancouver priors to start from (to refine with you): north-facing Coal Harbour looks over
  Burrard Inlet to the mountains; upper floors facing west or south-west in the West End look over
  English Bay; a south-facing "water view" in Yaletown or False Creek North is False Creek, not open
  ocean, and has no mountains; north-facing units on the slopes south of False Creek look across at
  downtown with the mountains behind.

### Photos

All of a listing's photos (when available) go onto one numbered contact sheet, and a quick first
pass sorts them: view from the unit, rooms, amenity or rooftop, exterior or stock, floor plan.
The full pass then gets up to six of the useful ones, view and window shots first.

### Building research

A separate step, cached per building for about 6 months, given only the address and building name,
never your budget or criteria. It covers building age, condo vs purpose-built rental, known issues,
nearby noise sources (the Granville entertainment strip, SkyTrain lines, busy arterials) and nearby
construction. For City of Vancouver addresses it starts from the city's open data: the property tax
roll (year built, strata or not), rental-standards issues on record, and building permits nearby.

### Untrusted input

Listing text, emails and photos are written by strangers, and scam listings are hostile. Scoring
therefore runs with no tools at all: it can only read the listing and return ratings. Listing text
is passed as clearly marked data. Evidence quotes must actually appear in the listing, or the rating
becomes "unknown". The desk displays every listing string as plain text, so a listing can't inject
code into the page.

### Keeping scores honest over time

- Every score records the model, prompt version and rubric version. A change is tested before it is
  used, and only active cards are re-scored.
- **Golden set**: over the first two weeks you label 40 to 60 real listings (keep or drop, plus
  view and overall ratings; one to two hours in total). Every later change to the prompt, weights or
  model must not drop any of your keepers.
- **Calibration**: your Not Interested reasons map to criteria. Once there are enough decisions, the
  tool proposes weight changes. They are never applied without your OK.
- **Auditing the bin**: near-misses (closest to 3.0) are listed first in the Auto-rejected bin, with
  a **Rescue** button, and every week a couple of random rejects are surfaced as "audit" cards, so a
  scoring blind spot gets noticed.

## 6. Scam and tenancy-law red flags

Kept separate from the score. Each home gets a risk level: none, caution or likely scam. A likely
scam goes to a visible **Suspected scam** group showing the evidence. It is never hidden in the
Auto-rejected bin, and never announced as "best new listing".

Checks done in code, from the extracted fields and text:

- **Price anomaly**: rent far below the median of comparable listings the tool has seen
  (same area tier and bedroom count).
- **Copied listing**: photos or text matching another listing at a different price, contact or address.
- **Classic scam phrases**: deposit or e-transfer before viewing, no viewing possible, owner
  overseas, keys by mail or courier, WhatsApp or Telegram only, wire transfer, crypto or gift cards,
  requests for SIN or passport.
- **BC Residential Tenancy Act**: a security deposit over half a month's rent; a pet damage deposit
  over half a month's rent; any application or processing fee (not allowed in BC), or a
  non-refundable "holding" fee (a refundable holding deposit counts toward the security deposit
  cap); "first and last month's rent" up front; a fixed term that requires moving out at the end,
  unless the landlord is an individual who, or whose close family member, will move in (from a
  company landlord it is always a red flag); a kitchen or bathroom shared with the owner (not
  covered by the Act at all).

Claude adds softer signs it notices. Before you can mark a home **Leased**, a short checklist must
be ticked: viewed in person; landlord or licensed property manager confirmed; written tenancy
agreement read; deposits within the legal limits; no fees; payment by a traceable method.

## 7. Sorting Desk

### Stages

```
Unreviewed ─► Interested ─► Inquiry Sent ─► Viewing Booked ─► Applied ─► Leased
      └─────────────┴─────────────┴───────────────┴──────────────┴──► Closed: Not Interested
                                                                       · Gone (rented or removed)
                                                                       · Landlord declined
                                                                       · No reply
                                                                       · Leased elsewhere
                                                                       · Withdrew

Auto-rejected: hidden bin set by the scorer, with Rescue (moves the home to Unreviewed)
```

- Your three stages and **Not Interested** are kept as you named them. Proposed additions:
  **Viewing Booked**, **Applied** and **Leased** (the goal), plus a few other ways a home can be
  closed. Not Interested stays the main one.
- Skipping ahead is allowed (straight to Viewing Booked for an open house), and so is going back
  one step (a cancelled viewing). Every closed card can be reopened.
- "Uncertain", "Possible duplicate", "Suspected scam", "Gone?", "Price drop" and "Follow-up due" are
  badges, not stages, so a card can be in Inquiry Sent and be "Gone?" at the same time. "Gone?" is
  only raised on positive evidence (the listing was removed or says rented), never because a site
  blocked a request, and the card closes only when you confirm.
- There is no "Viewed" stage. After a viewing's time passes, the card asks "How was it?" with
  Apply / Not interested / Still thinking.

### Layout (phone first)

- A **Today** strip at the top: new since your last visit, follow-ups due, viewings in the next 48
  hours, and anything waiting on a decision (possible duplicates, "Gone?" checks, price-drop returns).
- Four tabs with counts: **Inbox** (Unreviewed plus the needs-a-decision items), **Shortlist**
  (Interested), **In progress** (Inquiry Sent, Viewing Booked, Applied, sorted by next action),
  **Closed** (filter by reason). On a wide screen the stages can show side by side. No drag and
  drop; stage changes are buttons.
- **Short card**: one thumbnail (the photo the view rating rests on, when there is one), the score
  with its range when uncertain, effective monthly cost, beds and baths, neighbourhood, available
  date, a view chip (Mountain ✓ / Ocean ? / None), how long ago it was first seen, badges, a
  one-line summary, and two large buttons: **Interested** and **Not interested**.
- **Expanded card**: more thumbnails, 3 to 5 pros and cons, unknowns written as questions, red
  flags with their evidence, the per-criterion ratings, links to every source, an "Open in Maps"
  link, your notes, and the stage history with dates.

### Actions

- **Not interested** is one tap, with a few seconds to undo and optional reason chips (price, view,
  location, size or layout, building, available date, lease terms, looks like a scam, other).
  Reasons drive the price-drop resurfacing and the calibration.
- **Draft inquiry** asks Claude (from inside the page) for a ready-to-send message that asks your
  open questions (which way it faces, which floor, parking cost, pets, available date, lease terms)
  and always "Can I view in person before any payment?". It never includes personal ID details and
  is **never sent automatically**. You copy it, or tap a prefilled email or text link.
- **Mark sent** records the channel and sets a follow-up reminder for 2 days later. After two
  unanswered nudges it suggests closing as No reply (reopenable).
- **Viewing Booked** takes a date and time and offers an "Add to calendar" file for your phone, plus
  a "check at the viewing" list built from the card's unknowns and red flags (is the view from the
  unit itself, noise at night, cooling, laundry, cell signal, smells or pests).
- **Compare**: tick 2 or 3 shortlisted homes to see effective cost, view, area, size, dates,
  unknowns and red flags side by side.
- **Notes**: a timestamped log per home, with one pinned line shown on the short card.
- **Leased** offers to close every other open card as "Leased elsewhere", draft withdrawal notes for
  open inquiries, and pause the scans.

### Header

"Last scan 07:02 (5 h ago)", amber when a scan is overdue and red after a day, with each source's
status underneath. The page computes this itself, so even if no scan has run at all (the PC was
asleep), you can see it on your phone.

### Thumbnails

Listing sites' photos can't be embedded in an artifact, so a few small thumbnails (about 400 px
wide) are uploaded to the artifact's private asset store, only for homes that reach the desk. Their
sources: the image in a site's own alert email, and screenshots you add. Never images fetched from a
site that forbids it, and none for sources whose terms bar storing their content (such as
Hollyburn). Without a thumbnail the card shows the summary, pros, cons and link, as agreed.

### Data in the artifact

| Collection | Written by | Holds |
| --- | --- | --- |
| `homes` | the pipeline only | Listing facts, score and ratings, pros, cons, unknowns, red flags, source links, thumbnail references, and states the pipeline sets (Auto-rejected, Unscored, Tracked only, merged into another home) |
| `decisions` | the page only | Stage, reasons, notes, stage history, answers to unknowns, follow-up and viewing dates |
| `inbox` | the page only | Pasted links, text and screenshots waiting to be scored |
| `feedback` | the page only | Your Same place / Different answers |
| `meta` | the pipeline only | Heartbeat: last run, per-source status |

Because each document has one writer, a scan can never overwrite something you just did on your
phone. Your stages live only in `decisions`; the page combines them with the pipeline's states in
`homes` when it draws a card (a rescued Auto-rejected home, for instance, is simply one you gave a
stage). The pipeline writes through prepared JSON files, so listing text isn't re-typed by Claude
on the way.

## 8. Running it

- **Schedule**: a Claude Code desktop scheduled task, about 3 times a day (for example 07:00, 12:30
  and 18:30), with quiet hours. That keeps the desk fresh enough to act on a listing the same day.
  Being first on a hot listing is a job for the sites' own phone alerts, which you can keep on for
  your top one or two sites.
- **Limits of scheduled tasks**: they run only while the desktop app is open and the computer is
  awake. A missed run catches up once when the app next opens. Your alert inbox keeps collecting in
  the meantime, so nothing is lost, only delayed. "Keep computer awake" helps on a desktop; a
  closed laptop lid still stops runs.
- **Unattended test before relying on it**: a scheduled run must be able to write the desk's
  database, upload thumbnails and send a notification without anyone clicking "allow". This gets
  tested first. If something can't be pre-approved, the run prepares everything and notifies you,
  and the publish step happens the next time you open a Claude session.
- **Narrow permissions**: the scheduled run is allowed only what it needs (running the pipeline,
  writing the desk, notifying), and reading `.env` is explicitly denied.
- **Notifications**: sent at the end of a scan, not in real time, and only when something deserves
  attention: a new home scoring 3.5 or more (flagged as a priority at 4.0 or more), a follow-up or
  viewing due, a source blocked or broken. Never on an empty run. The risk level is part of the
  text, for example "2 new · best 4.4 (2 bed, view confirmed) · 1 follow-up due".

## 9. Tech stack (proposed)

**TypeScript on Node 24**, which is already installed (Python is not).

| Need | Choice |
| --- | --- |
| Database | SQLite through Node's built-in `node:sqlite` |
| Email | `imapflow` (read-only IMAP) and `postal-mime` |
| Parsing alert emails | `cheerio` |
| Validation (Claude output, desk data) | `zod` |
| Thumbnails, photo fingerprints | `sharp` |
| Geocoding | BC Address Geocoder (free, no key needed at this volume); results cached per address |
| Claude | `@anthropic-ai/sdk` if scoring goes through the API (decision 2) |
| Tests | `node:test`, with saved sample alert emails as fixtures |

One language end to end: the Sorting Desk page is JavaScript too, so the data shapes are shared.

## 10. Cost

With the Claude API and Claude Opus 5.5, rough estimates:

| Item | Estimate |
| --- | --- |
| Automatic score from an alert email | about $0.03 to $0.05 per listing |
| Full score with photos | about $0.12 per listing |
| Building research | about $0.05 to $0.10 per new building, cached for months |

At 20 to 30 new unique listings a day, that is roughly $30 to $60 a month, falling as the building
cache fills. A spend limit on the API key caps it. Using your Claude subscription instead costs
nothing extra but uses your plan's limits (decision 2).

## 11. Data, privacy and retention

- Personal criteria live in `private/` and secrets in `.env`, both gitignored. The database,
  emails, photos and raw data live in `data/`, also gitignored.
- Landlord names, phone numbers and emails are not stored as fields and are removed from stored
  descriptions. What's kept is a one-way fingerprint of the contact details (enough to tell
  whether two listings share a contact, which is how copied scam listings get spotted) and the
  contact channel type ("WhatsApp only" is itself a scam signal). The card links to the listing.
- Retention: raw emails and pages 7 days; thumbnails deleted 14 days after a card is closed; closed
  homes removed from the artifact after 60 days; fingerprints (IDs, address and unit, photo hashes)
  kept for the whole search so passed-on listings are recognised. A full purge is offered when you
  sign a lease.
- The desk stays private. Sharing it with anyone outside your household would change the privacy
  picture.

## 12. Phased plan

| Phase | When | What you get |
| --- | --- | --- |
| 0. Setup | You, about an hour | Answers to the open decisions; the alerts mailbox and saved searches; the full criteria list |
| 1. Desk, scoring and Zillow | Days 1-3 | Repo skeleton, private criteria config, Zillow connector intake (run on request), prefilter, scoring with red flags, building research, Sorting Desk v1 with Add details. Real Zillow listings on the desk from the start |
| 2. Automatic intake | Days 3-7 | Scheduled runs after the unattended test, alert-email ingestion for the other sites (parsers built from your first real alerts), de-duplication across sources, heartbeat and header, notifications |
| 3. Quality | Week 2 | Duplicate and scam-copy detection with photos, thumbnails, price-drop returns, follow-ups, viewing calendar files, Draft inquiry, Compare, golden set and calibration |
| 4. Only if gaps remain | Later | Permitted direct sources (VADA), liveness checks |

## 13. Open decisions

1. **How to treat the sites.** Settled on 2026-11-11. You accept breaking the sites' terms, but
   Anthropic's Usage Policy doesn't allow Claude to, so intake is alert emails, the details you
   add, official connectors, and sites whose terms allow automated access (see "Browser scanning").
2. **Scoring engine.** Recommended: the Claude API with its own key and a spend limit (section 10).
   It is consistent and testable, it runs with no tools (safer against hostile listing text), and it
   doesn't use up your Claude plan. Alternative: your Claude subscription, scoring inside Claude Code
   with a read-only scorer, at no extra cost but harder to test and sharing your plan's limits.
3. **Stack.** Recommended: TypeScript on the Node 24 you already have. Python would need installing.
4. **Alert inbox.** Recommended: a dedicated Gmail account read over IMAP with an app password,
   which can't reach your personal mail (app passwords need 2-Step Verification turned on for that
   account). Alternative: connect the Gmail connector to that account.
5. **Scan times.** Recommended: about 3 a day with quiet hours. Alternative: mornings only.
6. **Thumbnails.** Recommended: only from alert-email images and your own screenshots. Alternative:
   no thumbnails at all.
7. **Passed-on homes.** Default: Not Interested is final, as R5 says. Option: bring a home back
   when the fact behind your decision changes, for example the rent drops by $100 or more after
   you passed on price.

## 14. Questions for the full criteria list

- Your move-in window (earliest and latest), and how firm it is.
- Is your budget for rent only, or including parking, utilities and internet? Would a listing a
  little over budget with a free month count?
- Pets, parking, EV charging, bike storage?
- What counts as a view: is a False Creek water view "ocean"? Mountains or ocean, which matters
  more? Is a partial view worth something? Do city lights count?
- Must-haves vs nice-to-haves: in-suite laundry, AC or heat pump, dishwasher, balcony, minimum
  bedrooms or size, furnished or not, lease length.
- Purpose-built rental (stable, professionally managed) vs privately owned condo (often nicer, but
  the owner can sell or move in)?
- Noise tolerance (nightlife, stadium nights, seaplanes, construction) and where you commute to.
- Do you want a "Not this building" option that hides every unit in a building?
- Is the PC a desktop that stays on, or a laptop that sleeps? Will anyone else look at the desk?
