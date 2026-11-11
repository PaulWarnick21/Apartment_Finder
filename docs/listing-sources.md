# Listing sources

Which sites Apartment Finder should take Vancouver rental listings from, and how. Researched on
2026-11-10: each site's own terms of use, robots.txt and help pages were read, then a second,
independent pass tried to refute the findings. Listing counts are rough snapshots.

## Bottom line

- **None of the major listing sites allows automated scanning.** Every portal checked forbids bots,
  scrapers or automated collection in its terms. Zillow, Apartments.com, Rentals.ca, RentFaster,
  Realtor.ca and liv.rent also actively block non-browser requests, and Craigslist's search RSS
  feeds now return "blocked".
- **What does work: each site's own saved-search alerts.** You save searches on the sites, they
  email you new matches, and Apartment Finder reads those emails in a dedicated inbox. It uses only
  what is in the email and never follows the links automatically. The sites do the scanning, and
  "only new listings" comes built in. That is far lower risk than scanning, though not risk-free
  for every site (see the notes below).
- **Claude doesn't browse these sites, even though it technically could.** Research on
  2026-11-11 found that a browser agent on a home connection would mostly get through, but
  Anthropic's Usage Policy prohibits using Claude to circumvent other platforms' terms, so an agent
  only browses sites whose terms allow it. Zillow is the exception through its official Claude
  connector, which works for Vancouver and is the main automatic source.
- **A few sites are browse-it-yourself.** Facebook Marketplace forbids automated collection even
  when logged out, and most of it sits behind a login. Rentals.ca and RentFaster go further and
  forbid using "automated means, algorithms, AI" to research rentals on their sites. Anything you
  find there can be pasted into the Sorting Desk.

## Recommendation

| Site | Vancouver coverage (snapshot) | Automation allowed? | How Apartment Finder would use it | Verdict |
| --- | --- | --- | --- | --- |
| liv.rent | High: about 1,430 City of Vancouver listings; verified landlords | No | Your saved-search alerts | **Core** |
| Zumper | High: about 1,540 citywide, about 230 downtown | No | Your alerts, emailed as new listings match | **Core** |
| PadMapper | Same listings as Zumper (same company and backend) | No | Not needed: use Zumper | Skip |
| Craigslist Vancouver | High: 300+ City of Vancouver ads in budget, but many reposts, basement suites and scams | No: scripts may not even open listing pages | Your alerts; only the email's content is used | **Core**, with scam checks |
| REW.ca (MLS rentals) | Medium: 500+ in the City of Vancouver; realtor-listed condos with unit numbers, often view units | No | Your alerts (daily) | **Core** for view condos |
| Hollyburn Properties | 50+ buildings, many West End towers | Content may not be stored; robots.txt allows | Hollyburn's own new-listing alerts by neighbourhood and budget; the desk keeps only the link and basic facts (no photos or text) | **Include** |
| Kijiji | Medium-high: about 560 citywide, many bumped duplicates | No; RSS removed | Your alerts (daily only) | Optional |
| Zillow | About 490 City of Vancouver rentals, about 30 new a day (connector test, 2026-11-11); also North Vancouver, Burnaby, Port Moody | No for the site; yes through its official Claude connector | Zillow's Claude connector: automatic searches for new listings, with view and amenity tags | **Core** (main automatic source) |
| Apartments.com | Medium: about 1,700 citywide (Sep 2025), mostly managed buildings, overlaps | No; bot protection | Your alerts (contents unverified; test one first) | Optional |
| Facebook Marketplace and rental groups | Probably high (unverified); scams are common | No, even logged out; login wall | Manual: paste the link plus the text or screenshots | Manual |
| Rentals.ca | High: about 2,960 (Aug 2026), mostly purpose-built | No, and no AI use | Browse it yourself; the desk can track a listing, but Claude doesn't score it | Manual, no AI |
| RentFaster | Medium: about 640 (Nov 2025); same network as Rentals.ca | No, and no AI use | Browse it yourself | Manual, no AI |
| Realtor.ca | Unknown (blocked); the same MLS listings as REW | No; forbids "grounding" AI with its data | Not needed: REW covers the same listings | Skip |
| Realtylink.org | About 1,620 region-wide (MLS) | No merging or republishing | Only if REW's alert emails turn out thin; its terms forbid merging its data with other data | Backup |
| VADA Property Management | Coal Harbour, Yaletown and West End view condos (low volume) | No terms found; robots.txt allows listing pages | Later, if the alert sources leave gaps: a light direct check, after a final terms check | **Candidate for later** (the only direct source) |
| Senakw (Kits Point towers) | New rental towers by the Burrard Bridge | Unknown | Register for their leasing updates | Optional |
| CAPREIT (4 West End buildings) | Small | No (bans scraping) | Links on the desk; join waitlists | Manual |

