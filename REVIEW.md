# Deep Blue Board: bug review

Scope: the live board in the repo root (`app.js`, `lines.js`, `styles.css`, `index.html`, `ascii.js`, `ocean.js`) at version 2026.10.29.1. `test/` runs the same code for everything below (`test/lines.js` matches `lines.js` apart from its header comment), so each finding and fix applies there as well.

## How this was tested

- I read all of `app.js` and `lines.js`, plus the relevant parts of `styles.css` and `ascii.js`.
- `review/harness.js` serves the repo with `python3 -m http.server` and opens it in Playwright (Chromium, 390×844, touch). Every Supabase call goes to a small in-memory fake backend instead: the RPCs over HTTP, and Realtime over a mocked WebSocket, so the board shows **Live** and gets a "changed" ping when another open board saves. Two or three boards can share one fake backend to act as different captains' phones. Latency, failure and "never answers" can be set per RPC and per phone.
- The fake backend has to guess server behaviour from how `app.js` calls it. The guess that matters most: `app_save_point` returns `stale` when `x.expect` is non-null and doesn't match `updated_at`, and a missing or null `expect` means a plain overwrite. Findings that depend on that guess say so.
- **Reproduced** means a script in `review/` drives the real page and the bad outcome shows up (on screen or in the fake server's data). **From reading** means I didn't script it.
- `review/run-all.sh` runs every script against the repo root. `review/verify-fixes.sh` applies `review/suggested-fixes.diff` to a temporary copy and runs the same scripts against that. With the fixes in, the findings they cover print `not reproduced`. No app files in the repo are changed.

Results from the last run, saved as `review/results-original.txt` and `review/results-patched.txt`:
- **Original board:** every finding in the table reproduces.
- **With `suggested-fixes.diff`:** every finding with a client fix prints `not reproduced`. The ones still reproducing are exactly the four with no client-only fix: #7, #13, #15 and #16. The line-maker simulation drops from 1.16 to 0.18 back-to-back placements per game. There were no page errors in either run.

To re-run (needs Node, Playwright with Chromium, and python3):

```bash
review/run-all.sh
```

```bash
review/verify-fixes.sh
```

## Summary

| # | Severity | Finding | Where | Status |
|---|---|---|---|---|
| 1 | Critical | Fill lines' **Undo** stays armed after the lines are played; one tap deletes played lines with their goals and assists, even from another game | `app.js:1270` | Reproduced · fix verified |
| 2 | Critical | A reload that was already in flight **overwrites newer changes on screen**: filled lines vanish (then get filled twice), a saved O/D is undone by the re-tap, a just-opened practice disappears | `app.js:81-90` | Reproduced · fix verified |
| 3 | High | **No request timeout**: one stalled request silently blocks every later save on that line and all live updates, while the header still says Live | `app.js:18`, `:110`, `:1610` | Reproduced · fix verified |
| 4 | High | **One tap in a line's ⋯ menu erases recorded points**: Clear players (wipes goals and assists too), Clear results, Plays → fewer | `app.js:1818-1820`, `:1566-1570` | Reproduced · fix verified |
| 5 | High | **Fill lines saves whole lines without a version check**, wiping a result another captain just recorded | `app.js:1259`, `:1272` | Reproduced (depends on server) · fix verified |
| 6 | High | After the **team passcode changes**, other phones never see the passcode screen; every tap silently reverts | `app.js:1598`, `:1607`, `:1972` | Reproduced · fix verified |
| 7 | Medium-high | **Two captains pressing Fill lines** a second apart get every new line twice (same seven players back to back) with duplicate positions | `app.js:1234`, `:1250` | Reproduced · needs a server change |
| 8 | Medium | Players marked **not going (or Out) stay on planned lines**, with no warning, and Fill won't replace them, although the sheet says lines leave them out | `app.js:1232`, `:1142`, `lines.js:73` | Reproduced · fix verified |
| 9 | Medium | **O/D and H/C toggles flip the wrong way** when another phone changed the line first (two captains both tap O → no O/D) | `app.js:1660-1661`, `:1591-1596` | Reproduced · fix verified |
| 10 | Medium | **Line maker sends people back to back that it didn't need to**: zone spots are filled in a fixed order, and handlers can use up the slot the only rested short deep needed | `lines.js:194-210` | Reproduced (simulation) · fix verified |
| 11 | Medium | **Who's going on slow signal**: an older answer flips a chip back, so the next tap cycles from the wrong state | `app.js:709-717` | Reproduced · fix verified |
| 12 | Medium | **Fast double tap on We scored / They scored** answers the next question: picks a scorer, or turns off the next point's auto "start on O" | `app.js:1667-1684` | Reproduced · fix verified |
| 13 | Medium | **Offline saves outside the lines** (practice check-in, Who's going, roster, zone) stay ticked on screen, then silently vanish when signal returns; nothing is retried | `app.js:130-146` | Reproduced · fix not written |
| 14 | Medium-low | **Paste, then Done** while an earlier save on that line is still going: the paste throws and is silently dropped | `app.js:1788` | Reproduced · fix verified |
| 15 | Medium-low | **Two phones opening today's check-in** make two practices for today; everyone's attendance reads 1/2 | `app.js:685-691` | Reproduced · needs a server change |
| 16 | Low | **Zone spots (and whole player, game and tournament rows) are last-writer-wins**: two captains editing at once wipe each other's change | `app.js:568-573`, `:153-154` | Reproduced · fix not written |
| 17 | Low | **Swipe**: a second short swipe within 200 ms drops a redraw, so another phone's change stays off screen until something else redraws | `app.js:1489`, `:1501` | Reproduced · fix verified |
| 18 | Low | The **Fill / Copied bar covers the bottom of Points**; the last chart row and "Fewest planned" can't be scrolled out from under it | `styles.css:103`, `:123` | Reproduced · fix verified |
| 19 | Low | **Stats page scrolls sideways** when the tournament name is over about 40 characters | `styles.css:139` | Reproduced · fix verified |
| 20 | Low | **gender and badge are rendered without escaping**; a hand-crafted RPC value runs script on every phone (typed names are all escaped) | `app.js:56`, `:468` and others | Reproduced with crafted data · fix verified |
| 21 | Low | From reading: new-line `pos` is count+1 (collides after any gap); Undo delete's reorder leaves out lines added since; a save that's stale four times in a row is dropped silently; iPhone edge-swipe | various | From reading |

The fixes are short diffs in each section below. `review/suggested-fixes.diff` has all of them as one patch (about 100 changed lines across `app.js`, `lines.js` and `styles.css`), and `review/verify-fixes.sh` checks it.

---

## 1. Fill lines' Undo deletes played lines, even from another game (Critical)

**Reproduced:** `review/repro-undo-fill.js`
**Where:** `app.js:1263` (`ui.auto = …`), `app.js:1270-1276` (`undoAuto`), `app.js:843` / `:1664` (switching games doesn't clear it)

After Fill lines, the bottom bar ("Filled Lines 1–3 … Undo / Done") stays until someone taps Done. It isn't cleared when points are recorded on those lines, or when you switch games. Tapping Undo then:
- deletes every line Fill created (`app_delete_point`), **including lines that now have results, goals and assists**, with no confirmation;
- for lines Fill only topped up, puts back the old lineup with a whole-row save (`savePoint({...cur, lineup})`), so the players credited for points already played change.

Undo and Done are two small buttons next to each other in the bar above the bottom nav, right where a thumb goes to dismiss it.

**Steps:** Points on a phone → Fill lines → Fill (3 lines). Don't tap Done. Record Pt 1 (We scored, scorer, assist) and Pt 2 (They scored). Tap Undo in the bar. Result: all 3 lines are deleted on the server, including the two played ones and the goal.
Variant: Fill lines in game 1, open game 2 from the game list. The bar is still there; Undo deletes game 1's lines.

**Fix:** remember which game the fill was for, clear it on a game switch, refuse once anything on those lines has a result, and restore lineups through `patchPoint` so it's checked against the server's copy:

```diff
@@ function openGame(gid) {
-    ui.gameId = gid; store.set("game", gid); ui.swipe = null; ui.editLines = null; ui.undoDel = null;
+    ui.gameId = gid; store.set("game", gid); ui.swipe = null; ui.editLines = null; ui.undoDel = null; ui.auto = null;
@@ if (a === "pick-game") { … ui.undoDel = null;
+    … ui.undoDel = null; ui.auto = null;
@@ autoFill
-    ui.auto = { changed, created, text: …
+    ui.auto = { gid: g.id, changed, created, text: …
@@ async function undoAuto() {
     const u = ui.auto; if (!u) return; ui.auto = null;
-    for (const c of u.changed) { const cur = S.points.find(p => p.id === c.id); if (cur) await savePoint({ ...cur, lineup: c.lineup }); }
+    // Never undo onto a game that's moved on: once any of these lines has a result, keep them.
+    const playedNow = [...u.created, ...u.changed.map(c => c.id)].some(id => { const p = S.points.find(x => x.id === id); return p && outs(p).some(o => o.result); });
+    if (u.gid !== ui.gameId || playedNow) { render(); toast("Those lines have been played, so Fill can't be undone."); return; }
+    for (const c of u.changed) await patchPoint(c.id, pt => { if (!outs(pt).some(o => o.result)) pt.lineup = c.lineup; });
```

It would also be worth hiding the bar once the first point on a filled line is recorded.

---

## 2. A reload already in flight overwrites newer changes on screen (Critical)

**Reproduced:** `review/repro-refresh-race.js`, `review/repro-fill-vanishes.js`, and as a side effect in `review/repro-two-practices.js`
**Where:** `app.js:81-90` (`load`), with `scheduleRefresh` at `app.js:106-114`

`scheduleRefresh` waits until nothing is saving before it *sends* `app_load`. Nothing checks again when the answer *arrives*. On bad signal the full reload takes seconds, so anything you change in that window is saved, and then the older snapshot replaces `S` and `serverLines` and puts the old state back on screen. Reloads are triggered by every Realtime ping from another phone, by coming back to the tab, and every 60 s, so this is routine at a tournament with two phones open. The phone doesn't hear its own pings, so the wrong screen stays until something else triggers a reload.

What the captain sees (all reproduced):
- **Lines saved twice.** Fill lines → the three new lines appear, then vanish when the old reload lands. Filling again leaves the server with every new line twice (8 lines, `pos=[1,2,3,3,4,4,5,5]`).
- **A saved tap undone.** Tap O for Pt 1: it saves, then shows as not selected. Tapping O again sends a toggle that's applied to the server's copy (which has O), so the server ends up with no O/D (see also #9).
- **Practice check-in kicks you out.** Tap "Check in today's practice": the new practice isn't in the old snapshot, `ui.practiceId` is reset, and you're back on the practice list.

**Steps (single phone):** two boards open. Board A's `app_load` answer takes 2.5 s. Board B changes anything, so A starts a reload. Within 2.5 s, A taps O (or runs Fill lines). The tap saves fine, then disappears from A's screen when the reload lands.

**Fix:** count local changes. If any were made, or any save is still going, while a reload was on its way, throw its answer away and reload again once the saves are in:

```diff
   let pending = 0, refreshQueued = false;
+  let editSeq = 0;   // goes up with every change made on this phone (see load)
@@ async function load(first) {
+    const seq = editSeq;
     try {
       const d = await rpc("app_load");
+      // Something changed on this phone while this was on its way, so the answer is older than
+      // the screen. Drop it and ask again once the saves are in.
+      if (S.team && !gated && (seq !== editSeq || pending > 0)) { if (first) { connect(); if (OWNER) loadOwner(); } scheduleRefresh(); return true; }
       S = …
@@ async function save(fn, args, optimistic) {
+    editSeq++;
     if (optimistic) optimistic();
@@ function patchPoint(id, fn) {
     const pt = S.points.find(x => x.id === id); if (!pt) return;
+    editSeq++;
     upsertLocal("points", buildLine(pt, fn)); render();   // show it now
```

(`gated` comes from fix #6.) While one phone keeps editing, its reload is put off, but its own saves already confirm each line through `serverLines`, so what it shows stays current.

---

## 3. A stalled request blocks saving and live updates, while the header says Live (High)

**Reproduced:** `review/repro-hung-request.js`
**Where:** `app.js:18` (client created without a fetch timeout), `app.js:110` (refresh waits for `pending === 0`), `app.js:1610` (each line's saves run one at a time)

supabase-js has no request timeout. When a phone moves between cell towers, or wifi to cell, a request can sit unanswered for minutes. While it does:
- every later change to **that line** is queued behind it. The screen shows the optimistic state (score, scorer, assist), and nothing is sent;
- `pending > 0`, so `scheduleRefresh` keeps postponing itself, and **no changes from other phones arrive**;
- the header still says Live, and there's no toast.

If the phone is locked or the tab closed in that state, everything recorded on that line is gone.

**Steps:** the first `app_save_point` from phone A never answers. On A, tap D for Pt 1, then We scored → scorer → assist. 18 s later the score on A reads 1–0, the server has nothing for Line 1, A has made no further reloads, and phone B's change to Line 2 isn't on A.

**Fix:** give every request a timeout. After it, the existing error path runs: toast, the line goes back to what the server has, a reload is scheduled, and the queued saves go out.

```diff
-  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
+  // On bad signal a request can hang for minutes. Give up after 15 s so the save shows as failed
+  // and later saves (and live refreshes) aren't stuck behind it.
+  const timedFetch = (url, opts = {}) => {
+    const c = new AbortController(), t = setTimeout(() => c.abort(), 15000);
+    if (opts.signal) opts.signal.addEventListener("abort", () => c.abort());
+    return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
+  };
+  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
```

A timed-out save may still have reached the server. That's fine here: the error path reloads, and line saves are version-checked.

---

## 4. One tap in a line's ⋯ menu erases recorded points (High)

**Reproduced:** `review/repro-one-tap-wipes.js`
**Where:** `app.js:1818-1820`; `buildLine` at `app.js:1566-1570` drops a scorer or assist who isn't on the line

On a played line, these menu items act on the first tap, with no confirm and no undo:
- **Clear players** empties the lineup, and `buildLine` then nulls every scorer and assist (they're no longer on the line). Putting the players back doesn't bring the goals back. Reproduced: 2 goals → 0.
- **Clear results** wipes every result, O/D, goal and assist on the line.
- **Plays 1** (the circles at the top of the menu) on a 2-point line drops the second point with its result and goal.

Delete line already asks for a second tap; these are just as destructive and sit right next to it.

**Fix:** ask for a second tap whenever the action would erase a recorded point:

```diff
     if (a.startsWith("pm-")) {
       const pid = ui.sheet.id, pt = S.points.find(x => x.id === pid);
+      // Clear results / Clear players / fewer points erase recorded points (players cleared take
+      // their goals and assists with them): ask for a second tap, like Delete.
+      const kept = a === "pm-plays" ? +el.dataset.v : a === "pm-clear-result" || a === "pm-clear" ? 0 : null;
+      if (pt && kept !== null && outs(pt).slice(kept).some(o => o.result) && ui.sheet.arm !== a + el.dataset.v) {
+        ui.sheet.arm = a + el.dataset.v; renderSheet(); toast("That erases recorded points. Tap again to do it.", 3000); return;
+      }
```

Better still, give these the same armed label as Delete ("Tap again to clear results"). Also consider not letting Clear players null the goals: keep the outcomes, and only drop scorers or assists who were swapped for someone else.

---

## 5. Fill lines overwrites a result another captain just recorded (High)

**Reproduced:** `review/repro-fill-overwrites-result.js`. This depends on the server: it assumes `app_save_point` without `expect` overwrites unconditionally.
**Where:** `app.js:1259` (autoFill), and the same pattern in `undoAuto` at `app.js:1272`

Line edits from taps go through `patchPoint`, which sends `expect: updated_at` and retries on `stale`. Fill lines doesn't: it sends the whole row from this phone's copy (`savePoint({ ...cur, lineup })`) with no `expect`. If this phone is a few seconds behind (its reload hasn't landed yet), the save writes the old, empty `outcomes` over the result another captain just recorded.

**Steps:** Line 1 (the NOW line) is one player short. Phone A taps They scored. Phone B, whose reload is slow, opens Fill lines with "Also fill empty spots" on and 0 new lines, and taps Fill. The server's Line 1 now has 7 players and no result.

**Fix:** top up existing lines through `patchPoint`, and leave a line alone if the server's copy has a result:

```diff
-      if (before.has(x.id)) { changed.push({ id: x.id, lineup: before.get(x.id) }); const cur = S.points.find(p => p.id === x.id); await savePoint({ ...cur, lineup: x.lineup }); }
+      // Through patchPoint, so it's checked against the server's copy: a line someone has
+      // recorded a result on in the meantime is left alone.
+      if (before.has(x.id)) { changed.push({ id: x.id, lineup: before.get(x.id) }); await patchPoint(x.id, pt => { if (!outs(pt).some(o => o.result)) pt.lineup = x.lineup; }); }
```

On the server side, it would be safer if `app_save_point` rejected an update to an existing row that arrives without `expect`.

---

## 6. After a passcode change, other phones never get the passcode screen (High)

**Reproduced:** `review/repro-passcode-change.js`
**Where:** `app.js:1598` (patchPoint's bad_code path), `app.js:1607` (its `finally` redraws), `app.js:1972` (`renderGate` leaves `S.team` set, so `render()` still draws)

When someone changes the team passcode (Roster → Private settings), every other phone's next line tap gets `bad_code`. `renderGate()` draws the passcode screen, then patchPoint's `finally` immediately calls `render()`, and the board is drawn back over it. The tap goes back to what the server had, with no toast (the bad_code path doesn't show one). The captain is left on a board where nothing saves and nothing says why. Any other redraw (a reload, a swipe, a version check) does the same.

**Steps:** the server starts rejecting phone A's code. A taps They scored. 2 s later: no passcode form, the board is showing, the score is back to 0–0, no message.

**Fix:** once the gate is up, don't draw the board until a load succeeds:

```diff
+  let gated = false; // the passcode screen is up: don't draw the board over it
@@ function render() {
-    if (!S.team) return;
+    if (!S.team || gated) return;
@@ function renderGate(msg) {
+    if (TOKEN && CODE === "") gated = true;
@@ async function load(first) {  (after the stale-answer check from #2)
+      gated = false;
       S = …
```

---

## 7. Two captains pressing Fill lines a second apart get every line twice (Medium-high)

**Reproduced:** `review/repro-two-captains-fill.js`
**Where:** `app.js:1234` (`pos: lines.length + 1`), `app.js:1250` (`seed: g.id + ":" + i`)

Each phone plans from its own copy and gives the new lines `pos = count + 1, + 2, …`. If both captains tap Fill before either sees the other's lines (one reload on bad signal is enough), the server ends up with both sets. The seed is the game and line index, so **both phones plan the same lineups**. The game then has each new line twice in a row: the same seven players back to back, at duplicate positions (`pos=[1,2,3,3,4,4,5,5]`). The order of tied positions depends on how the server sorts ties, so it can change between reloads.

**Fix:** this needs the server to take part:
- best: give `app_save_point` an "append" mode for new lines that sets `pos = max(pos) + 1` in the same transaction. Or have the client send the line count it planned from (`expect_lines`), and have the server return `stale` if it has changed;
- client side, as a stopgap: reload first in `autoFill` (`await load(false)` before planning), use `Math.max(0, ...lines.map(l => l.pos)) + 1` instead of `lines.length + 1` (here and in `newPointAfter`, `app.js:1545`), and after saving, warn if new lines from another phone appeared in the meantime.

I didn't write a client-only fix, because it can only narrow the window.

---

## 8. Not-going and Out players stay on planned lines (Medium)

**Reproduced:** `review/repro-not-going-on-line.js`
**Where:** `app.js:1232` (Fill only targets lines with fewer than 7 players), `app.js:1142` (the sheet text), `lines.js:73` (keep). The tiles in `lineCard` don't mark them.

Lines are often planned the night before. In the morning someone drops out and gets marked not going in Who's going, which says "Lines and Fill lines leave out anyone not going." In fact:
- they stay on every line already planned, and the line card doesn't show it (no tag, still counted in "3 W · 4 M");
- Fill lines → "Also fill empty spots" says "Nothing to fill: every line is full" because the line has 7 names, so there's no quick way to replace them;
- the Points-per-person chart quietly drops them ("all 23 players"), so the chart and the lines disagree.

The same goes for players marked **Out** in Roster. The player sheet says Out "hides them from … the line maker", but they're kept on lines.

(Fill itself never adds a not-going player: `going` excludes them, and `planLine` drops them from `keep`.)

**Steps:** plan Line 1 with Cleo. Who's going → tap Cleo twice (not going). Line 1 still shows Cleo with no warning. Fill lines with 0 new lines → "Nothing to fill".

**Fix:** tag them on the tile, and treat them as empty spots when filling unplayed lines:

```diff
@@ function lineCard
-    const zs = zoneSets(), spots = DBLines.assignSpots(line.map(s => s.p), zs);
+    const zs = zoneSets(), spots = DBLines.assignSpots(line.map(s => s.p), zs), awayL = awayOf(S.games.find(x => x.id === pt.game_id));
+    const gone = id => awayL.has(id) || (P(id) && !P(id).active);
@@
       const bits = [
+        gone(s.p) ? '<span class="t-b2b">not going</span>' : "",
@@ function autoFill
+    const away = awayOf(g), here = id => !away.has(id) && !!P(id)?.active;   // not-going / Out players count as empty spots
-      if (opts.existing) targets = … (lines[i].lineup || []).length < SLOTS …
+      if (opts.existing) targets = … (lines[i].lineup || []).filter(s => here(s.p)).length < SLOTS …
-      const keep = (lines[i].lineup || []).map(s => s.p), keepRoles …
+      const keep = (lines[i].lineup || []).map(s => s.p).filter(here), keepRoles …
```

---

## 9. O/D and H/C toggles flip the wrong way when another phone got there first (Medium)

**Reproduced:** `review/repro-two-captains-toggle.js`, and the re-tap in `review/repro-refresh-race.js`
**Where:** `app.js:1661` (od), `app.js:1660` (role), together with patchPoint's stale retry at `app.js:1591-1596`

patchPoint re-applies the same change function to the server's newer copy when its save is stale. That's right for setting a value, but O/D and the role chip are *toggles inside the function* (`o.start_on === v ? "" : v`, and `ROLES[(i + 1) % 3]`). If another phone already made the change, re-applying the toggle undoes it:
- both captains tap O for Pt 1 a moment apart → the server ends with no O/D, so the point counts as neither a hold nor a break;
- both tap the role chip to make someone a handler → they end up C.

The role toggle also uses the slot index `k`, so if another phone added or removed someone, it can change the wrong player's role.

**Fix:** decide the new value from what this phone shows when it's tapped, and save it as the value to set. For roles, find the player by id:

```diff
-    if (a === "role") { const k = +el.dataset.k; patchPoint(id, pt => { const s = pt.lineup[k]; if (s) { const cur = s.r === "P" ? "C" : (s.r || ""); s.r = ROLES[(ROLES.indexOf(cur) + 1) % ROLES.length]; } }); return; }
-    if (a === "od") { const k = +el.dataset.k; patchPoint(id, pt => { const o = pt.outcomes[k]; o.start_on = o.start_on === el.dataset.v ? "" : el.dataset.v; }); return; }
+    if (a === "role") { const s0 = (S.points.find(x => x.id === id)?.lineup || [])[+el.dataset.k]; if (!s0) return;
+      const cur = s0.r === "P" ? "C" : (s0.r || ""), r = ROLES[(ROLES.indexOf(cur) + 1) % ROLES.length];
+      patchPoint(id, pt => { const s = (pt.lineup || []).find(x => x.p === s0.p); if (s) s.r = r; }); return; }
+    if (a === "od") { const k = +el.dataset.k, v = outs(S.points.find(x => x.id === id))[k].start_on === el.dataset.v ? "" : el.dataset.v; patchPoint(id, pt => { pt.outcomes[k].start_on = v; }); return; }
```

The `result` handler already works this way (`res` is decided at tap time), which is why it doesn't have this problem.

---

## 10. The line maker sends people back to back that it didn't need to (Medium)

**Reproduced:** `review/sim-lines.js` (the seed roster) and `review/sim-fairness.js` (300 random rosters × 3 games × 13 lines)
**Where:** `lines.js:194-210`

Zone spots are filled in a fixed order: handlers, then deep deep, then short deep. Each spot falls back to "allow back to back" before anything earlier is reconsidered. Handlers lists are long, while deep and short lists are usually two or three people. So the handler picks often use up the last W (or M) slot that the only *rested* short deep needed, and the short deep then comes from someone who just played.

With the test roster (11 W, 13 M, 6 leaders) on a fresh game, Line 3 sends **Kip back to back** (short deep, played Line 2), while six players haven't played yet. The two handlers picked were both women (Dina, Cleo), which left no W slot for the rested short deep Gia. Picking Eli as the second handler would have avoided it.

Across the simulation (Fill lines' "Nobody back to back" rule, no private settings):

| zone lists | back-to-back placements per 13-line game, now | filling the scarcest spot first |
|---|---|---|
| 2 deep, 2 short, 5 handlers | 2.33 | 0.72 |
| same + 1–2 "if needed" each | 1.16 | 0.18 |

Neither version ever produced a full line that wasn't 3 W / 4 M, or a short line, and the spread of points between non-leaders also got slightly smaller (15.2 → 13.7).

**Fix:** fill the zone spot with the fewest people listed first:

```diff
+    // Most constrained spot first (fewest people listed): filling handlers first can use up the
+    // last W or M slot that the only rested short deep needed, and then someone goes back to back.
+    const listed = k => (pos[k] ? active.filter(p => inList(k, p.id)).length : Infinity);
+    needs.sort((a, b) => listed(a[0]) - listed(b[0]));
     for (const [k, name, missing] of needs) {
```

It's a heuristic, not a search. It still allows back to back when there's truly no other way, which is what the existing notes report.

---

## 11. Who's going on slow signal flips chips back and cycles from the wrong state (Medium)

**Reproduced:** `review/repro-going-taps.js`
**Where:** `app.js:709-717` (`setGoing`)

Each tap shows the change straight away, and **every** answer from the server is then written over the chip (`x.late = v.late; x.away = v.away`). With slow answers, the answer to tap 1 arrives after tap 2, and the chip flips back to the state after tap 1. The next tap then cycles from that state.

**Steps:** answers take 1.5 s. Tap Eve (late), tap again 0.4 s later (not going). 1.25 s later the chip shows late again. The captain taps once more, meaning to go back to going, and Eve ends up **not going**.

`markPractice` already solves this with a counter (`markWaiting`). Do the same here:

```diff
+  const goingWaiting = new Map();
   async function setGoing(tid, player, next) {
     const t = tours().find(x => x.id === tid); if (!t) return;
+    goingWaiting.set(tid, (goingWaiting.get(tid) || 0) + 1);
     …
-    if (v && Array.isArray(v.late)) { …
+    const left = goingWaiting.get(tid) - 1; goingWaiting.set(tid, left);
+    // Only the answer to the last tap: an earlier one would flip a chip back under the finger.
+    if (!left && v && Array.isArray(v.late)) { …
```

---

## 12. A fast double tap on We scored / They scored answers the next question (Medium)

**Reproduced:** `review/repro-double-tap.js`
**Where:** `app.js:1667-1684`

The next control appears exactly where the result button was. On a phone, a quick double tap (common when the signal is bad and the first tap seems not to have taken) answers it:
- **We scored ×2** records the first tile under the finger as the scorer (Ava, in the test);
- **They scored ×2** on a 2-point line lands on Pt 2's O button, which had just been set to O automatically, and turns it off.

**Fix:** ignore a recording tap within 400 ms of the previous one:

```diff
     const a = el.dataset.act, id = el.dataset.id;
+    // The scorer grid / next point's O-D appear right where "We scored" / "They scored" was, so a
+    // nervous double tap would answer them. Ignore a recording tap within 400 ms of the last one.
+    if (/^(result|set-goal|set-assist|od|ga-change)$/.test(a)) { if (Date.now() - (ui.lastRec || 0) < 400) return; ui.lastRec = Date.now(); }
```

The trade-off: two deliberate recording taps less than 400 ms apart (for example, scorer then thrower) now drop the second one. Finding a name in the grid takes longer than that. The repro scripts tap at a 500 ms pace for this reason. Another option is to fade the scorer grid in with `pointer-events: none` for the first 300 ms.

---

## 13. Offline saves outside the lines stay on screen, then silently vanish (Medium)

**Reproduced:** `review/repro-offline-checkin.js`
**Where:** `app.js:130-146` (`save`)

Line edits roll back on failure: patchPoint puts the server's copy back. Every other save (practice check-in, sitting out, Who's going, roster edits, zone spots, tournaments, games) shows the change, toasts "Couldn't save", and schedules a reload to undo it. With no signal the reload fails too, so the change stays on screen as if it were saved. When signal comes back, the next reload silently drops all of it. Nothing is retried.

**Steps:** open today's check-in, lose signal, tick four people. The "here" count says 4 (the header says Offline, and toasts flash). Signal returns and the next reload sets the count back to 0. Those people's attendance is gone, and attendance decides who starts the next tournament.

**Fix (not written):** the practice, sitting and going marks are absolute and per player (`p_on`, `p_state`), so they're safe to retry. Keep a small outbox in localStorage (`[{fn, args}]`), add to it when one of those saves fails, and flush it in order on the next successful request or `online` event. Show "N changes waiting" next to Offline. For whole-row saves (roster, zone), at least restore the screen to the last server copy when the save fails and the reload can't run.

---

## 14. Paste, then Done: the paste is silently lost (Medium-low)

**Reproduced:** `review/repro-paste-done.js`
**Where:** `app.js:1788`

The paste's change function reads `ui.clip` when the save *runs*, not when Paste is tapped. If an earlier save on that line is still going (or the save comes back stale and is retried), and the captain taps Done in the clipboard bar, `ui.clip` is null by then. The function throws `TypeError: Cannot read properties of null (reading 'lineup')`, the paste is never sent, and the line goes back to its old players with no message.

**Steps:** slow signal. On Line 2, tap a role chip, then Paste (Line 1's players), then Done. Seven names show, then 3. The server never got the paste.

**Fix:**

```diff
-      patchPoint(id, x => { x.lineup = ui.clip.lineup.map(y => ({ ...y })).slice(0, SLOTS); });
+      const lu = ui.clip.lineup.map(y => ({ ...y })).slice(0, SLOTS);   // now: Done may clear the clipboard before this saves
+      patchPoint(id, x => { x.lineup = lu.map(y => ({ ...y })); });
```

---

## 15. Two phones opening today's check-in make two practices (Medium-low)

**Reproduced:** `review/repro-two-practices.js`
**Where:** `app.js:685-691` (`newPractice`)

`newPractice` only checks this phone's copy for a practice on that date. Two captains arriving at practice and both tapping "Check in today's practice" before either sees the other's ping create two practices for the same day. In the repro, both phones end up ticking people into one of them (phone B gets kicked out of its own practice by #2 and reopens the other one). The second, empty practice still counts, so the Attendance card says "2 practices" and everyone who came reads 1/2. That shifts the attendance nudge in Fill lines.

**Fix:** needs the server: a unique `(team, practice_date)` with `app_save_practice` returning the existing row on conflict, and the client switching `ui.practiceId` to the returned id. The client can also reload before creating. Merging duplicates already in the data (union of `attended`) would clean up any that exist.

---

## 16. Zone spots, players, games and tournaments are last-writer-wins (Low)

**Reproduced (zone):** `review/repro-zone-lost-update.js`
**Where:** `app.js:568-573` (`saveZone` sends the whole zone object), and `savePlayer` / `saveGame` / `app_save_tournament` (whole rows), `app.js:153-154` and `:1918`

These saves send the whole object built from this phone's copy, with no version check. Captain A adds Max to Handlers; captain B, a few seconds behind, adds Jo to Deep deep. B's save writes the old Handlers list back, and Max is gone. The same happens if one captain marks a player Out while another renames them. These edits are rare at tournaments, hence Low.

**Fix (not written):** reuse patchPoint's pattern (send `expect`, re-apply the change to the fresh copy on `stale`), or give the server small per-change RPCs (`app_zone_set(player, zone, level)`).

---

## 17. Swipe: a second short swipe drops a redraw (Low)

**Reproduced:** `review/check-swipe.js` (CDP touch events)
**Where:** `app.js:1489` (`settle`), `app.js:1501`

While a finger is swiping, `render()` is put off (`ui.swiping.pending`), which is right. But a swipe that snaps back clears `ui.swiping` 200 ms later, and a second swipe started in that window replaces `ui.swiping` with a fresh `{pending:false}`. The first swipe's owed redraw is lost, and the first swipe's `settle` then clears the second swipe's guard. A short flick that doesn't change line (common at the first or last line, where it resists) followed by another is enough. A change from another phone that arrived during the first swipe then stays off screen until something else redraws. In the test it was still missing 4.5 s later, and showed up only after a tab tap.

Basic swiping works fine: left and right change lines, mostly-vertical drags scroll the page (`touch-action: pan-y`), and the click at the end of a swipe is swallowed.

**Fix:**

```diff
-    const settle = () => { const p = ui.swiping && ui.swiping.pending; ui.swiping = null; if (p) render(); };
+    const settle = () => { if (s && s.on) return; const p = ui.swiping && ui.swiping.pending; ui.swiping = null; if (p) render(); };   // a newer swipe owns it now
@@
-        s.on = true; ui.swiping = { pending: false }; s.el.style.transition = "none"; s.el.classList.add("swiping");
+        s.on = true; ui.swiping = { pending: !!(ui.swiping && ui.swiping.pending) }; s.el.style.transition = "none"; s.el.classList.add("swiping");   // keeps a redraw still owed from the last swipe
```

---

## 18. The Fill / Copied bar covers the bottom of Points (Low)

**Reproduced:** `review/check-bar-covers.js`
**Where:** `styles.css:103` (`.deep` bottom padding only clears the nav), `styles.css:123` (`.clipbar` is fixed above the nav)

While the Copied, Fill lines or Edit lines bar is showing, it sits about 64 px above the bottom nav, but the page only leaves room for the nav. Scrolled all the way down at 390 px, the last row of Points per person (a tap target) and the "Fewest planned: …" note stay under the bar. The toast appears in the same spot as the bar and covers its text.

**Fix:**

```diff
@@ render()
-      <main id="main" class="tab-${ui.tab}">
+      <main id="main" class="tab-${ui.tab}${ui.tab === "points" && (ui.editLines || ui.undoDel || ui.auto || ui.clip) ? " has-bar" : ""}">
@@ styles.css
+.has-bar .deep{padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom,0px))}
```

And raise `.toast`'s `bottom` by the bar's height while a bar is showing.

---

## 19. Stats scrolls sideways with a long tournament name (Low)

**Reproduced:** `review/check-stats-390.js`, `review/check-layout-390.js`
**Where:** `styles.css:139`

The "Tournament › Game" pill on Stats shortens the game name with an ellipsis, but the tournament part is `white-space: nowrap` and can't shrink. A tournament name of about 40+ characters ("Atlantic Coast Open: D-III Women's and Men's") makes the whole Stats page 414 px wide at 390, so it wobbles sideways under a thumb. Every other page and sheet I checked at 390 px (Points on the NOW and a played line, Home, Practice, Roster, the tournament page, the game menu, Fill lines, Who's going, the player picker, the line menu, the game list, Edit lines) had no sideways overflow with 30-character nicknames and 80-character game, tournament and location names. The one exception needs a 30-letter word with no spaces.

**Fix:**

```diff
+.ctx-pick{min-width:0}
+.ctx-pick span{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
```

---

## 20. gender and badge go into the page unescaped (Low)

**Reproduced with crafted data:** `review/check-xss-gender.js`. Clean result for typed input: `review/check-xss.js`.
**Where:** `app.js:56` (`badge`), and every `<span class="mag ${p.gender}">${p.gender}</span>` / `class="dot ${p.gender}"` (e.g. `app.js:395, 468, 477, 490, 542, 941, 1011`)

Every typed name is escaped: player nickname and full name, game, tournament, location, pod and practice. I put HTML/JS payloads in all of them and visited every page and sheet, including the copy-line bar, the Fill-lines notes, usual pairs, scrim teams and Edit lines, and nothing ran. gender and badge, though, are written into the page raw. The UI only ever sends W/M and ""/C/P, but anyone with the team link and passcode can call `app_save_player` by hand with `gender: "W\"><img src=x onerror=…>"`. That then runs on every phone that opens the board, where it can read localStorage, including a captain's **private settings code** (`deepblue:<token>:owner`), and so the rookie and keep-apart lists.

**Fix:** let only known values in, wherever `S` is loaded (or validate in `app_save_player`):

```diff
+  // gender and badge are put into the page as-is (class names, text); keep them to known values.
+  const clean = s => { (s.players || []).forEach(p => { if (p.gender !== "W" && p.gender !== "M") p.gender = ""; if (!BADGE_NAME[p.badge]) p.badge = ""; }); return s; };
-      S = { team: d.team, … };
+      S = clean({ team: d.team, … });
       (and the two `S = cached` lines)
```

---

## 21. Smaller things, from reading

- **New line positions are count + 1** (`app.js:1234`, `app.js:1545`). This assumes positions are always 1..n with no gaps. If a delete succeeds but the reorder after it fails (bad signal), or another phone deleted a line, the next added or filled line gets a `pos` that's already taken. Use `max(pos) + 1`, or let the server assign it (see #7).
- **Undo delete's reorder leaves out lines added since the delete** (`app.js:1401`): `u.order` is the order *before* the delete. A line added between Delete and Undo keeps its old `pos`, which can collide with a restored one.
- **A save that comes back stale four times in a row is dropped silently** (`app.js:1582`): the loop ends with no toast and the line goes back to the server copy. It's rare (it needs constant edits from another phone), but it should toast like the other failures.
- **iPhone Safari's edge swipe.** A right swipe that starts within about 20 px of the left edge is taken by Safari as Back. If the board was opened in a tab with history, that leaves the board. The card has a 16 px margin, so a thumb swipe to the previous line can start there. Consider ignoring pointerdowns with `clientX < 24`, so the browser gesture and the line swipe don't compete.

## Checked and found OK

- **Line sizes and ratio.** Over 11,700 simulated lines, Fill lines never produced a line over 7 players, and every full line was 3 W / 4 M (or 2 W / 5 M when that was chosen). Not-going players are never added by Fill, keep-apart is never broken, and players you placed stay put.
- **Practice check-in double taps** are already handled (`markWaiting`). Only the last answer is shown.
- **Rapid taps on one line from one phone** (result → scorer → assist, role cycling) are saved in order, because each line has a queue.
- **The swipe gesture itself**: left and right change lines, vertical drags scroll, edge resistance works, and the click at the end of a swipe is swallowed.
- **XSS through typed names**: none (see #20).
- **Inputs are 17 px**, so iOS doesn't zoom when one is focused.

## Files on this branch

- `REVIEW.md`: this report.
- `review/harness.js`: static server, Playwright board, fake Supabase (RPC + Realtime).
- `review/repro-*.js`: one script per data finding. Each prints `REPRODUCED` or `not reproduced`.
- `review/check-*.js`: layout (390 px), swipe, the bottom bar, XSS.
- `review/sim-lines.js`, `review/sim-fairness.js`: the line maker run directly in Node.
- `review/suggested-fixes.diff`: all the client-side fixes above as one patch, for `app.js`, `lines.js` and `styles.css`.
- `review/run-all.sh`: runs everything against the repo root.
- `review/verify-fixes.sh`: applies the diff to a temp copy and runs everything against it.
- `review/results-original.txt`, `review/results-patched.txt`: output of the last run of each.
- `review/smoke.js`: a one-page sanity check for the harness.
