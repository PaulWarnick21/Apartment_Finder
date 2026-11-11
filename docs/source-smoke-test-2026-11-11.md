# Source access smoke test — 2026-11-11

Manual discovery/detail checks using web search and the rendered browser. This is not an
implemented adapter test, proof of unattended access, an inventory completeness study, or
a guarantee of availability. Fourteen sources yielded readable listing details; liv.rent
was blocked. Some successful pages represent building advertisements or future availability.
Personal fit scores and reference IDs are recorded only in the gitignored private directory.

Subsequent user decision on 2026-11-11: remove liv.rent from the planned scanners for now.
Its row below preserves the historical test outcome, not an active integration commitment.

Photo review was incomplete for several accessible galleries. In particular, Zillow,
Facebook, Rentals.ca and RentFaster received only limited visual inspection; REW's reviewed
balcony evidence did not establish an interior-window view. These are pending assessments,
not proof that the listings lack better photos or qualifying views. Zumper and Sunstar had
gallery-access limitations; Hollyburn and Kijiji had exact-unit evidence limitations.

| Source | Sample | Observed result and limits |
| --- | --- | --- |
| Zillow | [33 Smithe Street](https://www.zillow.com/homedetails/33-Smithe-St-Vancouver-BC-V6B-0B5/2069751636_zpid/) | Search, detail and photos readable. Description and structured fields disagree on lease term and area. |
| Apartments.com | [33 Smithe, Coopers Lookout](https://www.apartments.com/33-smithe-st-vancouver-bc-unit-coopers-lookout/e4p3tpn/) | Current search/detail readable. Same advertised home as Zillow: matching description, price, area discrepancy, furnishing, optional parking fee and lease wording. Reuse assessment; preserve source differences. |
| Zumper | [1277 Hornby, 22nd-floor one-bedroom](https://www.zumper.com/address/1277-hornby-st-vancouver-bc-v6z-can) | Current building page separates available and occupied units. One-bedroom details retrieved, including separate parking charge and lease. Unit detail click did not expand in this browser test; full-resolution unit photo access remains to validate. Do not apply building-wide amenities to every unit. |
| Facebook Marketplace | [Canvas one-bedroom](https://www.facebook.com/marketplace/item/1880644579423650/) | Search, specific listing, description and photos readable in the existing signed-in browser session. Independent worker authentication/session persistence not tested. No message sent. |
| Craigslist | [Braeview Manor suite 704](https://www.craigslist.org/view/d/vancouver-unobstructed-english-bay/dDBRF91cvLGuzHt8LwTEVS) | Listing, stable post ID 7997892270, price, description and gallery accessible. Rechecked the existing trial candidate. |
| liv.rent | [Attempted detail page](https://liv.rent/rental-listings/detail/apartment/vancouver/23861) | Direct fetch returned 403; browser presented a human-verification challenge. Stopped at challenge. No current listing or score verified. Old promotional landing-page data is not a substitute for a live detail check. |
| REW | [Park Lane, suite 1108](https://www.rew.ca/rentals/5426976/1825-haro-street-vancouver-bc) | Detail and gallery accessible. Header says available now; description specifies December 15, 2026. Keep the discrepancy. |
| Rentals.ca | [928 Richards Street](https://rentals.ca/vancouver/928-richards-street-id1056833) | Current rendered listing and photos readable, ID 1056833. Structured parking field says no information; description specifies optional parking and a price. Description also clarifies utilities despite all-inclusive marketing wording. |
| RentFaster | [1655 Haro Street, suite 704](https://www.rentfaster.ca/properties/1655-haro-street-vancouver-760859) | Vancouver discovery, detail, specific available unit, and its photo button readable. Building-level availability and unit details must remain separate. |
| Kijiji | [Harbourview one-bedroom advertisement](https://www.kijiji.ca/v-apartments-condos/vancouver-downtown-west-end/harbourview-1-bedroom-apartment-for-rent/1708208776) | Browser detail readable after web fetch failed. Unit number unspecified; not a verified exact apartment. Links to Hollyburn with RentSync attribution. Term fields conflict. |
| Hollyburn | [Harbourview suite 605](https://www.hollyburn.com/furnished_rental/unit-605-in-harbourview/) | Specific unit page, price, minimum term and gallery accessible. Dates require checking; display-suite photo disclaimer prevents assuming exact-unit view evidence. |
| VADA | [Seastrand suite 703](https://vadapm.com/seastrand-2-bedroom-apartment-rental-703-150-24th-west-vancouver) | Current unit detail and photos accessible; advertised available now. |
| Austeville | [Pacific Palisades suite 2104](https://www.austeville.com/property/pacific-palisades-alberni-tower/suite-2104/) | Unit detail, availability and photo/floor-plan links accessible. Rechecked prior trial candidate. |
| EasyRent | [1328 West Pender, suite 1703](https://www.easyrent.ca/listings/1703-1328-west-pender-st-vancouver-british-columbia/) | Unit detail and photos accessible; available now. Area differs between structured detail and description. |
| Sunstar / MyBCRental | [The Park suite 2206](https://www.mybcrental.com/listings/alberni1723_2206/) | Description accessible, but advertised availability is September 1, 2027. Gallery not usable in this trial. Detail retrieval passes; photo assessment does not. |

## Findings for implementation

- Search-index data can be stale: an indexed Apartments.com result for
  [1495 Richards suite 3207](https://www.apartments.com/1495-richards-st-vancouver-bc-unit-3207/zekzdtw/)
  returned a live 404. Replaced it with a current result from on-site discovery. Do not
  recommend it from the cached page or equate an arbitrary fetch failure with removal.
- Zillow and Apartments.com surfaced the same Coopers Lookout advertisement. Share a
  canonical record and assessment; store different advertised dates and other conflicts.
- Kijiji's Harbourview ad and Hollyburn's suite 605 share descriptive wording, but their
  advertised price/area differ and Kijiji omits the unit number. Possible duplicate only;
  do not silently merge the apartments or transfer suite-specific facts.
- Extract descriptions alongside structured fields: parking fees and minimum terms can
  be missing or contradictory in portal fields. Preserve provenance and uncertainty.
- Successful detail access does not establish exact-unit photo provenance, verified view,
  current availability for chosen dates, pagination coverage, or scheduled reliability.
- Use a small set of reliable sources first. Validate automation, repeat scans, changes,
  photos and deduplication before declaring adapters ready. liv.rent is now excluded from
  planned scanners by user decision; do not schedule retries or bypass its challenge.
- PadMapper remains excluded. This test does not establish full inventory parity between
  other sources or authorize adding redundant scanners.
