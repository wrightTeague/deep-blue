# Deep Blue Board changelog

What changed, in plain words, newest first. **Real board** is the one the team uses. **Test board** is the separate copy at `/test/` for trying things before they go live; nothing there touches the real board.

## Oct 4, 2026

**Test board**
- **Swipe between lines on phones.** Each line fills the screen; swipe left or right, or use the arrows and dots above it ("Line 3 of 7"). It opens on the line we're on, and slides to the next line once a line is finished (every point has a result, and every goal has its scorer and assist). "+ Add line" is the last card. Laptops keep the grid.
- **NOW marker.** The first point without a result is highlighted in yellow with a NOW tag, its line gets a yellow outline, and a "Now: Pt 7" button jumps straight to it.
- **Zone spots are the same for every tournament** (handlers, deep deep, short deep and their backups) until someone changes them, instead of being set per tournament.

## Oct 3, 2026 (evening)

**Test board**
- **Its own home-screen icon** (yellow with TEST) and the name "DB Test", so it's easy to tell apart from the real board on a phone.
- **Zone spots are Handlers, Deep deep and Short deep** (no more Cup, since anyone can play it), shown below the roster. Each has a main list and a "can play it if needed" list.
- **The line maker uses them:** every line gets at least 2 handlers, a deep deep and a short deep (two different people). It goes to the "if needed" list only when nobody on the main list fits.
- **Zone spots moved to the Roster tab** and are set once per tournament instead of per game. The Zone tab is gone. A game outside a tournament still has its own.
- **Automatic line maker.** In the game menu (⋯), "Fill lines" plans new lines and fills empty spots in lines that haven't been played. "Suggest players for the empty spots" in a line's menu does one line. Each line gets 2 captains or president (whoever has rested longest), 3 women and 4 men, a deep deep, and nobody back to back. Everyone else goes by who has sat the most lines and played the fewest, carrying over from the last game that day. Players you placed stay put, lines with results are never touched, and there's an Undo.
- **5 men / 2 women popup.** Since 4 of the 6 captains and president are men, 3:4 lines give the other women a little more time than the other men, and it adds up over a day. The line maker tracks that across every game that day, and once the men (not counting captains and president) are a point behind, it asks before making a 5:2 line. On a normal day that's about twice.

**Real board**
- **Sitting time carries over between games.** The first line of a game counts from where people left off in the previous game that day (same tournament), using only points that got a result.
- **Player picker sorts by "Lines sat" or "Lines played"** (or A–Z). Each name shows both, like "sat 2 lines (4 pts) · 3 lines played".
- **Every player on a line shows how long they sat** before it: "sat 4 pts", "1st shift", or "back to back" in orange.

## Oct 3, 2026 (during the tournament)
- After a result, the next point's O/D is set automatically (they scored → we're on O).
- Goals and assists are picked by tapping names on the line.
- Copy a line's players and paste them into other lines or games.
- Tournament folders for games, and stats for a whole tournament.

## Oct 2, 2026
- The board went live: point-by-point line planner, zone spots, stats and roster, shared live between everyone with the link and passcode.
- Lines play 2 points each by default, with a points-per-person chart under the lines.
- Captain (C) and president (P) badges.
- Roles are just Handle and Cut.
- Open boards reload themselves when a new version is published.
