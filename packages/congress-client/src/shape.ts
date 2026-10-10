/**
 * Field checks at the edge of each source. Responses are cast to TypeScript types,
 * so a renamed or retyped field upstream would otherwise become undefined, then NULL
 * columns, and the site would quietly lose data. `checkShape` compares a batch of
 * records with the fields we rely on and throws a ShapeError (failing the job, which
 * the daily health check reports) when:
 *
 *   - a required field is missing from every record in the batch (the mark of a
 *     rename; a field that is merely empty is fine), or
 *   - more than a tenth of a field's non-null values have the wrong type.
 *
 * Optional fields ("?") are only type-checked: sources leave them out when empty.
 * Types: string, number, boolean, object, array, date (an ISO-like date string);
 * "a|b" accepts either.
 */

export type Shape = Record<string, string>;

export class ShapeError extends Error {
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(`${source} changed shape: ${problems.join('; ')}`);
    this.name = 'ShapeError';
  }
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matches(value: unknown, type: string): boolean {
  return type.split('|').some((t) => {
    if (t === 'date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
    return typeOf(value) === t;
  });
}

/** The problems with a batch of records (empty when it looks right). */
export function shapeProblems(rows: readonly unknown[], shape: Shape): string[] {
  const records = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  if (records.length === 0) return rows.length ? ['records are not objects'] : [];
  const problems: string[] = [];
  for (const [field, spec] of Object.entries(shape)) {
    const optional = spec.endsWith('?');
    const type = optional ? spec.slice(0, -1) : spec;
    const present = records.filter((r) => r[field] !== undefined);
    if (!optional && present.length === 0) {
      problems.push(`no "${field}" in any of ${records.length} records`);
      continue;
    }
    const values = present.map((r) => r[field]).filter((v) => v !== null);
    const wrong = values.filter((v) => !matches(v, type));
    if (wrong.length > 0 && wrong.length > values.length * 0.1)
      problems.push(`"${field}" is ${typeOf(wrong[0])} in ${wrong.length} of ${values.length}, expected ${type}`);
  }
  return problems;
}

/** Throw a ShapeError when a batch doesn't look like `shape`; returns the rows for chaining. */
export function checkShape<T>(source: string, rows: readonly T[], shape: Shape): T[] {
  const problems = shapeProblems(rows, shape);
  if (problems.length) throw new ShapeError(source, problems);
  return rows as T[];
}

/** checkShape for one record. */
export function checkRecord<T>(source: string, row: T, shape: Shape): T {
  return checkShape(source, [row], shape)[0]!;
}

/**
 * Records a mapper had to skip (no id, unreadable): fine now and then, but when most of
 * a sizeable batch is skipped the source has changed. Throws a ShapeError.
 */
export function checkKept(source: string, read: number, kept: number, options: { min?: number; share?: number } = {}) {
  const min = options.min ?? 10;
  const share = options.share ?? 0.5;
  if (read >= min && kept < read * share)
    throw new ShapeError(source, [`only ${kept} of ${read} records could be read`]);
}
