/**
 * Quest Board core: pure functions, no Obsidian / Node dependencies.
 * Input = plain data (frontmatter maps); output = stats + SVG string.
 * Used by both the Obsidian plugin (live view) and render.mjs (server PNG).
 */

export type Frontmatter = Record<string, unknown>;

export interface QuestDef {
  id: string;
  type: "habit" | "project";
  habit?: string;
  project?: string;
  title: string;
  icon?: string;
  color?: string;
  goal?: number;
  weekly?: number;
  anchor?: string;
  why?: string;
  /** Note opened when the card is clicked (link text or vault path). Defaults: project note for projects, today's daily note for habits. */
  note?: string;
}

export interface QuestConfig {
  xp_per_habit?: number;
  xp_per_task?: number;
  xp_per_level?: number;
  quests?: QuestDef[];
}

export interface TaskData extends Frontmatter {
  _projects: string[];
  _path: string;
}

export interface BoardInput {
  config: QuestConfig;
  /** date (YYYY-MM-DD) -> daily note frontmatter */
  daily: Record<string, Frontmatter>;
  tasks: TaskData[];
  today: string; // YYYY-MM-DD
  month?: string; // YYYY-MM, defaults to today's month
}

export interface HabitStats {
  kind: "habit";
  done: number;
  goal: number;
  prevMonth: number;
  last14: boolean[];
  record: number;
  weekStreak: number;
  weekThis: number;
  weekThreshold: number;
}

export interface ProjectStats {
  kind: "project";
  done: number;
  goal: number;
  open: { title: string; path: string }[];
}

export interface QuestStats {
  def: QuestDef;
  stats: HabitStats | ProjectStats;
}

export interface BoardStats {
  month: string;
  today: string;
  xp: number;
  level: number;
  into: number;
  perLevel: number;
  quests: QuestStats[];
}

export const MONTHS_CS = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

// ---------- helpers ----------

