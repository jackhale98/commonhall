/**
 * Worcester's annual capital budget, read from the text of the city's PDF
 * (`pdftotext -layout`). Each department has a table of project lines (department,
 * category, title and five amounts), a printed sub-total, and a description per
 * project; the document ends with the five-year plan's totals by area and department.
 *
 * Cells are sometimes blank rather than "-", so amounts are placed by their column
 * position under that table's own header. Every department's parsed lines must add
 * up to its printed sub-total or the parse is refused: a changed layout fails
 * loudly instead of loading wrong numbers. Plan areas are checked against their
 * printed totals too, but only reported: the city's FY26 plan prints a Facility
 * Improvements total $1.4M above its own rows.
 */

export const AMOUNT_COLUMNS = ['borrowing', 'cash', 'new_authorization', 'prior_authorization', 'grants'] as const;
type AmountColumn = (typeof AMOUNT_COLUMNS)[number];
const HEADER_LABELS = ['Borrowing', 'Cash Purchase', 'New Authorization', 'Prior Year Loan', 'Grant/Donation Funds'];

const CATEGORIES = new Set([
  'Equipment',
  'Facility Improvements',
  'Infrastructure',
  'Capital Outlay',
  'Court Judgment',
  'Technology',
]);

export interface CapitalItem extends Record<AmountColumn, number> {
  seq: number;
  department: string;
  category: string | null;
  title: string;
  description: string | null;
}

export interface CapitalPlanRow {
  area: string;
  department: string;
  amounts: number[];
}

export interface ParsedCapitalBudget {
  items: CapitalItem[];
  /** Printed sub-totals by department, in AMOUNT_COLUMNS order. */
  subtotals: Map<string, number[]>;
  planYears: number[];
  plan: CapitalPlanRow[];
  /** Plan areas whose printed total differs from its rows (the city's own arithmetic; kept as printed). */
  planWarnings: string[];
}

interface Token {
  value: number;
  end: number;
}

/** Amounts on a line from `from` onward, with where each ends: "1,234", "-", "(5,000)". */
function amountTokens(line: string, from: number): Token[] {
  const out: Token[] = [];
  const re = /\(?\d[\d,]*\)?|(?<=\s|\$)-(?=\s|$)/g;
  re.lastIndex = from;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const raw = m[0];
    const n = raw === '-' ? 0 : Number(raw.replace(/[(),]/g, ''));
    out.push({ value: raw.startsWith('(') ? -n : n, end: m.index + raw.length });
  }
  return out;
}

/**
 * Place amounts in columns. With one amount per column they go in order; with
 * blanks, each goes to the column whose header ends nearest to where it ends.
 */
function placeAmounts(tokens: Token[], columnEnds: number[]): number[] {
  const out = columnEnds.map(() => 0);
  if (tokens.length === columnEnds.length) return tokens.map((t) => t.value);
  let next = 0;
  for (const t of tokens) {
    let best = next;
    for (let c = next; c < columnEnds.length; c++)
      if (Math.abs(columnEnds[c]! - t.end) < Math.abs(columnEnds[best]! - t.end)) best = c;
    out[best] = t.value;
    next = best + 1;
  }
  return out;
}

const PAGE_FURNITURE =
  /^(FY \d{4}-\d{4} Capital Improvement Program|CITY OF WORCESTER|Budget Office|City Manager|FISCAL YEAR \d{4} CAPITAL BUDGET|FY\d{2} CAPITAL BUDGET|\d+)$/i;

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Word overlap between a description's lead-in and a project title (0–1). */
function overlap(a: string, b: string): number {
  const wa = new Set(normalizeKey(a).split(' '));
  const wb = normalizeKey(b).split(' ');
  if (!wb.length) return 0;
  return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length);
}

