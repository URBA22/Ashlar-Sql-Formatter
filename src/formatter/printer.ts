import { indentUnit, indentWidth, type FormatOptions } from './options';

/**
 * Marks embedded in the output text and resolved once every line exists.
 *
 * Every "align ..." setting means the same thing: a token on each line of a
 * group must start at the same column. That column is only known once
 * the whole group has been written, so the formatter writes a mark and the
 * printer turns it into padding at the end.
 *
 * The sentinels are Unicode private-use characters, which cannot occur in SQL.
 */
const LEFT_MARK = '';
const RIGHT_MARK = '';

const LEFT_PATTERN = new RegExp(`${LEFT_MARK}([^${LEFT_MARK}]*)${LEFT_MARK}`, 'u');
const LEFT_PATTERN_ALL = new RegExp(`${LEFT_MARK}[^${LEFT_MARK}]*${LEFT_MARK}`, 'gu');
const RIGHT_PATTERN_ALL = new RegExp(
    `${RIGHT_MARK}([^:${RIGHT_MARK}]*):(\\d+)${RIGHT_MARK}`,
    'gu',
);

/** Text that must begin at the same column on every line of `group`. */
export function leftAlignMark(group: string): string {
    return `${LEFT_MARK}${group}${LEFT_MARK}`;
}

/** A keyword of width `width` that must end at the same column across `group`. */
export function rightAlignMark(group: string, width: number): string {
    return `${RIGHT_MARK}${group}:${width}${RIGHT_MARK}`;
}

export class Printer {
    private readonly lines: string[] = [];
    private readonly options: FormatOptions;
    private readonly unitWidth: number;
    private readonly tabWidth: number;
    private readonly useTabs: boolean;
    private readonly smartTabs: boolean;
    private buffer = '';
    /**
     * Indentation is tracked in columns, not levels, so that a continuation
     * indent or an alignment column that is not a whole number of levels can be
     * expressed exactly.
     */
    private indentColumns = 0;
    private lineIndentColumns = 0;
    private pendingBlanks = 0;

    constructor(options: FormatOptions) {
        this.options = options;
        this.unitWidth = indentWidth(options);
        this.tabWidth = Math.max(1, options.indents.tabSize);
        this.useTabs = options.indents.useTabCharacter;
        this.smartTabs = options.indents.smartTabs;
        void indentUnit;
    }

    /** Columns in one indent level. */
    get unit(): number {
        return this.unitWidth;
    }

    /** Visual width of the current line so far, ignoring unresolved marks. */
    get column(): number {
        const indent = this.buffer.length === 0 ? this.indentColumns : this.lineIndentColumns;
        return Math.max(0, indent) + visibleWidth(this.buffer);
    }

    get isLineEmpty(): boolean {
        return this.buffer.length === 0;
    }

    get isEmpty(): boolean {
        return this.lines.length === 0 && this.buffer.length === 0;
    }

    /** Indent of the line being built, in columns. */
    get currentLineIndent(): number {
        return this.buffer.length === 0 ? this.indentColumns : this.lineIndentColumns;
    }

    /** Sets the indent of the next line, in columns. */
    setIndent(columns: number): void {
        this.indentColumns = Math.max(0, Math.round(columns));
    }

    append(text: string, spaceBefore: boolean): void {
        if (text.length === 0) {
            return;
        }
        if (this.buffer.length === 0) {
            this.lineIndentColumns = this.indentColumns;
        } else if (spaceBefore && visibleWidth(this.buffer) > 0) {
            // A buffer holding nothing but alignment marks is still an empty
            // line, and an empty line never takes a leading space.
            this.buffer += ' ';
        }
        this.buffer += text;
    }

    /** Appends text that occupies no width, such as an alignment mark. */
    appendRaw(text: string): void {
        if (this.buffer.length === 0) {
            this.lineIndentColumns = this.indentColumns;
        }
        this.buffer += text;
    }

    newline(): void {
        if (this.buffer.length === 0) {
            return;
        }
        const blankText = this.options.indents.keepIndentsOnEmptyLines
            ? this.indentText(this.lineIndentColumns)
            : '';
        for (let i = 0; i < this.pendingBlanks; i += 1) {
            this.lines.push(blankText);
        }
        this.pendingBlanks = 0;
        this.lines.push(this.indentText(this.lineIndentColumns) + this.buffer);
        this.buffer = '';
    }

    requestBlankLines(count: number): void {
        if (this.isEmpty || this.buffer.length > 0) {
            return;
        }
        this.pendingBlanks = Math.max(this.pendingBlanks, count);
    }

    clearPendingBlankLines(): void {
        this.pendingBlanks = 0;
    }

