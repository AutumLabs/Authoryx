/**
 * @authoryx/types — Shared domain types
 *
 * These are the canonical type definitions used across
 * API, worker, web, and SDK packages.
 */

// ── Core entities ─────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  displayName: string | null
  publicKey: string | null
  createdAt: Date
}

export interface Device {
  id: string
  userId: string
  deviceName: string
  platform: 'ios' | 'android'
  lastSeenAt: Date | null
  createdAt: Date
}

export interface Group {
  id: string
  name: string
  description: string | null
  ownerId: string
  memberCount: number
  createdAt: Date
}

export type SecretType = 'password' | 'api_key' | 'otp_seed' | 'note' | 'credential'

export interface Secret {
  id: string
  name: string
  type: SecretType
  ownerId: string
  metadata: {
    url?: string
    username?: string
    notes?: string
    tags?: string[]
  } | null
  createdAt: Date
  updatedAt: Date
  // encryptedPayload is NOT included in list responses — only on direct GET
}

export interface SecretWithPayload extends Secret {
  encryptedPayload: string
  nonce: string
  authTag: string
}

export interface SecretShare {
  id: string
  secretId: string
  grantedBy: string
  targetType: 'user' | 'group' | 'agent'
  targetId: string
  expiresAt: Date | null
  createdAt: Date
}

// ── Agents ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  ownerId: string
  name: string
  description: string | null
  allowedResources: string[]
  allowedActions: string[]
  requireApproval: boolean
  webhookUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentIntent {
  action: string
  resource: string
  reason: string
  targetUserId?: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface AgentApproval {
  id: string
  agentId: string
  requestedBy: string
  intent: AgentIntent
  status: ApprovalStatus
  decidedBy: string | null
  decisionReason: string | null
  expiresAt: Date
  decidedAt: Date | null
  createdAt: Date
}

export interface EphemeralSession {
  id: string
  token: string
  agentId: string
  scope: string[]
  expiresAt: Date
}

// ── SMS ───────────────────────────────────────────────────────────────────────

export interface SmsMessage {
  id: string
  deviceId: string
  userId: string
  sender: string
  body: string
  extractedOtp: string | null
  receivedAt: Date
  processedAt: Date | null
}

export interface SmsForwardTarget {
  type: 'group' | 'user' | 'agent' | 'webhook'
  targetId: string
}

export interface SmsRule {
  id: string
  userId: string
  name: string
  senderPattern: string
  bodyPattern: string | null
  forwardTo: SmsForwardTarget[]
  extractOtp: boolean
  enabled: boolean
  createdAt: Date
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: string
  event: string
  userId: string | null
  agentId: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: Date
}

// ── API responses ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface ApiError {
  error: string
  details?: unknown
}

// ── Fastify request augmentation ──────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user: User
  }
}
