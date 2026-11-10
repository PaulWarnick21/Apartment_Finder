# Apartment Finder

A tool that scans apartment listing portals and websites, filters listings against the user's
personal criteria, and presents the matches.

## Status

Scaffold only. No code yet and **no tech stack chosen** — don't assume one. Full requirements
are coming and will live in [docs/requirements.md](docs/requirements.md); read it before
starting any implementation work, and propose a stack based on it rather than picking one
silently.

## How the project is used

- The user drives everything from **Claude Code (desktop app)** rather than running a
  standalone app day to day.
- Results are shown in a **Claude Artifact** that gets rebuilt/republished as the work
  progresses. Keep publishing to the same artifact so the link stays stable.
- Email delivery of findings is a possible later output — not in scope until requirements say so.

## Listing sources

- The user will suggest a handful of sites. Claude should also research and recommend which
  apartment sites are best to pull from, and explain the tradeoffs (coverage, data quality,
  whether automated access is allowed).
- Check each site's terms of service and robots.txt before scraping. Prefer official APIs or
  feeds where they exist. Never bypass CAPTCHAs, logins, or other bot protection.

## Conventions

- Secrets (API keys, email credentials) go in a local `.env` file, never committed. Keep an
  `.env.example` with placeholder names only.
- The user's search criteria (budget, locations, etc.) are personal — keep them in local
  config, not hard-coded in source or published artifacts beyond what's needed to show results.
