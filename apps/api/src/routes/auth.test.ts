import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { sign } from 'hono/jwt';
import app from '../index';
import {
  companies,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  refreshTokens,
  passwordTokens,
  authEvents,
} from '@egg-os/db';
import { hashPassword, generateToken, hashToken } from '../lib/crypto';
import { AUTH } from '../lib/constants';
import { verifyAccessToken } from '../lib/jwt';
import type { TestResponseBody } from '../test/types';

// ── Test env ─────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars';

const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
};

// ── Fixtures §8 ──────────────────────────────────────────────────────────────

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const AUTH_RBAC_ROLE_ID = '70000000-0000-4000-8000-000000000001';
const authRbacPermissionCodes = ['inventory.read', 'reports.read'];
const authRbacPermissionIds = new Map<string, string>();

const FIXTURES = {
  owner: {
    email: 'owner@egg.test',
    password: 'Owner#123',
    fullName: 'ERP Owner',
    status: 'active' as const,
    firstLoginRequired: false,
  },
  spv: {
    email: 'spv.btmk@egg.test',
    password: 'Spv#1234',
    fullName: 'SPV Betamek',
    status: 'active' as const,
    firstLoginRequired: false,
  },
  staff: {
    email: 'staff.btmk@egg.test',
    fullName: 'Staff Betamek',
    status: 'invited' as const,
    firstLoginRequired: true,
  },
};

// ── DB client (direct, not via Worker) ───────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL!);
const db = drizzle(sql);

// Raw token for set_password test (C1)
let SET_PASSWORD_RAW_TOKEN: string;
let OWNER_ID: string;
let SPV_ID: string;
let STAFF_ID: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function req(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await app.request(`http://localhost${path}`, init, TEST_ENV);
  const json = await res.json() as TestResponseBody;
  return { status: res.status, body: json };
}

async function makeAccessToken(userId: string, companyId: string, firstLoginRequired = false) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: userId,
      company_id: companyId,
      roles: [],
      scopes: [],
      first_login_required: firstLoginRequired,
      iat: now,
      exp: now + AUTH.ACCESS_TTL_SEC,
    },
    TEST_JWT_SECRET,
    'HS256'
  );
}

async function makeExpiredToken(userId: string, companyId: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: userId,
      company_id: companyId,
      roles: [],
      scopes: [],
      first_login_required: false,
      iat: now - 1000,
      exp: now - 1,  // already expired
    },
    TEST_JWT_SECRET,
    'HS256'
  );
}

async function insertPermissionCatalog() {
  await db
    .insert(permissions)
    .values(
      authRbacPermissionCodes.map((code) => {
        const [module, action] = code.split('.');
        return {
          code,
          module,
          action,
          description: `AUTH RBAC integration test permission ${code}`,
        };
      })
    )
    .onConflictDoNothing();

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, authRbacPermissionCodes));

  for (const row of rows) {
    authRbacPermissionIds.set(row.code, row.id);
  }
}

async function seedRbacForOwner() {
  await insertPermissionCatalog();

  await db.insert(roles).values({
    id: AUTH_RBAC_ROLE_ID,
    companyId: COMPANY_ID,
    code: 'ERP_OWNER_AUTH',
    name: 'ERP Owner Auth Test',
    defaultScopeType: 'company',
    isSystem: false,
  });

  await db.insert(rolePermissions).values(
    authRbacPermissionCodes.map((code) => ({
      roleId: AUTH_RBAC_ROLE_ID,
      permissionId: authRbacPermissionIds.get(code)!,
      companyId: COMPANY_ID,
    }))
  );

  await db.insert(userRoles).values({
    userId: OWNER_ID,
    roleId: AUTH_RBAC_ROLE_ID,
    companyId: COMPANY_ID,
    scopeType: 'company',
    scopeId: null,
    grantedBy: OWNER_ID,
  });
}

