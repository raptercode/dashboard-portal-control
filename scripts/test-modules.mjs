import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = (await readdir(new URL('../test/', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs')).sort();
const selectors = process.argv.slice(2);
if (!selectors.length || selectors.includes('--list')) {
  console.log(`${modules.length} test modules:\n${modules.map((name) => name.replace('.test.mjs', '')).join('\n')}`);
} else {
  const matches = (name, selector) => selector === '--all' || name.replace('.test.mjs', '') === selector || name.startsWith(`${selector}-`);
  const unknown = selectors.filter((selector) => !modules.some((name) => matches(name, selector)));
  const selected = modules.filter((name) => selectors.some((selector) => matches(name, selector)));
  if (unknown.length) {
    console.error(`No test module matched: ${unknown.join(', ')}. Use --list for module names.`);
    process.exitCode = 1;
  } else {
    const result = spawnSync(process.execPath, ['--test', ...selected.map((name) => `test/${name}`)], { cwd: root, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  }
}
