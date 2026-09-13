/**
 * Builds the style reference page.
 *
 * The page ships in two places from one template:
 *   media/style-reference.html   the VS Code webview document (in the .vsix)
 *   build/artifact-page.html     the fragment published as a claude.ai Artifact
 *
 * Examples are not written by hand. Every before/after pair is produced by
 * running the real formatter over a sample, so the page cannot drift from the
 * extension, and a setting that changes nothing is reported rather than faked.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const HERE = __dirname;

const { GROUPS } = require('./catalogue.js');
const { formatSql, DEFAULT_OPTIONS } = require(path.join(ROOT, 'out', 'formatter'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PROPS = pkg.contributes.configuration.properties;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const get = (obj, p) => p.split('.').reduce((n, k) => (n == null ? n : n[k]), obj);

function setIn(obj, p, value) {
    const keys = p.split('.');
    let node = obj;
    for (const k of keys.slice(0, -1)) {
        if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
        node = node[k];
    }
    node[keys[keys.length - 1]] = value;
    return obj;
}

function merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
            ? merge(out[k], v)
            : v;
    }
    return out;
}

const LABELS = {
    toLeft: 'To left', toLeftWithIndent: 'To left with indent', toRight: 'To right',
    newLine: 'New line', sameLine: 'Same line', asInCommon: 'As in common',
    chop: 'Chop', chopIfLong: 'Chop if long', wrapIfLong: 'Wrap if long', doNotChange: 'Do not change',
    toBegin: 'To begin', toEnd: 'To end', auto: 'Auto', inTheMiddle: 'In the middle',
    indented: 'Indented', aligned: 'Aligned',
    sameLineAligned: 'Same line aligned', wrappedUnindented: 'Wrapped unindented',
    wrappedAligned: 'Wrapped aligned', wrappedIndented: 'Wrapped indented',
    atTheEnd: 'At the end', underOpening: 'Under opening', underElements: 'Under elements',
    unindented: 'Unindented', enabled: 'Enabled', subqueriesOnly: 'Subqueries only', disabled: 'Disabled',
    withCase: 'With CASE', withWhen: 'With WHEN', lineEnd: 'Line end',
    table: 'Table', fromIndented: 'FROM indented', from: 'FROM', tableIndented: 'Table indented',
    upper: 'Upper', lower: 'Lower', preserve: 'Preserve',
};

function titleise(settingPath) {
    const leaf = settingPath.split('.').pop();
    const words = leaf.replace(/([A-Z])/gu, ' $1').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

function buildData() {
    const seen = new Set();
    const groups = GROUPS.map((group) => {
        const settings = group.settings.map((entry) => {
            const [settingPath, over = {}] = Array.isArray(entry) ? entry : [entry, {}];
            const id = 'sqlFormatter.' + settingPath;
            const prop = PROPS[id];
            if (!prop) throw new Error('unknown setting: ' + id);
            seen.add(id);

            const def = get(DEFAULT_OPTIONS, settingPath);
            if (over.demo !== undefined && over.demo === def) {
                throw new Error('demo value equals the default for ' + settingPath);
            }

            let values = null;
            let demo;
            if (prop.enum) {
                values = prop.enum.map((v) => ({ value: v, label: LABELS[v] || v }));
                demo = over.demo !== undefined ? over.demo : prop.enum.find((v) => v !== def);
            } else if (prop.type === 'boolean') {
                demo = over.demo !== undefined ? over.demo : !def;
            } else {
                demo = over.demo !== undefined ? over.demo : def + 2;
            }

            const sql = over.sql || group.sql;
            const options = merge(merge({}, group.options || {}), over.options || {});
            const before = formatSql(sql, setIn(merge({}, options), settingPath, def));
            const after = formatSql(sql, setIn(merge({}, options), settingPath, demo));

            return {
                path: settingPath, id, label: titleise(settingPath),
                description: prop.description, type: prop.enum ? 'enum' : prop.type,
                values, def, demo, sql, options, note: over.note || null,
                effective: before !== after,
            };
        });
        return {
            id: group.id, tab: group.tab, name: group.name,
            blurb: group.blurb, settings,
        };
    });

    const declared = Object.keys(PROPS)
        .filter((k) => k !== 'sqlFormatter.enable' && k !== 'sqlFormatter.dialect');
    const missing = declared.filter((k) => !seen.has(k));
    if (missing.length) {
        throw new Error('settings missing from every group:\n  ' + missing.join('\n  '));
    }
    return groups;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

function bundleFormatter() {
    const result = esbuild.buildSync({
        entryPoints: [path.join(ROOT, 'web', 'entry.ts')],
        bundle: true, format: 'iife', target: 'es2020', minify: true,
        write: false,
    });
    return result.outputFiles[0].text;
}

function fill(template, bundle, data, nonceAttr) {
    if (!template.includes('/*__BUNDLE__*/') || !template.includes('/*__DATA__*/')) {
        throw new Error('page template is missing its placeholders');
    }
    const json = JSON.stringify(data);
    if (bundle.includes('</script') || json.includes('</script')) {
        throw new Error('payload contains a script-closing sequence');
    }
    return template
        .replace(/%NONCE%/gu, () => nonceAttr)
        .replace('/*__BUNDLE__*/', () => bundle)
        .replace('/*__DATA__*/', () => json);
}