    toString(): string {
        this.newline();
        const resolved = resolveMarks(this.lines, this.tabWidth, this.padStyle());
        while (resolved.length > 0 && resolved[resolved.length - 1].trim().length === 0) {
            resolved.pop();
        }
        const keepIndents = this.options.indents.keepIndentsOnEmptyLines;
        return resolved
            .map((line) => (keepIndents && line.trim().length === 0 ? line : line.trimEnd()))
            .join(this.options.newline);
    }

    /**
     * Renders `columns` of indentation. With tabs enabled, "smart tabs" fills
     * whole tab stops with tabs and the remainder with spaces so that alignment
     * survives; without it the indent is tabs only.
     */
    private indentText(columns: number): string {
        const width = Math.max(0, columns);
        if (!this.useTabs) {
            return ' '.repeat(width);
        }
        if (this.smartTabs) {
            return '\t'.repeat(Math.floor(width / this.tabWidth))
                + ' '.repeat(width % this.tabWidth);
        }
        return '\t'.repeat(Math.round(width / this.tabWidth));
    }

    private padStyle(): PadStyle {
        return this.useTabs && !this.smartTabs
            ? { tabs: true, tabWidth: this.tabWidth }
            : { tabs: false, tabWidth: this.tabWidth };
    }
}

/** How the gap an alignment mark leaves behind is filled. */
interface PadStyle {
    tabs: boolean;
    tabWidth: number;
}

/** Fills the gap between two columns, in tabs or spaces. */
function pad(from: number, to: number, style: PadStyle): string {
    const width = Math.max(0, to - from);
    if (!style.tabs) {
        return ' '.repeat(width);
    }
    // Without smart tabs the gap is tabs only, which is why fine alignment is
    // lost: the fill lands on the next tab stop at or past the target column.
    let out = '';
    let column = from;
    while (column < to) {
        out += '\t';
        column += style.tabWidth - (column % style.tabWidth);
    }
    return out;
}

/** Width of `text` with alignment marks removed. */
function visibleWidth(text: string): number {
    return stripMarks(text).length;
}

function stripMarks(text: string): string {
    return text.replace(LEFT_PATTERN_ALL, '').replace(RIGHT_PATTERN_ALL, '');
}

/**
 * Replaces every alignment mark with the padding that lines its group up.
 *
 * Right marks are resolved first because they sit at the start of a line and
 * shift everything after them. Left marks are then resolved one "column" at a
 * time: on each pass the first unresolved mark of each line is considered, its
 * group's widest occurrence wins, and every member is padded out to it.
 */
function resolveMarks(lines: string[], tabWidth: number, style: PadStyle): string[] {
    let out = resolveRightMarks(lines);
    for (let guard = 0; guard < 64; guard += 1) {
        const next = resolveLeftMarkPass(out, tabWidth, style);
        if (next === null) {
            return out;
        }
        out = next;
    }
    return out.map(stripMarks);
}

function resolveRightMarks(lines: string[]): string[] {
    const widest = new Map<string, number>();
    for (const line of lines) {
        for (const match of line.matchAll(RIGHT_PATTERN_ALL)) {
            const group = match[1];
            widest.set(group, Math.max(widest.get(group) ?? 0, Number(match[2])));
        }
    }
    if (widest.size === 0) {
        return [...lines];
    }
    return lines.map((line) =>
        line.replace(RIGHT_PATTERN_ALL, (_all, group: string, width: string) =>
            ' '.repeat(Math.max(0, (widest.get(group) ?? 0) - Number(width))),
        ),
    );
}

/** Resolves one column of left marks; returns null when none are left. */
function resolveLeftMarkPass(
    lines: string[],
    tabWidth: number,
    style: PadStyle,
): string[] | null {
    const targets = new Map<string, number>();
    const found: Array<{ group: string; column: number } | null> = [];

    for (const line of lines) {
        const match = LEFT_PATTERN.exec(line);
        if (match === null) {
            found.push(null);
            continue;
        }
        const group = match[1];
        const column = columnOf(line.slice(0, match.index), tabWidth);
        found.push({ group, column });
        targets.set(group, Math.max(targets.get(group) ?? 0, column));
    }
    if (targets.size === 0) {
        return null;
    }
    return lines.map((line, index) => {
        const hit = found[index];
        if (hit === null) {
            return line;
        }
        const filler = pad(hit.column, targets.get(hit.group) ?? 0, style);
        return line.replace(LEFT_PATTERN, () => filler);
    });
}

/** Visual column of `prefix`, expanding tabs and ignoring unresolved marks. */
function columnOf(prefix: string, tabWidth: number): number {
    let column = 0;
    for (const ch of stripMarks(prefix)) {
        column += ch === '\t' ? tabWidth - (column % tabWidth) : 1;
    }
    return column;
}
