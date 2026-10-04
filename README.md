# Quest Board

Habitica-inspired quest board for Obsidian, computed from data you already have: boolean habit properties in daily-note frontmatter and [TaskNotes](https://github.com/callumalpass/tasknotes) tasks linked to projects. No new tracker.

- **XP and levels only go up.** No HP loss, no streak that resets to zero.
- **Habit quests**: monthly goal, longest-ever run (record), weekly streak (weeks meeting a per-quest threshold).
- **Project quests ("bosses")**: done / total tasks linked to the project, with the next open task.

One TypeScript core (`src/core.ts`) computes the stats and emits SVG. Two hosts use it:

- **Obsidian plugin** (`src/main.ts`): a ```` ```quests ```` code block renders a live, clickable SVG and refreshes when the vault changes. Optional `month: YYYY-MM` inside the block.
- **Headless renderer** (`render.mjs`): reads the vault from disk and writes `questboard.svg` + `questboard.png` (via `@resvg/resvg-js`, no browser), e.g. for a nightly cron or a chat bot.

## Install

**BRAT:** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then *Add beta plugin* with this repository's URL and enable **Quest Board**.

**Manual:** copy `main.js`, `manifest.json`, `styles.css` from the latest release into `<vault>/.obsidian/plugins/quest-board/`.

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
  - id: house
    type: project
    project: House          # note name; tasks with projects: [[House]] count
    title: House
    icon: "⌂"
    color: "#FFB74D"
    why: "Finish the renovation."
```

Daily notes are found as `*/Daily/YYYY-MM-DD.md` under the configured root; a list property counts as done when non-empty. Recurring TaskNotes count `completeInstances`.

## Build / render

```
npm install && npm run build          # -> main.js, dist/core.js
node render.mjs --vault PATH [--month YYYY-MM] [--out DIR]
```

Releases are built by GitHub Actions when a tag matching the manifest version (e.g. `0.1.0`) is pushed.

## License

MIT
