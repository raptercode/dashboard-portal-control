import net from 'node:net';

// 64 KiB leaves headroom for the read-project-log operation's line buffer
// while remaining a fixed, non-attacker-reachable bound (loopback Unix socket).
const MAX_RESPONSE_BYTES = 64 * 1024;

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
    const timer = setTimeout(() => socket.destroy(new Error('Host helper timed out.')), 90_000);
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
