import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { AgentService } from '../services/agent.service.js'
import { AuditService } from '../services/audit.service.js'
import { requireAuth } from '../middleware/auth.js'

/**
 * Agent routes — secret brokering for AI agents and automations.
 *
 * The core flow:
 *   1. Agent declares identity (agentId) + intent (what, why, target resource)
 *   2. Intent verifier checks: is this agent registered? is this scope allowed?
 *      Does this action require human approval?
 *   3. If approved → secret broker fetches from vault, holds in memory for TTL
 *   4. Returns ephemeral credential. Every access is audit-logged.
 */

const RequestSecretSchema = z.object({
  agentId: z.string().uuid(),
  intent: z.object({
    action: z.string().min(1),         // e.g. "send_email", "create_stripe_charge"
    resource: z.string().min(1),       // e.g. "gmail", "stripe"
    reason: z.string().min(1),         // human-readable justification
    targetUserId: z.string().uuid().optional(), // whose credential to use
  }),
  ttlSeconds: z.number().int().min(5).max(300).default(30),
})

const RegisterAgentSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  allowedResources: z.array(z.string()),   // e.g. ["gmail", "stripe", "github"]
  allowedActions: z.array(z.string()),     // e.g. ["read", "send_email"]
  requireApproval: z.boolean().default(true),
  webhookUrl: z.string().url().optional(), // where to POST approval requests
})

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  const agentService = new AgentService()
  const auditService = new AuditService()

  /**
   * POST /v1/agents
   * Register a new named agent with scoped permissions.
   */
  fastify.post('/', {
    preHandler: requireAuth,
    schema: {
      tags: ['Agents'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const body = RegisterAgentSchema.parse(request.body)
    const agent = await agentService.registerAgent({
      ...body,
      ownerId: request.user.id,
    })
    return reply.status(201).send(agent)
  })

  /**
   * GET /v1/agents
   * List agents owned by the authenticated user.
   */
  fastify.get('/', {
    preHandler: requireAuth,
    schema: { tags: ['Agents'], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    return agentService.listAgents(request.user.id)
  })

  /**
   * POST /v1/agents/secret-request
   * Core broker endpoint. An agent requests ephemeral access to a secret.
   *
   * Returns a short-lived token scoped to the stated intent.
   * The actual credential is NEVER returned directly — callers use the
   * returned session token to make the proxied API call through AuthoryxOS.
   */
  fastify.post('/secret-request', {
    preHandler: requireAuth,
    schema: {
      tags: ['Agents'],
      security: [{ bearerAuth: [] }],
      summary: 'Request ephemeral credential for a stated intent',
    },
  }, async (request, reply) => {
    const body = RequestSecretSchema.parse(request.body)

    // Verify the agent is registered and owned by this user
    const agent = await agentService.verifyAgent(body.agentId, request.user.id)

    // Check scope: is this resource + action allowed for this agent?
    await agentService.checkScope(agent, body.intent)

    // Does this action require human approval?
    if (agent.requireApproval) {
      const approval = await agentService.requestApproval(agent, body.intent, request.user.id)
      if (approval.status === 'pending') {
        return reply.status(202).send({
          status: 'pending_approval',
          approvalId: approval.id,
          message: 'Approval request sent. Poll /v1/agents/approvals/:id for status.',
        })
      }
      if (approval.status === 'denied') {
        await auditService.log({
          event: 'agent.secret.denied',
          agentId: agent.id,
          userId: request.user.id,
          intent: body.intent,
        })
        return reply.status(403).send({ error: 'Request denied by approver' })
      }
    }

    // Issue ephemeral session token — scoped to intent, expires in TTL
    const session = await agentService.issueEphemeralSession({
      agent,
      intent: body.intent,
      ttlSeconds: body.ttlSeconds,
      requestedBy: request.user.id,
    })

    await auditService.log({
      event: 'agent.secret.granted',
      agentId: agent.id,
      userId: request.user.id,
      intent: body.intent,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    })

    return reply.status(200).send({
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      scope: session.scope,
    })
  })

  /**
   * GET /v1/agents/approvals/:id
   * Poll approval status for a pending secret request.
   */
  fastify.get('/approvals/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const approval = await agentService.getApproval(id, request.user.id)
    return reply.send(approval)
  })

  /**
   * POST /v1/agents/approvals/:id/decide
   * Human approves or denies a pending agent secret request.
   */
  fastify.post('/approvals/:id/decide', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { decision, reason } = z.object({
      decision: z.enum(['approve', 'deny']),
      reason: z.string().optional(),
    }).parse(request.body)

    const result = await agentService.decideApproval(id, decision, request.user.id, reason)

    await auditService.log({
      event: `agent.approval.${decision}d`,
      approvalId: id,
      userId: request.user.id,
      reason,
    })

    return reply.send(result)
  })

  /**
   * GET /v1/agents/:id/audit
   * Full audit trail for a specific agent.
   */
  fastify.get('/:id/audit', {
    preHandler: requireAuth,
  }, async (request) => {
    const { id } = request.params as { id: string }
    return auditService.getAgentAuditLog(id, request.user.id)
  })
}
