# Deep Blue Board changelog

What changed, in plain words, newest first. **Real board** is the one the team uses. **Test board** is the separate copy at `/test/` for trying things before they go live; nothing there touches the real board.

## Oct 29, 2026

**Real board and test board**
- **The swap list only shows people going to the tournament.** People marked not going used to sit at the bottom under "Not going to this tournament"; now they're not offered at all.
- **Safer saving on bad signal and with two captains (from a full bug review).**
  - Fill lines' Undo can't delete lines once a point on them has been played, and it goes away when you switch games.
  - A slow background refresh no longer puts old data back on screen (lines vanishing after Fill, a tapped O/D reverting, getting kicked out of practice check-in).
  - A request that hangs gives up after 15 seconds, so later saves and live updates aren't stuck behind it.
  - Clear results, Clear players, and dropping a line to fewer points ask for a second tap when they'd erase a recorded point.
  - Fill lines no longer overwrites a result another captain just recorded.
  - If the team passcode changes, other phones now show the passcode screen instead of silently not saving.
  - Two captains tapping O/D or a role chip at the same moment no longer cancel each other out.
  - People marked not going (or Out) who are still on a planned line get a "not going" tag, and Fill lines treats their spot as empty.
  - Who's going on slow signal no longer flips a name back after you tap it.
  - A quick double tap on We scored / They scored no longer picks the scorer or turns off the next point's O.
  - Paste then Done right away no longer loses the paste.
  - Two phones opening today's practice at the same time share one practice instead of making two.
  - Fill lines picks the zone spot with the fewest people listed first, so it sends fewer people back to back.
  - The Fill / Copied bar no longer covers the bottom of Points, and a long tournament name no longer makes Stats scroll sideways.
- **New lines play 1 point by default.** Fill lines now starts on "Each plays 1 point", and + Add line and "Paste as new line" make 1-point lines. Lines already on the board keep their points, and you can still pick 2–4 in Fill lines or a line's menu.

## Oct 27, 2026

**Real board and test board**
- **Readable H / C on laptop's planned lines.** Below the water the H and C letters were pale on a pale chip and almost invisible. They're now bright letters on a tinted see-through chip, like the DD / SD tags.
- **Planned lines get darker the further ahead they are,** instead of the shading repeating every row of four.
- **Swipe between lines on phones.** On Points, swipe the line card left for the next line and right for the one before. The card follows your finger and snaps back if you don't swipe far enough. Up-and-down still scrolls the page, and swiping is off while you're editing lines.

## Oct 20, 2026

**Test board**
- **A tentacle in Roster's water.** A blue arm reaches up from the bottom of the navy section, behind the lists. Phones get one arm and laptops get one from each corner. Every 8–16 seconds it reaches for a name or a zone heading, glows cyan, wraps its tip around it, tugs it toward its base for a couple of seconds and lets it spring back. A grabbed name can't be tapped while it's held. It's covered by the same "Turn off ASCII…" switch at the bottom of Roster.

**Real board and test board**
- **Cards in the water are see-through,** so you can see the sharks swimming behind Zone spots, pods and the other navy cards.

## Oct 19, 2026

**Real board**
- **Everything from today's test board is on the real board:**
  - ASCII sharks swimming in the navy water on every page
  - the rolling ASCII sea on the passcode screen
  - the ASCII waterline
  - the goal celebration: a spinning disc splashes into the score, then HOLD, BREAK or CALLAHAN?! flashes after you pick the scorer and thrower
  - "No assist (Callahan)"
- Both can be turned off per phone at the bottom of Roster. Phones set to reduce motion get still waves and no celebration.

**Test board**
- **Sharks on every page.** They now swim in the navy water on Points, Practice, Stats and Roster too, not just Home. "Turn off sharks" at the bottom of Roster turns them off everywhere on that phone.
- **ASCII sea on the passcode screen.** A slow rolling sea drawn in characters sits under the login.
- **ASCII waterline.** The wave between the top of each page and the navy section is now a gently bobbing line of ~ and ≈ characters.
- **Goal celebration.** After you pick the scorer and the thrower, a spinning disc splashes into the score, then HOLD (the point started on O), BREAK (it started on D) or CALLAHAN?! (no assist) flashes for a moment with the scorer's name.
- **"No assist" is now "No assist (Callahan)",** so it's clear that's what it means.
- **Turn it off per phone** at the bottom of Roster. Phones set to reduce motion get still waves and no celebration.
- **Sharks in the deep on Home.** ASCII sharks swim in the blue water under the wave, behind The season ahead (one on phones, four on laptops). Other tabs stay plain. The sharks are by @stackedlol, credited at the bottom of Home.
- **"Turn off sharks on Home"** at the bottom of Roster. It only changes the phone or laptop you're on.
- The ocean band across the top, added earlier today, is gone. The sharks moved into the deep instead.
- **The sharks stay in the part of the water you can see,** so they don't swim off screen or down below the bottom of the screen. When you scroll down, they follow.
- **Smaller characters on laptops,** so the sharks there have more detail.
- **A smaller shark on phones, drawn in smaller characters,** so it keeps the same detail but has room to turn around without leaving the screen.
- **Tapping the water doesn't make a splash anymore.**

