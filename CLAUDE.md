# Working on the Deep Blue Board

Notes for Claude sessions working in this repo. README.md says what the app does; this file says how to change it.

## Ground rules

- **Run `git pull` before starting**, and again before pushing. Other sessions sometimes work on this repo, sometimes at the same time. Don't overwrite their work: if a push is rejected, pull with rebase and check what changed.
- **New features: ask "test or real?" before building**, unless Teague already said which. Default to the test board.
- **Small bug fixes go straight to the real board**, with the same fix on test so the two stay in step.
- **Commit as Teague**: `git -c user.name=wrightTeague -c user.email=wrightTeague@users.noreply.github.com commit ...`, then push to `main`. GitHub Pages deploys in about a minute (`gh run list -R wrightTeague/deep-blue -L 1`).
- **Say what you're about to do before touching the database**, even read-only lookups, and never change real-team data without being asked.
- **This repo is public.** No team links/tokens, passcodes or private-settings details in commits, the changelog or any doc. The app has some private captain settings; they're never named in UI copy, the changelog or anything shared with the team.
- Never type passwords or passcodes anywhere. Teague does that himself.

## Layout

- Repo root = **real board** (the one the team uses): `index.html`, `app.js`, `lines.js`, `styles.css`, `ocean.js`, `ascii.js`, `sim.html`, `sim.js`, `version.json`.
- `test/` = **test board**: the same files for a separate test team in the same database. `test/index.html` loads `../supabase.js` from the root.
- `sim.html` + `sim.js` (and the same in `test/`) = the **playing-time simulator**, linked quietly at the bottom of Roster. Read-only: it loads with the passcode already saved on the phone and never saves to the team. It runs `simDay` from `lines.js`, and its Fill lines inputs mirror `autoFill` in `app.js`, so change the two together. `sim.js` needs no changes between boards (`test/sim.html` marks itself `data-board="test"`), so it goes over as is.
- `supabase.js` is the bundled supabase-js browser build. Don't edit it.
- `lines.js` is the line maker, pure functions with no DOM. It runs in Node too (`require("./lines.js")`).
- `sims/` has offline simulations of the line maker.

## How the app works

- Plain JavaScript, no framework, no build step. Keep it that way.
- One state object `S` (team, players, tournaments, games, points, practices) plus `ui` (view state). `render()` rebuilds the page from them. Clicks go through one document listener that reads `data-act` attributes.
- Line edits go through `patchPoint` (optimistic, per-line queue, version-checked with `expect`, retried on `stale`). Other saves go through `save()`.
- Backend: Supabase Postgres. Tables are locked; the page only calls `app_*` SECURITY DEFINER functions, which check the team token and passcode. The functions live in the database, not this repo: change them with migrations and keep them backward compatible with phones still on the old version.
- Every user-typed string goes through `esc()` before it goes into HTML.

## Releasing a change

1. Bump the version everywhere for each board you touch:
   - real: `APP_VERSION` in `app.js`, `version.json`, and every `?v=` in `index.html` and `sim.html`. Format `YYYY.MM.DD.N` (e.g. `2026.10.29.3`).
   - test: the same three in `test/`, plus the `?v=` in `test/sim.html`. Format `test.N`.
   Open boards see the new `version.json` and reload themselves.
2. Add a plain-words entry to `CHANGELOG.md`, newest first, under **Real board**, **Test board**, or **Real board and test board**. Write it for teammates, not developers.
3. Commit, push, check the deploy.

## Promoting test → real

The real board is the test board with these differences. Copy the test files over, then restore them:
- `app.js`: header comment, `APP_VERSION`, no `<span class="test-tag">TEST</span>` in the header brand or the passcode screen's `<h1>`, gate text `Lines, zone spots and stats for the team.`, and `const PODS_ON = false; // pods are test-board only for now`.
- `lines.js`: header comment without "(test board only)".
- `ascii.js`: header says `Deep Blue ASCII touches:`.
- `index.html`: `theme-color` `#f1f7f8` (test uses `#ffe14d`), real version in every `?v=`.
- `sim.html`: no `data-board="test"`, `theme-color` `#f1f7f8`, title without "(TEST)", the real board's icon, `supabase.js` from the same folder, real version in every `?v=`. `sim.js` goes over as is.
- Test-only for now: the grabbing tentacle on Roster (`placeTentacle` in `app.js`, `tentacle` in `ascii.js`, the `.ascii-tent` / `.tgrab` CSS) and pods. Leave them out of the real board unless asked.

Diff the two boards afterwards. Only the items above should differ.

## Testing

- Serve the repo with `python3 -m http.server` and drive it with Playwright, intercepting every `*.supabase.co` request with a small fake backend (`page.route`). Never point tests at the real database.
- Check phone size (390×844, touch) and laptop size (about 1280×900): no page errors, no sideways scroll, and the flow you changed works end to end.
- For the line maker, run `planLine` in Node over a few made-up rosters and check the ratio, the captains per line, and back-to-back counts.
- Look at a screenshot of anything visual before pushing.

## Design

- "Waterline" look: light sea-foam top half, a wave, then navy "deep" sections below. Tokens are at the top of `styles.css` (`--sea`, `--foam`, `--cyan`, `--sun`, ...). Fonts: Bricolage Grotesque for display, Figtree for body.
- Phone first: big tap targets, one-handed use on the sideline, often on bad signal.
- Sharks (`ocean.js`) and the ASCII touches (`ascii.js`) can be turned off per device at the bottom of Roster, and they respect reduced motion.
