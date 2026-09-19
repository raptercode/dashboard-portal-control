import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const logoDirectory = new URL('../public/ui/runtime-logos/', import.meta.url);

test('runtime logo SVG assets are structurally valid enough for browsers', async () => {
  const files = (await readdir(logoDirectory)).filter((file) => file.endsWith('.svg'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const content = await readFile(new URL(file, logoDirectory), 'utf8');
    assert.match(content, /<svg\b[\s\S]*<\/svg>\s*$/i, `${file} should have an svg root`);
    for (const match of content.matchAll(/<([A-Za-z][\w:.-]*)([^<>]*?)\/?>/g)) {
      if (match[1].startsWith('!') || match[1].startsWith('?')) continue;
      const attributes = [...match[2].matchAll(/\s([A-Za-z_:][\w:.-]*)\s*=/g)].map((item) => item[1]);
      const duplicate = attributes.find((name, index) => attributes.indexOf(name) !== index);
      assert.equal(duplicate, undefined, `${file} has duplicate "${duplicate}" attributes in <${match[1]}>`);
    }
  }
});