## Oct 13, 2026

**Real board**
- **Everything from the test board since Oct 10 is on the real board** (pods stay test-only):
  - **Who's going** for each tournament (going, late or not going). It replaces late sign-ups.
  - **"+ New player"** at practice check-in and in Who's going.
  - **A slimmer game menu (⋯)** next to the game name, with only this game's actions. New tournaments are added from Home, and tournaments are edited from their own page.
  - **A game switcher on Stats**, plus a planning look for games on a later day.
  - **The tournament page** has fixes, Practice is laid out better, buttons are easier to tap, and zone spots can be set from a player's panel.
- **Typing in a form isn't wiped out anymore** when another phone's change comes in while it's open.

**Test board**
- Same fix: typing in a form isn't wiped out when another phone's change comes in.

**Real board and test board**
- **Fixed: the red and blue dots in Attendance are no longer cut off** on the left.
- **Roster is shorter:** the share-the-board link and passcode boxes are gone. "Forget passcode on this device" is a small link at the bottom.
- **Fixed: the Practice tab no longer slides sideways on phones.** The "Check in today's practice" and "Add an earlier practice" buttons are smaller and wrap onto two lines so they fit.

## Oct 11, 2026

**Real board and test board**
- **Fixed: deleting several lines makes them all disappear at once,** instead of one by one. Undo brings them all back at once too, and so does undoing Fill lines.

**Test board: add a player from check-in or Who's going**
- **"+ New player" at practice check-in and in Who's going.** Type their name and pick W or M. They join the team and are checked in, or marked going. In Who's going you can also mark them as a late sign-up.
- **Catches duplicates.** As you type, names already on the team that look similar show up ("Sammy" → Sam G, Sam M). Tap one to use them instead. An exact repeat of a name on the team isn't added.

**Test board: easier to get around**
- **The game menu (⋯) sits next to the game name** on Points, instead of in the header. It only has this game's things now: Fill lines, Edit lines, Who's going, Edit game, Next game in this tournament, Delete. Tournament edit and remove live on the tournament's page.
- **Switch games from Stats too.** Stats has a "Stress Open › vs Bravo ▾" button. The tournament page's Stats button shows that tournament without changing which game you're on.
- **New game starts in the tournament you're in.** "Plan the first game" on Home opens the new-game form right away.
- **Planning looks different from playing.** A game on a later day with nothing played shows "Planning · in 21 days" instead of a 0–0 score, NOW and the result buttons, with Fill lines up front. On the day of the game it switches to the normal view.
- **Tournament page.** The record leaves out a game still in progress (and shows ties as W–L–T). Stats is always there, and the buttons fit on a phone.
- **Practice** no longer scrolls sideways on a phone. The date has its own row, "Split into 2 teams" is up top, and "Delete this practice" moved to the bottom.
- **Bigger tap targets** for the tournament link, the game name and the H/C chips. Swapping a player opens on the same matching (W or M), and "Take X off this line" is a quieter link.
- **Roster:** set a player's zone spots from their panel. Share link, passcode and "forget this device" moved to a "Team settings" button.
- The Fill lines and Who's going buttons stay at the bottom of the panel while you scroll. Phones show "Offline" in words when the board can't save.

**Test board**
- **Who's going, per tournament.** Each tournament has one "Who's going" list, on its page, on Home and in the game menu. It replaces the separate late sign-ups list. Everyone on the roster starts as going. Tap a name to cycle going → late sign-up → not going. It shows how many are going, with women/men and late counts.
- **Not going means left out of that tournament.** Fill lines, points per person and "Not on yet" skip them. The player picker lists them last under "Not going to this tournament", so you can still put someone in if they show up. The Roster tab is still the whole team.

## Oct 10, 2026

**Real board**
- **New look ("Waterline").** The real board now has the redesign from the test board: new fonts, a navy tab bar along the bottom on phones, and each page split at a wave. What you act on sits above the water; history, lists and settings sit below it.
- **Points** shows one line at a time on a phone, with "Up next", earlier lines and points per person below the wave. Tap the game name to switch games. On a laptop, the played, current and next lines sit side by side, with planned lines below the water.
- **Tournament pages.** Tapping a tournament on Home opens its own page with its date, where, record and games in order. Tap a game to open its lines. A tournament with no games yet shows its page with "+ Add game". On a game, the tournament name takes you back to its page.
- **Roster** shows players as tiles. Tap one to change their name, W/M, badge, mark them out, or remove them. Adding a player asks for the nickname first.
- **Stats, pop-ups and the passcode screen** use the new look too.

