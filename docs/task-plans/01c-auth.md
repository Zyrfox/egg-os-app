# Sprint 1C — AUTH (Login, JWT, Password Reset)

> **Tujuan**: User bisa login dengan email + password, dapat JWT pair, bisa refresh, logout, dan reset password via email token.
> **Estimasi**: Minggu 3.
> **Dependency**: Sprint 1B selesai (user entity sudah ada).
> **Output**: Login flow lengkap, `/auth/me` jalan, token rotation aman.

---

## Pre-requisite

- [ ] Sprint 1B done (user CRUD jalan)
- [ ] Secret `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET` sudah di-set via `wrangler secret put`

---

## Tasks

### Schema

- [ ] **SP1C-001** Buat schema `password_tokens` (id, user_id FK, token_hash, type enum [`set_password`, `reset_password`], expires_at, used_at, created_at) — DoD: schema ada, FK ke users
- [ ] **SP1C-002** Buat schema `refresh_tokens` (id, user_id FK, token_hash, expires_at, revoked_at, user_agent, ip_addr, created_at) — DoD: schema ada
- [ ] **SP1C-003** Buat schema `auth_events` (id, user_id nullable, event_type enum [`login_success`, `login_failed`, `password_set`, `password_reset_requested`, `password_changed`, `logout`, `token_refreshed`], ip_addr, user_agent, metadata jsonb, created_at) — DoD: schema ada
- [ ] **SP1C-004** Generate + run migration — DoD: 3 tabel ada

### Password Hashing

- [ ] **SP1C-005** Pilih hashing strategy: bcryptjs (Workers-compatible) atau Argon2 via WASM — DoD: ADR/note di repo, dependency terinstall
- [ ] **SP1C-006** Buat utility `hashPassword(plain)` dan `verifyPassword(plain, hash)` di `apps/api/src/lib/crypto.ts` — DoD: unit test pass (hash, verify, wrong-password reject)
- [ ] **SP1C-007** Buat utility `generateToken(length)` (crypto-strong random) dan `hashToken(plain)` (SHA-256) untuk password_token + refresh_token — DoD: tested

### JWT Service

- [ ] **SP1C-008** Buat utility `signAccessToken(payload)` — JWT HS256, expires 15 menit, claim `sub` (user_id), `email`, `roles` (kosong dulu), `scope` (kosong dulu) — DoD: token ter-sign, decodable
- [ ] **SP1C-009** Buat utility `signRefreshToken(userId)` — random opaque token (bukan JWT), simpan hash di `refresh_tokens` — DoD: token return, row created
- [ ] **SP1C-010** Buat utility `verifyAccessToken(token)` — verify signature + expiry — DoD: invalid/expired return null
- [ ] **SP1C-011** Buat utility `verifyRefreshToken(token)` — lookup by hash, cek expires_at + revoked_at — DoD: return user_id atau null

### Auth Endpoints

- [ ] **SP1C-012** Endpoint `POST /api/v1/auth/login` — body `{ email, password }` — return `{ access_token, expires_in, user }` + set `refresh_token` cookie (HttpOnly, Secure, SameSite=Strict) — DoD: 200 happy path, 401 wrong password, 403 user suspended/archived
- [ ] **SP1C-013** Endpoint `POST /api/v1/auth/refresh` — read refresh_token dari cookie, rotate (issue new pair, revoke old) — DoD: rotation jalan, old refresh token tidak bisa dipakai lagi
- [ ] **SP1C-014** Endpoint `POST /api/v1/auth/logout` — revoke refresh_token di DB, clear cookie — DoD: subsequent refresh 401
- [ ] **SP1C-015** Endpoint `GET /api/v1/auth/me` — return current user (decoded from access token via middleware) — DoD: protected, 401 jika no token
- [ ] **SP1C-016** Login record `auth_events.login_success` + update `users.last_login_at` — DoD: row ter-create, last_login_at ter-update
- [ ] **SP1C-017** Login failed record `auth_events.login_failed` (with email attempted, ip) — DoD: row ter-create, tidak leak info user existence

