import * as vscode from 'vscode';
import { CONFIG_SECTION, settingPaths } from './settings';

const VIEW_TYPE = 'sqlFormatter.styleReference';
const PAGE = ['media', 'style-reference.html'];

/** The settings scopes the panel can edit, in the order they are offered. */
type ScopeId = 'user' | 'workspace' | 'folder';

interface Scope {
    id: ScopeId;
    label: string;
    target: vscode.ConfigurationTarget;
    /** Resource a folder-scoped configuration is read and written against. */
    resource?: vscode.Uri;
}

/** Messages the page sends to the extension. */
type Incoming =
    | { type: 'ready' }
    | { type: 'scope'; scope: ScopeId }
    | { type: 'set'; path: string; value: unknown; scope: ScopeId }
    | { type: 'reset'; path: string; scope: ScopeId };

/**
 * The style reference panel: the same page that is published on the web, wired
 * to the editor so that it shows the settings in force for the chosen scope and
 * writes every change straight to settings.json as you make it.
 */
export class StyleReferencePanel {
    private static current: StyleReferencePanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private scope: ScopeId = 'user';
    /** Set while writing, so our own write does not bounce back as an update. */
    private writing = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly output: vscode.OutputChannel,
    ) {
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: Incoming) => void this.onMessage(message),
            null,
            this.disposables,
        );
        // Settings edited anywhere else -- settings.json, the settings UI,
        // another window -- are reflected here.
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!this.writing && event.affectsConfiguration(CONFIG_SECTION)) {
                    this.postSettings();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.postSettings()),
        );
    }

    static async show(
        extensionUri: vscode.Uri,
        output: vscode.OutputChannel,
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (StyleReferencePanel.current) {
            StyleReferencePanel.current.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'SQL Formatter Style',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            },
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');

        const instance = new StyleReferencePanel(panel, extensionUri, output);
        StyleReferencePanel.current = instance;
        await instance.load();
    }

    private async load(): Promise<void> {
        const pageUri = vscode.Uri.joinPath(this.extensionUri, ...PAGE);
        let html: string;
        try {
            html = new TextDecoder().decode(await vscode.workspace.fs.readFile(pageUri));
        } catch (error) {
            this.output.appendLine(`Could not read ${pageUri.fsPath}: ${String(error)}`);
            this.panel.webview.html = missingPageHtml();
            return;
        }
        const nonce = makeNonce();
        this.panel.webview.html = html
            .replace(/\{\{nonce\}\}/gu, nonce)
            .replace(/\{\{cspSource\}\}/gu, this.panel.webview.cspSource);
    }

    private async onMessage(message: Incoming): Promise<void> {
        switch (message?.type) {
            case 'ready':
                this.postSettings();
                return;
            case 'scope':
                this.scope = message.scope;
                this.postSettings();
                return;
            case 'set':
                await this.write(message.path, message.value, message.scope);
                return;
            case 'reset':
                await this.write(message.path, undefined, message.scope);
                return;
            default:
        }
    }

    private async write(path: string, value: unknown, scopeId: ScopeId): Promise<void> {
        if (!settingPaths().includes(path)) {
            return;
        }
        const scope = availableScopes().find((s) => s.id === scopeId);
        if (scope === undefined) {
            return;
        }
        this.writing = true;
        try {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION, scope.resource);
            await config.update(path, value, scope.target);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`Could not write ${CONFIG_SECTION}.${path}: ${detail}`);
            void vscode.window.showErrorMessage(
                `SQL Formatter could not save ${CONFIG_SECTION}.${path}. ` +
                'See the SQL Formatter output channel.',
            );
        } finally {
            this.writing = false;
        }
        // Echo the stored state back, so the page shows what was actually saved.
        this.postSettings();
    }

    /** Sends the values in force for the selected scope, and what it overrides. */
    private postSettings(): void {
        const scopes = availableScopes();
        if (!scopes.some((s) => s.id === this.scope)) {
            this.scope = scopes[scopes.length - 1].id;
        }
        const scope = scopes.find((s) => s.id === this.scope) as Scope;
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, scope.resource);

        const values: Record<string, unknown> = {};
        const overridden: string[] = [];
        for (const path of settingPaths()) {
            const info = config.inspect(path);
            if (info === undefined) {
                continue;
            }
            const own = ownValue(info, this.scope);
            if (own !== undefined) {
                overridden.push(path);
            }
            const effective = effectiveValue(info, this.scope);
            if (effective !== undefined) {
                values[path] = effective;
            }
        }

        void this.panel.webview.postMessage({
            type: 'settings',
            scope: this.scope,
            scopes: scopes.map((s) => ({ id: s.id, label: s.label })),
            values,
            overridden,
        });
    }

    private dispose(): void {
        StyleReferencePanel.current = undefined;
        this.panel.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }
}

type Inspected = {
    defaultValue?: unknown;
    globalValue?: unknown;
    workspaceValue?: unknown;
    workspaceFolderValue?: unknown;
};

/** The value this scope sets itself, if any. */
function ownValue(info: Inspected, scope: ScopeId): unknown {
    switch (scope) {
        case 'folder':
            return info.workspaceFolderValue;
        case 'workspace':
            return info.workspaceValue;
        default:
            return info.globalValue;
    }
}

/** The value in force at this scope, falling back through the wider ones. */
function effectiveValue(info: Inspected, scope: ScopeId): unknown {
    const chain =
        scope === 'folder'
            ? [info.workspaceFolderValue, info.workspaceValue, info.globalValue, info.defaultValue]
            : scope === 'workspace'
                ? [info.workspaceValue, info.globalValue, info.defaultValue]
                : [info.globalValue, info.defaultValue];
    return chain.find((value) => value !== undefined);
}

/** User is always available; the others depend on what is open. */
function availableScopes(): Scope[] {
    const scopes: Scope[] = [
        { id: 'user', label: 'User', target: vscode.ConfigurationTarget.Global },
    ];
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length > 0 || vscode.workspace.workspaceFile !== undefined) {
        scopes.push({
            id: 'workspace',
            label: 'Workspace',
            target: vscode.ConfigurationTarget.Workspace,
        });
    }
    const folder = activeFolder(folders);
    if (folder !== undefined) {
        scopes.push({
            id: 'folder',
            label: `Folder: ${folder.name}`,
            target: vscode.ConfigurationTarget.WorkspaceFolder,
            resource: folder.uri,
        });
    }
    return scopes;
}

/** The folder the active editor lives in, else the only folder there is. */
function activeFolder(
    folders: readonly vscode.WorkspaceFolder[],
): vscode.WorkspaceFolder | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active !== undefined) {
        const owner = vscode.workspace.getWorkspaceFolder(active);
        if (owner !== undefined) {
            return owner;
        }
    }
    return folders.length > 0 ? folders[0] : undefined;
}

function makeNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i += 1) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
}

function missingPageHtml(): string {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; padding: 24px; line-height: 1.5;">
<h2 style="margin-top:0;">The style reference has not been built</h2>
<p>Run <code>npm run build:page</code> in the extension folder, then reopen this panel.</p>
</body>
</html>
`;
}
