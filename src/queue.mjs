export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const fail = (message, status = 400) => {
  throw new AppError(message, status);
};
export const text = (v, min = 1, max = 100) => {
  if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
    fail(`Please enter ${min}–${max} characters.`);
  return v.trim();
};
export const int = (v, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    fail(`Enter a number between ${min} and ${max}.`);
  return n;
};
export const uid = () => crypto.randomUUID();
export const secret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
export const day = (now = Date.now()) =>
  new Date(now + 19800000).toISOString().slice(0, 10);
export const session = () => ({
  status: "idle",
  current: null,
  startedAt: null,
  pausedAt: null,
  pausedMs: 0,
  delayUntil: 0,
  durations: [],
});
export function fresh(name) {
  return {
    name,
    address: "",
    phone: "",
    hours: "10:00–14:00",
    color: "#087d70",
    logo: "",
    publicBooking: false,
    doctors: [],
    patients: [],
    counters: {},
    events: [],
    requests: [],
    plan: { name: "Pilot", status: "trial", renewalDate: null },
    displayKey: secret(),
  };
}
export function doctor(s, id) {
  const d = s.doctors.find((x) => x.id === id);
  if (!d) fail("Doctor not found.", 404);
  return d;
}
export function todaySession(d, now) {
  if (d.sessionDay !== day(now)) {
    d.sessionDay = day(now);
    d.session = session();
  }
  return d.session;
}
export function average(d) {
  const a = d.session?.durations || [];
  return a.length >= 3
    ? Math.round(a.slice(-5).reduce((a, b) => a + b, 0) / Math.min(a.length, 5))
    : d.minutes;
}
export function line(s, did, now = Date.now()) {
  return s.patients
    .filter(
      (p) =>
        p.doctorId === did && p.date === day(now) && p.status === "waiting",
    )
    .sort(
      (a, b) => Number(b.priority) - Number(a.priority) || a.order - b.order,
    );
}
export function elapsed(q, now) {
  return Math.max(
    0,
    ((q.pausedAt || now) - (q.startedAt || now) - q.pausedMs) / 60000,
  );
}
export function estimate(s, p, now = Date.now()) {
  const d = doctor(s, p.doctorId),
    q = d.session;
  if (
    p.date !== day(now) ||
    d.sessionDay !== day(now) ||
    q?.status !== "active" ||
    !["waiting", "serving"].includes(p.status)
  )
    return null;
  if (p.status === "serving") return now;
  const ahead = line(s, d.id, now).findIndex((x) => x.id === p.id);
  if (ahead < 0) return null;
  const remain = q.current ? Math.max(0, average(d) - elapsed(q, now)) : 0;
  return (
    now +
    (remain + ahead * average(d)) * 60000 +
    Math.max(0, q.delayUntil - now)
  );
}
export function event(s, message, actor, now) {
  s.events.unshift({
    id: uid(),
    at: now,
    message,
    actor: actor?.name || "Patient",
  });
  s.events = s.events.slice(0, 150);
}
function advance(s, d, now) {
  const q = d.session,
    p = line(s, d.id, now).find((p) => p.arrived);
  q.current = p?.id || null;
  q.startedAt = p ? now : null;
  q.pausedMs = 0;
  q.pausedAt = null;
  if (p) p.status = "serving";
  return p;
}
export function book(s, b, now = Date.now(), publicRequest = false) {
  const d = doctor(s, b.doctorId);
  if (!d.enabled) fail("This doctor is not accepting bookings.");
  const date = text(b.date, 10, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    fail("Choose a valid appointment date.");
  if (date < day(now) || date > day(now + 30 * 86400000))
    fail("Choose a date within the next 30 days.");
  const count = s.patients.filter(
    (p) =>
      p.doctorId === d.id &&
      p.date === date &&
      !["cancelled", "no-show"].includes(p.status),
  ).length;
  if (count >= d.capacity) fail("This session is fully booked.", 409);
  if (s.patients.length >= 2000)
    fail("Pilot storage limit reached. Contact the clinic owner.", 409);
  const n = (s.counters[date] || 0) + 1;
  s.counters[date] = n;
  const p = {
    id: uid(),
    key: secret(),
    name: text(b.name, 2, 70),
    phone: b.phone ? text(b.phone, 5, 20) : "",
    doctorId: d.id,
    date,
    token: `${d.prefix}-${String(n).padStart(3, "0")}`,
    type: publicRequest
      ? "Appointment"
      : b.type === "Walk-in"
        ? "Walk-in"
        : "Appointment",
    status: "waiting",
    arrived: !publicRequest && !!b.arrived,
    priority: !publicRequest && !!b.priority,
    order: now + n / 100000,
    createdAt: now,
  };
  s.patients.push(p);
  return p;
}
export function apply(s, b, u, now = Date.now()) {
  const owner = u.role === "owner",
    staff = owner || u.role === "reception";
  let d, q, p;
  if (["doctor", "settings", "rotate-display"].includes(b.action) && !owner)
    fail("Owner access required.", 403);
  if (b.doctorId) {
    d = doctor(s, b.doctorId);
    if (u.role === "doctor" && u.doctor_id !== d.id)
      fail("This doctor is not assigned to you.", 403);
    q = todaySession(d, now);
  }
  if (b.patientId) {
    p = s.patients.find((p) => p.id === b.patientId);
    if (!p) fail("Appointment not found.", 404);
    d = doctor(s, p.doctorId);
    if (u.role === "doctor" && u.doctor_id !== d.id)
      fail("This doctor is not assigned to you.", 403);
    q = todaySession(d, now);
  }
  let result = {};
  switch (b.action) {
    case "settings": {
      s.name = text(b.name, 2, 80);
      s.address = text(b.address || "", 0, 200);
      s.phone = text(b.phone || "", 0, 30);
      s.hours = text(b.hours || "", 0, 80);
      if (!/^#[0-9a-f]{6}$/i.test(b.color))
        fail("Choose a valid brand colour.");
      s.color = b.color;
      if (
        typeof b.logo !== "string" ||
        b.logo.length > 120000 ||
        (b.logo &&
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo))
      )
        fail("Upload a PNG, JPEG or WebP logo under 100 KB.");
      s.logo = b.logo;
      s.publicBooking = !!b.publicBooking;
      break;
    }
    case "rotate-display":
      s.displayKey = secret();
      break;
    case "doctor": {
      if (s.doctors.length >= 20 && !b.id)
        fail("Pilot supports up to 20 doctors.");
      const existing = b.id ? doctor(s, b.id) : null;
      const prefix = text(b.prefix, 1, 5).toUpperCase();
      if (!/^[A-Z]{1,5}$/.test(prefix))
        fail("Use 1–5 letters for the token prefix.");
      if (s.doctors.some((x) => x.id !== b.id && x.prefix === prefix))
        fail("Use a unique doctor token prefix.");
      const item = {
        id: existing?.id || uid(),
        name: text(b.name, 2, 70),
        specialty: text(b.specialty, 2, 80),
        hours: text(b.hours, 3, 80),
        minutes: int(b.minutes, 2, 60),
        capacity: int(b.capacity, 1, 300),
        prefix,
        enabled: !!b.enabled,
        session: existing?.session || session(),
        sessionDay: existing?.sessionDay || day(now),
      };
      if (existing) Object.assign(existing, item);
      else s.doctors.push(item);
      break;
    }
    case "book":
      if (!staff) fail("Reception access required.", 403);
      result.patient = book(s, b, now);
      break;
    case "checkin":
      if (!staff) fail("Reception access required.", 403);
      if (p.status !== "waiting") fail("Only waiting patients can check in.");
      p.arrived = true;
      break;
    case "priority":
      if (!staff) fail("Reception access required.", 403);
      if (p.status !== "waiting")
        fail("Only waiting patients can receive priority.");
      p.priority = true;
      event(s, "Emergency priority added; estimates changed.", u, now);
      break;
    case "cancel":
    case "noshow":
      if (b.action === "cancel" && !staff)
        fail("Reception access required.", 403);
      if (!["waiting", "serving"].includes(p.status))
        fail("Appointment is no longer active.", 409);
      p.status = b.action === "cancel" ? "cancelled" : "no-show";
      if (q.current === p.id) {
        q.current = null;
        if (q.status === "active") advance(s, d, now);
      }
      break;
    case "recall":
      if (!staff) fail("Reception access required.", 403);
      if (p.status !== "no-show" || p.date !== day(now))
        fail("Only today’s no-shows can be recalled.");
      p.status = "waiting";
      p.order = now;
      p.priority = false;
      p.arrived = false;
      break;
    case "start":
      if (!d) fail("Choose a doctor.");
      if (q.status === "break") fail("Resume this session instead.");
      q.status = "active";
      if (!q.current) advance(s, d, now);
      break;
    case "pause":
      if (!d || q.status !== "active") fail("Start the session first.");
      q.status = "break";
      q.pausedAt = now;
      break;
    case "resume":
      if (!d || q.status !== "break") fail("This session is not on a break.");
      q.pausedMs += now - q.pausedAt;
      q.pausedAt = null;
      q.status = "active";
      break;
    case "end":
      if (!d) fail("Choose a doctor.");
      if (q.current)
        fail("Complete or mark the current patient no-show before ending.");
      q.status = "ended";
      break;
    case "delay":
      if (!d) fail("Choose a doctor.");
      q.delayUntil =
        Math.max(now, q.delayUntil) + int(b.minutes, 0, 120) * 60000;
      break;
    case "next":
      if (!d || q.status !== "active")
        fail("Start or resume the session first.");
      if ((b.currentId || null) !== q.current)
        fail(
          "Queue changed on another device. Review the current patient.",
          409,
        );
      if (q.current) {
        const current = s.patients.find((p) => p.id === q.current);
        current.status = "completed";
        current.completedAt = now;
        const duration = Math.max(1, Math.round(elapsed(q, now)));
        current.duration = duration;
        q.durations.push(duration);
        q.durations = q.durations.slice(-10);
      }
      advance(s, d, now);
      break;
    default:
      fail("Unknown action.");
  }
  event(
    s,
    b.action === "book"
      ? `${result.patient.token} booked.`
      : `${b.action.replaceAll("-", " ")} updated${p ? " · " + p.token : d ? " · " + d.name : ""}.`,
    u,
    now,
  );
  return result;
}
export function publicClinic(row) {
  const s = JSON.parse(row.state);
  return {
    id: row.id,
    slug: row.slug,
    name: s.name,
    address: s.address,
    phone: s.phone,
    hours: s.hours,
    color: s.color,
    logo: s.logo,
    publicBooking: s.publicBooking,
    doctors: s.doctors
      .filter((d) => d.enabled)
      .map((d) => ({
        id: d.id,
        name: d.name,
        specialty: d.specialty,
        hours: d.hours,
        minutes: d.minutes,
        capacity: d.capacity,
      })),
  };
}
export function ticket(row, key, now = Date.now()) {
  const s = JSON.parse(row.state),
    p = s.patients.find((p) => p.key === key);
  if (!p) fail("Tracking link not found.", 404);
  const d = doctor(s, p.doctorId),
    q = d.sessionDay === day(now) ? d.session : session(),
    ahead = line(s, d.id, now).findIndex((x) => x.id === p.id);
  return {
    clinic: publicClinic(row),
    patient: {
      token: p.token,
      name: p.name,
      date: p.date,
      status: p.status,
      arrived: p.arrived,
    },
    doctor: { name: d.name, specialty: d.specialty, hours: d.hours },
    current: s.patients.find((x) => x.id === q.current)?.token || null,
    sessionStatus: q.status,
    eta: estimate(s, p, now),
    average: average(d),
    ahead:
      p.status === "waiting" ? Math.max(0, ahead) + (q.current ? 1 : 0) : 0,
    delayUntil: q.delayUntil,
    now,
    version: row.version,
  };
}
