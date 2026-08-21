import { randomUUID } from 'node:crypto';
import type { CredentialSource } from '../../shared/contracts/auth.js';
import type { DiagnosticLevel } from '../../shared/contracts/diagnostics.js';
import type { FlowRecord, SignupRecord, VerifiedClaims } from '../domain/types.js';

export class TransactionStore {
  private readonly flows = new Map<string, FlowRecord>();
  private readonly signups = new Map<string, SignupRecord>();

  createFlow(
    expectedOrigin: string,
    ttlSeconds: number,
    diagnostics: { traceId?: string; level: DiagnosticLevel } = { level: 'off' },
  ): FlowRecord {
    const now = Date.now();
    const flow: FlowRecord = {
      id: randomUUID(),
      nonce: cryptoRandomNonce(),
      expectedOrigin,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      used: false,
      traceId: diagnostics.traceId,
      diagnosticLevel: diagnostics.level,
    };
    this.flows.set(flow.id, flow);
    this.cleanup();
    return flow;
  }

  getFlow(id: string): FlowRecord | undefined {
    return this.flows.get(id);
  }

  consumeFlow(id: string): void {
    const flow = this.flows.get(id);
    if (flow) flow.used = true;
  }

  createSignup(
    claims: VerifiedClaims,
    source: CredentialSource,
    ttlSeconds: number,
    traceId?: string,
  ): SignupRecord {
    const now = Date.now();
    const signup: SignupRecord = {
      token: randomUUID(),
      claims,
      source,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      used: false,
      traceId,
    };
    this.signups.set(signup.token, signup);
    this.cleanup();
    return signup;
  }

  getSignup(token: string): SignupRecord | undefined {
    return this.signups.get(token);
  }

  consumeSignup(token: string): void {
    const signup = this.signups.get(token);
    if (signup) signup.used = true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt + 60_000 < now) this.flows.delete(id);
    }
    for (const [token, signup] of this.signups) {
      if (signup.expiresAt + 60_000 < now) this.signups.delete(token);
    }
  }
}

function cryptoRandomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
