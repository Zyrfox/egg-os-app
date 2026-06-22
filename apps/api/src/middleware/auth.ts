import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { users } from '@egg-os/db';
import { createDb } from '../lib/db';
import { verifyAccessToken } from '../lib/jwt';
import { errResponse, ERR } from '../lib/errors';
import type { Env, AuthCtx } from '../types';

// Routes where firstLoginGuard allows access even if first_login_required=true
const FIRST_LOGIN_ALLOWLIST = [
  '/auth/change-password',
  '/auth/set-password',
  '/auth/me',
  '/auth/logout',
];

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { auth: AuthCtx };
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  const token = authHeader.slice(7);
  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token, c.env.JWT_ACCESS_SECRET);
  } catch {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  const db = createDb(c.env.DATABASE_URL);
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user || user.status !== 'active') {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  // Freelance expiry is treated as inactive (§3 state machine)
  if (user.isFreelance && user.freelanceExpiresAt && user.freelanceExpiresAt < new Date()) {
    return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401);
  }

  c.set('auth', {
    userId: user.id,
    companyId: user.companyId,
    roles: payload.roles,
    scopes: payload.scopes,
    firstLoginRequired: user.firstLoginRequired,
  });

  await next();
});

export const firstLoginGuard = createMiddleware<{
  Bindings: Env;
  Variables: { auth: AuthCtx };
}>(async (c, next) => {
  const auth = c.get('auth');
  if (auth?.firstLoginRequired) {
    const pathname = new URL(c.req.url).pathname;
    const allowed = FIRST_LOGIN_ALLOWLIST.some((p) => pathname.endsWith(p));
    if (!allowed) {
      return c.json(
        errResponse(ERR.PASSWORD_CHANGE_REQUIRED.code, ERR.PASSWORD_CHANGE_REQUIRED.message),
        403
      );
    }
  }
  await next();
});
