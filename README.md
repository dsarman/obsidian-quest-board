# Quest Board

Habitica-inspired quest board for Obsidian, computed from data you already have: boolean habit properties in daily-note frontmatter and [TaskNotes](https://github.com/callumalpass/tasknotes) tasks linked to projects. No new tracker.

- **XP and levels only go up.** No HP loss, no streak that resets to zero.
- **Habit quests**: monthly goal, longest-ever run (record), weekly streak (weeks meeting a per-quest threshold).
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
node render.mjs --vault PATH [--view month|week] [--month YYYY-MM] [--week YYYY-Www] [--width PX] [--out DIR]
```

Releases are built by GitHub Actions when a tag matching the manifest version (e.g. `0.1.0`) is pushed.

## License

MIT
