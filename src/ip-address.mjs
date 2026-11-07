// The 8 groups of any textual IPv6 address, including "::" and a trailing dotted quad,
// or null when it is not one. Callers that need a verdict on an address (is it public,
// which /64 is it in) work on these numbers instead of on its many spellings.
export function ipv6Hextets(text) {
  let address = String(text);
  const dotted = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    address = address.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - left.length - right.length)).fill('0');
  const groups = [...left, ...fill, ...right].map((group) => parseInt(group || '0', 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}
