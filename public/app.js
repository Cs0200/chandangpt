const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10),
  clock = (n) =>
    n
      ? new Date(n).toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—",
  dateLabel = (n) =>
    new Date(n + "T00:00:00+05:30").toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
let me = null,
  data = null,
  view = "Overview",
  selectedDoctor = "",
  selectedDate = today(),
  filter = "All",
  search = "",
  staff = [],
  admin = [],
  busy = false,
  lastSync = 0,
  online = true,
  signUp = false,
  logoDraft = "",
  toastTimer,
  travel = 15,
  buffer = 5,
  following = false,
  lastAlert = "",
  publicData = null;
const hashRoute = () => {
  const [path, query = ""] = location.hash.slice(1).split("?");
  return {
    parts: path.split("/").filter(Boolean),
    params: new URLSearchParams(query),
  };
};
const badge = (v, kind = "") => `<span class="badge ${kind}">${esc(v)}</span>`;
const btn = (label, action, cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const empty = (title, sub, action = "") =>
  `<div class="empty"><div class="symbol">✚</div><h3>${title}</h3><p class="small">${sub}</p>${action}</div>`;
const brand = (s) =>
  `<div class="brand">${s?.logo ? `<img class="logo" src="${esc(s.logo)}" alt="Clinic logo">` : '<span class="logo">✚</span>'}<div>${s ? esc(s.name) : "Clinic<em>Sync</em>"}${s ? "<small>POWERED BY CLINICSYNC</small>" : ""}</div></div>`;
const heading = (title, sub, action = "") =>
  `<div class="heading"><div><div class="eyebrow">A CALMER CLINIC STARTS HERE</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${action}</div>`;
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
async function api(path, body) {
  const r = await fetch("/api" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const out = await r.json();
  if (!r.ok) {
    const e = new Error(out.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  return out;
}
async function action(payload) {
  const result = await api("/action", {
    ...payload,
    requestId: payload.requestId || crypto.randomUUID(),
  });
  await refresh(true);
  return result;
}
function statusBar() {
  return `<span class="statusbar ${online ? "" : "offline"}">${online ? "● Connected · sync every 10 sec" : "● Connection lost · showing last saved data"}${lastSync ? " · " + clock(lastSync) + " IST" : ""}</span>`;
}
function doctorOptions(all = false) {
  return `${all ? '<option value="">All doctors</option>' : ""}${data?.state.doctors.map((d) => `<option value="${d.id}" ${d.id === selectedDoctor ? "selected" : ""}>${esc(d.name)}</option>`).join("") || ""}`;
}
function sess(d) {
  return d.sessionDay === today()
    ? d.session
    : { status: "idle", current: null, durations: [], delayUntil: 0 };
}
function average(d) {
  let a = sess(d).durations || [];
  return a.length >= 3
    ? Math.round(a.slice(-5).reduce((x, y) => x + y, 0) / Math.min(5, a.length))
    : d.minutes;
}
function current(d) {
  return data.state.patients.find((p) => p.id === sess(d).current);
}
function queue(d) {
  return data.state.patients
    .filter(
      (p) =>
        p.doctorId === d.id && p.date === today() && p.status === "waiting",
    )
    .sort(
      (a, b) => Number(b.priority) - Number(a.priority) || a.order - b.order,
    );
}
function patientUrl(p) {
  return `${location.origin}${location.pathname}#/track/${data.slug}?key=${p.key}`;
}
function bookingUrl() {
  return `${location.origin}${location.pathname}#/book/${data.slug}`;
}
function displayUrl(d) {
  return `${location.origin}${location.pathname}#/display/${data.slug}/${d.id}?key=${data.state.displayKey}`;
}
function feed() {
  return `<div class="card"><div class="row"><h2>Activity</h2>${badge("Saved")}</div>${
    data.state.events
      .slice(0, 6)
      .map(
        (e) =>
          `<div class="feed"><span class="event-dot">✓</span><div><p>${esc(e.message)}</p><small>${esc(e.actor)} · ${clock(e.at)} IST</small></div></div>`,
      )
      .join("") ||
    empty("A fresh start", "Your clinic’s activity will appear here.")
  }</div>`;
}
function shell() {
  const s = data.state;
  document.documentElement.style.setProperty("--teal", s.color);
  const tabs =
    me.role === "doctor"
      ? ["Consultations", "Account"]
      : [
          "Overview",
          "Appointments",
          "Consultations",
          ...(me.role === "owner"
            ? ["Doctors", "Staff", "Settings", "Subscription"]
            : []),
          "Account",
          ...(me.platformAdmin ? ["Platform"] : []),
        ];
  if (!tabs.includes(view)) view = tabs[0];
  $("#app").innerHTML =
    `<aside class="sidebar">${brand()}<div class="clinic-chip"><strong>${esc(s.name)}</strong><span>${esc(me.role)} workspace</span></div><nav>${tabs.map((v, i) => `<button data-view="${v}" class="${view === v ? "active" : ""}"><span>${["◫", "▤", "✚", "♙", "♧", "⚙", "◈", "○"][i % 8]}</span> ${v}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="small">${badge(s.plan.name)}<p style="margin-top:10px">Know your turn.<br>Arrive on time.</p></div>${btn("↪ Sign out", "logout")}</div></aside><div class="main"><header class="topbar">${statusBar()}<div class="user"><span class="user-circle">${esc(me.name.slice(0, 1))}</span><span>${esc(me.name)} · ${esc(me.role)}</span>${btn("Sign out", "logout", "", 'title="Sign out"')}</div></header><main class="page">${{ Overview: overview, Appointments: appointments, Consultations: consultations, Doctors: doctors, Staff: staffPage, Settings: settings, Subscription: subscription, Account: account, Platform: platform }[view]()}<footer class="footer"><span>ClinicSync · Know your turn. Arrive on time.</span><span>All times IST · Estimates may change · Pilot release</span></footer></main></div>`;
}
function overview() {
  const s = data.state,
    p = s.patients.filter((p) => p.date === today());
  return (
    heading(
      "Your clinic, in sync.",
      dateLabel(today()) + " · Your team’s shared view of the day.",
      `<div class="flex">${btn("↗ Booking page", "booking-link")}${btn("+ Add patient", "add-patient", "primary")}</div>`,
    ) +
    `<div class="stats">${[
      [p.length, "Appointments today"],
      [p.filter((x) => x.status === "waiting").length, "Waiting"],
      [p.filter((x) => x.status === "completed").length, "Completed"],
      [
        s.doctors.filter((d) => sess(d).status === "active").length,
        "Doctors in session",
      ],
    ]
      .map(
        ([n, l]) =>
          `<div class="card"><span class="small">${l}</span><strong>${n}</strong><span class="small">${l === "Waiting" ? "Live queue" : "Today’s overview"}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div class="stack"><div class="card"><div class="row"><h2>Doctor sessions</h2>${badge(s.doctors.length + " doctors")}</div>${s.doctors.map((d) => `<div class="doctor-card"><div class="row"><div class="flex"><span class="avatar">✚</span><div><h3>${esc(d.name)}</h3><p class="small">${esc(d.specialty)} · ${esc(d.hours)}</p></div></div>${badge(sess(d).status)}</div><div class="divider"></div><div class="row"><div><span class="small">NOW SERVING</span><h2>${current(d)?.token || "—"}</h2></div><div class="small">${queue(d).length} waiting<br>${average(d)} min average</div>${btn("Open →", "open-doctor", "", 'data-id="' + d.id + '"')}</div></div>`).join("") || empty("Add your first doctor", "Create a doctor profile to start accepting appointments.", me.role === "owner" ? btn("+ Add doctor", "add-doctor", "primary") : "Ask the owner to add a doctor.")}</div><div class="card"><h2>Your clinic’s booking link</h2><p class="small">Share it with patients. Online booking is ${s.publicBooking ? "enabled" : "currently off"}.</p><div class="linkbox">${esc(bookingUrl())}</div>${btn("Copy booking link", "copy-booking")}</div></div><div class="stack">${s.doctors.length ? "" : `<div class="card"><h2>Set up your clinic</h2><div class="steps"><div><section><h3>Make it yours</h3><p>Update your clinic name, logo and brand colour in Settings.</p></section></div><div><section><h3>Add a doctor</h3><p>Set session hours and consultation length.</p></section></div><div><section><h3>Welcome your first patient</h3><p>Add a booking, check them in, and start the session.</p></section></div></div></div>`}${feed()}</div></div>`
  );
}
function appointments() {
  let patients = data.state.patients.filter(
    (p) =>
      p.date === selectedDate &&
      (!selectedDoctor || p.doctorId === selectedDoctor) &&
      (filter === "All" || p.status === filter) &&
      `${p.name} ${p.token}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    heading(
      "Appointments & walk-ins",
      "Every arrival, one shared queue.",
      btn("+ Add patient", "add-patient", "primary"),
    ) +
    `<div class="card"><div class="toolbar"><input id="search" aria-label="Search patients" placeholder="Search name or token" value="${esc(search)}"><input id="date" aria-label="Appointment date" type="date" value="${selectedDate}" style="max-width:170px"><select id="doctor-filter" aria-label="Filter doctor">${doctorOptions(true)}</select><select id="status-filter" aria-label="Filter status">${["All", "waiting", "serving", "completed", "cancelled", "no-show"].map((s) => `<option ${s === filter ? "selected" : ""}>${s}</option>`).join("")}</select></div><div class="tablewrap"><table><thead><tr><th>Token</th><th>Patient</th><th>Doctor</th><th>Arrival</th><th>Status</th><th>Actions</th></tr></thead><tbody>${patients.map((p) => `<tr><td><strong>${p.token}</strong>${p.priority ? " " + badge("Priority", "orange") : ""}</td><td>${esc(p.name)}<br><span class="small">${esc(p.type)}</span></td><td>${esc(data.state.doctors.find((d) => d.id === p.doctorId)?.name)}</td><td>${p.arrived ? "✓ Checked in" : "Expected"}</td><td>${badge(p.status)}</td><td><div class="flex">${btn("Tracking link", "copy-ticket", "", 'data-id="' + p.id + '"')}${p.status === "waiting" ? `${!p.arrived ? btn("Check in", "checkin", "", 'data-id="' + p.id + '"') : ""}${btn("Priority", "priority", "", 'data-id="' + p.id + '"')}${btn("No-show", "noshow", "", 'data-id="' + p.id + '"')}${btn("Cancel", "cancel", "danger", 'data-id="' + p.id + '"')}` : p.status === "no-show" ? btn("Recall", "recall", "", 'data-id="' + p.id + '"') : ""}</div></td></tr>`).join("")}</tbody></table></div>${patients.length ? "" : empty("No appointments here", "Choose another date or add a patient.")}</div>`
  );
}
function consultations() {
  let d =
    data.state.doctors.find((d) => d.id === selectedDoctor) ||
    data.state.doctors[0];
  if (!d)
    return (
      heading("Consultations", "Start with a doctor profile.") +
      empty("No doctor yet", "Add a doctor from the Doctors screen.")
    );
  selectedDoctor = d.id;
  const q = sess(d),
    p = current(d),
    waiting = queue(d),
    elapsed = q.startedAt
      ? Math.max(
          0,
          Math.floor(
            ((q.pausedAt || data.now) - q.startedAt - q.pausedMs) / 60000,
          ),
        )
      : 0;
  return (
    heading(
      "Focus on the person in front of you.",
      "Large controls. Less coordination.",
      `<select id="doctor-filter" aria-label="Select doctor" style="max-width:230px">${doctorOptions()}</select>`,
    ) +
    `<div class="grid"><div class="card"><div class="row"><div><h2>${esc(d.name)}</h2><p class="small">${esc(d.specialty)} · ${esc(d.hours)}</p></div>${badge(q.status)}</div><div class="consultation"><div class="row"><span class="eyebrow">CURRENT CONSULTATION</span><span class="small">${elapsed} min elapsed</span></div><div class="token">${p?.token || "—"}</div><h2>${esc(p?.name || "Ready for your next patient")}</h2><p class="small">${p ? "Checked-in patient · timing recorded on completion" : "Only checked-in patients will be called."}</p></div>${btn(p ? "Complete & Next →" : "Call next checked-in patient →", "next", "primary big-button", q.status !== "active" ? "disabled" : "")}<div class="quicklinks">${q.status === "active" ? btn("Ⅱ Take a break", "pause") : q.status === "break" ? btn("▶ Resume session", "resume") : btn("▶ Start session", "start")}${btn("End session", "end")}${p ? btn("Mark no-show", "current-noshow", "danger") : ""}</div><div class="divider"></div><div class="row"><p class="small">Average consultation<br><strong>${average(d)} minutes</strong> · rolling average after 3 completions</p>${btn("+15 min delay", "delay")}</div>${q.status === "break" ? '<div class="notice warning" style="margin-top:20px">Queue paused—turn time pending. Consultation timer is paused.</div>' : ""}</div><div class="stack"><div class="card"><h2>Waiting patients</h2>${waiting.map((p) => `<div class="listitem"><div><strong>${p.token}</strong>${esc(p.name)}<p class="small">${p.priority ? "Emergency priority · " : ""}${p.arrived ? "Checked in" : "Not yet at clinic"}</p></div>${badge(p.arrived ? "Ready" : "Expected", p.arrived ? "" : "gray")}</div>`).join("") || empty("Queue is clear", "New bookings will appear here.")}</div>${me.role !== "doctor" ? `<div class="card"><h2>Cabin display</h2><p class="small">Token-only screen. Open on your waiting-room display.</p><div class="quicklinks">${btn("Open display ↗", "open-display")}${btn("Copy display link", "copy-display")}</div></div>` : ""}</div></div>`
  );
}
function doctors() {
  return (
    heading(
      "Your doctors. Your schedules.",
      "Configure the people and sessions behind your clinic.",
      btn("+ Add doctor", "add-doctor", "primary"),
    ) +
    `<div class="grid equal">${data.state.doctors.map((d) => `<div class="card"><div class="row"><div class="flex"><span class="avatar">✚</span><div><h2>${esc(d.name)}</h2><p class="small">${esc(d.specialty)}</p></div></div>${badge(d.enabled ? "Booking open" : "Booking off", d.enabled ? "" : "gray")}</div><div class="divider"></div><p class="small">Session · ${esc(d.hours)}<br>Default consultation · ${d.minutes} min<br>Daily capacity · ${d.capacity} patients<br>Token prefix · ${esc(d.prefix)}</p><div class="quicklinks">${btn("Edit profile", "edit-doctor", "", 'data-id="' + d.id + '"')}${btn("Open session", "open-doctor", "", 'data-id="' + d.id + '"')}</div></div>`).join("") || empty("Build your care team", "Add a doctor to get started.", btn("+ Add doctor", "add-doctor", "primary"))}</div>`
  );
}
function staffPage() {
  return (
    heading(
      "A team with the right access.",
      "Staff credentials are created here and shared by you; no invitation emails are sent.",
      btn("+ Add staff", "add-staff", "primary"),
    ) +
    `<div class="card"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Assigned doctor</th><th>Status</th><th></th></tr></thead><tbody>${staff.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${badge(u.role)}</td><td>${esc(data.state.doctors.find((d) => d.id === u.doctor_id)?.name || "—")}</td><td>${u.active ? "Active" : "Disabled"}</td><td>${u.role !== "owner" && u.active ? btn("Disable access", "disable-staff", "danger", 'data-id="' + u.id + '"') : ""}</td></tr>`).join("")}</tbody></table></div></div>`
  );
}
function settings() {
  const s = data.state;
  return (
    heading(
      "Make ClinicSync your own.",
      "Your branding appears on booking, patient and display screens.",
    ) +
    `<form id="settings" class="grid"><div class="card"><h2>Clinic details</h2><div class="divider"></div><div class="formgrid">${field("Clinic name", "name", s.name, "text", 'required maxlength="80"')}${field("Contact phone", "phone", s.phone, "tel", 'maxlength="30"')}<div class="full">${field("Address", "address", s.address, "text", 'maxlength="200"')}</div>${field("Opening hours", "hours", s.hours, "text", 'maxlength="80"')}${field("Brand colour", "color", s.color, "color")}<div class="full"><label class="check"><input name="publicBooking" type="checkbox" ${s.publicBooking ? "checked" : ""}> Allow patients to book through the public link</label><p class="small">Bookings use a daily queue; doctor hours are displayed as information, not individual time slots.</p></div></div><div class="error" id="form-error"></div><div class="form-actions"><button class="primary" type="submit">Save clinic settings</button></div></div><div class="stack"><div class="card"><h2>Your logo</h2><div class="divider"></div><img id="logo-preview" class="logo-preview" src="${s.logo || "icon.svg"}" alt="Logo preview"><label style="margin-top:18px">Upload logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="small" style="margin-top:8px">PNG, JPEG or WebP · maximum 100 KB</p>${btn("Remove logo", "remove-logo", "text-button")}</div><div class="card"><h2>Booking link</h2><div class="linkbox">${esc(bookingUrl())}</div><p class="small">Clinic URL: ${esc(data.slug)} · fixed after registration</p></div><div class="card"><h3>Display access</h3><p class="small">If a display link has been shared accidentally, replace it. Existing display links will stop working.</p><div class="quicklinks">${btn("Replace display links", "rotate-display", "danger")}</div></div></div></form>`
  );
}
function subscription() {
  const p = data.state.plan;
  return (
    heading(
      "A simple start for your clinic.",
      "Subscription records are managed manually during the pilot.",
    ) +
    `<div class="grid"><div class="card"><div class="row"><h2>${esc(p.name)}</h2>${badge(p.status)}</div><div class="divider"></div><div class="plan-price">Pilot access</div><p class="subtitle">No automatic charges are made by this application.</p><div class="steps"><div><section><h3>Clinic setup</h3><p>Branding, doctors, staff and booking links.</p></section></div><div><section><h3>Shared queue</h3><p>Patient, reception, doctor and display updates.</p></section></div><div><section><h3>Optional installation</h3><p>Use your own tablet or display; hardware is not included.</p></section></div></div><p class="small">Renewal record: ${p.renewalDate ? esc(p.renewalDate) : "Not scheduled"}</p></div><div class="card"><h2>Built for the first pilot</h2><p class="subtitle">This release supports up to 20 doctors, 50 staff accounts and 2,000 stored appointments per clinic. Contact the service owner for plan and renewal changes.</p><div class="notice" style="margin-top:20px">Payments, invoices, email, SMS and WhatsApp are not connected.</div></div></div>`
  );
}
function account() {
  return (
    heading("Your account", "Keep your sign-in details private.") +
    `<div class="grid"><form id="password" class="card"><h2>Change password</h2><div class="divider"></div><div class="stack">${field("Current password", "current", "", "password", 'required minlength="12" autocomplete="current-password"')}${field("New password · at least 12 characters", "password", "", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}</div><div class="error" id="form-error"></div><div class="form-actions"><button class="primary">Update password</button></div></form><div class="card"><h2>${esc(me.name)}</h2><p class="subtitle">${esc(me.email)}</p><div class="divider"></div>${badge(me.role)}<p class="small" style="margin-top:15px">Updating your password signs out other sessions. Email verification and email-based password reset are not enabled in this pilot; the service owner can help with account recovery.</p></div></div>`
  );
}
function platform() {
  return (
    heading(
      "Platform administration",
      "Manual subscription records. No payment processing.",
    ) +
    `<div class="card"><div class="tablewrap"><table><thead><tr><th>Clinic</th><th>Doctors</th><th>Appointments</th><th>Plan</th><th>Status</th><th></th></tr></thead><tbody>${admin.map((c) => `<tr><td>${esc(c.name)}<br><span class="small">${esc(c.slug)}</span></td><td>${c.doctors}</td><td>${c.appointments}</td><td>${esc(c.plan.name)}</td><td>${badge(c.plan.status)}</td><td>${btn("Update record", "edit-plan", "", 'data-id="' + c.id + '"')}</td></tr>`).join("")}</tbody></table></div></div>`
  );
}
function authScreen() {
  document.documentElement.style.setProperty("--teal", "#087d70");
  $("#app").innerHTML =
    `<div class="auth-page"><section class="auth-story">${brand()}<div><div class="eyebrow" style="color:#92c7b5">LESS WAITING. MORE LIVING.</div><h1>A calmer clinic.<br><span>A better day.</span></h1><p>Appointments, arrivals and every turn in between. Bring your clinic together with one shared queue.</p><div class="auth-preview"><div class="row"><span class="small">YOUR CLINIC, CONNECTED</span>${badge("Live queue")}</div><div class="row" style="margin:18px 0"><div><span class="small">Now serving</span><div class="token">A-005</div></div><div class="small">Doctor → Reception<br>Patient → Display</div></div><span class="small">Illustration · your real queue starts empty</span></div></div><span class="small" style="color:#a1bfb5">Built for small clinics. Designed around people.</span></section><section class="auth-form"><div><div class="eyebrow">WELCOME TO CLINICSYNC</div><h1>${signUp ? "Your clinic starts here." : "Good to see you again."}</h1><p class="subtitle">${signUp ? "Create your clinic owner account." : "Sign in to your clinic workspace."}</p><form id="auth">${signUp ? `${field("Your name", "name", "", "text", 'required maxlength="70" autocomplete="name"')}${field("Clinic name", "clinic", "", "text", 'required maxlength="80"')}${field("Clinic link name", "slug", "", "text", 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength="3" maxlength="50" placeholder="green-park-clinic"')}` : ""}${field("Email address", "email", "", "email", 'required autocomplete="username"')}${field("Password · at least 12 characters", "password", "", "password", 'required minlength="12" maxlength="128" autocomplete="' + (signUp ? "new-password" : "current-password") + '"')}<div class="error" id="form-error"></div><button class="primary" type="submit">${signUp ? "Create clinic →" : "Sign in →"}</button></form><p class="auth-switch">${signUp ? "Already have an account?" : "Setting up a new clinic?"} ${btn(signUp ? "Sign in" : "Create clinic", "auth-toggle", "text-button")}</p><div class="divider"></div><p class="small">Staff: ask your clinic owner to create your account.<br>Patients: use the booking or tracking link your clinic shared.</p></div></section></div>`;
}
function showModal(title, html) {
  $("#modal").innerHTML =
    `<div class="row"><h2>${title}</h2>${btn("×", "close-modal", "", 'aria-label="Close dialog"')}</div>${html}`;
  $("#modal").showModal();
}
function doctorForm(id) {
  let d = data.state.doctors.find((d) => d.id === id) || {
    name: "",
    specialty: "General Physician",
    hours: "10:00–14:00",
    minutes: 8,
    capacity: 40,
    prefix: String.fromCharCode(65 + data.state.doctors.length),
    enabled: true,
  };
  showModal(
    id ? "Edit doctor" : "Add a doctor",
    `<form id="doctor-form" data-id="${id || ""}"><div class="formgrid">${field("Doctor name", "name", d.name, "text", 'required maxlength="70"')}${field("Specialty", "specialty", d.specialty, "text", 'required maxlength="80"')}${field("Session hours", "hours", d.hours, "text", 'required maxlength="80"')}${field("Token prefix", "prefix", d.prefix, "text", 'required pattern="[A-Za-z]{1,5}"')}${field("Average consultation (minutes)", "minutes", d.minutes, "number", 'required min="2" max="60"')}${field("Maximum bookings per day", "capacity", d.capacity, "number", 'required min="1" max="300"')}<label class="check full"><input name="enabled" type="checkbox" ${d.enabled ? "checked" : ""}> Accept bookings</label></div><div class="error" id="form-error"></div><div class="form-actions"><button class="primary">Save doctor</button></div></form>`,
  );
}
function patientForm() {
  if (!data.state.doctors.length) return notify("Add a doctor first.");
  showModal(
    "Add an appointment",
    `<form id="patient-form"><div class="formgrid">${field("Patient name", "name", "", "text", 'required minlength="2" maxlength="70"')}${field("Phone (optional)", "phone", "", "tel", 'maxlength="20"')}<label>Doctor<select name="doctorId" required>${doctorOptions()}</select></label>${field("Appointment date", "date", today(), "date", 'required min="' + today() + '"')}<label>Appointment type<select name="type"><option>Appointment</option><option>Walk-in</option></select></label><label class="check"><input name="arrived" type="checkbox"> Already checked in</label><label class="check full"><input name="priority" type="checkbox"> Emergency priority — insert ahead of waiting patients</label></div><div class="error" id="form-error"></div><div class="form-actions"><button class="primary">Book & generate token</button></div></form>`,
  );
}
function staffForm() {
  showModal(
    "Add a team member",
    `<form id="staff-form"><div class="formgrid">${field("Name", "name", "", "text", 'required maxlength="70"')}${field("Email", "email", "", "email", "required")}<label>Role<select name="role"><option value="reception">Reception</option><option value="doctor">Doctor</option></select></label><label>Doctor assignment (doctor role only)<select name="doctorId">${doctorOptions()}</select></label><div class="full">${field("Initial password · share privately", "password", "", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}</div></div><p class="small" style="margin-top:15px">No email is sent. Share the sign-in link and initial password privately. They can change their password in Account.</p><div class="error" id="form-error"></div><div class="form-actions"><button class="primary">Create staff account</button></div></form>`,
  );
}
function publicShell(c, html) {
  document.documentElement.style.setProperty("--teal", c.color);
  $("#app").innerHTML =
    `<header class="public-header">${brand(c)}<a class="small" href="#/">Staff sign in →</a></header><main class="public-main">${html}<footer class="footer"><span>Powered by ClinicSync · ${esc(c.name)}</span><span>Times IST · Estimates may change</span></footer></main>`;
}
function bookingPage(c) {
  publicShell(
    c,
    heading(
      "Less waiting. More living.",
      "Book your place and follow your turn from anywhere.",
    ) +
      `<div class="grid"><div class="card"><h2>Book an appointment</h2><p class="subtitle">Select a doctor and a date. Your token follows the live queue.</p>${c.publicBooking && c.doctors.length ? `<form id="public-booking" style="margin-top:23px"><div class="formgrid">${field("Patient name", "name", "", "text", 'required minlength="2" maxlength="70"')}${field("Phone (optional)", "phone", "", "tel", 'maxlength="20"')}<label>Doctor<select name="doctorId" required>${c.doctors.map((d) => `<option value="${d.id}">${esc(d.name)} · ${esc(d.specialty)}</option>`).join("")}</select></label>${field("Preferred date", "date", c.today, "date", 'required min="' + c.today + '"')}</div><div class="error" id="form-error"></div><p class="small" style="margin-top:20px">Please do not enter medical details. Booking creates a queue token, not a guaranteed consultation time.</p><div class="form-actions"><button class="primary">Book my appointment →</button></div></form>` : empty("Online booking is currently closed", "Please contact the clinic or visit reception.")}</div><div class="stack"><div class="card"><h2>${esc(c.name)}</h2><p class="subtitle">${esc(c.address || "Contact the clinic for directions.")}</p><div class="divider"></div><p class="small">Opening hours · ${esc(c.hours)}<br>Contact · ${esc(c.phone || "Ask reception")}</p></div><div class="card"><h2>Meet your doctors</h2>${c.doctors.map((d) => `<div class="listitem"><div><h3>${esc(d.name)}</h3><p class="small">${esc(d.specialty)}<br>${esc(d.hours)}</p></div>${badge(d.minutes + " min avg.")}</div>`).join("")}</div></div></div>`,
  );
}
function ticketPage(t) {
  let p = t.patient,
    eta = online ? t.eta : null,
    departure = eta ? eta - (travel + buffer) * 60000 : null;
  let status =
    p.status === "serving"
      ? "Your turn"
      : p.status === "completed"
        ? "Completed"
        : p.status === "cancelled"
          ? "Cancelled"
          : p.status === "no-show"
            ? "Marked no-show"
            : p.date !== today()
              ? "Upcoming appointment"
              : !eta
                ? "Turn time pending"
                : p.arrived
                  ? "Checked in"
                  : departure <= t.now
                    ? "Leave now"
                    : departure - t.now <= 300000
                      ? "Leave soon"
                      : "Waiting";
  if (following && status === "Leave now" && lastAlert !== p.token) {
    lastAlert = p.token;
    notify("Leave now: your recommended departure time has arrived.");
  }
  publicShell(
    t.clinic,
    heading(
      `Hello, ${esc(p.name.split(" ")[0])}.`,
      "Your place is saved. Keep this private link to follow your turn.",
    ) +
      `<div class="grid"><div class="stack"><div class="card"><div class="row"><div><h2>${esc(t.doctor.name)}</h2><p class="small">${esc(t.doctor.specialty)} · ${esc(t.doctor.hours)}</p></div>${badge(t.sessionStatus)}</div><div class="divider"></div><div class="row"><span class="small">CURRENTLY SERVING</span><h2>${t.current || "—"}</h2></div></div><div class="card ticket"><div class="row"><span class="eyebrow">YOUR TOKEN · ${dateLabel(p.date)}</span>${badge(status)}</div><div class="token">${p.token}</div><p class="small">${esc(p.name)}</p><div class="ticket-metrics"><div><b>${t.ahead}</b><span class="small">patients ahead</span></div><div><b>${t.average} min</b><span class="small">average visit</span></div><div><b>${eta ? clock(eta) : "Pending"}</b><span class="small">estimated turn</span></div></div><div class="divider"></div><p class="small">${p.arrived ? "✓ Checked in · wait near the doctor’s cabin." : "Check in at reception when you arrive."}</p></div><div class="card">${statusBar()}<p class="small" style="margin-top:10px">${t.sessionStatus === "break" ? "Queue paused—turn time pending." : t.delayUntil > t.now ? "Doctor delayed. Estimates include the announced delay." : "Estimates change as consultations finish."}</p><div class="quicklinks">${btn(following ? "✓ Following this page" : "Follow queue on this page", "follow")}${btn("Copy private tracking link", "copy-current")}</div><p class="small" style="margin-top:10px">Alerts appear only while this page is open. No SMS, WhatsApp or background notifications.</p></div></div><div class="card"><h2>Plan your arrival</h2><p class="small">Enter your own travel estimate. No location access.</p><div class="divider"></div><label>Travel time: ${travel} minutes<input id="travel" type="range" min="5" max="90" value="${travel}"></label><label style="margin-top:22px">Arrival buffer: ${buffer} minutes<input id="buffer" type="range" min="0" max="30" value="${buffer}"></label><div class="travel-card"><span class="eyebrow">RECOMMENDED DEPARTURE</span><strong>${departure ? (departure <= t.now ? "Leave now" : clock(departure)) : "Pending"}</strong><p class="small">${!departure ? "A departure estimate is available when the queue is running." : departure > t.now ? "Leave in " + Math.ceil((departure - t.now) / 60000) + " minutes." : t.now + travel * 60000 > eta ? "You may arrive approximately " + Math.ceil((t.now + travel * 60000 - eta) / 60000) + " minutes after your estimated turn." : "You can still arrive before your estimated turn."}</p></div><p class="small" style="margin:15px 0">Estimated turn − travel time − arrival buffer. Travel time is self-entered, not live traffic.</p>${t.clinic.address ? `<a class="button" rel="noopener noreferrer" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t.clinic.address)}">Open directions ↗</a>` : ""}</div></div>`,
  );
}
function displayPage(t) {
  document.documentElement.style.setProperty("--teal", t.clinic.color);
  $("#app").innerHTML =
    `<div class="display">${brand(t.clinic)}<h2>${esc(t.doctor.name)}</h2><p class="small">${esc(t.doctor.specialty)} · ${esc(t.status)}</p><div style="margin-top:30px" class="eyebrow">NOW SERVING</div><div class="token">${online ? t.current || "—" : "—"}</div><div class="small">UP NEXT</div><div class="next-tokens">${online ? t.next.map((x) => `<span>${x}</span>`).join("") : "Connection lost"}</div><div class="announcement">${!online ? "Connection lost. Please ask reception for the current token." : t.status === "break" ? "Doctor is on a break. Turn time pending." : t.delayUntil > t.now ? "Doctor delayed · approximately " + Math.ceil((t.delayUntil - t.now) / 60000) + " minutes" : t.priority ? "Emergency priority · waiting estimates have changed" : t.status !== "active" ? "Please wait for the doctor to start the session." : "Please keep your token ready. Thank you for your patience."}</div><p class="small">${online && t.eta ? "Next token in approximately " + Math.max(0, Math.ceil((t.eta - t.now) / 60000)) + " minutes" : "Turn estimate pending"}</p><div style="margin-top:20px">${statusBar()}</div><div class="quicklinks" style="justify-content:center">${btn("Full screen", "fullscreen")}</div></div>`;
}
async function refresh(force = false) {
  if (busy && !force) return;
  const r = hashRoute();
  try {
    if (r.parts[0] === "book") {
      if (force || !publicData) {
        publicData = await api("/public/" + encodeURIComponent(r.parts[1]));
        bookingPage(publicData);
      }
      return;
    }
    if (["track", "display"].includes(r.parts[0])) {
      const key = r.params.get("key"),
        path =
          "/public/" +
          encodeURIComponent(r.parts[1]) +
          "/" +
          (r.parts[0] === "track" ? "ticket" : "display");
      publicData = await api(path, { key, doctorId: r.parts[2] });
      online = true;
      lastSync = Date.now();
      (r.parts[0] === "track" ? ticketPage : displayPage)(publicData);
      return;
    }
    if (!me) return;
    const updated = await api("/clinic");
    online = true;
    lastSync = Date.now();
    const changed = !data || data.version !== updated.version;
    data = updated;
    if (view === "Staff" && (force || !staff.length))
      staff = await api("/staff");
    if (view === "Platform" && force) admin = await api("/admin");
    if (force || changed || view === "Consultations") {
      if (
        force ||
        (!$("#modal").open &&
          !["INPUT", "SELECT", "TEXTAREA"].includes(
            document.activeElement.tagName,
          ))
      )
        shell();
    } else
      document
        .querySelectorAll(".statusbar")
        .forEach((el) => (el.outerHTML = statusBar()));
  } catch (e) {
    online = false;
    if (e.status === 401 && me) {
      me = null;
      authScreen();
      notify("Session expired. Please sign in.");
    } else if (force) {
      throw e;
    } else if (publicData && ["track", "display"].includes(r.parts[0]))
      (r.parts[0] === "track" ? ticketPage : displayPage)(publicData);
    else
      document
        .querySelectorAll(".statusbar")
        .forEach((el) => (el.outerHTML = statusBar()));
  }
}
async function boot() {
  publicData = null;
  const r = hashRoute();
  try {
    if (["book", "track", "display"].includes(r.parts[0])) {
      await refresh(true);
      return;
    }
    me = await api("/me");
    await refresh(true);
  } catch (e) {
    if (e.status === 401) {
      me = null;
      authScreen();
    } else
      $("#app").innerHTML =
        `<main class="public-main"><div class="card">${empty("Unable to open this page", esc(e.message), '<a class="button" href="#/">Go to sign in</a>')}</div></main>`;
  }
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    notify("Link copied.");
  } catch {
    showModal("Copy this link", `<div class="linkbox">${esc(value)}</div>`);
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b || busy) return;
  if (b.dataset.view) {
    view = b.dataset.view;
    if (view === "Settings") logoDraft = data.state.logo;
    try {
      await refresh(true);
    } catch (e) {
      notify(e.message);
    }
    return;
  }
  const a = b.dataset.action,
    id = b.dataset.id;
  if (!a) return;
  try {
    if (a === "auth-toggle") {
      signUp = !signUp;
      authScreen();
      return;
    }
    if (a === "close-modal") {
      $("#modal").close();
      return;
    }
    if (a === "add-doctor" || a === "edit-doctor") {
      doctorForm(id);
      return;
    }
    if (a === "add-patient") {
      patientForm();
      return;
    }
    if (a === "add-staff") {
      staffForm();
      return;
    }
    if (a === "open-doctor") {
      selectedDoctor = id;
      view = "Consultations";
      shell();
      return;
    }
    if (a === "booking-link") {
      window.open(bookingUrl(), "_blank", "noopener");
      return;
    }
    if (a === "copy-booking") {
      await copy(bookingUrl());
      return;
    }
    if (a === "copy-ticket") {
      await copy(patientUrl(data.state.patients.find((p) => p.id === id)));
      return;
    }
    if (a === "copy-current") {
      await copy(location.href);
      return;
    }
    if (a === "follow") {
      following = !following;
      lastAlert = "";
      ticketPage(publicData);
      return;
    }
    if (a === "fullscreen") {
      await document.documentElement.requestFullscreen?.();
      return;
    }
    if (a === "remove-logo") {
      logoDraft = "";
      $("#logo-preview").src = "icon.svg";
      return;
    }
    if (a === "open-display" || a === "copy-display") {
      const d =
        data.state.doctors.find((d) => d.id === selectedDoctor) ||
        data.state.doctors[0];
      if (a === "open-display")
        window.open(displayUrl(d), "_blank", "noopener");
      else await copy(displayUrl(d));
      return;
    }
    if (a === "edit-plan") {
      const c = admin.find((c) => c.id === id);
      showModal(
        "Update subscription record",
        `<form id="plan-form" data-id="${id}"><div class="stack">${field("Plan name", "name", c.plan.name, "text", "required")}<label>Status<select name="status">${["trial", "active", "past-due", "cancelled"].map((v) => `<option ${v === c.plan.status ? "selected" : ""}>${v}</option>`).join("")}</select></label>${field("Renewal date", "renewalDate", c.plan.renewalDate || "", "date")}</div><div class="error" id="form-error"></div><div class="form-actions"><button class="primary">Save record</button></div></form>`,
      );
      return;
    }
    if (
      ["disable-staff", "rotate-display", "cancel"].includes(a) &&
      !confirm(
        a === "disable-staff"
          ? "Disable this staff account and sign them out?"
          : a === "rotate-display"
            ? "Replace display links? Existing displays will need the new link."
            : "Cancel this appointment?",
      )
    )
      return;
    busy = true;
    b.disabled = true;
    if (a === "logout") {
      await api("/auth/logout", {});
      me = null;
      data = null;
      location.hash = "/";
      authScreen();
      return;
    }
    if (a === "disable-staff") {
      await api("/staff", { action: "disable", id });
      staff = await api("/staff");
      shell();
      notify("Staff access disabled.");
      return;
    }
    if (["checkin", "cancel", "noshow", "recall", "priority"].includes(a)) {
      await action({ action: a, patientId: id });
      notify("Appointment updated.");
      return;
    }
    const d =
      data.state.doctors.find((d) => d.id === selectedDoctor) ||
      data.state.doctors[0];
    if (a === "current-noshow") {
      await action({ action: "noshow", patientId: current(d)?.id });
      return;
    }
    if (["next", "start", "pause", "resume", "end", "delay"].includes(a)) {
      await action({
        action: a,
        doctorId: d.id,
        currentId: sess(d).current,
        minutes: 15,
      });
      notify("Session updated. Other devices will sync within 10 seconds.");
      return;
    }
    if (a === "rotate-display") {
      await action({ action: a });
      notify("Display links replaced.");
      return;
    }
  } catch (err) {
    notify(err.message);
    if (err.status === 409) await refresh(true).catch(() => {});
  } finally {
    busy = false;
    b.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const f = e.target,
    b = Object.fromEntries(new FormData(f));
  if (!f.dataset.requestId) f.dataset.requestId = crypto.randomUUID();
  b.requestId = f.dataset.requestId;
  let error = f.querySelector(".error");
  if (error) error.textContent = "";
  busy = true;
  const button = f.querySelector(
    "button[type=submit],.form-actions button,button.primary",
  );
  if (button) button.disabled = true;
  try {
    switch (f.id) {
      case "auth":
        await api("/auth/" + (signUp ? "register" : "login"), b);
        me = await api("/me");
        view = me.role === "doctor" ? "Consultations" : "Overview";
        await refresh(true);
        break;
      case "doctor-form":
        await action({
          ...b,
          action: "doctor",
          id: f.dataset.id || undefined,
          enabled: b.enabled === "on",
        });
        $("#modal").close();
        notify("Doctor profile saved.");
        break;
      case "patient-form": {
        const r = await action({
          ...b,
          action: "book",
          arrived: b.arrived === "on",
          priority: b.priority === "on",
        });
        showModal(
          "Appointment confirmed",
          `<div class="notice">Token <strong>${r.patient.token}</strong> has been saved.</div><p class="small">Share this private tracking link with the patient:</p><div class="linkbox">${esc(patientUrl(r.patient))}</div>${btn("Copy tracking link", "copy-ticket", "primary", 'data-id="' + r.patient.id + '"')}`,
        );
        break;
      }
      case "staff-form":
        await api("/staff", b);
        staff = await api("/staff");
        $("#modal").close();
        shell();
        notify("Staff account created. Share their credentials privately.");
        break;
      case "settings":
        await action({
          ...b,
          action: "settings",
          logo: logoDraft,
          publicBooking: b.publicBooking === "on",
        });
        notify("Clinic settings saved across all screens.");
        break;
      case "password":
        await api("/password", b);
        f.reset();
        notify("Password updated. Other sessions have been signed out.");
        break;
      case "plan-form":
        await api("/admin", {
          ...b,
          clinicId: f.dataset.id,
          requestId: crypto.randomUUID(),
        });
        admin = await api("/admin");
        $("#modal").close();
        shell();
        notify("Subscription record updated.");
        break;
      case "public-booking": {
        const r = hashRoute();
        const result = await api(
          "/public/" + encodeURIComponent(r.parts[1]) + "/book",
          { ...b, requestId: f.dataset.requestId },
        );
        location.hash = `/track/${r.parts[1]}?key=${result.trackingKey}`;
        notify("Booked! Save this private tracking link.");
        break;
      }
    }
  } catch (err) {
    if (error) error.textContent = err.message;
    else notify(err.message);
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.id === "doctor-filter") {
    selectedDoctor = el.value;
    shell();
  }
  if (el.id === "date") {
    selectedDate = el.value;
    shell();
  }
  if (el.id === "status-filter") {
    filter = el.value;
    shell();
  }
  if (el.id === "travel" || el.id === "buffer") {
    if (el.id === "travel") travel = Number(el.value);
    else buffer = Number(el.value);
    lastAlert = "";
    ticketPage(publicData);
  }
  if (el.id === "logo-file") {
    const f = el.files[0];
    if (!f) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
      f.size > 100000
    ) {
      notify("Choose a PNG, JPEG or WebP under 100 KB.");
      el.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      logoDraft = reader.result;
      $("#logo-preview").src = logoDraft;
    };
    reader.readAsDataURL(f);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    const pos = e.target.selectionStart;
    search = e.target.value;
    shell();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  }
});
window.addEventListener("hashchange", () => {
  me = null;
  boot();
});
window.addEventListener("online", () =>
  refresh(true).catch((e) => notify(e.message)),
);
window.addEventListener("offline", () => {
  online = false;
  const route = hashRoute().parts[0];
  if (publicData && route === "display") return displayPage(publicData);
  if (publicData && route === "track") return ticketPage(publicData);
  document
    .querySelectorAll(".statusbar")
    .forEach((el) => (el.outerHTML = statusBar()));
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh().catch(() => {});
});
setInterval(() => {
  if (
    !document.hidden &&
    !$("#modal").open &&
    !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
  )
    refresh();
}, 10000);
boot();
