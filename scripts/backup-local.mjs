import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
const dir = new URL("../.data/backups/", import.meta.url);
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(
  new URL("../.data/clinicsync.sqlite", import.meta.url),
);
const name =
  "clinicsync-" + new Date().toISOString().replaceAll(":", "-") + ".sqlite";
await backup(db, new URL(name, dir).pathname);
db.close();
console.log("Backup saved to .data/backups/" + name);
