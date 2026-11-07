// Fixed-window failure counters for throttling anonymous endpoints (login, owner
// bootstrap). Only failures are recorded, so a person who signs in correctly is never
// slowed down by their own successes.
//
// The table is bounded. When it is full the oldest key is dropped, never a new one
// refused: refusing would let a flood of made-up keys lock every real visitor out.
export function createFailureWindow({ windowMs = 15 * 60 * 1000, maxKeys = 10_000, now = Date.now } = {}) {
  const entries = new Map();
  const live = (key) => {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= now()) { entries.delete(key); return undefined; }
    return entry;
  };
  return {
    // True once `limit` failures are on record for `key` inside the current window.
    blocked: (key, limit) => (live(key)?.count ?? 0) >= limit,
    fail(key) {
      const entry = live(key) ?? { count: 0, resetAt: now() + windowMs };
      entry.count += 1;
      // Re-insert so the Map's iteration order is also "least recently failed first".
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxKeys) entries.delete(entries.keys().next().value);
    },
    // Give back one failure that was counted ahead of time (see the login handler), keeping
    // everything else on record for the key.
    forgive(key) {
      const entry = live(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) entries.delete(key);
    },
    clear: (key) => { entries.delete(key); },
    get size() { return entries.size; }
  };
}