### Password Set / Reset Flow

- [ ] **SP1C-018** Endpoint `POST /api/v1/auth/password/set-link` — admin generate token untuk new user (`type=set_password`, expires 72h) — DoD: token tersimpan, return link (email integration nanti)
- [ ] **SP1C-019** Endpoint `POST /api/v1/auth/password/reset-request` — user request reset by email (`type=reset_password`, expires 24h) — DoD: silent response (200 walau email tidak ada — prevent enum), event ter-log
- [ ] **SP1C-020** Endpoint `POST /api/v1/auth/password/set` — body `{ token, new_password }` — validate token, set password_hash, mark token used, set `password_set_at` + `must_change_password=false` — DoD: invalid/expired/used token → 400
- [ ] **SP1C-021** Endpoint `POST /api/v1/auth/password/change` (authenticated) — body `{ current_password, new_password }` — DoD: verify current, update hash, log event
- [ ] **SP1C-022** Password policy enforcement (min 12 char, complexity) di Zod schema — DoD: weak password 422

### Middleware

- [ ] **SP1C-023** Implement real `authMiddleware` — read `Authorization: Bearer <token>`, verify, attach `c.set('user', userPayload)` — DoD: protected route dapat user object, invalid 401
- [ ] **SP1C-024** Middleware `requireMustChangePassword` — block API kalau `must_change_password=true` (kecuali endpoint change-password) — DoD: temp password user kena force change

### FE Auth Flow (minimal)

- [ ] **SP1C-025** Buat halaman `/login` di `apps/web` (TanStack Form + Zod) — DoD: form submit ke `/auth/login`, token disimpan di memory + cookie HttpOnly
- [ ] **SP1C-026** Buat halaman `/set-password?token=` untuk first-time + reset — DoD: validate token via API, set password
- [ ] **SP1C-027** Setup TanStack Query `useAuth()` hook (cache `/auth/me`) + redirect to `/login` if 401 — DoD: protected route auto-redirect
- [ ] **SP1C-028** Setup axios/fetch wrapper dengan auto-refresh on 401 (intercept, call `/auth/refresh`, retry) — DoD: token rotation transparan

### Tests

- [ ] **SP1C-029** Unit test: hash/verify password — DoD: pass
- [ ] **SP1C-030** Integration test: login → refresh → logout flow — DoD: pass
- [ ] **SP1C-031** Integration test: expired token rejected — DoD: pass
- [ ] **SP1C-032** Integration test: reused refresh token rejected — DoD: pass

---

## Validasi Sprint 1C (Exit Criteria)

```bash
# Create user dulu (Sprint 1B)
USER_ID=$(curl -s -X POST localhost:8787/api/v1/users -d '{...}' | jq -r .id)

# Generate set-password link
curl -X POST localhost:8787/api/v1/auth/password/set-link -d "{ \"user_id\": \"$USER_ID\" }"
# → { "token": "abc123..." }

# Set password
curl -X POST localhost:8787/api/v1/auth/password/set \
  -d '{ "token": "abc123...", "new_password": "ContohPassword123!" }'

# Login
curl -X POST localhost:8787/api/v1/auth/login -c cookies.txt \
  -d '{ "email": "ilham@egg.id", "password": "ContohPassword123!" }'
# → { access_token, expires_in: 900, user }

# Me
curl localhost:8787/api/v1/auth/me -H "Authorization: Bearer <token>"
# → user

# Refresh (gunakan cookie)
curl -X POST localhost:8787/api/v1/auth/refresh -b cookies.txt -c cookies.txt
# → new access_token

# Logout
curl -X POST localhost:8787/api/v1/auth/logout -b cookies.txt
# Subsequent refresh → 401
```

**Sign-off**: Technical Owner + ERP Owner.
