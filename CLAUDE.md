# Apartment Finder

A tool that scans apartment listing portals and websites, filters listings against the user's
personal criteria, and presents the matches.

## Status

Design proposed but not yet approved, and no code yet. Read these before any implementation work:

- [docs/requirements.md](docs/requirements.md): what the user asked for.
- [docs/design.md](docs/design.md): the proposed design. Its **Open decisions** (stack, scoring
  engine, intake, schedule) are not settled until the user answers them; don't assume an answer.
- [docs/listing-sources.md](docs/listing-sources.md): per-site research on coverage, terms and access.

The user's personal search criteria are in `private/criteria.md` (gitignored).

## How the project is used

- The user drives everything from **Claude Code (desktop app)** rather than running a
  standalone app day to day.
- Results are shown in a **Claude Artifact** (the "Sorting Desk"). Its data lives in the
  artifact's database; republish the page only when its code changes, always to the same artifact
  so the link stays stable.
- Email delivery of findings is a possible later output — not in scope until requirements say so.

## Listing sources

- Every major listing site forbids automated access in its terms (see docs/listing-sources.md).
  The user accepts that risk for themselves (2026-11-11), but Anthropic's Usage Policy (effective
  2026-11-12) prohibits using Claude, including agents acting through browsers, to "circumvent the
  guardrails or terms of other platforms or services". So Claude must not browse, scrape or
  collect from a site whose terms forbid automated access, scheduled or on request, whatever the
  user accepts.
- Allowed intake: official connectors (Zillow's is the main automatic source; see
  docs/design.md); the user's own saved-search alert emails; listings, text and screenshots the
  user pastes in; and browsing only of sites whose terms allow it, after checking and recording
  their terms in docs/listing-sources.md.
- Don't send content from sites whose terms forbid AI use (Rentals.ca, RentFaster, Realtor.ca)
  to Claude.
- Never solve, bypass or work around CAPTCHAs or other anti-bot checks (no solving services,
  stealth plugins, disguised browser fingerprints, proxies or IP rotation), and never log in on
  the user's behalf. Treat a block as a stop.

## Conventions

- Secrets (API keys, email credentials) go in a local `.env` file, never committed. Keep an
  `.env.example` with placeholder names only.
- The user's search criteria (budget, locations, etc.) are personal — keep them in local
  config, not hard-coded in source or published artifacts beyond what's needed to show results.
