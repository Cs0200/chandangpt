import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { database } from "./db.mjs";
import worker from "../src/worker.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, ".data"), { recursive: true });
const db = database(resolve(root, ".data/clinicsync.sqlite"));
if (
  !db.raw.prepare("SELECT name FROM sqlite_master WHERE name='clinics'").get()
)
  db.raw.exec(
    readFileSync(resolve(root, "migrations/0001_initial.sql"), "utf8"),
  );
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const env = {
  DB: db,
  ALLOW_SIGNUP: process.env.ALLOW_SIGNUP || "true",
  PLATFORM_ADMIN_USER_ID: process.env.PLATFORM_ADMIN_USER_ID || "",
  ASSETS: {
    async fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path === "/") path = "/index.html";
      const file = resolve(root, "public", "." + path);
      if (!file.startsWith(resolve(root, "public") + "/"))
        return new Response("Not found", { status: 404 });
      try {
        return new Response(readFileSync(file), {
          headers: {
            "Content-Type": mime[extname(file)] || "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
const port = Number(process.env.PORT || 4310);
createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 190000) {
        res.writeHead(413);
        res.end("Too large");
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method)
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const r = await worker.fetch(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end("Server error");
  }
}).listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `ClinicSync running at http://127.0.0.1:${port}\nLocal database: .data/clinicsync.sqlite\nRegistration enabled locally. Use fictional patients for testing.`,
  ),
);
