#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function markdown(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'knowledge-local') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdown(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}
const docs = await markdown(join(root, 'docs'));
const files = [...docs, join(root, 'README.md'), join(root, 'CHANGELOG.md')];
const failures = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  // Code examples may contain illustrative markdown. Only inspect prose links.
  const prose = content.replace(/```[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!await stat(path).catch(() => null)) failures.push(`${relative(root, file)}: missing ${target}`);
  }
  const local = relative(join(root, 'docs'), file).replaceAll('\\', '/');
  if (/^(th|en)\//.test(local)) {
    const sibling = local.replace(/^(th|en)\//, (_, language) => `${language === 'th' ? 'en' : 'th'}/`);
    if (!await stat(join(root, 'docs', sibling)).catch(() => null)) failures.push(`${local}: missing language counterpart`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${files.length} Markdown files: local links and th/en topic counterparts passed.`);
