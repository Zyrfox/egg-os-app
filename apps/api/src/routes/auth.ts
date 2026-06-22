import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { users, refreshTokens, passwordTokens, authEvents } from '@egg-os/db';
import { createDb, type Db } from '../lib/db';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../lib/crypto';
import { signAccessToken } from '../lib/jwt';
import { errResponse, okResponse, ERR } from '../lib/errors';
import { AUTH } from '../lib/constants';
import { authMiddleware, firstLoginGuard } from '../middleware/auth';
import type { Env, AuthCtx } from '../types';

// ── Zod schemas (§5) ────────────────────────────────────────────────────────

const LoginReq = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshReq = z.object({ refresh_token: z.string().min(1) });

const LogoutReq = z.object({ refresh_token: z.string().optional() });

const passwordRules = z
  .string()
  .min(AUTH.PASSWORD.minLength, `Minimal ${AUTH.PASSWORD.minLength} karakter`)
  .regex(/[A-Za-z]/, 'harus mengandung huruf')
  .regex(/[0-9]/, 'harus mengandung angka');

const SetPasswordReq = z.object({
  token: z.string().min(10),
  new_password: passwordRules,
});

const ReqResetReq = z.object({ email: z.string().email() });

const ResetReq = z.object({
  token: z.string().min(10),
  new_password: passwordRules,
});

const ChangeReq = z.object({
  current_password: z.string().min(1),
  new_password: passwordRules,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }));
}

function formatUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    company_id: u.companyId,
    email: u.email,
    full_name: u.fullName,
    status: u.status,
    first_login_required: u.firstLoginRequired,
    is_freelance: u.isFreelance,
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
  };
}

type RequestMeta = { ip: string | null; ua: string | null };

function getMeta(c: { req: { header: (n: string) => string | undefined } }): RequestMeta {
  return {
    ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    ua: c.req.header('User-Agent') ?? null,
  };
}

async function logEvent(
  db: Db,
  companyId: string | null,
  userId: string | null,
  eventType: string,
  meta: RequestMeta,
  detail: Record<string, unknown> = {}
) {
  await db.insert(authEvents).values({
    companyId,
    userId,
    eventType,
    ipAddress: meta.ip,
    userAgent: meta.ua,
    detail: detail as never,
  });
}

async function issueTokenPair(
  db: Db,
  user: typeof users.$inferSelect,
  jwtSecret: string,
  meta: RequestMeta
): Promise<{ accessToken: string; rawRefresh: string; refreshId: string }> {
  const rawRefresh = generateToken();
  const refreshHash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + AUTH.REFRESH_TTL_SEC * 1000);

  const [inserted] = await db
    .insert(refreshTokens)
    .values({
      userId: user.id,
      companyId: user.companyId,
      tokenHash: refreshHash,
      expiresAt,
      userAgent: meta.ua,
      ipAddress: meta.ip,
    })
    .returning({ id: refreshTokens.id });

  const accessToken = await signAccessToken(
    {
      sub: user.id,
      company_id: user.companyId,
      roles: [],   // RBAC module populates; AUTH emits empty hint per §4
      scopes: [],
      first_login_required: user.firstLoginRequired,
    },
    jwtSecret
  );

  return { accessToken, rawRefresh, refreshId: inserted.id };
}

