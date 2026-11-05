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
const file = new URL("../wrangler.jsonc", import.meta.url);
const config = readFileSync(file, "utf8");
// Preserve JSONC comments and trailing commas instead of parsing it as JSON.
const field = /"database_id"\s*:\s*"[^"]*"/g;
if ([...config.matchAll(field)].length !== 1) {
  throw new Error("Expected exactly one D1 database_id in wrangler.jsonc.");
}
writeFileSync(file, config.replace(field, `"database_id": "${id}"`));
console.log("D1 database ID configured. Next: npm run db:migrate");
