import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownPostProcessorContext, Notice } from "obsidian";
import { computeStats, renderSvg, normalizeProjects, type BoardInput, type QuestConfig, type TaskData, type Frontmatter } from "./core";

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

export default class QuestBoardPlugin extends Plugin {
  settings: QBSettings = DEFAULTS;
  private containers = new Set<HTMLElement>();
  private refreshTimer: number | null = null;

  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new QBSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("quests", (src, el, ctx) => this.renderBlock(src, el, ctx));

    this.addCommand({
      id: "quest-board-copy-svg",
      name: "Copy Quest Board SVG to clipboard",
      callback: async () => {
        const svg = renderSvg(this.collect(), { interactive: false });
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
    this.containers.clear();
  }

  // ---------- data ----------

  private fm(file: TFile): Frontmatter {
    return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Frontmatter;
  }

  collect(month?: string): import("./core").BoardStats {
    const s = this.settings;
    const cfgFile = this.app.vault.getAbstractFileByPath(s.configPath);
    const config: QuestConfig = cfgFile instanceof TFile ? (this.fm(cfgFile) as QuestConfig) : {};

    const daily: Record<string, Frontmatter> = {};
    const tasks: TaskData[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(s.dailyGlob) && /\/Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(f.path)) {
        daily[f.basename] = this.fm(f);
      } else if (f.path.startsWith(s.tasksFolder + "/") || f.path.startsWith(s.archiveFolder + "/")) {
        const fm = this.fm(f);
        if (Object.keys(fm).length === 0) continue;
        tasks.push({ ...fm, _projects: normalizeProjects(fm.projects), _path: f.path });
      }
    }
    const input: BoardInput = { config, daily, tasks, today: todayLocal(), month };
    return computeStats(input);
  }

  // ---------- rendering ----------

  private renderBlock(src: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) {
    const month = src.match(/month:\s*(\d{4}-\d{2})/)?.[1];
    el.dataset.qbMonth = month ?? "";
    this.containers.add(el);
    this.paint(el);
  }

  private paint(el: HTMLElement) {
    const month = el.dataset.qbMonth || undefined;
    const stats = this.collect(month);
    el.empty();
    el.addClass("quest-board");
    el.innerHTML = renderSvg(stats, { interactive: true });
    // make the SVG responsive
    const svg = el.querySelector("svg");
    if (svg) { svg.removeAttribute("width"); svg.removeAttribute("height"); svg.setAttribute("style", "width:100%;height:auto"); }
    // clickable: card -> open project/config note; "další" -> open task
    el.querySelectorAll<SVGElement>(".qb-link").forEach(n => {
      n.style.cursor = "pointer";
      n.addEventListener("click", ev => {
        ev.stopPropagation();
        const path = n.dataset.path;
        if (path) this.app.workspace.openLinkText(path, "", false);
      });
    });
    el.querySelectorAll<SVGElement>(".qb-card").forEach(g => {
      g.style.cursor = "pointer";
      g.addEventListener("click", () => {
        const id = g.dataset.quest;
        const q = (stats.quests.find(x => x.def.id === id)?.def);
        if (!q) return;
        const target = q.type === "project" && q.project ? q.project : this.settings.configPath;
        this.app.workspace.openLinkText(target, "", false);
      });
    });
  }

  private refreshAll() {
    for (const el of Array.from(this.containers)) {
      if (!el.isConnected) { this.containers.delete(el); continue; }
      this.paint(el);
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