export function parseCapitalBudget(text: string): ParsedCapitalBudget {
  const lines = text.split(/\r?\n/);
  const items: CapitalItem[] = [];
  const subtotals = new Map<string, number[]>();
  let columnEnds: number[] | null = null;
  let block: CapitalItem[] = [];
  let descriptions: { lead: string; text: string }[] = [];
  let inDescriptions = false;

  const flushDescriptions = () => {
    if (!block.length) return;
    // In printed order when the counts agree; otherwise by the closest title.
    if (descriptions.length === block.length) {
      block.forEach((item, i) => (item.description = descriptions[i]!.text));
    } else {
      for (const d of descriptions) {
        const best = [...block].sort((x, y) => overlap(d.lead, y.title) - overlap(d.lead, x.title))[0];
        if (best && !best.description && overlap(d.lead, best.title) > 0) best.description = d.text;
      }
    }
    block = [];
    descriptions = [];
  };

  let planStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (/^Equipment\s+FY\d{2}\s+FY\d{2}/.test(trimmed)) {
      planStart = i;
      break;
    }
    if (/Project Title/.test(line) && /Borrowing/.test(line)) {
      flushDescriptions();
      inDescriptions = false;
      columnEnds = HEADER_LABELS.map((label) => {
        const at = line.indexOf(label);
        return at < 0 ? -1 : at + label.length;
      });
      if (columnEnds.some((e) => e < 0)) throw new Error(`Unrecognised table header: ${trimmed}`);
      continue;
    }
    if (!columnEnds) continue;
    const sub = /^(.*?)\s+Sub-Total:/.exec(trimmed);
    if (sub) {
      const dept = sub[1]!.trim();
      subtotals.set(dept, placeAmounts(amountTokens(line, line.indexOf('Sub-Total:') + 10), columnEnds));
      inDescriptions = true;
      continue;
    }
    if (!trimmed || trimmed === 'Authorization' || PAGE_FURNITURE.test(trimmed)) continue;
    if (inDescriptions) {
      const lead = / - /.exec(trimmed);
      if (lead && lead.index < 120)
        descriptions.push({ lead: trimmed.slice(0, lead.index), text: trimmed.slice(lead.index + 3) });
      else if (descriptions.length) descriptions.at(-1)!.text += ` ${trimmed}`;
      continue;
    }
    // A project line: department, category and title separated by runs of spaces, then amounts.
    const parts = line.split(/\s{2,}/).map((p) => p.trim());
    if (parts.length < 3 || !/^[A-Z]/.test(parts[0]!)) continue;
    const [department, second, third] = parts as [string, string, string];
    const hasCategory = CATEGORIES.has(second);
    const title = hasCategory ? third : second;
    const titleEnd = line.indexOf(title, line.indexOf(hasCategory ? second : department) + 1) + title.length;
    const amounts = placeAmounts(amountTokens(line, titleEnd), columnEnds);
    const item = {
      seq: items.length + 1,
      department,
      category: hasCategory ? second : null,
      title,
      description: null,
    } as CapitalItem;
    AMOUNT_COLUMNS.forEach((c, k) => (item[c] = amounts[k]!));
    items.push(item);
    block.push(item);
  }
  flushDescriptions();

  const plan = planStart >= 0 ? parsePlan(lines.slice(planStart)) : { years: [], rows: [], problems: [] };
  return { items, subtotals, planYears: plan.years, plan: plan.rows, planWarnings: plan.problems };
}

/** The five-year plan: area headings, department rows and each area's printed total. */
function parsePlan(lines: string[]): { years: number[]; rows: CapitalPlanRow[]; problems: string[] } {
  const header = lines[0]!;
  const yearLabels = [...header.matchAll(/FY(\d{2})/g)];
  const years = yearLabels.map((m) => 2000 + Number(m[1]));
  const ends = yearLabels.map((m) => m.index! + m[0].length);
  const rows: CapitalPlanRow[] = [];
  let area = header.trim().split(/\s{2,}/)[0]!;
  const problems: string[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Total Credit Funding|TOTAL:/.test(trimmed)) break;
    const label = trimmed.split(/\s{2,}|\s+\$/)[0]!.trim();
    const tokens = amountTokens(line, line.indexOf(label) + label.length);
    if (tokens.length === 0) {
      area = label;
      continue;
    }
    // Plan columns are wider than the year labels: place by order, falling back to position.
    const amounts = tokens.length === years.length ? tokens.map((t) => t.value) : placeByOrder(tokens, ends, line);
    if (/^Total /.test(label)) {
      const parsed = rows.filter((r) => r.area === area);
      amounts.forEach((total, k) => {
        const sum = parsed.reduce((n, r) => n + (r.amounts[k] ?? 0), 0);
        if (Math.abs(sum - total) > 1) problems.push(`${area} ${years[k]}: rows add to ${sum}, printed ${total}`);
      });
      continue;
    }
    rows.push({ area, department: label, amounts });
  }
  return { years, rows, problems };
}

/** Blank plan cells: shift the year labels' ends to the amounts' alignment, then place by nearest. */
function placeByOrder(tokens: Token[], ends: number[], line: string): number[] {
  void line;
  const shift = tokens[0] ? tokens[0].end - ends[0]! : 0;
  return placeAmounts(
    tokens,
    ends.map((e) => e + shift),
  );
}

/** Departments whose parsed lines don't add up to the printed sub-total. */
export function subtotalMismatches(parsed: ParsedCapitalBudget): string[] {
  const problems: string[] = [];
  for (const [dept, printed] of parsed.subtotals) {
    // Sub-totals sometimes drop the parent department ("DCU" for "Public Facilities - DCU").
    const key = normalizeKey(dept);
    const lines = parsed.items.filter((i) => {
      const d = normalizeKey(i.department);
      return d === key || d.endsWith(` ${key}`);
    });
    if (!lines.length) {
      problems.push(`${dept}: no project lines`);
      continue;
    }
    AMOUNT_COLUMNS.forEach((c, k) => {
      const sum = lines.reduce((n, i) => n + i[c], 0);
      if (Math.abs(sum - printed[k]!) > 1) problems.push(`${dept} ${c}: lines add to ${sum}, printed ${printed[k]}`);
    });
  }
  return problems;
}
