/**
 * @authoryx/config
 *
 * Typed, validated environment config for all apps.
 * Import `config` anywhere — it throws at startup if required vars are missing,
 * so misconfigured deploys fail fast instead of at runtime.
 */

import { z } from 'zod'

const ConfigSchema = z.object({
  // App
  NODE_ENV:  z.enum(['development', 'test', 'production']).default('development'),
  APP_URL:   z.string().url().default('http://localhost:3000'),
  API_URL:   z.string().url().default('http://localhost:4000'),
  PORT:      z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1),
  REDIS_URL:    z.string().min(1),

  // Auth
  JWT_SECRET:              z.string().min(32),
  SESSION_SECRET:          z.string().min(16),
  JWT_EXPIRES_IN:          z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // Vault
  VAULT_MASTER_KEY:   z.string().min(32),
  PBKDF2_ITERATIONS:  z.coerce.number().int().min(100_000).default(600_000),

  // SMS relay
  SMS_RELAY_SECRET: z.string().min(16),

  // Twilio (optional)
  TWILIO_ACCOUNT_SID:  z.string().optional(),
  TWILIO_AUTH_TOKEN:   z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Agent runtime
  AGENT_SECRET_TTL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  AGENT_REQUIRE_APPROVAL:   z.string().transform(v => v === 'true').default('true'),

  // Audit
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),

  // Webhooks
  WEBHOOK_SIGNING_SECRET: z.string().min(16),

  // Email
  SMTP_HOST:  z.string().optional(),
  SMTP_PORT:  z.coerce.number().int().optional(),
  SMTP_USER:  z.string().optional(),
  SMTP_PASS:  z.string().optional(),
  EMAIL_FROM: z.string().email().default('no-reply@authoryx.com'),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // Self-hosted flags
  DISABLE_TELEMETRY:       z.string().transform(v => v === 'true').default('false'),
  ALLOW_OPEN_REGISTRATION: z.string().transform(v => v !== 'false').default('true'),
})

export type Config = z.infer<typeof ConfigSchema>

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(
      `AuthoryxOS: Invalid environment configuration\n${missing.join('\n')}\n\nSee .env.example for required variables.`
    )
  }
  return result.data
}

export const config = loadConfig()