// ── Seed & Teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  // Clean up any leftover test data
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM auth_events   WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM password_tokens WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM refresh_tokens  WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM users           WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM companies       WHERE id = ${COMPANY_ID}`;

  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'AUTH-RBAC',
    companyName: 'AUTH RBAC Integration Company',
    status: 'active',
  });

  // Insert owner
  const [owner] = await db.insert(users).values({
    companyId: COMPANY_ID,
    email: FIXTURES.owner.email,
    fullName: FIXTURES.owner.fullName,
    passwordHash: hashPassword(FIXTURES.owner.password),
    status: 'active',
    firstLoginRequired: false,
  }).returning({ id: users.id });
  OWNER_ID = owner.id;

  // Insert spv
  const [spv] = await db.insert(users).values({
    companyId: COMPANY_ID,
    email: FIXTURES.spv.email,
    fullName: FIXTURES.spv.fullName,
    passwordHash: hashPassword(FIXTURES.spv.password),
    status: 'active',
    firstLoginRequired: false,
  }).returning({ id: users.id });
  SPV_ID = spv.id;

  // Insert staff (invited, no password)
  const [staff] = await db.insert(users).values({
    companyId: COMPANY_ID,
    email: FIXTURES.staff.email,
    fullName: FIXTURES.staff.fullName,
    passwordHash: null,
    status: 'invited',
    firstLoginRequired: true,
  }).returning({ id: users.id });
  STAFF_ID = staff.id;

  // Insert set_password token for staff (C1)
  SET_PASSWORD_RAW_TOKEN = generateToken();
  await db.insert(passwordTokens).values({
    userId: STAFF_ID,
    companyId: COMPANY_ID,
    tokenHash: hashToken(SET_PASSWORD_RAW_TOKEN),
    type: 'set_password',
    expiresAt: new Date(Date.now() + AUTH.SET_PASSWORD_TTL_SEC * 1000),
  });

  await seedRbacForOwner();
});

afterAll(async () => {
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM auth_events    WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM password_tokens WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM refresh_tokens  WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM users           WHERE company_id = ${COMPANY_ID}`;
  await sql`DELETE FROM companies       WHERE id = ${COMPANY_ID}`;
  await sql.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN (A1–A8)
// ─────────────────────────────────────────────────────────────────────────────

