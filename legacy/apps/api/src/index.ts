import Fastify from 'fastify'
import { config } from '@authoryx/config'

import { authPlugin } from './middleware/auth.js'
import { rateLimitPlugin } from './middleware/rateLimit.js'
import { errorHandler } from './middleware/errorHandler.js'

// Routes
import { authRoutes } from './routes/auth.js'
import { vaultRoutes } from './routes/vault.js'
import { smsRoutes } from './routes/sms.js'
import { agentRoutes } from './routes/agents.js'
import { groupRoutes } from './routes/groups.js'
import { webhookRoutes } from './routes/webhooks.js'
import { healthRoutes } from './routes/health.js'

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Redact secrets from logs — never log credentials
      redact: ['req.headers.authorization', 'body.password', 'body.secret', 'body.credential'],
    },
    trustProxy: true,
  })

  // ── Plugins ──────────────────────────────────────────────────────────────
  await app.register(import('@fastify/cors'), {
    origin: config.APP_URL,
    credentials: true,
  })

  await app.register(import('@fastify/cookie'))
  await app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: '1 minute' })

  // Swagger docs (dev only)
  if (config.NODE_ENV !== 'production') {
    await app.register(import('@fastify/swagger'), {
      openapi: {
        info: { title: 'AuthoryxOS API', version: '0.1.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    })
    await app.register(import('@fastify/swagger-ui'), { routePrefix: '/docs' })
  }

  // ── Middleware ────────────────────────────────────────────────────────────
  await app.register(authPlugin)
  await app.register(rateLimitPlugin)
  app.setErrorHandler(errorHandler)

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/health' })
  await app.register(authRoutes,    { prefix: '/v1/auth' })
  await app.register(vaultRoutes,   { prefix: '/v1/vault' })
  await app.register(smsRoutes,     { prefix: '/v1/sms' })
  await app.register(groupRoutes,   { prefix: '/v1/groups' })
  await app.register(agentRoutes,   { prefix: '/v1/agents' })
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' })

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  app.log.info(`AuthoryxOS API running on port ${config.PORT}`)
}

bootstrap().catch((err) => {
  console.error('Fatal startup error', err)
  process.exit(1)
})
