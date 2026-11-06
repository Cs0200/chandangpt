# ClinicSync

A working pilot application for clinic appointments and queues. Clinic branding, doctors, staff accounts, bookings and consultation state are saved in a database. Devices synchronize every 10 seconds while their pages are visible.

**Code hosting:** GitHub. **Application hosting:** Cloudflare Workers + D1 (free-tier eligible within provider limits). GitHub Pages is neither a backend nor a permitted host for commercial SaaS. No paid messaging API is required.

## Try it on your computer — no cloud account required

1. Install Node.js 24 LTS from https://nodejs.org if you do not already have it.
2. Download this repository and unzip it.
3. Open Terminal in the project folder.
4. Run `npm start`.
5. Open http://127.0.0.1:4310 and choose **Create clinic**.
6. In **Doctors**, add a doctor. In **Settings**, upload your logo, set your clinic name and enable online booking if desired.
7. Add a patient in **Appointments**, check them in, and start the doctor's session in **Consultations**.
8. Open the patient tracking link and cabin display in separate tabs. Complete a consultation and observe the updates within 10 seconds.

The local server and tests have **no package dependencies**. `npm install` is needed only for Cloudflare deployment tools. Local records are stored in `.data/clinicsync.sqlite`; they survive closing and restarting the application. Keep this directory private and backed up. Stop the server with Control+C. There are no default production passwords or seeded real patients.

Localhost links work only on your computer. Multi-device internet access requires deployment. Never expose the HTTP development server directly to the internet.

## What works

- Owner registration (locally enabled; deployed registration is closed by default).
- Owner, receptionist and doctor sign-in; password change; staff disabling revokes sessions.
- Independent clinic accounts, enforced by the server.
- Custom name, address, phone, hours, logo and accent colour.
- Multiple doctors, specialties, daily capacity, token prefix and default consultation duration.
- Staff-created appointments/walk-ins and optional patient self-booking up to 30 days ahead.
- Atomic queue updates and unique tokens; retry identifiers; stale “Next” protection.
- Check-in, cancel, no-show, recall, priority insertion, start/pause/resume/end and delays.
- Only checked-in waiting patients are called. A doctor may call a later arrival before an absent patient; estimates remain approximate.
- Consultation durations and a rolling average after three completions; breaks do not count toward consultation time.
- Private patient tracking links, self-entered travel/buffer estimates and page-open departure alerts.
- Token-only cabin display with revocable display links.
- Activity history (most recent 150 events).
- Platform-admin manual subscription records; no automatic charges.
- Polling sync, visible disconnected state, and token suppression on disconnected displays.
- Local database backup and an automated test suite.

## First pilot scope

This is a pilot foundation, **not an independently audited production medical system**. Use fictional data for initial testing. Before real use, review privacy and retention obligations, access/recovery procedures, backups and the deployment's monitoring.

Explicit limits and exclusions:

- IST only; one branch per clinic; 20 doctors, 50 staff accounts, 2,000 retained appointments per clinic.
- Daily queue bookings, not fixed appointment time slots. Session hours are informational. Holidays and recurring schedule rules are not yet implemented.
- Clinic settings, queue, tokens, patient phone numbers and tracking secrets are in one versioned database document per clinic. This keeps the pilot simple and mutations atomic, but is not intended for high-volume workloads. Normalize appointments/audit history before scaling.
- Tokens are unique within a clinic/day; the counter is shared across doctors. Tracking links identify the actual appointment, including its date.
- No automated prescriptions, online payments, tax invoices, SMS, email, automatic WhatsApp, live traffic or background push notifications. Optional clinician-entered health notes, manual WhatsApp links and medicine receipts are available.
- No email verification, self-service email password reset, MFA or social login yet. Login email is an identifier, not proof of email ownership. Account recovery is an operator procedure.
- Subscription status is a manual record and does not automatically lock a clinic out during care.
- Retry history retains 200 operations per clinic; it is not a permanent financial ledger.
- Accounts and bookings are rate limited. Consider Cloudflare Turnstile and stronger edge rate limiting before opening public signup broadly.
- Existing sessions require network access. There is no offline editing or offline patient cache.
- A waiting appointment on a past date stays in history and is not automatically moved to today's queue.
- Activity history is operational information, not a tamper-evident compliance audit log.

