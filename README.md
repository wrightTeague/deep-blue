# Deep Blue Board

Point-by-point line planner and stat tracker for Deep Blue Ultimate (F&M club ultimate).

- **Points:** plan as many points ahead as you want, 7 players each, with Handle / Cut / Pop roles.
- **Zone:** deep deep, cup and short deep assignments per game.
- **Stats:** points played (O/D), goals, assists, holds and breaks, per game or across all games.
- **Roster:** add players, set W/M matchup, nicknames, mark people out.

Everyone with the team link and passcode can edit at the same time; changes show up on other open devices within a second or two.

## How it works

Static site (`index.html`, `app.js`, `styles.css`) on GitHub Pages. Data is in a Supabase Postgres database. The tables are locked; the page only calls `app_*` database functions, and every one of them checks the team link token and the passcode before reading or writing. Live updates use a Supabase Realtime broadcast channel.

`supabase.js` is the official supabase-js 2.117.2 browser build, bundled so the site has no other script dependencies.
