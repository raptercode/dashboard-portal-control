export const DEFAULT_NODE_MAJOR = 24;
export const NODE_VERSIONS = Object.freeze({
  20: '20.20.2',
  22: '22.23.4',
  24: '24.22.2',
  26: '26.13.0'
});

export function nodeMajorForProject(value) {
  const major = value === undefined || value === null ? DEFAULT_NODE_MAJOR : Number(value);
  if (!Number.isInteger(major) || !Object.hasOwn(NODE_VERSIONS, major)) throw new Error('Node.js version must be 20, 22, 24 or 26.');
  return major;
}

export function nodeBin(major) {
  return `/opt/node-v${NODE_VERSIONS[nodeMajorForProject(major)]}/bin`;
}

export function nodeRuntimeEnvironment(major, environment = process.env) {
  return { ...environment, PATH: `${nodeBin(major)}:${environment.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}` };
}