export function habitDone(fm: Frontmatter | undefined, key: string): boolean {
  if (!fm) return false;
  const v = fm[key];
  if (Array.isArray(v)) return v.length > 0;
  return v === true;
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function dateOf(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoWeek(d: Date): [number, number] {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return [t.getUTCFullYear(), week];
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function bestStreak(daily: Record<string, Frontmatter>, key: string, upto: string): number {
  let best = 0, cur = 0;
  let prev: Date | null = null;
  for (const dt of Object.keys(daily).sort()) {
    if (dt > upto) break;
    const d = dateOf(dt);
    if (habitDone(daily[dt], key)) {
      cur = prev && (d.getTime() - prev.getTime()) === 86400000 ? cur + 1 : 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
    prev = d;
  }
  return best;
}

export function weekStreak(
  daily: Record<string, Frontmatter>, key: string, threshold: number, today: string,
): { streak: number; thisWeek: number } {
  const counts = new Map<string, number>();
  for (const dt of Object.keys(daily)) {
    if (dt > today) continue;
    if (habitDone(daily[dt], key)) {
      const k = isoWeek(dateOf(dt)).join("-");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const td = dateOf(today);
  const thisKey = isoWeek(td).join("-");
  const thisWeek = counts.get(thisKey) ?? 0;
  // Monday of this ISO week
  let wk = addDays(td, -((td.getUTCDay() || 7) - 1));
  if (thisWeek < threshold) wk = addDays(wk, -7);
  let streak = 0;
  for (;;) {
    const k = isoWeek(wk).join("-");
    if ((counts.get(k) ?? 0) >= threshold) { streak++; wk = addDays(wk, -7); } else break;
  }
  return { streak, thisWeek };
}

// ---------- stats ----------

export function computeStats(input: BoardInput): BoardStats {
  const cfg = input.config;
  const quests = cfg.quests ?? [];
  const xpH = cfg.xp_per_habit ?? 10;
  const xpT = cfg.xp_per_task ?? 20;
  const perLevel = cfg.xp_per_level ?? 100;
  const today = input.today;
  const month = input.month ?? today.slice(0, 7);
  const daily = input.daily;
  const dates = Object.keys(daily).sort();
  const habitKeys = quests.filter(q => q.type === "habit" && q.habit).map(q => q.habit as string);

  let xp = 0;
  for (const dt of dates) for (const k of habitKeys) if (habitDone(daily[dt], k)) xp += xpH;
  for (const t of input.tasks) {
    if (t.recurrence) {
      const inst = t.completeInstances;
      xp += xpH * (Array.isArray(inst) ? inst.length : 0);
    } else if (t.status === "done") {
      xp += xpT;
    }
  }
  const level = Math.floor(xp / perLevel);
  const into = xp % perLevel;

  const out: QuestStats[] = quests.map(def => {
    if (def.type === "habit" && def.habit) {
      const k = def.habit;
      const pm = prevMonth(month);
      const done = dates.filter(d => d.startsWith(month) && habitDone(daily[d], k)).length;
      const prev = dates.filter(d => d.startsWith(pm) && habitDone(daily[d], k)).length;
      const last14 = dates.filter(d => d <= today).slice(-14).map(d => habitDone(daily[d], k));
      const thr = def.weekly ?? 4;
      const ws = weekStreak(daily, k, thr, today);
      const stats: HabitStats = {
        kind: "habit", done, goal: def.goal ?? 20, prevMonth: prev, last14,
        record: bestStreak(daily, k, today), weekStreak: ws.streak, weekThis: ws.thisWeek, weekThreshold: thr,
      };
      return { def, stats };
    }
    const pname = def.project ?? "";
    const pt = input.tasks.filter(t => !t.recurrence && t._projects.includes(pname));
    const open = pt.filter(t => t.status !== "done").map(t => ({ title: String(t.title ?? "?"), path: t._path }));
    const stats: ProjectStats = { kind: "project", done: pt.length - open.length, goal: Math.max(pt.length, 1), open };
    return { def, stats };
  });

  return { month, today, xp, level, into, perLevel, quests: out };
}

// ---------- SVG ----------

const BG = "#111419", CARD = "#1c202c", TXT = "#ebedf0", MUT = "#8c92a0", TRACK = "#2d3240", GOLD = "#facc15";
const FONT = "DejaVu Sans, Segoe UI, Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Rough text width for layout (DejaVu Sans ~0.6em average). */
function tw(s: string, size: number, bold = false): number {
  return s.length * size * (bold ? 0.70 : 0.58);
}

export interface SvgOptions {
  /** Emit data-attributes + class hooks for interactivity (plugin). */
  interactive?: boolean;
}

export function renderSvg(b: BoardStats, opts: SvgOptions = {}): string {
  const W = 1200, CARD_H = 170, GAP = 16, TOP = 204;
  const H = TOP + b.quests.length * (CARD_H + GAP) + 60;
  const [y_, m_] = b.month.split("-").map(Number);
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" class="qb-svg">`);
  p.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);
  p.push(`<text x="48" y="64" font-size="34" font-weight="bold" fill="${TXT}">QUEST BOARD · ${MONTHS_CS[m_ - 1]} ${y_}</text>`);
  p.push(`<text x="48" y="98" font-size="18" fill="${MUT}">Každé sezení / hotový úkol ubere bossovi 1 HP. Vynechaný den nic nedělá.</text>`);

  // level strip
  p.push(`<rect x="48" y="120" width="${W - 96}" height="56" rx="14" fill="${CARD}"/>`);
  p.push(`<text x="68" y="156" font-size="24" font-weight="bold" fill="${GOLD}">LVL ${b.level}</text>`);
  p.push(`<text x="190" y="155" font-size="18" fill="${MUT}">${b.xp} XP  ·  ${b.perLevel - b.into} do dalšího levelu</text>`);
  const lx0 = 620, lx1 = W - 72;
  p.push(`<rect x="${lx0}" y="140" width="${lx1 - lx0}" height="16" rx="8" fill="${TRACK}"/>`);
  if (b.into) p.push(`<rect x="${lx0}" y="140" width="${Math.round((lx1 - lx0) * b.into / b.perLevel)}" height="16" rx="8" fill="${GOLD}"/>`);

  let y = TOP;
  for (const { def, stats } of b.quests) {
    const col = def.color ?? "#60a5fa";
    const dataAttr = opts.interactive ? ` data-quest="${esc(def.id)}" class="qb-card"` : "";
    p.push(`<g${dataAttr}>`);
    p.push(`<rect x="48" y="${y}" width="${W - 96}" height="${CARD_H}" rx="18" fill="${CARD}"/>`);
    p.push(`<circle cx="108" cy="${y + 64}" r="36" fill="${col}"/>`);
    p.push(`<text x="108" y="${y + 64}" font-size="40" font-weight="bold" fill="${BG}" text-anchor="middle" dominant-baseline="central">${esc(def.icon ?? "•")}</text>`);
    p.push(`<text x="170" y="${y + 50}" font-size="28" font-weight="bold" fill="${TXT}">${esc(def.title)}</text>`);
    const titleW = tw(def.title, 28, true);
    if (def.anchor) p.push(`<text x="${170 + titleW + 16}" y="${y + 47}" font-size="17" fill="${MUT}">kotva: ${esc(def.anchor)}</text>`);
    if (def.why) p.push(`<text x="170" y="${y + 80}" font-size="17" fill="#c8ccd4">Proč: ${esc(def.why)}</text>`);

    const bx0 = 170, bx1 = 900;
    p.push(`<rect x="${bx0}" y="${y + 108}" width="${bx1 - bx0}" height="26" rx="10" fill="${TRACK}"/>`);
    const frac = Math.min(stats.done / stats.goal, 1);
    if (frac > 0) p.push(`<rect x="${bx0}" y="${y + 108}" width="${Math.round((bx1 - bx0) * frac)}" height="26" rx="10" fill="${col}"/>`);
    if (stats.done >= stats.goal) p.push(`<text x="${bx0 + 12}" y="${y + 126}" font-size="16" font-weight="bold" fill="${BG}">BOSS PORAŽEN</text>`);
    p.push(`<text x="${bx1 + 18}" y="${y + 128}" font-size="20" font-weight="bold" fill="${TXT}">${stats.done} / ${stats.goal}</text>`);

    if (stats.kind === "habit") {
      p.push(`<text x="${bx1 + 18}" y="${y + 151}" font-size="15" fill="${MUT}">${MONTHS_CS[(m_ - 2 + 12) % 12]}: ${stats.prevMonth}</text>`);
      // badges, right-aligned
      const badges = [`rekord ${stats.record} d`, `týdny v řadě ${stats.weekStreak}  ·  tento týden ${stats.weekThis}/${stats.weekThreshold}`];
      let bxr = W - 72;
      for (const bd of badges.reverse()) {
        const bw = tw(bd, 14, true) + 20;
        p.push(`<rect x="${bxr - bw}" y="${y + 24}" width="${bw}" height="24" rx="12" fill="${TRACK}"/>`);
        p.push(`<text x="${bxr - bw + 10}" y="${y + 41}" font-size="14" font-weight="bold" fill="${col}">${esc(bd)}</text>`);
        bxr -= bw + 8;
      }
      stats.last14.forEach((ok, i) => {
        p.push(`<circle cx="${177 + i * 22}" cy="${y + 153}" r="7" fill="${ok ? col : "#373c4c"}"/>`);
      });
    } else {
      p.push(`<text x="${bx1 + 18}" y="${y + 151}" font-size="15" fill="${MUT}">zbývá ${stats.open.length}</text>`);
      const nxt = stats.open[0];
      const label = nxt ? `další: ${nxt.title.slice(0, 70)}` : "další: —";
      const linkAttr = opts.interactive && nxt ? ` class="qb-link" data-path="${esc(nxt.path)}"` : "";
      p.push(`<text x="170" y="${y + 157}" font-size="15" fill="${MUT}"${linkAttr}>${esc(label)}</text>`);
    }
    p.push(`</g>`);
    y += CARD_H + GAP;
  }
  p.push(`<text x="48" y="${H - 32}" font-size="15" fill="${MUT}">Vykresleno ${b.today} z denních zápisků a TaskNotes. Nic netrestá, nic neresetuje.</text>`);
  p.push(`</svg>`);
  return p.join("\n");
}

// ---------- parsing shared by both hosts ----------

export function normalizeProjects(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return arr.map(x => String(x).replace(/[\[\]"']/g, "").split("|")[0].trim());
}
