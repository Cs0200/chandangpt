PRAGMA foreign_keys=ON;
CREATE TABLE clinics(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','reception','doctor')), doctor_id TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX users_clinic ON users(clinic_id);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