// Dummy scrypt hash for constant-time response when user not found (§10 anti-enumeration)
const DUMMY_HASH =
  `scrypt$${16384}$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

// ── Router ────────────────────────────────────────────────────────────────────

const auth = new Hono<{ Bindings: Env; Variables: { auth: AuthCtx } }>();

// ── 5.1 POST /login ───────────────────────────────────────────────────────────
auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const { email, password } = parsed.data;
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const user = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1)
    .then((r) => r[0] ?? null);

  // User not found — run dummy verify to equalise timing (§10.3)
  if (!user) {
    verifyPassword(password, DUMMY_HASH);
    await logEvent(db, null, null, 'login_failed', meta);
    return c.json(errResponse(ERR.INVALID_CREDENTIALS.code, ERR.INVALID_CREDENTIALS.message), 401);
  }

  // Account locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return c.json(errResponse(ERR.LOGIN_LOCKED.code, ERR.LOGIN_LOCKED.message), 429);
  }

  // Status check — suspended / archived
  if (user.status === 'suspended' || user.status === 'archived') {
    await logEvent(db, user.companyId, user.id, 'login_failed', meta);
    return c.json(errResponse(ERR.USER_INACTIVE.code, ERR.USER_INACTIVE.message), 403);
  }

  // Freelance expiry (treated as inactive, §3)
  if (user.isFreelance && user.freelanceExpiresAt && user.freelanceExpiresAt < new Date()) {
    await logEvent(db, user.companyId, user.id, 'login_failed', meta);
    return c.json(errResponse(ERR.USER_INACTIVE.code, ERR.USER_INACTIVE.message), 403);
  }

  // Password verify — null hash (invited, no password yet) always fails; still runs scrypt for timing
  let passwordValid: boolean;
  if (user.passwordHash) {
    passwordValid = verifyPassword(password, user.passwordHash);
  } else {
    verifyPassword(password, DUMMY_HASH);
    passwordValid = false;
  }

  if (!passwordValid) {
    const newCount = user.failedLoginCount + 1;
    await logEvent(db, user.companyId, user.id, 'login_failed', meta);

    if (newCount >= AUTH.MAX_FAILED_LOGIN) {
      const lockedUntil = new Date(Date.now() + AUTH.LOCK_DURATION_SEC * 1000);
      await db.update(users)
        .set({ failedLoginCount: newCount, lockedUntil })
        .where(eq(users.id, user.id));
      await logEvent(db, user.companyId, user.id, 'account_locked', meta, {
        locked_until: lockedUntil.toISOString(),
      });
      return c.json(errResponse(ERR.LOGIN_LOCKED.code, ERR.LOGIN_LOCKED.message), 429);
    }

    await db.update(users).set({ failedLoginCount: newCount }).where(eq(users.id, user.id));
    return c.json(errResponse(ERR.INVALID_CREDENTIALS.code, ERR.INVALID_CREDENTIALS.message), 401);
  }

  // Final status gate (catches invited user who somehow has a password)
  if (user.status !== 'active') {
    return c.json(errResponse(ERR.USER_INACTIVE.code, ERR.USER_INACTIVE.message), 403);
  }

  // Success
  await db.update(users)
    .set({ failedLoginCount: 0, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  const { accessToken, rawRefresh } = await issueTokenPair(db, user, c.env.JWT_ACCESS_SECRET, meta);
  await logEvent(db, user.companyId, user.id, 'login_success', meta);

  return c.json(
    okResponse({
      access_token: accessToken,
      refresh_token: rawRefresh,
      token_type: 'Bearer' as const,
      expires_in: AUTH.ACCESS_TTL_SEC,
      user: formatUser(user),
    }),
    200
  );
});

// ── 5.2 POST /refresh ─────────────────────────────────────────────────────────
auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RefreshReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const tokenHash = hashToken(parsed.data.refresh_token);
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const record = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!record) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  // Token reuse detected: already revoked → revoke ALL sessions + log
  if (record.revokedAt) {
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, record.userId), isNull(refreshTokens.revokedAt)));
    await logEvent(db, record.companyId, record.userId, 'token_reuse_detected', meta);
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  // Token expired (not yet revoked)
  if (record.expiresAt < new Date()) {
    return c.json(errResponse(ERR.TOKEN_EXPIRED.code, ERR.TOKEN_EXPIRED.message), 401);
  }

  // Load user for fresh status check
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user || user.status !== 'active') {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  // Rotation: issue new pair then revoke old with replacedBy
  const { accessToken, rawRefresh, refreshId } = await issueTokenPair(
    db, user, c.env.JWT_ACCESS_SECRET, meta
  );

  await db.update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy: refreshId })
    .where(eq(refreshTokens.id, record.id));

  await logEvent(db, user.companyId, user.id, 'token_refreshed', meta);

  return c.json(
    okResponse({
      access_token: accessToken,
      refresh_token: rawRefresh,
      token_type: 'Bearer' as const,
      expires_in: AUTH.ACCESS_TTL_SEC,
    }),
    200
  );
});

// ── 5.3 POST /logout ──────────────────────────────────────────────────────────
auth.post('/logout', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LogoutReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const authCtx = c.get('auth');
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  if (parsed.data.refresh_token) {
    const tHash = hashToken(parsed.data.refresh_token);
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tHash),
          eq(refreshTokens.userId, authCtx.userId),
          isNull(refreshTokens.revokedAt)
        )
      );
  } else {
    // No token provided → revoke all sessions for user
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, authCtx.userId), isNull(refreshTokens.revokedAt)));
  }

  await logEvent(db, authCtx.companyId, authCtx.userId, 'logout', meta);
  return c.json(okResponse({ success: true }), 200);
});

// ── 5.4 GET /me ───────────────────────────────────────────────────────────────
auth.get('/me', authMiddleware, firstLoginGuard, async (c) => {
  const authCtx = c.get('auth');
  const db = createDb(c.env.DATABASE_URL);

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, authCtx.userId), eq(users.companyId, authCtx.companyId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  return c.json(okResponse(formatUser(user)), 200);
});

// ── 5.5 GET /me/permissions ───────────────────────────────────────────────────
auth.get('/me/permissions', authMiddleware, firstLoginGuard, async (c) => {
  const authCtx = c.get('auth');
  return c.json(
    okResponse({
      roles: authCtx.roles,
      scopes: authCtx.scopes,
      permissions: [] as string[], // RBAC module fills this; AUTH passthrough
    }),
    200
  );
});

// ── 5.6 POST /set-password ────────────────────────────────────────────────────
auth.post('/set-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SetPasswordReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const { token, new_password } = parsed.data;
  const tHash = hashToken(token);
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const pt = await db
    .select()
    .from(passwordTokens)
    .where(and(eq(passwordTokens.tokenHash, tHash), eq(passwordTokens.type, 'set_password')))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!pt) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }
  if (pt.usedAt) {
    return c.json(errResponse(ERR.TOKEN_USED.code, ERR.TOKEN_USED.message), 409);
  }
  if (pt.expiresAt < new Date()) {
    return c.json(errResponse(ERR.TOKEN_EXPIRED.code, ERR.TOKEN_EXPIRED.message), 401);
  }

  const passwordHash = hashPassword(new_password);
  await db.update(users)
    .set({ passwordHash, status: 'active', firstLoginRequired: false })
    .where(eq(users.id, pt.userId));
  await db.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, pt.id));
  await logEvent(db, pt.companyId, pt.userId, 'password_set', meta);

  return c.json(okResponse({ success: true }), 200);
});

// ── 5.7 POST /request-password-reset ─────────────────────────────────────────
auth.post('/request-password-reset', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ReqResetReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const { email } = parsed.data;
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const user = await db
    .select()
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.email})`, email.toLowerCase()),
        eq(users.status, 'active'),
        isNull(users.deletedAt)
      )
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  // Always return 200 — anti-enumeration (§5.7, §10.3)
  if (user) {
    const rawToken = generateToken();
    const tHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + AUTH.RESET_PASSWORD_TTL_SEC * 1000);

    await db.insert(passwordTokens).values({
      userId: user.id,
      companyId: user.companyId,
      tokenHash: tHash,
      type: 'reset_password',
      expiresAt,
    });

    await logEvent(db, user.companyId, user.id, 'password_reset_requested', meta);
    // TODO: queue email delivery via Cloudflare Queues (out of scope AUTH sprint)
  }

  return c.json(okResponse({ success: true }), 200);
});