## Oct 9, 2026

**Test board**
- **New look ("Waterline").** The whole test board is redesigned: new fonts, a navy tab bar along the bottom on phones, and each page split at a wave. What you act on now sits above the water; history, lists and settings sit below it.
- **Points.** On a phone you see one line at a time with big name tiles. "Up next" and earlier lines sit below the wave, along with points per person. Tap the game name to switch games. Played points fold into one row with an Edit button. On a laptop, the played, current and next lines sit side by side next to points per person, and the planned lines sit below the water. The water shows even when nothing else is planned yet, with a "+ Add line" button.
- **Home, tournament and practice pages** follow the new layout. Home has a countdown to the next tournament and the season list below the water.
- **Roster.** Players show as tiles. Tap one to open a panel where you can change the name, W/M, badge, mark them out or remove them. Zone spots, pods and board settings sit below the water. Tap ⋯ on a pod to rename it, add or remove people, or delete it.
- **Add a player** asks for the nickname first. The full name is optional.
- **Stats, pop-ups and the passcode screen** all use the new look.

## Oct 7, 2026 (night)

**Test board**
- **Tournament pages.** Tapping a tournament on Home opens its own page: date, where, record, and a list of its games in order with each one's score or status ("No lines yet", "3 lines planned", "In progress · Pt 7 next"). Tap a game to open its lines. The page also has "+ Add game", late sign-ups, tournament stats and edit. A tournament with no games shows its page too, instead of popping up the new-game form.
- **Back to the tournament.** On a game, the tournament name above the game name takes you back to the tournament's page.
- **Pods.** On the Roster tab, under Zone spots, make named groups of players ("+ New pod", then tap people in). Rename a pod by tapping its name. Someone can be in more than one pod.
- **Put pods on a line.** In a line's ⋯ menu, "Put pods on this line" lets you pick two or more pods. It shows the total and the women/men count, how long each pod has sat, and warns if someone just played. It keeps whoever is already on the line unless you uncheck that.
- **Pod tags on lines.** A line made of whole pods shows them, like "Pod A + Pod C".

## Oct 7, 2026 (evening)

**Real board and test board**
- **"Left early / not scrimming" at practice.** On a practice, switch the tap mode to "Left early / not scrimming" and tap anyone who's sitting out. They stay checked in (it still counts toward attendance) but are left off the scrim teams, and drop off teams already made. Tap again to put them back.

## Oct 7, 2026 (later)

**Real board**
- **Fixed: tapping W or M when adding a player no longer clears the name** you'd typed.
- **Everything from today's test board is on the real board:** the Home tab (next tournament, practice check-in button, every tournament with its record, recent games), a "Where" for tournaments, removing a tournament with or without its games, the game picker only on Points and Stats, and tapping "Deep Blue" to go Home.
- **November is on the schedule:** Susquehanna (Sun Nov 1), a tournament on Sun Nov 8 (place to be set), and Kutztown (Sat Nov 14).

**Test board**
- **Tap "Deep Blue" at the top to go to Home** from anywhere.
- **Fixed: tapping W or M when adding a player no longer clears the name** you'd typed. A live update from another phone won't clear it either.

## Oct 7, 2026

**Test board**
- **Home tab.** The board now opens on Home instead of the last game played. It shows the next tournament (date, where, how many days away, late sign-ups), a button for today's practice check-in, every tournament split into coming up and played (with the record for played ones), and recent games. Tap a tournament to open its latest game, or to name its first game if it has none.
- **Tournaments have a "Where"**, and you can add, edit or remove them from Home.
- **The game picker only shows on Points and Stats**, where a game matters. Home, Practice and Roster don't show it.
- **Removing a tournament asks what to do with its games:** delete them too, or keep them (they move to "Other games"). Works from Home (✎ → Remove) and from the game menu.
- **November is on the schedule:** Susquehanna (Sun Nov 1), a tournament on Sun Nov 8 (place to be set), and Kutztown (Sat Nov 14).

**Real board**
- **Everything from the Oct 6 test board is on the real board:** the Practice tab (check-in, attendance since the last tournament, scrim teams), late sign-ups for a tournament, attendance and late sign-up options in Fill lines, and practices in the player picker.

## Oct 6, 2026

