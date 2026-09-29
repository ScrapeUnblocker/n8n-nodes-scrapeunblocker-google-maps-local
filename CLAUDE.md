<!-- HQ-SESSION-GUARD v1 (managed from ScrapeUnblocker/headquarters - do not remove) -->
# HQ SESSION GUARD (Claude - MANDATORY, READ FIRST)

This repo is part of the ScrapeUnblocker ecosystem. All development on it is governed by the central
`headquarters` repo (`ScrapeUnblocker/headquarters`) - its CLAUDE.md carries the global rules
(branch/push policy, lint gates, credentials handling, worklog, deploy runbooks).

- **If the headquarters CLAUDE.md IS loaded in your context** (the session was started from the local
  `headquarters` folder - you can see its "ScrapeUnblocker - Valdymo pultas (Headquarters)" instructions),
  this guard is satisfied: work normally under those rules.
- **If it is NOT loaded** (Claude was launched directly in this repo or anywhere else): treat this repo as
  **READ-ONLY**. Do NOT edit files, do NOT commit, do NOT push, do NOT create branches or tags, and do NOT
  run deploys from here. Tell the developer: ScrapeUnblocker development sessions must be started from the
  local `headquarters` folder (clone of `ScrapeUnblocker/headquarters`) so the global rules load - then stop.
- Reading, searching, running read-only commands and explaining code is always allowed.
- **Exemption:** sanctioned headless server agents (self-heal / scout / parts-monitor / no-code crawler etc.
  running on our servers) follow their own playbooks and are NOT bound by this guard.

---

# CLAUDE.md

`n8n-nodes-scrapeunblocker-google-maps-local` is an n8n community node that runs ScrapeUnblocker's public **Google Maps Scraper** Actor on Apify (`scrapeunblocker/google-maps-local-scraper`, Actor ID `DKvV4GqDEdn25LSyc`) with the user's own Apify API token and returns the run's dataset items.

**This repo is generated.** Do not hand-edit it: change `specs/google-maps-local.json` or the templates in the private `ScrapeUnblocker/n8n-actor-nodes-factory` repo and regenerate (`python -m generator render google-maps-local`), then release as described below.

## Commands

```bash
npm run lint     # n8n community-node lint rules (CI gate)
npm run build    # n8n-node build -> dist/
npm run release  # on main: bump, changelog, tag, push -> publish.yml publishes with provenance
```

## Architecture

- `nodes/GoogleMapsScraper/GoogleMapsScraper.node.ts` - node description (Resource + Operation) and `buildActorInput()` mapping node parameters to the Actor's input keys. One Actor run per input item.
- `nodes/GoogleMapsScraper/GenericFunctions.ts` - shared Apify client (start run, long-poll status, page through the dataset) and input helpers. Identical in every generated repo.
- `credentials/ApifyApi.credentials.ts` - `apifyApi` (`apiKey`, Bearer). Same name and scheme as the official Apify n8n credential on purpose - do not rename.

## Releasing

Branch -> README version history (via the spec) -> lint + build + `npm publish --dry-run --ignore-scripts` -> PR -> `main` -> `GITHUB_TOKEN="$(gh auth token)" CI=true npm run release`.
