import { DatabaseSync } from "node:sqlite";
export function database(filename) {
  const raw = new DatabaseSync(filename);
  raw.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  const wrap = (sql, args = []) => ({
    bind(...values) {
      return wrap(sql, values);
    },
    async first() {
      return raw.prepare(sql).get(...args) || null;
    },
    async all() {
      return { results: raw.prepare(sql).all(...args) };
    },
    async run() {
      return this._run();
    },
    _run() {
      const result = raw.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    raw,
    prepare: wrap,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((s) => s._run());
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
