// A release is built with `git archive HEAD`, so only committed files ship. A source file
// that exists in the working tree but was never committed is silently left out, and a Portal
// whose server.mjs imports it then fails to start on the host that installs the release.
// This reads `git status --porcelain=v1 -z --untracked-files=all` and reports what would be missing.

// What an installed host actually runs. Tests and documentation are not part of that.
const SHIPPED = ['src/', 'scripts/', 'public/', 'views/'];
const SHIPPED_FILES = new Set(['strckro.sh', 'package.json', 'package-lock.json', 'Dockerfile']);
const shipped = (path) => SHIPPED_FILES.has(path) || SHIPPED.some((prefix) => path.startsWith(prefix));

export function releaseBlockers(porcelain) {
  const untracked = [];
  const modified = [];
  const entries = String(porcelain).split('\0').filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index].slice(0, 2);
    const path = entries[index].slice(3);
    // A rename or copy is followed by its original path as a separate entry.
    if (/[RC]/.test(status)) index += 1;
    if (status === '??') { if (shipped(path)) untracked.push(path); }
    else if (status !== '!!') modified.push(path);
  }
  return { untracked, modified };
}