Not worth it: Reddit housing subreddits (few listings), sites built on Yardi RentCafe (its terms ban
robots), and listing syndicators such as RentSync (their listings already reach Zumper and the
Rentals.ca network).

## Per-site notes

**liv.rent.** Vancouver-based with structured listings, 10 to 20 photos each, and a verification
program (landlord ID or business licence, proof of ownership) that cuts down on scams. Terms (7.1)
ban scraping, bots and automated processes. A "Create Alert" option exists on search results, and
account settings have email notifications for matches. Whether alerts go out by email or only as
push notifications, and what the emails contain, is still to be confirmed.

**Zumper / PadMapper.** One company and one listing backend, so use Zumper only. Strong downtown
coverage with good structured data. Terms (section 11) ban harvesting data and automated crawling.
Zumper's help centre (July 2025) says it emails you every time a new listing fits a saved search,
which makes it the fastest alert source.

**Craigslist.** Huge private-landlord volume, and the source with the most scams and reposts. The
terms ban robots, scripts and scrapers, and allow only Craigslist's app, ordinary web browsers and
email clients to interact with the site, so the tool must not even open listing pages from alert
links. Liquidated damages in the terms run to $3,000 a day. Saved-search alerts need an account;
how often they arrive and what they contain is unverified.

**REW.ca.** MLS rental listings posted by realtors: exact unit-number addresses, professional
photos, and many high-floor downtown and waterfront condos, which suit a view-focused search. Terms
ban scraping and robots, and also any activity meant to collect, store or reorganize data from its
pages. Reading your own alert emails is defensible for private, non-commercial use, but it is a
grey area. Alerts are daily.

**Hollyburn Properties.** The largest West End purpose-built landlord. It runs an official "get
alerts on new apartments" signup by city, neighbourhood and budget, the most clearly sanctioned
channel found. Its legal disclaimer allows personal viewing but bars storing content without consent,
so no copies of its pages or photos.

**Kijiji.** Many Vancouver listings, but heavily bumped and duplicated. Terms ban robots and
scrapers; RSS feeds have been removed. Web alerts arrive once a day. One archived help page suggests
some Kijiji notifications only give a count of new ads, so its usefulness depends on what the emails
actually contain.

**Zillow and Apartments.com.** Both ban automated access and use bot protection (PerimeterX and
Akamai). Their Vancouver inventory is mostly managed buildings that likely also appear on Zumper and
liv.rent. Zillow, however, has an official connector for Claude. Tested on 2026-11-11, it returned
Vancouver, BC rentals with the address (often including the unit number), coordinates, rent, beds,
baths, size and link, and it filters by Zillow's view tags, a search of the description, amenities
and days on Zillow. It returns no photos or descriptions, and its details tool doesn't cover active
listings. Apartments.com is worth one test alert; keep it only if its emails add listings the core
sources miss.

**Facebook Marketplace.** Probably one of the biggest private-landlord channels, but Meta's terms
require express written permission for any automated collection, logged in or not; robots.txt
blocks every path; and there is no API for reading rental listings. Keep it manual: share or copy
the link and paste it with the text or screenshots.

**Rentals.ca and RentFaster.** One network, strong in purpose-built buildings. Besides banning bots,
their terms say the personal-use licence may not be exercised by "automated means, algorithms, AI",
which covers having Claude score their listings even from your alert emails. Treat them as sites you
browse yourself.

**VADA Property Management.** Manages individually owned condos in exactly the towers this search is
about (Coal Harbour, Yaletown, West End). No terms of use were found and robots.txt allows the
listing pages, so a light direct check is the one place automated fetching looks acceptable. It is
planned for a later phase, only if the alert sources leave gaps. Confirm there are no terms before
building it, and filter out furnished and short-term units.

## What you would set up (once, about an hour)

