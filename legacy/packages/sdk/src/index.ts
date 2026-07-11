/**
 * @authoryx/sdk
 *
 * Official JavaScript/TypeScript client for AuthoryxOS.
 * Works in Node.js and edge runtimes.
 *
 * Quick start:
 *
 *   import { AuthoryxClient } from '@authoryx/sdk'
 *
 *   const authoryx = new AuthoryxClient({
 *     baseUrl: 'https://your-instance.authoryx.com', // or self-hosted URL
 *     apiKey: process.env.AUTHORYX_API_KEY,
 *   })
 *
 *   // Request an ephemeral credential for an agent action
 *   const session = await authoryx.agents.requestSecret({
 *     agentId: 'agent-uuid',
 *     intent: {
 *       action: 'send_email',
 *       resource: 'gmail',
 *       reason: 'Send invoice to customer',
 *     },
 *   })
 */

export interface AuthoryxClientOptions {
  baseUrl: string
  apiKey: string
  /** Timeout in ms (default: 10_000) */
  timeout?: number
  /** Fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch
}

export interface RequestSecretOptions {
  agentId: string
  intent: {
    action: string
    resource: string
    reason: string
    targetUserId?: string
  }
  ttlSeconds?: number
}

export interface EphemeralSessionResponse {
  sessionToken: string
  expiresAt: string
  scope: string[]
}

export interface PendingApprovalResponse {
  status: 'pending_approval'
  approvalId: string
  message: string
}

export class AuthoryxClient {
  private baseUrl: string
  private apiKey: string
  private timeout: number
  private _fetch: typeof fetch

  constructor(options: AuthoryxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.timeout = options.timeout ?? 10_000
    this._fetch = options.fetch ?? fetch
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Authoryx-SDK': '0.1.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new AuthoryxError(err.error ?? 'Request failed', res.status, err)
      }

      return res.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }

  // ── Agents ──────────────────────────────────────────────────────────────────

  agents = {
    /**
     * Request an ephemeral credential for an agent action.
     * Returns either an approved session token or a pending approval notice.
     */
    requestSecret: (options: RequestSecretOptions) =>
      this.request<EphemeralSessionResponse | PendingApprovalResponse>(
        'POST', '/v1/agents/secret-request', {
          agentId: options.agentId,
          intent: options.intent,
          ttlSeconds: options.ttlSeconds ?? 30,
        }
      ),

    pollApproval: (approvalId: string) =>
      this.request<{ status: string; sessionToken?: string }>('GET', `/v1/agents/approvals/${approvalId}`),

    listAgents: () =>
      this.request<unknown[]>('GET', '/v1/agents'),

    register: (options: {
      name: string
      description: string
      allowedResources: string[]
      allowedActions: string[]
      requireApproval?: boolean
      webhookUrl?: string
    }) => this.request<{ id: string; apiKey: string }>('POST', '/v1/agents', options),
  }

  // ── Vault ────────────────────────────────────────────────────────────────────

  vault = {
    listSecrets: (params?: { type?: string; tag?: string }) => {
      const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
      return this.request<unknown[]>('GET', `/v1/vault/secrets${qs}`)
    },

    getSecret: (id: string) =>
      this.request<unknown>('GET', `/v1/vault/secrets/${id}`),
  }

  // ── SMS ──────────────────────────────────────────────────────────────────────

  sms = {
    listMessages: (params?: { limit?: number; sender?: string }) => {
      const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
      return this.request<unknown[]>('GET', `/v1/sms/messages${qs}`)
    },
  }
}

// ── Error type ────────────────────────────────────────────────────────────────

export class AuthoryxError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'AuthoryxError'
  }
}
