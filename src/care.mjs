import { fail, text, int, uid, day } from "./queue.mjs";
export function careAction(s, b, u, now = Date.now()) {
  const owner = u.role === "owner",
    clinician = owner || u.role === "doctor";
  s.features ||= {};
  s.records ||= [];
  s.medicines ||= [];
  s.dispenses ||= [];
  if (b.action === "features") {
    if (!owner) fail("Owner access required.", 403);
    s.features = {
      whatsapp: b.whatsapp === true,
      history: b.history === true,
      dispensary: b.dispensary === true,
    };
    return { ok: true };
  }
  if (b.action === "whatsapp-consent") {
    if (!s.features.whatsapp || !["owner", "reception"].includes(u.role))
      fail("WhatsApp access disabled.", 403);
    const p = s.patients.find((p) => p.id === b.appointmentId);
    if (!p) fail("Appointment not found.", 404);
    p.whatsappConsent = b.consent === true;
    p.consentAt = now;
    return { ok: true };
  }
  const history = ["record-create", "record-link", "note-add"].includes(
    b.action,
  );
  if (history && (!s.features.history || !clinician))
    fail("Health history access disabled.", 403);
  if (
    !history &&
    (!s.features.dispensary || !["owner", "reception"].includes(u.role))
  )
    fail("Dispensary access disabled.", 403);
  const appointment = (id) => {
    const p = s.patients.find((p) => p.id === id);
    if (!p) fail("Appointment not found.", 404);
    if (u.role === "doctor" && p.doctorId !== u.doctor_id)
      fail("Doctor access denied.", 403);
    return p;
  };
  if (b.action === "record-create") {
    const p = appointment(b.appointmentId);
    if (p.recordId) fail("This appointment already has a patient record.");
    if (s.records.length >= 2000) fail("Patient record limit reached.");
    const r = {
      id: uid(),
      name: p.name,
      phone: p.phone,
      reference: text(b.reference || "", 0, 100),
      createdAt: now,
      notes: [],
    };
    s.records.push(r);
    p.recordId = r.id;
    return { ok: true };
  }
  if (b.action === "record-link") {
    const p = appointment(b.appointmentId),
      r = s.records.find((r) => r.id === b.recordId);
    if (!r) fail("Patient record not found.", 404);
    if (
      u.role === "doctor" &&
      !s.patients.some((x) => x.recordId === r.id && x.doctorId === u.doctor_id)
    )
      fail("Owner must link this patient first.", 403);
    if (p.recordId) fail("Appointment is already linked.");
    p.recordId = r.id;
    return { ok: true };
  }
  if (b.action === "note-add") {
    const p = appointment(b.appointmentId),
      r = s.records.find((r) => r.id === p.recordId);
    if (!r) fail("Link a patient record first.");
    if (r.notes.length >= 200) fail("Patient note limit reached.");
    r.notes.push({
      id: uid(),
      appointmentId: p.id,
      doctorId: p.doctorId,
      at: now,
      author: u.name,
      history: text(b.history || "", 0, 4000),
      allergies: text(b.allergies || "", 0, 1000),
      medicines: text(b.medicines || "", 0, 2000),
      plan: text(b.plan || "", 0, 2000),
    });
    if (
      ![b.history, b.allergies, b.medicines, b.plan].some(
        (v) => typeof v === "string" && v.trim(),
      )
    )
      fail("Enter a note before saving.");
    return { ok: true };
  }
  if (b.action === "medicine-add") {
    if (!owner) fail("Owner access required.", 403);
    if (s.medicines.length >= 500) fail("Stock batch limit reached.");
    const expiry = text(b.expiry, 10, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(expiry) ||
      !Number.isFinite(Date.parse(expiry)) ||
      new Date(expiry).toISOString().slice(0, 10) !== expiry ||
      expiry < day(now)
    )
      fail("Enter a valid future expiry date.");
    const price = String(b.price);
    if (!/^\d+(\.\d{1,2})?$/.test(price))
      fail("Enter a price with up to two decimal places.");
    const pricePaise = Math.round(Number(price) * 100);
    if (!Number.isSafeInteger(pricePaise) || pricePaise > 100000000)
      fail("Invalid price.");
    s.medicines.push({
      id: uid(),
      name: text(b.name, 2, 100),
      batch: text(b.batch, 1, 60),
      unit: text(b.unit, 1, 30),
      expiry,
      stock: int(b.stock, 1, 100000),
      pricePaise,
      createdAt: now,
    });
    return { ok: true };
  }
  if (b.action === "dispense") {
    const p = appointment(b.appointmentId);
    if (s.dispenses.length >= 2000) fail("Dispensing limit reached.");
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20)
      fail("Choose 1–20 medicine batches.");
    const seen = new Set();
    const items = b.items.map((i) => {
      if (seen.has(i.id)) fail("Duplicate batch.");
      seen.add(i.id);
      const m = s.medicines.find((m) => m.id === i.id);
      if (!m) fail("Medicine batch not found.");
      const quantity = int(i.quantity, 1, 100000);
      if (m.expiry < day(now)) fail("Expired stock cannot be dispensed.");
      if (m.stock < quantity) fail("Insufficient stock for " + m.name);
      return {
        medicineId: m.id,
        name: m.name,
        batch: m.batch,
        unit: m.unit,
        expiry: m.expiry,
        quantity,
        pricePaise: m.pricePaise,
        totalPaise: quantity * m.pricePaise,
      };
    });
    if (!["paid", "unpaid"].includes(b.payment))
      fail("Choose a payment status.");
    const bill = {
      id: uid(),
      number: "MED-" + String(s.dispenses.length + 1).padStart(5, "0"),
      appointmentId: p.id,
      patientName: p.name,
      at: now,
      author: u.name,
      items,
      totalPaise: items.reduce((a, i) => a + i.totalPaise, 0),
      payment: b.payment,
      paidAt: b.payment === "paid" ? now : null,
    };
    for (const i of items)
      s.medicines.find((m) => m.id === i.medicineId).stock -= i.quantity;
    s.dispenses.push(bill);
    return { ok: true, billId: bill.id };
  }
  if (b.action === "bill-paid") {
    const bill = s.dispenses.find((x) => x.id === b.billId);
    if (!bill) fail("Bill not found.", 404);
    if (bill.payment === "paid") fail("Already marked paid.");
    bill.payment = "paid";
    bill.paidAt = now;
    bill.paidBy = u.name;
    return { ok: true };
  }
  fail("Unknown care action.");
}
export function filterCare(s, u) {
  const features = s.features || {};
  if (!features.history || !["owner", "doctor"].includes(u.role))
    delete s.records;
  else if (u.role === "doctor") {
    const ids = new Set(s.patients.map((p) => p.recordId));
    s.records = (s.records || []).filter((r) => ids.has(r.id));
  }
  if (!features.dispensary) {
    delete s.medicines;
    delete s.dispenses;
  } else if (u.role === "doctor") {
    delete s.medicines;
    const ids = new Set(s.patients.map((p) => p.id));
    s.dispenses = (s.dispenses || []).filter((b) => ids.has(b.appointmentId));
  }
}
