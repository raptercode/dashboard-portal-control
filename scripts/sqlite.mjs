// Keep the existing SQLite file and SQL contract across supported Node majors.
// Node 20 predates node:sqlite; its synchronous fallback uses the same database.
let DatabaseSync;
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)) {
  ({ DatabaseSync } = await import('node:sqlite'));
} else {
  const { default: BetterSqlite3 } = await import('better-sqlite3');
  DatabaseSync = class {
    #database;
    constructor(path, options = {}) {
      this.#database = new BetterSqlite3(path, { readonly: options.readOnly === true, fileMustExist: options.readOnly === true });
    }
    exec(sql) { return this.#database.exec(sql); }
    prepare(sql) { return this.#database.prepare(sql); }
    close() { return this.#database.close(); }
  };
}

export { DatabaseSync };
