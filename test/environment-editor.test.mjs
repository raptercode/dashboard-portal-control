import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvironmentDocument, updateEnvironmentDocument, mergeEnvironmentDocument, ENVIRONMENT_MAX_BYTES } from '../public/ui/environment-editor.js';

test('file parsing preserves comments, quotes, empty values, equals and normalizes BOM/CRLF', () => {
  const document = parseEnvironmentDocument('\uFEFF# configuration\r\nAPI_KEY="abc==#literal"\r\nEMPTY=\r\n  URL =https://example.test?q=a=b\r\n');
  assert.deepEqual(document.variables, [
    { key: 'API_KEY', value: '"abc==#literal"' }, { key: 'EMPTY', value: '' }, { key: 'URL', value: 'https://example.test?q=a=b' }
  ]);
  assert.ok(document.content.startsWith('# configuration\n'));
  assert.equal(document.content.includes('\r'), false);
});

test('row editing preserves comments and unchanged formatting while supporting removal, rename and blank values', () => {
  const content = '# keep comment\n  SAME =value\nOLD=remove\nCLEAR=before\n';
  assert.equal(updateEnvironmentDocument(content + '\n', parseEnvironmentDocument(content).variables), content + '\n');
  const updated = updateEnvironmentDocument(content, [{ key: 'SAME', value: 'value' }, { key: 'CLEAR', value: '' }, { key: 'NEW', value: 'a=b' }]);
  assert.equal(updated, '# keep comment\n  SAME =value\nCLEAR=\nNEW=a=b\n');
  assert.deepEqual(parseEnvironmentDocument(updated).variables.map(({ key }) => key), ['SAME', 'CLEAR', 'NEW']);
});

test('upload merges matching keys without removing other values and retains a first upload verbatim', () => {
  const file = '# uploaded\nTOKEN=next\nNEW=\n';
  assert.equal(mergeEnvironmentDocument('', file), file);
  assert.equal(mergeEnvironmentDocument('# original\nTOKEN=old\nKEEP=yes\n', file), '# original\nTOKEN=next\nKEEP=yes\nNEW=\n');
});

test('invalid uploads, duplicate keys, binary input and oversized UTF-8 fail without including values in errors', () => {
  assert.throws(() => parseEnvironmentDocument('KEY=first\nKEY=second'), /บรรทัด 2/);
  assert.throws(() => parseEnvironmentDocument('TOKEN=one\nprivate-value-without-key'), (error) => !error.message.includes('private-value'));
  assert.throws(() => parseEnvironmentDocument('KEY=abc\0'), /บรรทัด 1/);
  assert.throws(() => parseEnvironmentDocument('KEY=' + 'ก'.repeat(ENVIRONMENT_MAX_BYTES / 2)), /128 KB/);
  assert.throws(() => mergeEnvironmentDocument('KEEP=yes', '# empty'), /ไม่มี/);
  assert.throws(() => updateEnvironmentDocument('', [{ key: 'KEY', value: '1' }, { key: 'KEY', value: '2' }]), /ซ้ำ/);
});
