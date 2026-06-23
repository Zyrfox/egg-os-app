import { Hono } from 'hono'
import { errResponse, ERR } from './lib/errors'
import authRouter from './routes/auth'
import coreRouter from './modules/core/routes'
import rbacRouter from './modules/rbac/routes'
import usersRouter from './modules/users/routes'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// Global error handler — never leak internals (Global Contract §2.4)
app.onError((err, c) => {
  console.error(err)
  return c.json(errResponse(ERR.INTERNAL.code, ERR.INTERNAL.message), 500)
})

app.get('/health', (c) =>
  c.json({ success: true, data: { status: 'ok' } })
)

app.route('/api/v1', coreRouter)
app.route('/api/v1/auth', authRouter)
app.route('/api/v1/rbac', rbacRouter)
app.route('/api/v1/users', usersRouter)

export default app
