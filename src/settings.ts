import { DEFAULT_OPTIONS } from './formatter';

export const CONFIG_SECTION = 'sqlFormatter';

/** The name the extension presents itself under, in the palette and the UI. */
export const EXTENSION_NAME = 'Ashlar - SQL Formatter (T-SQL)';

/** Settings that describe the style; `newline` is derived from the document. */
const NOT_A_STYLE_SETTING = new Set(['newline']);

/**
 * Every style setting path, in the same dotted form used by the setting ids
 * (`queries.select.alignAs` for `sqlFormatter.queries.select.alignAs`).
 * Derived from the defaults so the list cannot drift from the option model.
 */
export function settingPaths(): string[] {
    const out: string[] = [];
    walk(DEFAULT_OPTIONS as unknown as Record<string, unknown>, [], (path) => {
        if (!NOT_A_STYLE_SETTING.has(path[0])) {
            out.push(path.join('.'));
        }
    });
    return out;
}

export function walk(
    node: Record<string, unknown>,
    path: string[],
    visit: (path: string[]) => void,
): void {
    for (const [key, value] of Object.entries(node)) {
        const next = [...path, key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            walk(value as Record<string, unknown>, next, visit);
        } else {
            visit(next);
        }
    }
}

export function setPath(
    target: Record<string, unknown>,
    path: string[],
    value: unknown,
): void {
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (typeof node[key] !== 'object' || node[key] === null) {
            node[key] = {};
        }
        node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = value;
}
