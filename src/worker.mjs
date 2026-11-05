import {
  AppError,
  fail,
  text,
  uid,
  secret,
  fresh,
  apply,
  book,
  event,
  doctor,
  day,
  line,
  average,
  estimate,
  publicClinic,
  ticket,
  session,
} from "./queue.mjs";
const enc = new TextEncoder();
export const hash = async (s) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: enc.encode(salt),
          iterations: 100000,
        },
        key,
        256,
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const email = (v) => {
  v = text(v, 5, 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail("Enter a valid email.");
  return v;
};
const pass = (v) => text(v, 12, 128);
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const run = (env, sql, ...args) =>
  env.DB.prepare(sql)
    .bind(...args)
    .run();
const one = (env, sql, ...args) =>
  env.DB.prepare(sql)
    .bind(...args)
    .first();
async function body(req) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    fail("JSON is required.", 415);
  const raw = await req.text();
  if (raw.length > 180000) fail("Request is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    fail("Invalid JSON.");
  }
}
async function throttle(env, key, limit, minutes = 15) {
  const now = Date.now(),
    k = await hash(key),
    end = now + minutes * 60000;
  await run(
    env,
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<? THEN ? ELSE expires_at END",
    k,
    end,
    now,
    now,
    end,
  );
  const r = await one(env, "SELECT count FROM rate_limits WHERE key=?", k);
  if (r.count > limit) fail("Too many attempts. Please try again later.", 429);
}
const tokenOf = (req) =>
  req.headers.get("cookie")?.match(/(?:^|;\s*)cs_session=([a-f0-9]+)/)?.[1];
