import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import crypto from 'node:crypto'
import { SmsService } from '../services/sms.service.js'
import { requireAuth } from '../middleware/auth.js'
import { config } from '@authoryx/config'

/**
 * SMS routes — receive relayed messages from mobile apps, route OTPs.
 *
 * Mobile app flow:
 *   1. iOS/Android app receives an SMS
 *   2. App signs the payload with SMS_RELAY_SECRET (HMAC-SHA256)
 *   3. POST /v1/sms/relay with signed payload
 *   4. Server verifies signature, parses OTP if present
 *   5. Routes to groups / agents per user's rules
 */

const RelayPayloadSchema = z.object({
  deviceId: z.string(),
  sender: z.string(),
  body: z.string(),
  receivedAt: z.string().datetime(),
  // HMAC-SHA256(deviceId + sender + body + receivedAt, SMS_RELAY_SECRET)
  signature: z.string(),
})

const ForwardRuleSchema = z.object({
  name: z.string(),
  // Match incoming messages by sender pattern (regex allowed)
  senderPattern: z.string(),
  // Match by body content (regex allowed)
  bodyPattern: z.string().optional(),
  // Where to forward: group, user, agent, webhook
  forwardTo: z.array(z.object({
    type: z.enum(['group', 'user', 'agent', 'webhook']),
    targetId: z.string(),
  })),
  // Extract OTP before forwarding (strips surrounding text)
  extractOtp: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

export const smsRoutes: FastifyPluginAsync = async (fastify) => {
  const smsService = new SmsService()

  /**
   * POST /v1/sms/relay
   * Receive an SMS relayed from the mobile app.
   * Validates the HMAC signature before processing.
   */
  fastify.post('/relay', {
    // No requireAuth — authenticated via HMAC signature instead
    schema: { tags: ['SMS'], summary: 'Relay an SMS from a registered device' },
  }, async (request, reply) => {
    const body = RelayPayloadSchema.parse(request.body)

    // Verify HMAC — prevents spoofed relay payloads
    const expected = crypto
      .createHmac('sha256', config.SMS_RELAY_SECRET)
      .update(`${body.deviceId}${body.sender}${body.body}${body.receivedAt}`)
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(body.signature), Buffer.from(expected))) {
      return reply.status(401).send({ error: 'Invalid relay signature' })
    }

    const result = await smsService.processIncoming(body)
    return reply.status(202).send(result)
  })

  /**
   * GET /v1/sms/messages
   * List received SMS messages for the authenticated user.
   */
  fastify.get('/messages', {
    preHandler: requireAuth,
    schema: { tags: ['SMS'], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const { limit = 50, offset = 0, sender } = request.query as {
      limit?: number; offset?: number; sender?: string
    }
    return smsService.listMessages(request.user.id, { limit, offset, sender })
  })

  /**
   * GET /v1/sms/devices
   * List registered relay devices for this user.
   */
  fastify.get('/devices', {
    preHandler: requireAuth,
  }, async (request) => {
    return smsService.listDevices(request.user.id)
  })

  /**
   * POST /v1/sms/devices/register
   * Register a new mobile device as a relay source.
   * Returns a device token the app uses to sign relay payloads.
   */
  fastify.post('/devices/register', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const body = z.object({
      deviceName: z.string(),
      platform: z.enum(['ios', 'android']),
      pushToken: z.string().optional(),
    }).parse(request.body)

    const device = await smsService.registerDevice({ ...body, userId: request.user.id })
    return reply.status(201).send(device)
  })

  /**
   * GET /v1/sms/rules
   * List forward rules for the authenticated user.
   */
  fastify.get('/rules', {
    preHandler: requireAuth,
  }, async (request) => {
    return smsService.listRules(request.user.id)
  })

  /**
   * POST /v1/sms/rules
   * Create a new forward rule.
   */
  fastify.post('/rules', {
    preHandler: requireAuth,
    schema: { tags: ['SMS'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const body = ForwardRuleSchema.parse(request.body)
    const rule = await smsService.createRule({ ...body, userId: request.user.id })
    return reply.status(201).send(rule)
  })

  /**
   * PUT /v1/sms/rules/:id
   */
  fastify.put('/rules/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = ForwardRuleSchema.partial().parse(request.body)
    const rule = await smsService.updateRule(id, request.user.id, body)
    return reply.send(rule)
  })

  /**
   * DELETE /v1/sms/rules/:id
   */
  fastify.delete('/rules/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await smsService.deleteRule(id, request.user.id)
    return reply.status(204).send()
  })
}