describe('LOGIN', () => {
  it('A1 — email tidak terdaftar → 401 ERR_INVALID_CREDENTIALS', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: 'noone@nowhere.test',
      password: 'Whatever1',
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });

  it('A2 — password salah → 401 ERR_INVALID_CREDENTIALS (pesan identik A1)', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.owner.email,
      password: 'WrongPass1',
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });

  it('A3 — kredensial benar, status active → 200 + tokens + user', async () => {
    // Reset failed count from A2
    await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, OWNER_ID));

    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.owner.email,
      password: FIXTURES.owner.password,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.access_token).toBeTruthy();
    expect(body.data.refresh_token).toBeTruthy();
    expect(body.data.token_type).toBe('Bearer');
    expect(body.data.user.email).toBe(FIXTURES.owner.email);

    // Cleanup refresh token from this login
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${OWNER_ID}`;
  });

  it('A4 — status=suspended → 403 ERR_USER_INACTIVE', async () => {
    // Temporarily suspend spv
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, SPV_ID));
    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.spv.email,
      password: FIXTURES.spv.password,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('ERR_USER_INACTIVE');
    await db.update(users).set({ status: 'active' }).where(eq(users.id, SPV_ID));
  });

  it('A5 — status=invited (passwordHash null) → 401 ERR_INVALID_CREDENTIALS', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.staff.email,
      password: 'Anything1',
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });

  it('A6 — gagal login ke-5 → 429 ERR_LOGIN_LOCKED + lockedUntil terisi + event account_locked', async () => {
    // Reset state
    await db.update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, SPV_ID));

    let lastRes = { status: 0, body: {} as Record<string, unknown> };
    for (let i = 0; i < AUTH.MAX_FAILED_LOGIN; i++) {
      lastRes = await req('POST', '/api/v1/auth/login', {
        email: FIXTURES.spv.email,
        password: 'WrongPass1',
      });
    }
    expect(lastRes.status).toBe(429);
    expect((lastRes.body as { error: { code: string } }).error.code).toBe('ERR_LOGIN_LOCKED');

    // Verify lockedUntil is set
    const [u] = await db.select().from(users).where(eq(users.id, SPV_ID));
    expect(u.lockedUntil).not.toBeNull();

    // Verify account_locked event logged
    const events = await sql`
      SELECT * FROM auth_events
      WHERE user_id = ${SPV_ID} AND event_type = 'account_locked'
    `;
    expect(events.length).toBeGreaterThan(0);
  });

  it('A7 — lockedUntil > now → 429 ERR_LOGIN_LOCKED (even with correct password)', async () => {
    // SPV is already locked from A6
    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.spv.email,
      password: FIXTURES.spv.password,
    });
    expect(status).toBe(429);
    expect(body.error.code).toBe('ERR_LOGIN_LOCKED');

    // Unlock for subsequent tests
    await db.update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, SPV_ID));
  });

  it('A8 — freelance & freelanceExpiresAt<now → 403 ERR_USER_INACTIVE', async () => {
    await db.update(users)
      .set({ isFreelance: true, freelanceExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(users.id, SPV_ID));

    const { status, body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.spv.email,
      password: FIXTURES.spv.password,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('ERR_USER_INACTIVE');

    await db.update(users)
      .set({ isFreelance: false, freelanceExpiresAt: null })
      .where(eq(users.id, SPV_ID));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH (B1–B4)
// ─────────────────────────────────────────────────────────────────────────────

describe('REFRESH', () => {
  let validRefreshToken: string;

  beforeAll(async () => {
    // Login owner to get a valid refresh token
    const { body } = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.owner.email,
      password: FIXTURES.owner.password,
    });
    validRefreshToken = (body as { data: { refresh_token: string } }).data.refresh_token;
  });

  afterAll(async () => {
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${OWNER_ID}`;
  });

  it('B1 — refresh valid → 200 + token baru + token lama revoked', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: validRefreshToken,
    });
    expect(status).toBe(200);
    expect(body.data.access_token).toBeTruthy();
    expect(body.data.refresh_token).toBeTruthy();
    expect(body.data.refresh_token).not.toBe(validRefreshToken);

    // Old token must be revoked in DB
    const oldHash = hashToken(validRefreshToken);
    const [old] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash));
    expect(old.revokedAt).not.toBeNull();

    // Update for next tests
    validRefreshToken = body.data.refresh_token;
  });

  it('B2 — refresh expired → 401 ERR_TOKEN_EXPIRED', async () => {
    // Insert an expired token directly
    const expiredRaw = generateToken();
    await db.insert(refreshTokens).values({
      userId: OWNER_ID,
      companyId: COMPANY_ID,
      tokenHash: hashToken(expiredRaw),
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    const { status, body } = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: expiredRaw,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_TOKEN_EXPIRED');
  });

  it('B3 — refresh sudah revoked → 401 ERR_UNAUTHENTICATED + SEMUA token revoked + event', async () => {
    // Revoke the current valid token manually then try to use it
    const revokedRaw = validRefreshToken;
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, hashToken(revokedRaw)));

    const { status, body } = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: revokedRaw,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');

    // All remaining tokens for owner should be revoked
    const active = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, OWNER_ID), isNull(refreshTokens.revokedAt)));
    expect(active.length).toBe(0);

    // token_reuse_detected event logged
    const events = await sql`
      SELECT * FROM auth_events
      WHERE user_id = ${OWNER_ID} AND event_type = 'token_reuse_detected'
    `;
    expect(events.length).toBeGreaterThan(0);
  });

  it('B4 — refresh tak dikenal → 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: generateToken(), // random, not in DB
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD (C1–C7)
// ─────────────────────────────────────────────────────────────────────────────

describe('PASSWORD', () => {
  it('C1 — set_password token valid → 200 + status active + firstLoginRequired=false + token used', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/set-password', {
      token: SET_PASSWORD_RAW_TOKEN,
      new_password: 'Staff#123',
    });
    expect(status).toBe(200);
    expect(body.data.success).toBe(true);

    const [u] = await db.select().from(users).where(eq(users.id, STAFF_ID));
    expect(u.status).toBe('active');
    expect(u.firstLoginRequired).toBe(false);

    const tHash = hashToken(SET_PASSWORD_RAW_TOKEN);
    const [pt] = await db.select().from(passwordTokens).where(eq(passwordTokens.tokenHash, tHash));
    expect(pt.usedAt).not.toBeNull();
  });

  it('C2 — token expired → 401 ERR_TOKEN_EXPIRED', async () => {
    const expiredRaw = generateToken();
    await db.insert(passwordTokens).values({
      userId: STAFF_ID,
      companyId: COMPANY_ID,
      tokenHash: hashToken(expiredRaw),
      type: 'set_password',
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    const { status, body } = await req('POST', '/api/v1/auth/set-password', {
      token: expiredRaw,
      new_password: 'Staff#123',
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_TOKEN_EXPIRED');
  });

  it('C3 — token sudah used → 409 ERR_TOKEN_USED', async () => {
    // SET_PASSWORD_RAW_TOKEN was already used in C1
    const { status, body } = await req('POST', '/api/v1/auth/set-password', {
      token: SET_PASSWORD_RAW_TOKEN,
      new_password: 'Staff#123',
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('ERR_TOKEN_USED');
  });

  it('C4 — new_password < 8 chars → 422 ERR_VALIDATION dengan details', async () => {
    const freshRaw = generateToken();
    await db.insert(passwordTokens).values({
      userId: OWNER_ID,
      companyId: COMPANY_ID,
      tokenHash: hashToken(freshRaw),
      type: 'set_password',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const { status, body } = await req('POST', '/api/v1/auth/set-password', {
      token: freshRaw,
      new_password: 'abc',   // too short, no number
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe('ERR_VALIDATION');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('C5 — email tak terdaftar → 200 (anti-enumeration)', async () => {
    const { status, body } = await req('POST', '/api/v1/auth/request-password-reset', {
      email: 'ghost@nowhere.test',
    });
    expect(status).toBe(200);
    expect(body.data.success).toBe(true);
  });

  it('C6 — reset-password sukses → 200 + semua refresh token revoked', async () => {
    // Give owner some refresh tokens first
    await db.insert(refreshTokens).values({
      userId: OWNER_ID,
      companyId: COMPANY_ID,
      tokenHash: hashToken(generateToken()),
      expiresAt: new Date(Date.now() + AUTH.REFRESH_TTL_SEC * 1000),
    });

    const resetRaw = generateToken();
    await db.insert(passwordTokens).values({
      userId: OWNER_ID,
      companyId: COMPANY_ID,
      tokenHash: hashToken(resetRaw),
      type: 'reset_password',
      expiresAt: new Date(Date.now() + AUTH.RESET_PASSWORD_TTL_SEC * 1000),
    });

    const { status, body } = await req('POST', '/api/v1/auth/reset-password', {
      token: resetRaw,
      new_password: 'Owner#456',
    });
    expect(status).toBe(200);
    expect(body.data.success).toBe(true);

    // All refresh tokens for owner should be revoked
    const active = await sql`
      SELECT * FROM refresh_tokens
      WHERE user_id = ${OWNER_ID} AND revoked_at IS NULL
    `;
    expect(active.length).toBe(0);

    // Restore owner password for subsequent tests
    await db.update(users)
      .set({ passwordHash: hashPassword(FIXTURES.owner.password) })
      .where(eq(users.id, OWNER_ID));
  });

  it('C7 — current_password salah → 401 ERR_INVALID_CREDENTIALS', async () => {
    const token = await makeAccessToken(OWNER_ID, COMPANY_ID);
    const { status, body } = await req(
      'POST',
      '/api/v1/auth/change-password',
      { current_password: 'WrongPass1', new_password: 'Owner#789' },
      { Authorization: `Bearer ${token}` }
    );
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION / GUARD (D1–D5)
// ─────────────────────────────────────────────────────────────────────────────

describe('SESSION / GUARD', () => {
  it('D1 — tanpa Bearer → GET /auth/me 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('GET', '/api/v1/auth/me');
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');
  });

  it('D2 — JWT expired → 401 ERR_UNAUTHENTICATED', async () => {
    const expired = await makeExpiredToken(OWNER_ID, COMPANY_ID);
    const { status, body } = await req('GET', '/api/v1/auth/me', undefined, {
      Authorization: `Bearer ${expired}`,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');
  });

  it('D3 — user suspended mid-session → 401 ERR_UNAUTHENTICATED', async () => {
    const token = await makeAccessToken(SPV_ID, COMPANY_ID);
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, SPV_ID));

    const { status, body } = await req('GET', '/api/v1/auth/me', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');

    await db.update(users).set({ status: 'active' }).where(eq(users.id, SPV_ID));
  });

  it('D4 — firstLoginRequired=true → akses /dashboard → 403 ERR_PASSWORD_CHANGE_REQUIRED', async () => {
    // authMiddleware reads firstLoginRequired from DB, so we must set it there
    await db.update(users).set({ firstLoginRequired: true }).where(eq(users.id, STAFF_ID));
    const token = await makeAccessToken(STAFF_ID, COMPANY_ID, true);
    // /me/permissions is NOT in the firstLoginGuard allowlist
    const { status, body } = await req('GET', '/api/v1/auth/me/permissions', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('ERR_PASSWORD_CHANGE_REQUIRED');
    await db.update(users).set({ firstLoginRequired: false }).where(eq(users.id, STAFF_ID));
  });

  it('D5 — firstLoginRequired=true → /auth/change-password diizinkan (allowlist)', async () => {
    // Staff was set to active + firstLoginRequired=false in C1
    // Temporarily set firstLoginRequired=true to test the guard
    await db.update(users).set({ firstLoginRequired: true }).where(eq(users.id, STAFF_ID));
    const token = await makeAccessToken(STAFF_ID, COMPANY_ID, true);

    const { status } = await req(
      'POST',
      '/api/v1/auth/change-password',
      { current_password: 'Staff#123', new_password: 'Staff#456' },
      { Authorization: `Bearer ${token}` }
    );
    // Should NOT be blocked by firstLoginGuard (allowlisted)
    // May return 401/200 based on password, but NOT 403 ERR_PASSWORD_CHANGE_REQUIRED
    expect(status).not.toBe(403);

    await db.update(users).set({ firstLoginRequired: false }).where(eq(users.id, STAFF_ID));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TENANCY (E1)
// ─────────────────────────────────────────────────────────────────────────────

describe('TENANCY', () => {
  it('E1 — refresh token tak dikenal (cross-company / random) → 401 ERR_UNAUTHENTICATED', async () => {
    // Simulate company B token: just a random token not in DB
    const companyBToken = generateToken();
    const { status, body } = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: companyBToken,
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC INTEGRATION (I1-I2)
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC INTEGRATION', () => {
  it('I1 — /auth/me/permissions returns resolved roles, scopes, and permissions', async () => {
    const token = await makeAccessToken(OWNER_ID, COMPANY_ID);

    const { status, body } = await req('GET', '/api/v1/auth/me/permissions', undefined, {
      Authorization: `Bearer ${token}`,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.roles).toEqual(['ERP_OWNER_AUTH']);
    expect(body.data.scopes).toEqual([{ scope_type: 'company', scope_id: null }]);
    expect(body.data.permissions).toEqual(['inventory.read', 'reports.read']);
  });

  it('I2 — login and refresh access tokens include roles/scopes hints, not full permissions', async () => {
    const login = await req('POST', '/api/v1/auth/login', {
      email: FIXTURES.owner.email,
      password: FIXTURES.owner.password,
    });
    expect(login.status).toBe(200);

    const loginPayload = await verifyAccessToken(login.body.data.access_token, TEST_JWT_SECRET);
    expect(loginPayload.roles).toEqual(['ERP_OWNER_AUTH']);
    expect(loginPayload.scopes).toEqual([{ scope_type: 'company', scope_id: null }]);
    // JWT payload intentionally omits full permissions; this narrows only for the negative assertion.
    expect((loginPayload as unknown as { permissions?: string[] }).permissions).toBeUndefined();

    const refreshed = await req('POST', '/api/v1/auth/refresh', {
      refresh_token: login.body.data.refresh_token,
    });
    expect(refreshed.status).toBe(200);

    const refreshPayload = await verifyAccessToken(refreshed.body.data.access_token, TEST_JWT_SECRET);
    expect(refreshPayload.roles).toEqual(['ERP_OWNER_AUTH']);
    expect(refreshPayload.scopes).toEqual([{ scope_type: 'company', scope_id: null }]);
    // JWT payload intentionally omits full permissions; this narrows only for the negative assertion.
    expect((refreshPayload as unknown as { permissions?: string[] }).permissions).toBeUndefined();

    await sql`DELETE FROM refresh_tokens WHERE user_id = ${OWNER_ID}`;
  });
});
