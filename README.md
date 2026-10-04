# Quest Board

Habitica-inspired quest board for Obsidian, computed from data you already have: boolean habit properties in daily-note frontmatter and [TaskNotes](https://github.com/callumalpass/tasknotes) tasks linked to projects. No new tracker.

- **XP and levels only go up.** No HP loss, no streak that resets to zero.
- **Habit quests**: monthly goal, longest-ever run (record), weekly streak (weeks meeting a per-quest threshold).
- **Comebacks**: doing a habit again after a pause (`comeback_gap` days) earns bonus XP and a "↺" badge — restarting is rewarded, not just not breaking.
- **Now card**: the current or next timed item of today's plan (Day Planner format) or of a quest's `when` window, with a concrete instruction (`how`, or the latest "Next:" item from a log note via `how_from`).
- **Your own words**: a sentence from your daily reflections that mentions the habit, rotating daily.
- **Project quests ("bosses")**: done / total tasks linked to the project, with the next open task.

One TypeScript core (`src/core.ts`) computes the stats and emits SVG. Two hosts use it:

- **Obsidian plugin** (`src/main.ts`): a ```` ```quests ```` code block renders a live, clickable SVG and refreshes when the vault changes. The layout is drawn for the actual width of the note, so text keeps its size on phones (cards stack and wrap instead of shrinking).
- **Headless renderer** (`render.mjs`): reads the vault read-only and writes `questboard.svg` + `questboard.png` (via `@resvg/resvg-js`, no browser) to `--out`, e.g. to send the board from a chat bot. It never writes into the vault.

## Install

**BRAT:** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then *Add beta plugin* with this repository's URL and enable **Quest Board**.

**Manual:** copy `main.js`, `manifest.json`, `styles.css` from the latest release into `<vault>/.obsidian/plugins/quest-board/`.

## Block options

````
```quests
view: month        # default; or: week
month: 2026-09     # month view: show another month
week: 2026-W41     # week view: show another ISO week
```
````

`view: week` shows the current ISO week: per habit the Mon–Sun days and progress toward the weekly threshold, per project the tasks completed that week (by `completedDate`), and XP earned that week. In a weekly note named like `…/YYYY/MM/Weekly/W41.md` it shows that note's week automatically.

## Configuration

Quests live in the frontmatter of a note (default `Config/Quests.md`, changeable in settings):

```yaml
xp_per_habit: 10
xp_per_task: 20
xp_per_level: 100
xp_per_comeback: 10        # bonus for doing a habit again after a pause
comeback_gap: 3            # days without it that make the next one a comeback
plan_heading: Day planner  # heading of the timed plan in daily notes (Now card)
quote_headings:            # reflection headings mined for quotes (omit = off)
  - What went well
quests:
  - id: breathing
    type: habit
    habit: Breathing        # boolean frontmatter key in daily notes
    title: Breathing
    icon: "◎"
    color: "#4FC3F7"
    goal: 20                # sessions per month
    weekly: 4               # days per ISO week that count toward the weekly streak
    anchor: "after lunch"
    why: "Calm, focused afternoons."
    note: "Projects/Breathing"  # optional: opened on click
    words: [breath]             # optional: matches plan lines / reflections
    when: "12:30-14:00"         # optional: Now-card window if the plan has no timed line
    days: [1, 2, 3, 4, 5]       # optional: weekdays for `when` (1 = Mon)
    how: "4 s in, 6 s out · 5 min, then stop"
    # how_from: { note: "Logs/Physio", label: "Next" }  # last "Next" list item + sub-items
  - id: house
    type: project
    project: House          # note name; tasks with projects: [[House]] count
    title: House
    icon: "⌂"
    color: "#FFB74D"
    why: "Finish the renovation."
```

Clicking a card opens its `note` (link text or path, any file type); without it, project cards open the project note and habit cards open today's daily note. The "next:" line on a project card opens that task. Ctrl/Cmd-click opens in a new tab.

Daily notes are found as `*/Daily/YYYY-MM-DD.md` under the configured root; a list property counts as done when non-empty. Recurring TaskNotes count `completeInstances`.

## Build / render

```
npm install && npm run build          # -> main.js, dist/core.js
node render.mjs --vault PATH [--view month|week] [--month YYYY-MM] [--week YYYY-Www] [--width PX] [--now HH:MM|auto] [--out DIR]
```

Releases are built by GitHub Actions when a tag matching the manifest version (e.g. `0.1.0`) is pushed.

## License

MIT
