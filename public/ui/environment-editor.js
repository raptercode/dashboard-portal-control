export const ENVIRONMENT_MAX_BYTES = 128 * 1024;

// Keep values as written in the file, including quotes, comments and '=' signs.
// This editor does not expand variables or interpret shell expressions.
export function parseEnvironmentDocument(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > ENVIRONMENT_MAX_BYTES) {
    throw new Error('ไฟล์ .env ต้องมีขนาดไม่เกิน 128 KB');
  }
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const seen = new Set();
  const variables = [];
  const lines = normalized.split('\n').map((text, index) => {
    if (/[\u0000\r]/.test(text)) throw new Error(`บรรทัด ${index + 1}: มีอักขระที่ไม่รองรับ`);
    if (!text.trim() || text.trimStart().startsWith('#')) return { text };
    const match = text.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/);
    if (!match) throw new Error(`บรรทัด ${index + 1}: ใช้รูปแบบ KEY=value โดยชื่อเป็นตัวพิมพ์ใหญ่ และค่าต้องอยู่ในบรรทัดเดียว`);
    const [, key, value] = match;
    if (seen.has(key)) throw new Error(`บรรทัด ${index + 1}: ชื่อ ${key} ซ้ำ`);
    seen.add(key);
    variables.push({ key, value });
    return { text, key, value };
  });
  return { content: normalized, lines, variables };
}

export function updateEnvironmentDocument(content, variables) {
  const document = parseEnvironmentDocument(content);
  const remaining = new Map(variables.map((variable) => [variable.key, variable.value]));
  if (remaining.size !== variables.length) throw new Error('ชื่อ environment variable ต้องไม่ซ้ำกัน');
  if (document.variables.length === variables.length && document.variables.every(({ key, value }) => remaining.get(key) === value)) return document.content;
  const lines = document.lines.flatMap((line) => {
    if (!line.key) return [line.text];
    if (!remaining.has(line.key)) return [];
    const value = remaining.get(line.key);
    remaining.delete(line.key);
    return [value === line.value ? line.text : `${line.key}=${value}`];
  });
  while (lines.at(-1) === '') lines.pop();
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return parseEnvironmentDocument(lines.join('\n') + (lines.length ? '\n' : '')).content;
}

export function mergeEnvironmentDocument(content, incoming) {
  const current = parseEnvironmentDocument(content);
  const uploaded = parseEnvironmentDocument(incoming);
  if (!uploaded.variables.length) throw new Error('ไฟล์ที่อัปโหลดไม่มี environment variable');
  if (!current.variables.length && !current.content.trim()) return uploaded.content;
  const variables = new Map(current.variables.map((item) => [item.key, item]));
  for (const item of uploaded.variables) variables.set(item.key, item);
  return updateEnvironmentDocument(current.content, [...variables.values()]);
}
