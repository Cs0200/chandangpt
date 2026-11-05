import { readFileSync, writeFileSync } from "node:fs";
const id = process.argv[2];
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id || "",
  )
) {
  console.error("Usage: npm run configure -- YOUR_D1_DATABASE_ID");
  process.exit(1);
}
const file = new URL("../wrangler.jsonc", import.meta.url),
  config = JSON.parse(readFileSync(file, "utf8"));
config.d1_databases[0].database_id = id;
writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
console.log("D1 database ID configured. Next: npm run db:migrate");
