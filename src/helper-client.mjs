import net from 'node:net';

// Allow JSON escaping of the bounded 48 KiB deployment diagnostics and runtime
// log lines, while retaining a fixed limit on the root-owned socket response.
const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Send one bounded JSON request to the root-owned helper over its Unix socket.
 * The dashboard never executes a root script or interpolates browser input into
 * a shell command.
 */
export function callHostHelper(socketPath, request) {
  return new Promise((resolve, reject) => {
    if (typeof socketPath !== 'string' || !socketPath.startsWith('/')) return reject(new Error('Host helper socket is not configured.'));
    const socket = net.createConnection(socketPath);
    let response = '';
    // Activation can create a per-release venv or build Compose images before
    // health checks and TLS. Package installs and mail certificates can also
    // legitimately outlive the normal short helper budget.
    const timeoutMs = request?.operation === 'activate-project'
      ? 900_000
      : request?.operation === 'install-tool'
        ? 540_000
        : request?.operation === 'configure-mail'
          ? 240_000
          : 90_000;
    const timer = setTimeout(() => socket.destroy(new Error('Host helper timed out.')), timeoutMs);
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) socket.destroy(new Error('Host helper returned an oversized response.'));
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    socket.once('end', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(response);
        if (!result || typeof result !== 'object') throw new Error('Invalid host helper response.');
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}