**Test board**
- **New Practice tab.** "Check in today's practice", then tap everyone who's there; it saves as you go and shows live on everyone's board. You can add an earlier practice or change a practice's date.
- **Attendance since the last tournament.** The Practice tab lists how many practices each person has made since the last tournament, and starts over after each one.
- **Scrim teams.** On a practice, "Split into 2 teams" makes Dark and Light with even women and men, captains split up and handlers spread out. Shuffle for a new split. People who check in later join the smaller side.
- **Fill lines uses attendance** (a switch in Fill lines, on by default). The best attendance goes out first at a tournament and gets a little more time: someone at every practice plays about 1–2 more points a day than average.
- **Late sign-ups.** In the game menu (⋯), "Late sign-ups" marks who signed up for that tournament late. Fill lines starts them after everyone else's first shift. A second option, "Start later + less time", also gives them a couple fewer points over the day.
- **The player picker shows practices** (like "3/4 practices") and tags late sign-ups.

## Oct 4, 2026 (later)

**Real board and test board**
- **Two phones editing the same line no longer overwrite each other.** If someone else changed the line a moment before you, the board picks up their version and adds your change on top, so both stick.
- **Updates wait until you're done.** When a new version comes out, the board won't reload while you're typing, have a menu open, or are in Edit lines; it reloads right after.

## Oct 4, 2026 (afternoon): everything from the test board is now on the real board

**Real board**
- **Automatic line maker.** In the game menu (⋯), "Fill lines" plans new lines and fills empty spots; "Suggest players for the empty spots" in a line's menu does one line. Each line gets 2 captains or president, 3 women and 4 men, at least 2 handlers, a deep deep and a short deep, and nobody back to back. Everyone else goes by who has sat the most lines and played the fewest, carrying over from earlier games that day. Players you placed stay put, lines with results are never touched, and there's an Undo.
- **Choose how captains pair up** in Fill lines: Rotate, Mostly usual, or Same pairs.
- **5 men / 2 women popup** when the men fall a point behind over the day.
- **Fill lines sets roles:** up to 3 handlers get H, everyone else C.
- **Zone spots moved to the Roster tab:** Handlers, Deep deep and Short deep, each with a "can play it if needed" list, the same for every tournament. The Zone tab is gone (anyone can play cup).
- **DD / SD tags** on every line show who'd take deep deep and short deep, with a warning if nobody on the line can.
- **Swipe between lines on phones**, with "Line 3 of 7", dots and arrows. Opens on the line we're on and slides on once a line is finished.
- **NOW marker** on the first point without a result, and a "Now: Pt 7" button that jumps to it.
- **Edit lines** (game menu): select several lines to delete at once (with Undo), or press and hold a line and drag it to reorder.
- **Version number** in the top bar, and a short "Updated" note when a phone gets a new version.

## Oct 4, 2026

**Test board**
- **Choose how captains pair up** in Fill lines: **Rotate** (everyone plays with everyone over the day), **Mostly usual** (the pairs that have played together most, two rounds out of three, then a mixed round), or **Same pairs** (the original: whoever has rested longest). Each phone remembers its choice.
- **Edit lines.** In the game menu (⋯), "Edit lines" shows every line as a small tile. Tap tiles to select them and delete several at once (it asks once, and there's an Undo). Press and hold a tile, then drag it to move it; on a laptop just drag. Line and point numbers update as you go.
- **Version number** in the top bar (like "v10"), and a short "Updated to v10" note the first time a phone opens a new version.
- **Captain partners rotate.** Fill lines still sends out whichever captain or president has rested longest, but their partner is now the rested one they've played with least that day, instead of the same pairs coming back every third line. Over a day every pair plays together a few times. Captains still play about a third of lines, sometimes resting 1 or 3 lines instead of exactly 2.
- **Who plays deep deep and short deep:** every line shows a small **DD** and **SD** tag next to the people it thinks should take those spots, worked out from the zone lists (main list first). It updates as you swap people, isn't saved, and shows "no DD" / "no SD" if nobody on the line can cover it.
- **Fill lines sets roles:** up to 3 people from the Handlers list get **H**, everyone else **C**. Anyone you placed yourself keeps the role you gave them.
- **No zooming** (same as the real board).
- **Swipe fixes:** the dots, "Line X of Y" and the line's height now keep up while you swipe instead of catching up a second later (so the points-per-person chart no longer shows over a line), and the counter can't show "Line NaN" after Fill lines anymore.
- **Swipe between lines on phones.** Each line fills the screen; swipe left or right, or use the arrows and dots above it ("Line 3 of 7"). It opens on the line we're on, and slides to the next line once a line is finished (every point has a result, and every goal has its scorer and assist). "+ Add line" is the last card. Laptops keep the grid.
- **NOW marker.** The first point without a result is highlighted in yellow with a NOW tag, its line gets a yellow outline, and a "Now: Pt 7" button jumps straight to it.
- **Zone spots are the same for every tournament** (handlers, deep deep, short deep and their backups) until someone changes them, instead of being set per tournament.

**Real board**
- **No zooming.** Double-tapping no longer zooms in, pinching doesn't zoom, and tapping a text box doesn't zoom the page.

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