1. A dedicated Gmail account just for listing alerts, so the tool never touches your personal email.
   Turn on 2-Step Verification (needed for the app password the tool reads mail with), and add a
   filter so alert emails never go to spam.
2. Accounts and saved searches with email alerts, using that address, on liv.rent, Zumper,
   Craigslist, REW.ca and Hollyburn (optionally Kijiji, Zillow and Apartments.com). Filters: your
   areas, whole unit, long-term, and a price cap set a little above your budget, so listings with
   incentives (such as a free month) still come through. The tool applies the real limit.
3. A one-time sweep: alerts only cover listings posted from now on, so browse each site once and
   paste anything promising into the Sorting Desk.
4. If speed matters most, keep the phone app's push alerts on for your top one or two sites. A scan
   a few times a day is for sorting, not for being first.

Apartment Finder never logs in to any of these sites or creates accounts on your behalf.

## What alert emails contain

Researched 2026-11-11. Only Zillow's format is publicly documented; nothing public shows the others.

| Site | Delivery | How often | Known contents |
| --- | --- | --- | --- |
| Zillow | Email and push; account needed | Instant or daily | One photo, rent, beds, baths, size, address, link; no description (from a real US email; rentals assumed the same) |
| Zumper | Email and push; email address only, no account needed | Each new match (help centre, 2025) | Unknown |
| liv.rent | Account needed; email probably | "Instant", per liv.rent | Unknown |
| Craigslist | Email; account needed | Varies; up to 20 listings per email; renewed and reposted ads are re-sent | Unknown |
| Kijiji | Email or app | Once a day on the web | Unknown |
| REW.ca | Email; account needed | Daily only | Unknown |
| Apartments.com | Account needed | Unknown | Unknown |
| Hollyburn | Email; no account | Each time a matching suite opens up | Unknown |
| Realtylink | Email; account needed | Instant, daily or weekly | Unknown |

Expect enough to identify a listing and apply the hard rules (rent, beds, area), often with one
photo; the description and window photos are unlikely. The first week of real alerts settles it.

## Still to verify

- What each site's alert email actually contains. The first week of real emails decides which
  sources stay.
- Whether the Zillow connector works in an unattended scheduled run, and any rate limits on it.
- That VADA really has no terms of use restricting automated access.

## Key sources

- Craigslist: [terms of use](https://www.craigslist.org/about/terms.of.use/en),
  [robots.txt](https://vancouver.craigslist.org/robots.txt),
  [saved searches help](https://www.craigslist.org/about/help/account/features/searches)
- Facebook: [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms),
  [robots.txt](https://www.facebook.com/robots.txt)
- Zillow: [terms of use](https://www.zillow.com/z/corp/terms/), [robots.txt](https://www.zillow.com/robots.txt)
- Apartments.com: [terms of service](https://www.apartments.com/grow/about/terms-of-service)
- Zumper: [terms and conditions](https://www.zumper.com/terms-and-conditions); PadMapper: [terms](https://www.padmapper.com/tos)
- Rentals.ca: [terms](https://rentals.ca/terms), [robots.txt](https://rentals.ca/robots.txt)
- liv.rent: [terms](https://liv.rent/terms),
  [how listings are verified](https://liv.rent/guides/safety-security/verified-listings/how-liv-rent-verifies-landlords-and-listings)
- RentFaster: [terms of use](https://www.rentfaster.ca/terms-of-use/)
- Kijiji: [terms of use](https://community.kijiji.ca/helpdesk/policies/kijiji-terms-of-use),
  [creating search alerts](https://community.kijiji.ca/t/how-to-create-search-alerts/165)
- Realtor.ca: [terms of use](https://www.realtor.ca/terms-of-use); REW.ca: [terms](https://www.rew.ca/terms)
- Hollyburn: [find an apartment](https://www.hollyburn.com/find-an-apartment/),
  [legal disclaimer](https://www.hollyburn.com/legal-disclaimer/)
- VADA: [rentals search](https://vadapm.com/search/for-rent), [robots.txt](https://vadapm.com/robots.txt)
- CAPREIT: [terms of use](https://www.capreit.ca/terms-of-use/)
- Realtylink: [rentals](https://realtylink.org/en/properties~for-rent),
  [terms](https://realtylink.org/en/terms-use-privacy-policy)