## Deploy on the free tier

See [DEPLOY.md](DEPLOY.md) for the exact steps. You must own the Cloudflare account and complete its sign-in/verification. No cloud account or billable plan is created automatically.

## Development and tests

```sh
npm run check
npm test
npm start
npm run backup
```

Tests cover authentication, clinic/doctor isolation, role authorization, concurrent bookings, stale Next, cancellation, priority, no-show recall, break timing, public data filtering, display key rotation, CSRF protection, session revocation and manual subscription authorization.

Cloudflare build check after installing dependencies:

```sh
npm ci
npx wrangler deploy --dry-run
```

## Project structure

- `public/` — responsive browser UI; no framework build step.
- `src/worker.mjs` — HTTP API, authentication, database persistence and authorization.
- `src/queue.mjs` — queue rules and estimates.
- `migrations/` — Cloudflare D1 schema.
- `scripts/local.mjs` — local HTTP server using Node's SQLite support.
- `scripts/db.mjs` — D1-compatible local SQLite adapter.
- `test/` — integration and queue tests.
- `.github/workflows/` — checks on push and manually triggered Cloudflare deployment.

## Security design

Passwords are salted PBKDF2-SHA256 hashes; sessions are random, stored hashed, HTTP-only and SameSite=Strict. Deployed HTTPS cookies are Secure. All writes require a matching Origin and JSON. Patient and display links use high-entropy capability keys in URL fragments, not URL query strings, and pages send `Referrer-Policy: no-referrer`. Anyone holding a patient's link can view that appointment: share it privately. All sensitive API responses use `Cache-Control: no-store`. The backend scopes each staff operation to the authenticated clinic; doctors are further scoped to their assigned doctor profile.

Do not commit `.data`, `.env`, `.dev.vars`, cloud credentials, exported patient data or database backups. The supplied `.gitignore` excludes local data and tool state.

## Optional features

Owner → Settings → Optional features. WhatsApp, health history and dispensary can be enabled independently. All default off for new and existing clinics; disabling preserves records.

- **WhatsApp:** Appointments → WhatsApp. Confirm patient consent and international number, review the generic reminder, then open WhatsApp and manually press Send. No API fees, automated delivery, or sent/delivered claim. Uncheck consent and save to withdraw. Clinical information and billing never enter the message.
- **Health history:** Owner and assigned doctors can create a stable patient record from an appointment or explicitly link a returning appointment. Shared phone numbers never auto-merge records. Notes record history, reported allergies, clinician-entered medicines/instructions, and follow-up. Notes are append-only; corrections are new notes. Reception cannot read clinical notes. Doctors see records linked to their appointments. Public booking/tracking/display responses exclude clinical and stock data.
- **Dispensary:** Owner adds stock batches with medicine/strength, batch, unit, expiry, quantity and price. Owner/reception dispense multiple items to a named appointment, with a paid/unpaid receipt. Stock deduction and billing are atomic and requests retry safely. Expired or insufficient stock is rejected. Record payment manually; print/save the itemised receipt as PDF. Issued medicines appear in the linked health record.
- Limits: 2,000 patient records, 200 notes per record, 500 stock batches and 2,000 dispensing bills per clinic. INR only. No GST/tax calculations, discounts, returns/refunds, stock corrections, electronic prescription signing, drug interaction checks or payment gateway. Receipt is not a tax invoice. Confirm clinical instructions outside the software; it does not recommend treatment.
- No schema migration is needed: optional data is added lazily to existing clinic state. This remains a small pilot, not an audited electronic medical record system. Test with fictional records before using health history with real patients.
