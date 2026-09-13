import * as vscode from 'vscode';
import { DEFAULT_OPTIONS, detectNewline, formatSql } from './formatter';
import type { DeepPartial, FormatOptions } from './formatter';
import { CONFIG_SECTION, setPath, walk } from './settings';
import { StyleReferencePanel } from './styleReference';

const LANGUAGE_ID = 'sql';

const SELECTOR: vscode.DocumentSelector = [
    { language: LANGUAGE_ID, scheme: 'file' },
    { language: LANGUAGE_ID, scheme: 'untitled' },
    { language: LANGUAGE_ID, scheme: 'vscode-notebook-cell' },
];

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('SQL Formatter');
    const providers = new ProviderRegistry(output);
    providers.sync();

    context.subscriptions.push(
        output,
        providers,
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${CONFIG_SECTION}.enable`)) {
                providers.sync();
            }
        }),
        vscode.commands.registerTextEditorCommand(
            'sqlFormatter.formatDocument',
            (editor, edit) => {
                const document = editor.document;
                const formatted = safeFormat(document.getText(), document, editorOptions(editor), output);
                if (formatted === null) {
                    return;
                }
                edit.replace(wholeDocumentRange(document), formatted);
            },
        ),
        vscode.commands.registerCommand('sqlFormatter.openStyleReference', () =>
            StyleReferencePanel.show(context.extensionUri, output),
        ),
        vscode.commands.registerTextEditorCommand(
            'sqlFormatter.formatSelection',
            (editor, edit) => {
                for (const selection of editor.selections) {
                    if (selection.isEmpty) {
                        continue;
                    }
                    const result = formatRange(editor.document, selection, editorOptions(editor), output);
                    for (const textEdit of result) {
                        edit.replace(textEdit.range, textEdit.newText);
                    }
                }
            },
        ),
    );
}

export function deactivate(): void {
    // Registrations are disposed through the extension context.
}

/** Owns the formatting provider registrations so they can be toggled at runtime. */
class ProviderRegistry implements vscode.Disposable {
    private registrations: vscode.Disposable[] = [];

    constructor(private readonly output: vscode.OutputChannel) {}

    sync(): void {
        this.dispose();
        const enabled = vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<boolean>('enable', true);
        if (!enabled) {
            return;
        }
        this.registrations = [
            vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, {
                provideDocumentFormattingEdits: (document, options) =>
                    formatWholeDocument(document, options, this.output),
            }),
            vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, {
                provideDocumentRangeFormattingEdits: (document, range, options) =>
                    formatRange(document, range, options, this.output),
            }),
        ];
    }

    dispose(): void {
        for (const registration of this.registrations) {
            registration.dispose();
        }
        this.registrations = [];
    }
}

function wholeDocumentRange(document: vscode.TextDocument): vscode.Range {
    const text = document.getText();
    return new vscode.Range(document.positionAt(0), document.positionAt(text.length));
}

function editorOptions(editor: vscode.TextEditor): vscode.FormattingOptions {
    const { tabSize, insertSpaces } = editor.options;
    return {
        tabSize: typeof tabSize === 'number' ? tabSize : 4,
        insertSpaces: typeof insertSpaces === 'boolean' ? insertSpaces : true,
    };
}

function formatWholeDocument(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    output: vscode.OutputChannel,
): vscode.TextEdit[] {
    const text = document.getText();
    const formatted = safeFormat(text, document, options, output);
    if (formatted === null || formatted === text) {
        return [];
    }
    return [vscode.TextEdit.replace(wholeDocumentRange(document), formatted)];
}

function formatRange(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    output: vscode.OutputChannel,
): vscode.TextEdit[] {
    // Always work on whole lines: a fragment starting mid-statement cannot be
    // indented correctly, and a partial line would lose its leading whitespace.
    const expanded = new vscode.Range(
        range.start.line,
        0,
        range.end.line,
        document.lineAt(range.end.line).text.length,
    );
    const text = document.getText(expanded);
    if (text.trim().length === 0) {
        return [];
    }
    const formatted = safeFormat(text, document, options, output);
    if (formatted === null) {
        return [];
    }
    // Re-apply the indentation the selection started at, so formatting a block
    // inside a stored procedure does not drag it back to column zero.
    const baseIndent = /^[\t ]*/u.exec(document.lineAt(range.start.line).text)?.[0] ?? '';
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const reindented = baseIndent.length === 0
        ? formatted
        : formatted
            .split(/\r?\n/u)
            .map((line, index) => (index === 0 || line.length === 0 ? line : baseIndent + line))
            .join(eol);
    if (reindented === text) {
        return [];
    }
    return [vscode.TextEdit.replace(expanded, reindented)];
}

function safeFormat(
    text: string,
    document: vscode.TextDocument,
    editorFormattingOptions: vscode.FormattingOptions,
    output: vscode.OutputChannel,
): string | null {
    try {
        return formatSql(text, readOptions(document, editorFormattingOptions, text));
    } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        output.appendLine(`Formatting ${document.uri.toString()} failed:\n${message}`);
        void vscode.window.showErrorMessage(
            'SQL Formatter could not format this document. See the "SQL Formatter" output channel for details.',
        );
        return null;
    }
}

/**
 * Settings ids mirror the option paths exactly
 * (`sqlFormatter.queries.select.wrapElements`), so the whole style is read by
 * walking the defaults and asking the configuration for each leaf.
 */
function readOptions(
    document: vscode.TextDocument,
    editorFormattingOptions: vscode.FormattingOptions,
    text: string,
): DeepPartial<FormatOptions> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
    const style: Record<string, unknown> = {};

    walk(DEFAULT_OPTIONS as unknown as Record<string, unknown>, [], (path) => {
        if (path[0] === 'newline') {
            return;
        }
        const value = config.get(path.join('.'));
        if (value !== undefined) {
            setPath(style, path, value);
        }
    });

    const indents = (style.indents ?? {}) as Record<string, unknown>;
    if (indents.useEditorIndentation !== false) {
        indents.useTabCharacter = !editorFormattingOptions.insertSpaces;
        indents.tabSize = editorFormattingOptions.tabSize;
        indents.indent = editorFormattingOptions.tabSize;
        style.indents = indents;
    }
    style.newline = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : detectNewline(text);
    return style as DeepPartial<FormatOptions>;
}

