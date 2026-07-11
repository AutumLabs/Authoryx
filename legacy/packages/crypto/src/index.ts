/**
 * @authoryx/crypto
 *
 * All cryptographic primitives used across AuthoryxOS.
 * Zero external crypto dependencies — uses Node.js built-in `crypto` module only.
 *
 * Design principles:
 *   - Vault secrets are encrypted CLIENT-SIDE before transmission.
 *     The server holds ciphertext + nonce only.
 *   - Server-side envelope encryption (VAULT_MASTER_KEY) wraps the
 *     client ciphertext as a second layer (defence in depth).
 *   - Key derivation uses PBKDF2-SHA256 with configurable iterations.
 *   - All nonces are random 96-bit (12-byte) values for AES-256-GCM.
 *   - Agent ephemeral session tokens are signed with HMAC-SHA256.
 */

import { randomBytes, createHmac, pbkdf2, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(pbkdf2)

// ── Constants ─────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm' as const
const KEY_LENGTH = 32  // 256 bits
const NONCE_LENGTH = 12 // 96 bits (recommended for GCM)
const TAG_LENGTH = 16  // 128-bit auth tag
const SALT_LENGTH = 32 // 256-bit salt for KDF

// ── Key Derivation ────────────────────────────────────────────────────────────

export interface DeriveKeyResult {
  key: Buffer
  salt: string // hex-encoded, store alongside ciphertext
}

/**
 * Derive a 256-bit AES key from a user password using PBKDF2-SHA256.
 * Used client-side to produce the vault encryption key from the user's master password.
 */
export async function deriveKey(
  password: string,
  saltHex?: string,
  iterations = 600_000
): Promise<DeriveKeyResult> {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(SALT_LENGTH)
  const key = await pbkdf2Async(password, salt, iterations, KEY_LENGTH, 'sha256')
  return { key, salt: salt.toString('hex') }
}

// ── Symmetric Encryption (AES-256-GCM) ───────────────────────────────────────

export interface EncryptResult {
  ciphertext: string  // base64
  nonce: string       // base64 (12 bytes, random)
  tag: string         // base64 (16 bytes, GCM auth tag)
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns ciphertext + nonce + auth tag — all needed for decryption.
 */
export function encrypt(plaintext: string | Buffer, key: Buffer): EncryptResult {
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_LENGTH })

  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 * Throws if the auth tag doesn't match (tampered ciphertext).
 */
export function decrypt(encrypted: EncryptResult, key: Buffer): Buffer {
  const nonce = Buffer.from(encrypted.nonce, 'base64')
  const tag = Buffer.from(encrypted.tag, 'base64')
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function decryptToString(encrypted: EncryptResult, key: Buffer): string {
  return decrypt(encrypted, key).toString('utf8')
}

// ── HMAC ─────────────────────────────────────────────────────────────────────

/**
 * Sign data with HMAC-SHA256.
 * Used for: SMS relay signatures, webhook payloads, ephemeral session tokens.
 */
export function hmacSign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

/**
 * Constant-time HMAC verification.
 */
export function hmacVerify(data: string, signature: string, secret: string): boolean {
  const expected = hmacSign(data, secret)
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

// ── Ephemeral Session Tokens ──────────────────────────────────────────────────

export interface EphemeralToken {
  token: string
  expiresAt: Date
}

/**
 * Issue a short-lived HMAC-signed token for agent secret sessions.
 * Format: base64(payload).hmac_signature
 * payload = { agentId, scope, expiresAt, nonce }
 */
export function issueEphemeralToken(
  agentId: string,
  scope: string[],
  ttlSeconds: number,
  signingSecret: string
): EphemeralToken {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const payload = JSON.stringify({
    agentId,
    scope,
    expiresAt: expiresAt.toISOString(),
    nonce: randomBytes(16).toString('hex'),
  })
  const payloadB64 = Buffer.from(payload).toString('base64url')
  const sig = hmacSign(payloadB64, signingSecret)
  return {
    token: `${payloadB64}.${sig}`,
    expiresAt,
  }
}

/**
 * Verify and decode an ephemeral session token.
 * Returns null if invalid or expired.
 */
export function verifyEphemeralToken(
  token: string,
  signingSecret: string
): { agentId: string; scope: string[]; expiresAt: Date } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payloadB64, sig] = parts as [string, string]

  if (!hmacVerify(payloadB64, sig, signingSecret)) return null

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    const expiresAt = new Date(payload.expiresAt)
    if (expiresAt < new Date()) return null
    return { agentId: payload.agentId, scope: payload.scope, expiresAt }
  } catch {
    return null
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export const generateSecretKey = (bytes = 32): string =>
  randomBytes(bytes).toString('hex')

export const generateId = (): string =>
  randomBytes(16).toString('hex')
