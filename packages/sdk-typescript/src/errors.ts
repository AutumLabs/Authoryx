export class AuthoryxOSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidIntentError extends AuthoryxOSError {}

export class AccessDeniedError extends AuthoryxOSError {
  reason: string;
  token: string;
  constructor(message: string, opts: { reason?: string; token?: string } = {}) {
    super(message);
    this.reason = opts.reason ?? "";
    this.token = opts.token ?? "";
  }
}

export class PendingTimeoutError extends AuthoryxOSError {
  token: string;
  constructor(message: string, opts: { token?: string } = {}) {
    super(message);
    this.token = opts.token ?? "";
  }
}

export class TransportError extends AuthoryxOSError {
  code: string;
  retryable: boolean;
  constructor(message: string, opts: { code?: string; retryable?: boolean } = {}) {
    super(message);
    this.code = opts.code ?? "";
    this.retryable = opts.retryable ?? false;
  }
}
