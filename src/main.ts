import { App, Keymap, Plugin, PluginSettingTab, Setting, TFile, MarkdownPostProcessorContext, MarkdownRenderChild, Notice } from "obsidian";
import {
  computeStats, computeWeek, renderSvg, renderWeekSvg, normalizeProjects, weekKeyFromPath, estimateWidth,
  type BoardInput, type QuestConfig, type QuestDef, type TaskData, type Frontmatter, type Measure,
} from "./core";

interface QBSettings {
  configPath: string;
  dailyGlob: string; // folder prefix
  tasksFolder: string;
  archiveFolder: string;
}

const DEFAULTS: QBSettings = {
  configPath: "Config/Quests.md",
  dailyGlob: "Notes/",
  tasksFolder: "TaskNotes/Tasks",
  archiveFolder: "TaskNotes/Archive",
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Options written inside the ```quests``` block, one `key: value` per line. */
interface BlockOpts { view: "month" | "week"; month?: string; week?: string }

function parseBlock(src: string): BlockOpts {
  const get = (k: string) => src.match(new RegExp(`^\\s*${k}\\s*:\\s*(\\S+)`, "m"))?.[1];
  const view = get("view") === "week" ? "week" : "month";
  return { view, month: get("month")?.match(/^\d{4}-\d{2}$/)?.[0], week: get("week")?.match(/^\d{4}-W\d{1,2}$/)?.[0] };
}

/** Text width via canvas, using the font Obsidian actually renders with. */
function canvasMeasure(fontFamily: string): Measure {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return estimateWidth;
  const cache = new Map<string, number>();
  return (s, size, bold = false) => {
    const k = `${bold ? 1 : 0}|${size}|${s}`;
    let v = cache.get(k);
    if (v === undefined) {
      ctx.font = `${bold ? "bold " : ""}${size}px ${fontFamily}`;
      v = ctx.measureText(s).width;
      cache.set(k, v);
    }
    return v;
  };
}

class BoardView extends MarkdownRenderChild {
  private ro: ResizeObserver | null = null;
  private lastWidth = 0;
  constructor(el: HTMLElement, private plugin: QuestBoardPlugin, readonly opts: BlockOpts, readonly sourcePath: string) {
    super(el);
  }
  onload() {
    this.plugin.views.add(this);
    this.ro = new ResizeObserver(() => {
      const w = Math.round(this.containerEl.clientWidth);
      if (w && Math.abs(w - this.lastWidth) >= 4) this.paint();
    });
    this.ro.observe(this.containerEl);
    this.paint();
  }
  onunload() {
    this.ro?.disconnect();
    this.plugin.views.delete(this);
  }
  paint() {
    const el = this.containerEl;
    const width = Math.round(el.clientWidth) || 640;
    this.lastWidth = width;
    this.plugin.paint(this, width);
  }
}

export default class QuestBoardPlugin extends Plugin {
  settings: QBSettings = DEFAULTS;
  views = new Set<BoardView>();
  private refreshTimer: number | null = null;
  private dailyPaths: Record<string, string> = {};
  private measure: Measure = estimateWidth;
  private fontFamily = "sans-serif";

  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new QBSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.fontFamily = getComputedStyle(document.body).getPropertyValue("--font-interface").trim() || "sans-serif";
      this.measure = canvasMeasure(this.fontFamily);
      this.refreshAll();
    });

    this.registerMarkdownCodeBlockProcessor("quests", (src, el, ctx) => this.renderBlock(src, el, ctx));

    this.addCommand({
      id: "quest-board-copy-svg",
      name: "Copy Quest Board SVG to clipboard",
      callback: async () => {
        const svg = renderSvg(computeStats(this.input()), { interactive: false, width: 640 });
        await navigator.clipboard.writeText(svg);
        new Notice("Quest Board SVG copied");
      },
    });

    // live refresh on vault changes (debounced)
    const bump = () => {
      if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refreshAll(), 400);
    };
    this.registerEvent(this.app.metadataCache.on("changed", bump));
    this.registerEvent(this.app.vault.on("delete", bump));
    this.registerEvent(this.app.vault.on("rename", bump));
  }

  onunload() {
    this.views.clear();
  }

  // ---------- data ----------

  private fm(file: TFile): Frontmatter {
    return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Frontmatter;
  }

  input(month?: string): BoardInput {
    const s = this.settings;
    const cfgFile = this.app.vault.getAbstractFileByPath(s.configPath);
    const config: QuestConfig = cfgFile instanceof TFile ? (this.fm(cfgFile) as QuestConfig) : {};

    const daily: Record<string, Frontmatter> = {};
    const dailyPaths: Record<string, string> = {};
    const tasks: TaskData[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(s.dailyGlob) && /\/Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(f.path)) {
        daily[f.basename] = this.fm(f);
        dailyPaths[f.basename] = f.path;
      } else if (f.path.startsWith(s.tasksFolder + "/") || f.path.startsWith(s.archiveFolder + "/")) {
        const fm = this.fm(f);
        if (Object.keys(fm).length === 0) continue;
        tasks.push({ ...fm, _projects: normalizeProjects(fm.projects), _path: f.path });
      }
    }
    this.dailyPaths = dailyPaths;
    return { config, daily, tasks, today: todayLocal(), month };
  }

  // ---------- rendering ----------

  private renderBlock(src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.addClass("quest-board");
    ctx.addChild(new BoardView(el, this, parseBlock(src), ctx.sourcePath));
  }

  paint(view: BoardView, width: number) {
    const el = view.containerEl;
    const { opts, sourcePath: src } = view;
    const svgOpts = { interactive: true, width, measure: this.measure, fontFamily: this.fontFamily };
    let svg: string;
    let quests: QuestDef[];
    if (opts.view === "week") {
      const w = computeWeek(this.input(), opts.week ?? weekKeyFromPath(src));
      svg = renderWeekSvg(w, svgOpts);
      quests = [...w.habits.map(h => h.def), ...w.projects.map(p => p.def)];
    } else {
      const stats = computeStats(this.input(opts.month));
      svg = renderSvg(stats, svgOpts);
      quests = stats.quests.map(q => q.def);
    }
    el.empty();
    el.innerHTML = svg;
    const svgEl = el.querySelector("svg");
    if (svgEl) svgEl.setAttribute("style", "width:100%;height:auto;display:block");

    // clickable: card -> its note (see cardTarget); task lines -> that task
    el.querySelectorAll<SVGElement>(".qb-link").forEach(n => {
      n.style.cursor = "pointer";
      n.addEventListener("click", ev => {
        ev.stopPropagation();
        const path = n.dataset.path;
        if (path) this.app.workspace.openLinkText(path, src, Keymap.isModEvent(ev));
      });
    });
    el.querySelectorAll<SVGElement>(".qb-card").forEach(g => {
      g.style.cursor = "pointer";
      g.addEventListener("click", ev => {
        const q = quests.find(x => x.id === g.dataset.quest);
        if (!q) return;
        this.app.workspace.openLinkText(this.cardTarget(q), src, Keymap.isModEvent(ev));
      });
    });
  }

  /** Where a card click leads: explicit `note`, else the project note, else today's daily note (habits), else the config. */
  private cardTarget(q: QuestDef): string {
    if (q.note) return q.note;
    if (q.type === "project" && q.project) return q.project;
    return this.dailyPaths[todayLocal()] ?? this.settings.configPath;
  }

  private refreshAll() {
    for (const v of Array.from(this.views)) {
      if (!v.containerEl.isConnected) continue;
      v.paint();
    }
  }
}

class QBSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QuestBoardPlugin) { super(app, plugin); }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const row = (name: string, desc: string, key: keyof QBSettings) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText(t =>
        t.setValue(s[key]).onChange(async v => { (s as any)[key] = v.trim(); await this.plugin.saveData(s); }));
    row("Quest config note", "Note whose frontmatter defines quests, XP rules.", "configPath");
    row("Daily notes root", "Folder prefix containing */Daily/YYYY-MM-DD.md", "dailyGlob");
    row("Tasks folder", "TaskNotes tasks folder", "tasksFolder");
    row("Archive folder", "TaskNotes archive folder", "archiveFolder");
  }
}
