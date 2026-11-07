export function createApi({
  fetcher = globalThis.fetch,
  now = Date.now,
  onUnauthorized = () => {},
} = {}) {
  const cache = new Map();
  let csrf = null;
  async function request(path, options = {}) {
    const {
      method = "GET",
      body,
      ttl = 10000,
      force = false,
      signal,
    } = options;
    const secretRead = /\/environment(?:\/|$)/.test(path);
    const cached = secretRead ? null : cache.get(path);
    if (method === "GET" && !force && cached && cached.expires > now())
      return cached.promise;
    const task = (async () => {
      const response = await fetcher(path, {
        method,
        credentials: "same-origin",
        signal,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(method !== "GET" && csrf ? { "x-csrf-token": csrf } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response
        .json()
        .catch(() => ({ error: "รูปแบบข้อมูลจาก server ไม่ถูกต้อง" }));
      if (!response.ok) {
        const error = Object.assign(
          new Error(data.error || `Request failed (${response.status})`),
          { status: response.status },
        );
        if (
          response.status === 401 &&
          !["/api/login", "/api/bootstrap"].includes(path)
        )
          onUnauthorized();
        throw error;
      }
      if (data.csrfToken) csrf = data.csrfToken;
      if (method !== "GET") cache.clear();
      return data;
    })();
    if (method === "GET" && ttl > 0 && !secretRead) {
      const entry = { promise: task, expires: now() + ttl };
      cache.set(path, entry);
      task.catch(() => {
        if (cache.get(path) === entry) cache.delete(path);
      });
    }
    return task;
  }
  return {
    get: (path, options) => request(path, options),
    post: (path, body = {}, options = {}) =>
      request(path, { ...options, method: "POST", body }),
    patch: (path, body = {}, options = {}) =>
      request(path, { ...options, method: "PATCH", body }),
    delete: (path, body = {}) => request(path, { method: "DELETE", body }),
    clear: () => {
      cache.clear();
      csrf = null;
    },
    invalidate: (prefix = "") => {
      for (const key of cache.keys())
        if (key.startsWith(prefix)) cache.delete(key);
    },
  };
}
