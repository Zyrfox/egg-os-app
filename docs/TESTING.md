# Testing

## Local Postgres For API Tests

The API test suite should run against a local Postgres container, not the remote Neon database. Running tests against Neon was slow and flaky: full suite runs took about 160 seconds and sometimes failed with `ECONNRESET`. Running against local Postgres has been verified at about 6 seconds for 108 passing tests.

Development and database tooling still use the root `.env` file. Tests use `.env.test`, loaded after `.env` by `apps/api/vitest.config.ts` with `override: true`, so the test `DATABASE_URL` wins only inside Vitest.

### 1. Start The Test Database

Use a separate container and volume. Do not reuse `omni-pg-local`.

```powershell
docker run -d --name egg-os-pg-test `
  -e POSTGRES_USER=egg -e POSTGRES_PASSWORD=egg -e POSTGRES_DB=egg_os_test `
  -e PGDATA=/var/lib/postgresql/data `
  -p 54323:5432 -v egg-os-pg-test-data:/var/lib/postgresql/data `
  postgres:18
```

`PGDATA` is required for this mount. Without it, the `postgres:18` image refuses to start because PG18 uses a major-version-specific data layout by default.

Wait until Postgres accepts connections:

```powershell
docker exec egg-os-pg-test pg_isready -U egg -d egg_os_test
```

### 2. If Local Postgres Hits Connection Limits

Vitest runs test files in parallel, and several files open their own Postgres pools. If the suite fails with `sorry, too many clients already`, raise the limit for this local test container and restart it:

```powershell
docker exec egg-os-pg-test psql -U egg -d egg_os_test -c "ALTER SYSTEM SET max_connections = '300';"
docker restart egg-os-pg-test
docker exec egg-os-pg-test pg_isready -U egg -d egg_os_test
docker exec egg-os-pg-test psql -U egg -d egg_os_test -Atc "show max_connections;"
```

This is safe for the local test database only. Do not copy this production-side without a real capacity review.

### 3. Create The Test Env File

Copy the example file:

```powershell
Copy-Item .env.test.example .env.test
```

`.env.test` is ignored and must not be committed. It should contain only the local non-secret test database URL:

```env
DATABASE_URL=postgresql://egg:egg@localhost:54323/egg_os_test
```

### 4. Apply Migrations To The Local Test Database

Do not change `packages/db/drizzle.config.ts`; it intentionally reads `../../.env` by default. Override `DATABASE_URL` inline for the migration process:

```powershell
$env:DATABASE_URL='postgresql://egg:egg@localhost:54323/egg_os_test'; pnpm --filter @egg-os/db db:migrate
```

This applies the existing migrations to `egg_os_test`.

### 5. Seed CORE Once

`rbac/seed.test.ts` calls `seedRbac()` itself, but that seed expects company `EGG` to exist. Seed CORE once into the local test DB:

```powershell
$env:DATABASE_URL='postgresql://egg:egg@localhost:54323/egg_os_test'; pnpm --filter @egg-os/db db:seed:core
```

Expected output:

```text
Core seed complete: company=EGG, brands=8, outlets=2
```

### 6. Run The API Test Suite

```powershell
pnpm --filter @egg-os/api exec vitest run
```

Expected result on the verified local setup:

```text
Test Files  9 passed (9)
Tests       108 passed (108)
Duration    about 6s
```
