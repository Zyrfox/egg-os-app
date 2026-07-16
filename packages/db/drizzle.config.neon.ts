import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '../../.env.neon.local' })

const url = process.env.NEON_DATABASE_URL
if (!url) {
  throw new Error(
    'NEON_DATABASE_URL is not set.\n' +
    'Create .env.neon.local with NEON_DATABASE_URL=<neon-connection-string> before running Neon migrations.\n' +
    'NEVER run this config against the local test database.'
  )
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './migrations',
  dbCredentials: { url },
})
