import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { VaultService } from '../services/vault.service.js'
import { requireAuth } from '../middleware/auth.js'

/**
 * Vault routes — end-to-end encrypted secret storage.
 *
 * Secrets are encrypted client-side before being sent to the server.
 * The server stores ciphertext only. Server-side envelope encryption
 * (VAULT_MASTER_KEY) wraps the client-provided encrypted blob as
 * a defence-in-depth measure.
 *
 * Secret types: password | api_key | otp_seed | note | credential
 */

const SecretType = z.enum(['password', 'api_key', 'otp_seed', 'note', 'credential'])

const CreateSecretSchema = z.object({
  name: z.string().min(1).max(255),
  type: SecretType,
  // encryptedPayload: client-encrypted JSON blob (AES-GCM, key derived from user password)
  encryptedPayload: z.string(),
  // nonce used for client-side encryption
  nonce: z.string(),
  // Optional: which groups can access this secret
  sharedWithGroupIds: z.array(z.string().uuid()).default([]),
  // Optional: which agents can access this secret (by agentId)
  agentAccessList: z.array(z.string().uuid()).default([]),
  metadata: z.object({
    url: z.string().url().optional(),
    username: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }).optional(),
})

const ShareSecretSchema = z.object({
  targetType: z.enum(['user', 'group', 'agent']),
  targetId: z.string().uuid(),
  // Re-encrypted payload for the target's public key (user/group)
  // or scoped access token (agent)
  encryptedPayloadForTarget: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const vaultRoutes: FastifyPluginAsync = async (fastify) => {
  const vaultService = new VaultService()

  /**
   * GET /v1/vault/secrets
   * List secret metadata (NOT the encrypted payloads) for the authenticated user.
   */
  fastify.get('/secrets', {
    preHandler: requireAuth,
    schema: { tags: ['Vault'], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const { type, tag } = request.query as { type?: string; tag?: string }
    return vaultService.listSecrets(request.user.id, { type, tag })
  })

  /**
   * POST /v1/vault/secrets
   * Store a new encrypted secret.
   */
  fastify.post('/secrets', {
    preHandler: requireAuth,
    schema: { tags: ['Vault'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const body = CreateSecretSchema.parse(request.body)
    const secret = await vaultService.createSecret({
      ...body,
      ownerId: request.user.id,
    })
    return reply.status(201).send(secret)
  })

  /**
   * GET /v1/vault/secrets/:id
   * Retrieve the encrypted payload for a secret.
   * Access is verified (owner, group membership, or agent session).
   */
  fastify.get('/secrets/:id', {
    preHandler: requireAuth,
    schema: { tags: ['Vault'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const secret = await vaultService.getSecret(id, request.user.id)
    if (!secret) return reply.status(404).send({ error: 'Secret not found' })
    return secret
  })

  /**
   * PUT /v1/vault/secrets/:id
   * Update an existing secret (re-encrypt and replace payload).
   */
  fastify.put('/secrets/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = CreateSecretSchema.partial().parse(request.body)
    const updated = await vaultService.updateSecret(id, request.user.id, body)
    return reply.send(updated)
  })

  /**
   * DELETE /v1/vault/secrets/:id
   */
  fastify.delete('/secrets/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await vaultService.deleteSecret(id, request.user.id)
    return reply.status(204).send()
  })

  /**
   * POST /v1/vault/secrets/:id/share
   * Share a secret with a user, group, or agent.
   * The caller must provide the payload re-encrypted for the target's key.
   */
  fastify.post('/secrets/:id/share', {
    preHandler: requireAuth,
    schema: { tags: ['Vault'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = ShareSecretSchema.parse(request.body)
    const share = await vaultService.shareSecret(id, request.user.id, body)
    return reply.status(201).send(share)
  })

  /**
   * GET /v1/vault/secrets/:id/shares
   * List all active shares for a secret (owner only).
   */
  fastify.get('/secrets/:id/shares', {
    preHandler: requireAuth,
  }, async (request) => {
    const { id } = request.params as { id: string }
    return vaultService.listShares(id, request.user.id)
  })

  /**
   * DELETE /v1/vault/secrets/:id/shares/:shareId
   * Revoke a specific share.
   */
  fastify.delete('/secrets/:id/shares/:shareId', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id, shareId } = request.params as { id: string; shareId: string }
    await vaultService.revokeShare(id, shareId, request.user.id)
    return reply.status(204).send()
  })
}
