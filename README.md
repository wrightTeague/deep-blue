# Deep Blue Board

Point-by-point line planner and stat tracker for Deep Blue Ultimate (F&M club ultimate).

- **Lines:** plan as many lines ahead as you want, 7 players each, with Handle / Cut roles. Each line plays 2 points by default (Line 1 = points 1–2, Line 2 = points 3–4…), adjustable per line, with a result, goal and assist for each point. Each player on a line shows how many points they sat since their last line ("sat 4", "1st shift", "back to back"), and the player picker lists whoever has sat longest first (or A–Z).
- **Points per person:** grouped bar chart under the lines (0 pts, 2 pts, 4 pts…), split W/M. Tap a bar (or hover on a laptop) to see who's in it.
- **Tournaments:** games live in tournament folders (pick from the game menu at the top). "Next game" copies the current lines into a new game in the same tournament; Stats can show one game, the whole tournament, or everything.
- **Copy / paste lines:** line menu → Copy players, then tap Paste on any line in any game (or Paste as new line). Undo reverts the last paste.
- **Zone:** deep deep, cup and short deep assignments per game.
- **Stats:** points played (O/D), goals, assists, holds and breaks, per game or across all games.
- **Roster:** add players, set W/M matchup, nicknames, captain (C) / president (P) badges, mark people out.

Everyone with the team link and passcode can edit at the same time; changes show up on other open devices within a second or two.

## How it works

Static site (`index.html`, `app.js`, `styles.css`) on GitHub Pages. Data is in a Supabase Postgres database. The tables are locked; the page only calls `app_*` database functions, and every one of them checks the team link token and the passcode before reading or writing. Live updates use a Supabase Realtime broadcast channel.

`supabase.js` is the official supabase-js 2.117.2 browser build, bundled so the site has no other script dependencies.
