import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../../.env') })

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60000,
  },
})