/** Wraps the fragment as a standalone document for the VS Code webview. */
function asWebviewDocument(fragment) {
    const end = fragment.indexOf('</style>');
    if (end === -1) throw new Error('page template has no style block');
    const head = fragment.slice(0, end + '</style>'.length);
    const body = fragment.slice(end + '</style>'.length);
    const csp = [
        "default-src 'none'",
        "style-src {{cspSource}} 'unsafe-inline' https://fonts.googleapis.com",
        'font-src {{cspSource}} https://fonts.gstatic.com',
        'img-src {{cspSource}} data:',
        "script-src 'nonce-{{nonce}}'",
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html { color-scheme: light dark; }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * Reports enum values that produce identical output on their example.
 *
 * Some overlap is inherent: `asInCommon` resolves to whatever Common says,
 * `auto` resolves to whatever the source already did, and the wrap modes agree
 * whenever a list is too long (or short) for the choice between them to matter.
 * Anything else means a value the formatter does not actually implement, which
 * is what this guards against.
 */
const WRAP_VALUES = new Set(['chop', 'chopIfLong', 'wrapIfLong', 'doNotChange']);

function auditValues(groups) {
    let unexplained = 0;
    let expected = 0;
    for (const group of groups) {
        for (const setting of group.settings) {
            if (!setting.values || setting.values.length < 2) {
                continue;
            }
            const byOutput = new Map();
            for (const { value } of setting.values) {
                const out = formatSql(
                    setting.sql,
                    setIn(merge({}, setting.options), setting.path, value),
                );
                if (!byOutput.has(out)) byOutput.set(out, []);
                byOutput.get(out).push(value);
            }
            for (const values of byOutput.values()) {
                if (values.length < 2) {
                    continue;
                }
                const inherits = values.includes('asInCommon') || values.includes('auto');
                const wraps = values.every((v) => WRAP_VALUES.has(v));
                if (inherits || wraps) {
                    expected += values.length - 1;
                    continue;
                }
                unexplained += values.length - 1;
                console.error(
                    `  ${setting.path}: ${values.join(' = ')} produce identical output`,
                );
            }
        }
    }
    return { expected, unexplained };
}

function main() {
    const groups = buildData();
    const data = { groups };
    const template = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8');
    const bundle = bundleFormatter();

    const webview = asWebviewDocument(fill(template, bundle, data, ' nonce="{{nonce}}"'));
    const artifact = fill(template, bundle, data, '');

    fs.mkdirSync(path.join(ROOT, 'media'), { recursive: true });
    fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'media', 'style-reference.html'), webview);
    fs.writeFileSync(path.join(ROOT, 'build', 'artifact-page.html'), artifact);

    const total = groups.reduce((n, g) => n + g.settings.length, 0);
    const live = groups.reduce((n, g) => n + g.settings.filter((s) => s.effective).length, 0);
    const audit = auditValues(groups);
    if (audit.unexplained > 0) {
        throw new Error(
            `${audit.unexplained} enum values produce no output of their own; ` +
            'either implement them or give the example a value that shows them apart',
        );
    }
    console.log(
        `style page: ${groups.length} groups, ${total} settings, ` +
        `${live} change output, ${total - live} declared but inert`,
    );
    console.log(
        `  enum values: all distinct except ${audit.expected} that inherit, ` +
        'follow the source, or coincide on their example',
    );
    console.log(`  media/style-reference.html  ${(webview.length / 1024).toFixed(0)} KB`);
    console.log(`  build/artifact-page.html    ${(artifact.length / 1024).toFixed(0)} KB`);
}

main();