async function auth(req, env) {
  const token = tokenOf(req);
  if (!token) fail("Please sign in.", 401);
  const u = await one(
    env,
    "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1",
    await hash(token),
    Date.now(),
  );
  if (!u) fail("Session expired. Please sign in.", 401);
  return u;
}
function cookie(req, token, age = 43200) {
  return `cs_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function signin(req, env, u) {
  const t = secret();
  await run(
    env,
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    await hash(t),
    u.id,
    Date.now() + 43200000,
  );
  return json({ ok: true }, 200, { "Set-Cookie": cookie(req, t) });
}
async function clinic(env, id) {
  const r = await one(env, "SELECT * FROM clinics WHERE id=?", id);
  if (!r) fail("Clinic not found.", 404);
  return r;
}
async function bySlug(env, slug) {
  const r = await one(env, "SELECT * FROM clinics WHERE slug=?", slug);
  if (!r) fail("Clinic not found.", 404);
  return r;
}
export async function mutate(env, id, requestId, actor, fn) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
    fail("Missing request identifier.");
  for (let i = 0; i < 6; i++) {
    const row = await clinic(env, id),
      s = JSON.parse(row.state);
    const previous = s.requests.find((r) => r.id === requestId);
    if (previous) {
      if (previous.actor !== actor) fail("Invalid request identifier.", 409);
      return previous.result;
    }
    const result = fn(s);
    s.requests.push({ id: requestId, actor, result });
    s.requests = s.requests.slice(-200);
    const update = await run(
      env,
      "UPDATE clinics SET state=?,version=version+1 WHERE id=? AND version=?",
      JSON.stringify(s),
      id,
      row.version,
    );
    if (update.meta.changes === 1) return result;
  }
  fail("Queue is busy. Refresh and try again.", 409);
}
async function route(req, env) {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method,
    ip = req.headers.get("CF-Connecting-IP") || "local";
  if (method !== "GET" && method !== "HEAD") {
    if (req.headers.get("origin") !== url.origin)
      fail("Request origin rejected.", 403);
  }
  if (path === "/api/health") return json({ ok: true, service: "ClinicSync" });
  if (path === "/api/auth/register" && method === "POST") {
    if (env.ALLOW_SIGNUP !== "true")
      fail(
        "New clinic registration is closed. Contact the service owner.",
        403,
      );
    await throttle(env, "signup:" + ip, 5, 60);
    const b = await body(req),
      e = email(b.email),
      name = text(b.name, 2, 70),
      pw = pass(b.password),
      clinicName = text(b.clinic, 2, 80);
    const slug = text(b.slug, 3, 50).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      fail(
        "Use lowercase letters, numbers and single hyphens for the clinic link.",
      );
    const salt = secret(),
      password_hash = await passwordHash(pw, salt),
      id = uid(),
      userId = uid();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO clinics(id,slug,state,created_at) VALUES(?,?,?,?)",
        ).bind(id, slug, JSON.stringify(fresh(clinicName)), Date.now()),
        env.DB.prepare(
          "INSERT INTO users(id,clinic_id,email,name,password_hash,salt,role) VALUES(?,?,?,?,?,?,?)",
        ).bind(userId, id, e, name, password_hash, salt, "owner"),
      ]);
    } catch (err) {
      if (/UNIQUE/.test(err.message))
        fail("That email or clinic link is already in use.", 409);
      throw err;
    }
    return signin(req, env, { id: userId });
  }
  if (path === "/api/auth/login" && method === "POST") {
    await throttle(env, "login-ip:" + ip, 30);
    const b = await body(req),
      e = email(b.email);
    await throttle(env, "login-email:" + e, 10);
    const u = await one(
      env,
      "SELECT * FROM users WHERE email=? AND active=1",
      e,
    );
    const candidate = await passwordHash(
      pass(b.password),
      u?.salt || "unknown-account-padding",
    );
    if (!u || candidate !== u.password_hash)
      fail("Email or password is incorrect.", 401);
    return signin(req, env, u);
  }
  if (path === "/api/auth/logout" && method === "POST") {
    const t = tokenOf(req);
    if (t)
      await run(env, "DELETE FROM sessions WHERE token_hash=?", await hash(t));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(req, "", 0) });
  }
  if (path.startsWith("/api/public/")) {
    const parts = path.split("/").filter(Boolean),
      slug = parts[2],
      row = await bySlug(env, slug);
    if (parts.length === 3 && method === "GET")
      return json({ ...publicClinic(row), today: day(), now: Date.now() });
    if (parts[3] === "book" && method === "POST") {
      await throttle(env, "booking:" + ip + ":" + row.id, 8, 60);
      const b = await body(req);
      const result = await mutate(env, row.id, b.requestId, "public", (s) => {
        if (!s.publicBooking)
          fail("Online bookings are closed. Contact reception.");
        const p = book(s, b, Date.now(), true);
        event(s, `${p.token} booked online.`, null, Date.now());
        return { trackingKey: p.key, token: p.token };
      });
      return json(result);
    }
    if (parts[3] === "ticket" && method === "POST") {
      const b = await body(req);
      if (typeof b.key !== "string" || !/^[a-f0-9]{48}$/.test(b.key))
        fail("Invalid tracking link.", 404);
      return json(ticket(row, b.key));
    }
    if (parts[3] === "display" && method === "POST") {
      const b = await body(req),
        s = JSON.parse(row.state);
      if (b.key !== s.displayKey) fail("Display link expired or invalid.", 403);
      const d = doctor(s, b.doctorId),
        q = d.sessionDay === day() ? d.session : session(),
        first = line(s, d.id)[0];
      return json({
        clinic: publicClinic(row),
        doctor: { name: d.name, specialty: d.specialty },
        status: q.status,
        current: s.patients.find((p) => p.id === q.current)?.token || null,
        next: line(s, d.id)
          .slice(0, 3)
          .map((p) => p.token),
        eta: first ? estimate(s, first) : null,
        delayUntil: q.delayUntil,
        priority: !!first?.priority,
        now: Date.now(),
        version: row.version,
      });
    }
    fail("Not found.", 404);
  }
  const u = await auth(req, env);
  if (path === "/api/me" && method === "GET")
    return json({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      doctorId: u.doctor_id,
      clinicId: u.clinic_id,
      platformAdmin: env.PLATFORM_ADMIN_USER_ID === u.id,
    });
  if (path === "/api/clinic" && method === "GET") {
    const row = await clinic(env, u.clinic_id),
      s = JSON.parse(row.state);
    delete s.requests;
    if (u.role === "doctor") {
      s.doctors = s.doctors.filter((d) => d.id === u.doctor_id);
      s.patients = s.patients.filter((p) => p.doctorId === u.doctor_id);
      s.events = [];
      delete s.displayKey;
    }
    return json({
      id: row.id,
      slug: row.slug,
      version: row.version,
      state: s,
      now: Date.now(),
    });
  }
  if (path === "/api/action" && method === "POST") {
    const b = await body(req);
    return json(
      await mutate(env, u.clinic_id, b.requestId, u.id, (s) => apply(s, b, u)),
    );
  }
  if (path === "/api/password" && method === "POST") {
    const b = await body(req);
    if ((await passwordHash(pass(b.current), u.salt)) !== u.password_hash)
      fail("Current password is incorrect.", 403);
    const salt = secret(),
      ph = await passwordHash(pass(b.password), salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?").bind(
        salt,
        ph,
        u.id,
      ),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
    ]);
    return signin(req, env, u);
  }
  if (path === "/api/staff") {
    if (u.role !== "owner") fail("Owner access required.", 403);
    if (method === "GET") {
      const r = await env.DB.prepare(
        "SELECT id,name,email,role,doctor_id,active FROM users WHERE clinic_id=?",
      )
        .bind(u.clinic_id)
        .all();
      return json(r.results);
    }
    if (method === "POST") {
      const b = await body(req);
      if (b.action === "disable") {
        if (b.id === u.id) fail("You cannot disable your own account.");
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE users SET active=0 WHERE id=? AND clinic_id=? AND role!=?",
          ).bind(b.id, u.clinic_id, "owner"),
          env.DB.prepare(
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE id=? AND clinic_id=? AND role!=?)",
          ).bind(b.id, u.clinic_id, "owner"),
        ]);
        return json({ ok: true });
      }
      if (!["reception", "doctor"].includes(b.role))
        fail("Choose a staff role.");
      const s = JSON.parse((await clinic(env, u.clinic_id)).state);
      if (b.role === "doctor") doctor(s, b.doctorId);
      const count = await one(
        env,
        "SELECT count(*) AS n FROM users WHERE clinic_id=?",
        u.clinic_id,
      );
      if (count.n >= 50) fail("Pilot supports up to 50 staff accounts.");
      const salt = secret(),
        ph = await passwordHash(pass(b.password), salt);
      try {
        await run(
          env,
          "INSERT INTO users(id,clinic_id,email,name,password_hash,salt,role,doctor_id) VALUES(?,?,?,?,?,?,?,?)",
          uid(),
          u.clinic_id,
          email(b.email),
          text(b.name, 2, 70),
          ph,
          salt,
          b.role,
          b.role === "doctor" ? b.doctorId : null,
        );
      } catch (err) {
        if (/UNIQUE/.test(err.message))
          fail("That email is already registered.", 409);
        throw err;
      }
      return json({ ok: true }, 201);
    }
  }
  if (path === "/api/admin") {
    if (!env.PLATFORM_ADMIN_USER_ID || env.PLATFORM_ADMIN_USER_ID !== u.id)
      fail("Platform administrator access required.", 403);
    if (method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,slug,state,created_at FROM clinics",
      ).all();
      return json(
        rows.results.map((r) => {
          const s = JSON.parse(r.state);
          return {
            id: r.id,
            slug: r.slug,
            name: s.name,
            doctors: s.doctors.length,
            appointments: s.patients.length,
            createdAt: r.created_at,
            plan: s.plan,
          };
        }),
      );
    }
    if (method === "POST") {
      const b = await body(req);
      return json(
        await mutate(env, b.clinicId, b.requestId, u.id, (s) => {
          if (!["trial", "active", "past-due", "cancelled"].includes(b.status))
            fail("Invalid plan status.");
          s.plan = {
            name: text(b.name, 2, 50),
            status: b.status,
            renewalDate: b.renewalDate ? text(b.renewalDate, 10, 10) : null,
          };
          event(s, "Subscription record updated manually.", u, Date.now());
          return { ok: true };
        }),
      );
    }
  }
  fail("Not found.", 404);
}
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
export default {
  async fetch(req, env) {
    let r;
    try {
      if (new URL(req.url).pathname.startsWith("/api/"))
        r = await route(req, env);
      else r = await env.ASSETS.fetch(req);
    } catch (e) {
      if (!(e instanceof AppError)) console.error("Request failed:", e.message);
      r = json(
        {
          error:
            e instanceof AppError
              ? e.message
              : "Something went wrong. Please try again.",
        },
        e.status || 500,
      );
    }
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(security)) h.set(k, v);
    if (new URL(req.url).protocol === "https:")
      h.set("Strict-Transport-Security", "max-age=31536000");
    return new Response(r.body, { status: r.status, headers: h });
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(
        Date.now(),
      ),
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
        Date.now(),
      ),
    ]);
  },
};
