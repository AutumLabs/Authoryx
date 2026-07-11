/**
 * @authoryx/db — Drizzle ORM schema
 *
 * Tables:
 *   users            — accounts
 *   devices          — registered mobile relay devices
 *   groups           — sharing groups
 *   group_members    — user ↔ group membership
 *   secrets          — vault entries (ciphertext only)
 *   secret_shares    — who has access to which secret
 *   agents           — registered AI agents
 *   agent_approvals  — pending/approved/denied secret requests
 *   sms_messages     — relayed SMS log
 *   sms_rules        — forwarding rules
 *   audit_log        — immutable event log
 */

import {
  pgTable, uuid, text, boolean, timestamp,
  integer, jsonb, pgEnum, index, uniqueIndex,
} from 'drizzle-orm/pg-core'

// ── Enums ─────────────────────────────────────────────────────────────────────

export const secretTypeEnum = pgEnum('secret_type', [
  'password', 'api_key', 'otp_seed', 'note', 'credential',
])

export const shareTargetTypeEnum = pgEnum('share_target_type', [
  'user', 'group', 'agent',
])

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending', 'approved', 'denied', 'expired',
])

export const platformEnum = pgEnum('platform', ['ios', 'android'])

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull(),
  displayName:  text('display_name'),
  passwordHash: text('password_hash').notNull(),
  // Client-side key derivation salt (stored so user can re-derive vault key)
  kdfSalt:      text('kdf_salt').notNull(),
  // Public key for asymmetric secret sharing (X25519 or RSA-OAEP)
  publicKey:    text('public_key'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
}))

// ── Devices ───────────────────────────────────────────────────────────────────

export const devices = pgTable('devices', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(),
  platform:   platformEnum('platform').notNull(),
  // Hashed relay signing token — device uses this to sign relay payloads
  tokenHash:  text('token_hash').notNull(),
  pushToken:  text('push_token'),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('devices_user_idx').on(t.userId),
}))

// ── Groups ────────────────────────────────────────────────────────────────────

export const groups = pgTable('groups', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  description: text('description'),
  ownerId:     uuid('owner_id').notNull().references(() => users.id),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
})

export const groupMembers = pgTable('group_members', {
  id:       uuid('id').primaryKey().defaultRandom(),
  groupId:  uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId:   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:     text('role').notNull().default('member'), // 'admin' | 'member'
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => ({
  uniqueMember: uniqueIndex('group_members_unique').on(t.groupId, t.userId),
}))

// ── Vault ─────────────────────────────────────────────────────────────────────

export const secrets = pgTable('secrets', {
  id:   uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: secretTypeEnum('type').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // E2EE — server stores ciphertext only. The outer envelope uses VAULT_MASTER_KEY.
  encryptedPayload: text('encrypted_payload').notNull(),
  nonce:            text('nonce').notNull(),
  // GCM auth tag for integrity verification
  authTag:          text('auth_tag').notNull(),

  metadata: jsonb('metadata').$type<{
    url?: string
    username?: string
    notes?: string
    tags?: string[]
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index('secrets_owner_idx').on(t.ownerId),
}))

export const secretShares = pgTable('secret_shares', {
  id:           uuid('id').primaryKey().defaultRandom(),
  secretId:     uuid('secret_id').notNull().references(() => secrets.id, { onDelete: 'cascade' }),
  grantedBy:    uuid('granted_by').notNull().references(() => users.id),
  targetType:   shareTargetTypeEnum('target_type').notNull(),
  targetId:     uuid('target_id').notNull(), // userId | groupId | agentId
  // Re-encrypted payload for the target's key (for user/group shares)
  encryptedPayloadForTarget: text('encrypted_payload_for_target'),
  expiresAt:    timestamp('expires_at'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  secretTargetIdx: index('secret_shares_secret_target_idx').on(t.secretId, t.targetId),
}))

// ── Agents ────────────────────────────────────────────────────────────────────

export const agents = pgTable('agents', {
  id:               uuid('id').primaryKey().defaultRandom(),
  ownerId:          uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  description:      text('description'),
  allowedResources: jsonb('allowed_resources').$type<string[]>().notNull().default([]),
  allowedActions:   jsonb('allowed_actions').$type<string[]>().notNull().default([]),
  requireApproval:  boolean('require_approval').notNull().default(true),
  webhookUrl:       text('webhook_url'),
  // Hashed API key the agent uses to authenticate its requests
  apiKeyHash:       text('api_key_hash').notNull(),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index('agents_owner_idx').on(t.ownerId),
}))

export const agentApprovals = pgTable('agent_approvals', {
  id:           uuid('id').primaryKey().defaultRandom(),
  agentId:      uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  requestedBy:  uuid('requested_by').notNull().references(() => users.id),
  intent:       jsonb('intent').$type<{
    action: string
    resource: string
    reason: string
    targetUserId?: string
  }>().notNull(),
  status:       approvalStatusEnum('status').notNull().default('pending'),
  decidedBy:    uuid('decided_by').references(() => users.id),
  decisionReason: text('decision_reason'),
  expiresAt:    timestamp('expires_at').notNull(),
  decidedAt:    timestamp('decided_at'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  agentStatusIdx: index('agent_approvals_agent_status_idx').on(t.agentId, t.status),
}))

// ── SMS ───────────────────────────────────────────────────────────────────────

export const smsMessages = pgTable('sms_messages', {
  id:           uuid('id').primaryKey().defaultRandom(),
  deviceId:     uuid('device_id').notNull().references(() => devices.id),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sender:       text('sender').notNull(),
  body:         text('body').notNull(),
  // Extracted OTP (null if no OTP detected)
  extractedOtp: text('extracted_otp'),
  receivedAt:   timestamp('received_at').notNull(),
  processedAt:  timestamp('processed_at'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx:      index('sms_messages_user_idx').on(t.userId),
  receivedIdx:  index('sms_messages_received_idx').on(t.receivedAt),
}))

export const smsRules = pgTable('sms_rules', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  senderPattern: text('sender_pattern').notNull(),
  bodyPattern:   text('body_pattern'),
  forwardTo:     jsonb('forward_to').$type<Array<{
    type: 'group' | 'user' | 'agent' | 'webhook'
    targetId: string
  }>>().notNull().default([]),
  extractOtp:    boolean('extract_otp').notNull().default(true),
  enabled:       boolean('enabled').notNull().default(true),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
})

// ── Audit Log ─────────────────────────────────────────────────────────────────
// Append-only. No updates or deletes. Used for compliance and forensics.

export const auditLog = pgTable('audit_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  event:     text('event').notNull(),       // e.g. "agent.secret.granted"
  userId:    uuid('user_id').references(() => users.id),
  agentId:   uuid('agent_id').references(() => agents.id),
  metadata:  jsonb('metadata').$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  eventIdx:  index('audit_log_event_idx').on(t.event),
  userIdx:   index('audit_log_user_idx').on(t.userId),
  createdIdx: index('audit_log_created_idx').on(t.createdAt),
}))
