import { sign, verify } from 'hono/jwt';
import type { Scope } from '../types';
import { AUTH } from './constants';

export type JwtPayload = {
  sub: string;
  company_id: string;
  roles: string[];
  scopes: Scope[];
  first_login_required: boolean;
  iat: number;
  exp: number;
};

export async function signAccessToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...payload, iat: now, exp: now + AUTH.ACCESS_TTL_SEC }, secret, 'HS256');
}

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<JwtPayload> {
  return verify(token, secret, 'HS256') as Promise<JwtPayload>;
}
