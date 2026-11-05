import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { database } from "../scripts/db.mjs";
import worker from "../src/worker.mjs";
import { fresh, apply, book, estimate, day, average } from "../src/queue.mjs";
const schema = readFileSync(
  new URL("../migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
function setup() {
  const DB = database(":memory:");
  DB.raw.exec(schema);
  const env = {
    DB,
    ALLOW_SIGNUP: "true",
    ASSETS: { fetch: () => new Response("test") },
  };
  const request = async (
    path,
    { body, cookie, origin = "https://clinic.test", ip = "127.0.0.1" } = {},
  ) => {
    const r = await worker.fetch(
      new Request("https://clinic.test/api" + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          "CF-Connecting-IP": ip,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  };
  return { env, request };
}
const register = (r, n = "one") =>
  r("/auth/register", {
    body: {
      name: "Owner " + n,
      clinic: "Clinic " + n,
      slug: "clinic-" + n,
      email: n + "@example.test",
      password: "Secure-testing-only-123!",
    },
    ip: n,
  });
const addDoctor = (r, c, name = "Dr. A", prefix = "A") =>
  r("/action", {
    cookie: c,
    body: {
      requestId: crypto.randomUUID(),
      action: "doctor",
      name,
      specialty: "General Physician",
      hours: "10:00–14:00",
      minutes: 8,
      capacity: 100,
      prefix,
      enabled: true,
    },
  });
const act = (r, c, b) =>
  r("/action", { cookie: c, body: { requestId: crypto.randomUUID(), ...b } });
test("registration persists, duplicate signup rolls back, credentials are hashed, cookie secured", async () => {
  const { env, request: r } = setup();
  const a = await register(r);
  assert.equal(a.status, 200);
  assert.match(a.headers.get("set-cookie"), /HttpOnly/);
  assert.match(a.headers.get("set-cookie"), /Secure/);
  const u = await r("/me", { cookie: a.cookie });
  assert.equal(u.body.role, "owner");
  assert.equal(
    (await r("/clinic", { cookie: a.cookie })).body.state.name,
    "Clinic one",
  );
  assert.equal((await register(r)).status, 409);
  assert.equal(
    env.DB.raw.prepare("SELECT count(*) AS n FROM clinics").get().n,
    1,
  );
  assert.notEqual(
    env.DB.raw.prepare("SELECT password_hash FROM users").get().password_hash,
    "Secure-testing-only-123!",
  );
  assert.equal(
    (
      await r("/auth/login", {
        body: { email: "one@example.test", password: "incorrect-pass-123" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await r("/auth/login", {
        body: {
          email: "one@example.test",
          password: "Secure-testing-only-123!",
        },
      })
    ).status,
    200,
  );
});
test("tenant and doctor isolation, reception cannot change settings or create staff", async () => {
  const { request: r } = setup();
  const a = await register(r, "one"),
    b = await register(r, "two");
  await addDoctor(r, a.cookie);
  await addDoctor(r, b.cookie);
  const ca = (await r("/clinic", { cookie: a.cookie })).body,
    cb = (await r("/clinic", { cookie: b.cookie })).body;
  const d = ca.state.doctors[0];
  assert.equal(
    (await act(r, b.cookie, { action: "start", doctorId: d.id })).status,
    404,
  );
  assert.equal(cb.state.doctors.length, 1);
  await r("/staff", {
    cookie: a.cookie,
    body: {
      name: "Reception",
      email: "desk@example.test",
      password: "Staff-test-pass-123",
      role: "reception",
    },
  });
  const desk = await r("/auth/login", {
    body: { email: "desk@example.test", password: "Staff-test-pass-123" },
  });
  assert.equal(
    (await act(r, desk.cookie, { action: "settings", name: "attack" })).status,
    403,
  );
  assert.equal((await r("/staff", { cookie: desk.cookie })).status, 403);
  await addDoctor(r, a.cookie, "Dr. B", "B");
  await r("/staff", {
    cookie: a.cookie,
    body: {
      name: "Doctor A",
      email: "doc@example.test",
      password: "Staff-test-pass-123",
      role: "doctor",
      doctorId: d.id,
    },
  });
  const doc = await r("/auth/login", {
    body: { email: "doc@example.test", password: "Staff-test-pass-123" },
  });
  const cd = (await r("/clinic", { cookie: doc.cookie })).body;
  assert.equal(cd.state.doctors.length, 1);
  assert.equal(cd.state.displayKey, undefined);
  const other = (await r("/clinic", { cookie: a.cookie })).body.state
    .doctors[1];
  assert.equal(
    (await act(r, doc.cookie, { action: "start", doctorId: other.id })).status,
    403,
  );
});
test("concurrent bookings get unique tokens, retries are idempotent, stale Next cannot skip a second patient", async () => {
  const { request: r } = setup();
  const a = await register(r);
  await addDoctor(r, a.cookie);
  let c = (await r("/clinic", { cookie: a.cookie })).body;
  const did = c.state.doctors[0].id;
  const bookings = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      act(r, a.cookie, {
        action: "book",
        doctorId: did,
        name: "Patient " + i,
        date: day(),
        arrived: true,
      }),
    ),
  );
  assert.ok(bookings.every((x) => x.status === 200));
  assert.equal(new Set(bookings.map((x) => x.body.patient.token)).size, 4);
  const requestId = crypto.randomUUID(),
    b = {
      action: "book",
      doctorId: did,
      name: "Retry Patient",
      date: day(),
      arrived: true,
      requestId,
    };
  const first = await act(r, a.cookie, b),
    second = await act(r, a.cookie, b);
  assert.equal(first.body.patient.id, second.body.patient.id);
  await act(r, a.cookie, { action: "start", doctorId: did });
  c = (await r("/clinic", { cookie: a.cookie })).body;
  const old = c.state.doctors[0].session.current;
  const results = await Promise.all([
    act(r, a.cookie, { action: "next", doctorId: did, currentId: old }),
    act(r, a.cookie, { action: "next", doctorId: did, currentId: old }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  c = (await r("/clinic", { cookie: a.cookie })).body;
  assert.equal(
    c.state.patients.filter((p) => p.status === "completed").length,
    1,
  );
  assert.equal(c.state.patients.length, 5);
});
test("public booking and ticket expose only intended data; display includes no patient names", async () => {
  const { request: r } = setup();
  const a = await register(r);
  await addDoctor(r, a.cookie);
  let c = (await r("/clinic", { cookie: a.cookie })).body;
  const did = c.state.doctors[0].id;
  const booking = {
    doctorId: did,
    name: "Private Person",
    phone: "9999999999",
    date: day(),
    requestId: crypto.randomUUID(),
    arrived: true,
    priority: true,
  };
  assert.equal(
    (await r("/public/clinic-one/book", { body: booking })).status,
    400,
  );
  await act(r, a.cookie, {
    action: "settings",
    name: "Clinic One",
    address: "Green Park, Delhi",
    phone: "",
    hours: "10–14",
    color: "#087d70",
    logo: "",
    publicBooking: true,
  });
  const p = await r("/public/clinic-one/book", {
    body: { ...booking, requestId: crypto.randomUUID() },
  });
  assert.equal(p.status, 200);
  const t = await r("/public/clinic-one/ticket", {
    body: { key: p.body.trackingKey },
  });
  assert.equal(t.body.patient.name, "Private Person");
  assert.equal(t.body.patient.phone, undefined);
  assert.equal(t.body.patient.arrived, false);
  assert.equal(t.body.clinic.patients, undefined);
  assert.equal(
    (await r("/public/clinic-one/ticket", { body: { key: "a".repeat(48) } }))
      .status,
    404,
  );
  c = (await r("/clinic", { cookie: a.cookie })).body;
  const display = await r("/public/clinic-one/display", {
    body: { key: c.state.displayKey, doctorId: did },
  });
  assert.equal(display.status, 200);
  assert.equal(JSON.stringify(display.body).includes("Private Person"), false);
  assert.equal(
    (
      await r("/public/clinic-one/display", {
        body: { key: "invalid", doctorId: did },
      })
    ).status,
    403,
  );
  const oldKey = c.state.displayKey;
  await act(r, a.cookie, { action: "rotate-display" });
  assert.equal(
    (
      await r("/public/clinic-one/display", {
        body: { key: oldKey, doctorId: did },
      })
    ).status,
    403,
  );
});
test("invalid dates, overcapacity, no-show recall uniqueness and priority order", () => {
  let s = fresh("Test"),
    u = { role: "owner", name: "Owner" },
    now = Date.parse("2026-11-05T05:00:00Z");
  apply(
    s,
    {
      action: "doctor",
      name: "Dr. A",
      specialty: "General",
      hours: "10–14",
      minutes: 8,
      capacity: 3,
      prefix: "A",
      enabled: true,
    },
    u,
    now,
  );
  const did = s.doctors[0].id;
  const b = { doctorId: did, name: "Patient", date: day(now), arrived: true };
  assert.throws(() => book(s, { ...b, date: "2026-11-31" }, now));
  const p1 = book(s, b, now),
    p2 = book(s, b, now),
    p3 = book(s, b, now);
  assert.throws(() => book(s, b, now), /fully booked/);
  apply(s, { action: "start", doctorId: did }, u, now);
  apply(s, { action: "priority", patientId: p3.id }, u, now);
  apply(
    s,
    { action: "next", doctorId: did, currentId: p1.id },
    u,
    now + 480000,
  );
  assert.equal(s.doctors[0].session.current, p3.id);
  apply(s, { action: "noshow", patientId: p2.id }, u, now);
  apply(s, { action: "recall", patientId: p2.id }, u, now);
  assert.throws(() => apply(s, { action: "recall", patientId: p2.id }, u, now));
  assert.equal(s.patients.filter((p) => p.id === p2.id).length, 1);
});
test("estimate excludes completed/cancelled/no-show, counts current remaining once; break stops timer", () => {
  const s = fresh("Test"),
    u = { role: "owner", name: "Owner" },
    now = Date.parse("2026-11-05T05:00:00Z");
  apply(
    s,
    {
      action: "doctor",
      name: "Dr. A",
      specialty: "General",
      hours: "10–14",
      minutes: 8,
      capacity: 10,
      prefix: "A",
      enabled: true,
    },
    u,
    now,
  );
  const d = s.doctors[0],
    b = { doctorId: d.id, name: "Patient", date: day(now), arrived: true };
  const p1 = book(s, b, now),
    p2 = book(s, b, now),
    p3 = book(s, b, now);
  apply(s, { action: "start", doctorId: d.id }, u, now);
  assert.equal(estimate(s, p3, now + 240000), now + 960000);
  apply(s, { action: "cancel", patientId: p2.id }, u, now + 240000);
  assert.equal(estimate(s, p3, now + 240000), now + 480000);
  apply(s, { action: "pause", doctorId: d.id }, u, now + 240000);
  assert.equal(estimate(s, p3, now + 600000), null);
  apply(s, { action: "resume", doctorId: d.id }, u, now + 840000);
  assert.equal(estimate(s, p3, now + 840000), now + 1080000);
  apply(
    s,
    { action: "next", doctorId: d.id, currentId: p1.id },
    u,
    now + 1080000,
  );
  assert.equal(d.session.durations[0], 8);
  d.session.durations = [6, 8, 10];
  assert.equal(average(d), 8);
});
test("CSRF, oversized payloads, disabled staff and logout revoke access", async () => {
  const { request: r } = setup();
  const a = await register(r);
  assert.equal(
    (
      await r("/action", {
        cookie: a.cookie,
        origin: "https://evil.test",
        body: { action: "settings" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await r("/action", { cookie: a.cookie, body: { x: "x".repeat(181000) } }))
      .status,
    413,
  );
  await r("/staff", {
    cookie: a.cookie,
    body: {
      name: "Desk",
      email: "desk@example.test",
      password: "Staff-test-pass-123",
      role: "reception",
    },
  });
  const desk = await r("/auth/login", {
    body: { email: "desk@example.test", password: "Staff-test-pass-123" },
  });
  const staff = (await r("/staff", { cookie: a.cookie })).body;
  await r("/staff", {
    cookie: a.cookie,
    body: {
      action: "disable",
      id: staff.find((s) => s.role === "reception").id,
    },
  });
  assert.equal((await r("/me", { cookie: desk.cookie })).status, 401);
  await r("/auth/logout", { cookie: a.cookie, body: {} });
  assert.equal((await r("/me", { cookie: a.cookie })).status, 401);
});
test("only explicitly configured platform user may change subscription records", async () => {
  const { env, request: r } = setup();
  const a = await register(r),
    b = await register(r, "two");
  assert.equal((await r("/admin", { cookie: a.cookie })).status, 403);
  const me = (await r("/me", { cookie: a.cookie })).body;
  env.PLATFORM_ADMIN_USER_ID = me.id;
  const clinics = (await r("/admin", { cookie: a.cookie })).body;
  assert.equal(clinics.length, 2);
  assert.equal(clinics[0].patients, undefined);
  assert.equal((await r("/admin", { cookie: b.cookie })).status, 403);
  assert.equal(
    (
      await r("/admin", {
        cookie: a.cookie,
        body: {
          clinicId: clinics[1].id,
          requestId: crypto.randomUUID(),
          name: "Clinic",
          status: "active",
          renewalDate: "2026-12-01",
        },
      })
    ).status,
    200,
  );
});

test("saved clinic and session survive database close/reopen", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "clinicsync-persistence-"));
  const file = join(dir, "clinic.sqlite");
  let db = database(file);
  db.raw.exec(schema);
  const env = { DB: db, ALLOW_SIGNUP: "true" };
  const request = new Request("https://clinic.test/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://clinic.test",
    },
    body: JSON.stringify({
      name: "Owner",
      clinic: "Persistent Clinic",
      slug: "persistent",
      email: "persist@example.test",
      password: "Persistence-test-123!",
    }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  db.raw.close();
  db = database(file);
  env.DB = db;
  const restored = await worker.fetch(
    new Request("https://clinic.test/api/clinic", {
      headers: { Cookie: cookie },
    }),
    env,
  );
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).state.name, "Persistent Clinic");
  db.raw.close();
  rmSync(dir, { recursive: true });
});
