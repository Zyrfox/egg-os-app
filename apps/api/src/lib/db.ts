import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@egg-os/db';

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
