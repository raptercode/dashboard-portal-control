import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createRenderer(viewsDir) {
  async function readTemplate(relativePath) {
    return readFile(join(viewsDir, relativePath), 'utf8');
  }

  async function expandIncludes(source) {
    let output = source;
    const pattern = /\{\{>\s*([\w./-]+)\s*\}\}/g;
    let match;
    while ((match = pattern.exec(output))) {
      const partial = await expandIncludes(await readTemplate(match[1]));
      output = `${output.slice(0, match.index)}${partial}${output.slice(match.index + match[0].length)}`;
      pattern.lastIndex = 0;
    }
    return output;
  }

  function applyLocals(source, locals) {
    return source
      .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, key) => String(lookup(locals, key) ?? ''))
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => escapeHtml(String(lookup(locals, key) ?? '')));
  }

  async function render(view, locals = {}) {
    const body = applyLocals(await expandIncludes(await readTemplate(`pages/${view}.html`)), locals);
    const layout = await expandIncludes(await readTemplate('layout.html'));
    return applyLocals(layout, { ...locals, body });
  }

  return { render };
}

function lookup(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