// ── 5.8 POST /reset-password ──────────────────────────────────────────────────
auth.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ResetReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const { token, new_password } = parsed.data;
  const tHash = hashToken(token);
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const pt = await db
    .select()
    .from(passwordTokens)
    .where(and(eq(passwordTokens.tokenHash, tHash), eq(passwordTokens.type, 'reset_password')))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!pt) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }
  if (pt.usedAt) {
    return c.json(errResponse(ERR.TOKEN_USED.code, ERR.TOKEN_USED.message), 409);
  }
  if (pt.expiresAt < new Date()) {
    return c.json(errResponse(ERR.TOKEN_EXPIRED.code, ERR.TOKEN_EXPIRED.message), 401);
  }

  const passwordHash = hashPassword(new_password);
  await db.update(users)
    .set({ passwordHash, firstLoginRequired: false })
    .where(eq(users.id, pt.userId));
  await db.update(passwordTokens).set({ usedAt: new Date() }).where(eq(passwordTokens.id, pt.id));

  // Revoke ALL refresh tokens → force re-login on all devices (§5.8)
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, pt.userId), isNull(refreshTokens.revokedAt)));

  await logEvent(db, pt.companyId, pt.userId, 'password_reset', meta);
  return c.json(okResponse({ success: true }), 200);
});

// ── 5.9 POST /change-password ─────────────────────────────────────────────────
auth.post('/change-password', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ChangeReq.safeParse(body);
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422);
  }
  const { current_password, new_password } = parsed.data;
  const authCtx = c.get('auth');
  const db = createDb(c.env.DATABASE_URL);
  const meta = getMeta(c);

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, authCtx.userId), eq(users.companyId, authCtx.companyId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user || !user.passwordHash) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  if (!verifyPassword(current_password, user.passwordHash)) {
    return c.json(errResponse(ERR.INVALID_CREDENTIALS.code, ERR.INVALID_CREDENTIALS.message), 401);
  }

  const passwordHash = hashPassword(new_password);
  await db.update(users)
    .set({ passwordHash, firstLoginRequired: false })
    .where(eq(users.id, authCtx.userId));

  // Revoke all refresh tokens (force re-login on other sessions)
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, authCtx.userId), isNull(refreshTokens.revokedAt)));

  await logEvent(db, authCtx.companyId, authCtx.userId, 'password_changed', meta);
  return c.json(okResponse({ success: true }), 200);
});

export default auth;
