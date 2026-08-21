import type {
  CompleteSignupResponse,
  CredentialSource,
  PrepareAuthRequest,
  PrepareAuthResponse,
  VerifyResult,
} from '../../shared/contracts/auth.js';
import type { DiagnosticEventInput, DiagnosticLevel } from '../../shared/contracts/diagnostics.js';
import type { AccountRepository } from '../accounts/account-repository.js';
import type { ActivityRepository } from '../activity/activity-repository.js';
import type { SignupProfile, VerifiedClaims } from '../domain/types.js';
import { BadRequestError, HttpError } from '../http/errors.js';
import { buildOpenId4VpRequest } from '../openid4vp/request.js';
import type { SampleCredentialFixtures } from '../openid4vp/sample-fixtures.js';
import {
  verifyOpenId4VpResponse,
  verifySampleOpenId4VpResponse,
  type VerificationResult,
} from '../openid4vp/verifier.js';
import { TransactionStore } from './transaction-store.js';
import { DiagnosticTracer } from '../diagnostics/diagnostic-tracer.js';

export type AuthServiceOptions = {
  transactions: TransactionStore;
  accounts: AccountRepository;
  activity: ActivityRepository;
  flowTtlSeconds: number;
  signupTtlSeconds: number;
  diagnostics?: DiagnosticTracer;
  verifyLive?: typeof verifyOpenId4VpResponse;
  verifySample?: typeof verifySampleOpenId4VpResponse;
};

export class AuthService {
  private readonly verifyLive: typeof verifyOpenId4VpResponse;
  private readonly verifySample: typeof verifySampleOpenId4VpResponse;
  private readonly diagnostics: DiagnosticTracer;

  constructor(private readonly options: AuthServiceOptions) {
    this.verifyLive = options.verifyLive ?? verifyOpenId4VpResponse;
    this.verifySample = options.verifySample ?? verifySampleOpenId4VpResponse;
    this.diagnostics = options.diagnostics ?? DiagnosticTracer.disabled();
  }

  async prepare(
    expectedOrigin: string,
    input: PrepareAuthRequest,
    diagnosticContext: { traceId?: string; level: DiagnosticLevel } = { level: 'off' },
  ): Promise<PrepareAuthResponse> {
    const traceId = diagnosticContext.level === 'off' ? undefined : diagnosticContext.traceId;
    if (input.protocol !== 'openid4vp-v1-unsigned') {
      if (traceId && diagnosticContext.level !== 'off') {
        await this.diagnostics.startTrace({
          id: traceId,
          level: diagnosticContext.level,
          operation: 'auth.request.prepare',
          message: 'Started preparing an OpenID4VP authorization request.',
          data: { protocol: input.protocol, claims: input.claims },
        });
        await this.failTrace(traceId, 'auth.request.prepare', 'Signed OpenID4VP requests are not supported yet.');
      }
      throw new BadRequestError('Signed OpenID4VP requests are not supported yet.');
    }
    const flow = this.options.transactions.createFlow(
      expectedOrigin,
      this.options.flowTtlSeconds,
      diagnosticContext,
    );
    if (traceId && diagnosticContext.level !== 'off') {
      await this.diagnostics.startTrace({
        id: traceId,
        flowId: flow.id,
        level: diagnosticContext.level,
        operation: 'auth.request.prepare',
        message: 'Started preparing an OpenID4VP authorization request.',
        data: { protocol: input.protocol, claims: input.claims, expectedOrigin },
      });
    }

    try {
      const request = buildOpenId4VpRequest(flow, input);
      await this.diagnostics.captureBackendArtifact(traceId, {
        name: 'openid4vp.authorization_request',
        mediaType: 'application/json',
        value: request,
      });
      await this.event(traceId, {
        level: 'info',
        operation: 'auth.request.prepare',
        phase: 'success',
        message: 'Prepared the nonce-bound DCQL authorization request.',
        data: { flowId: flow.id, expiresAt: request.expires_at },
      });
      return { ...request, trace_id: traceId };
    } catch (error) {
      await this.failTrace(traceId, 'auth.request.prepare', errorMessage(error));
      throw error;
    }
  }

  async verifyLiveCredential(flowId: string, response: unknown, actualOrigin: string): Promise<VerifyResult> {
    return this.verifyFlow(flowId, actualOrigin, 'live', async (nonce, origin, traceId) => {
      await this.diagnostics.captureBackendArtifact(traceId, {
        name: 'openid4vp.authorization_response',
        mediaType: 'application/json',
        value: response,
      });
      return this.verifyLive({
        response,
        expectedNonce: nonce,
        expectedOrigin: origin,
        onDiagnostic: (event) => this.event(traceId, { ...event, phase: 'progress' }),
      });
    });
  }

  async verifySampleCredential(
    flowId: string,
    actualOrigin: string,
    fixtures: SampleCredentialFixtures,
  ): Promise<VerifyResult> {
    return this.verifyFlow(flowId, actualOrigin, 'sample', async (_nonce, _origin, traceId) => {
      await this.diagnostics.captureBackendArtifact(traceId, {
        name: 'openid4vp.sample_credential_context',
        mediaType: 'application/json',
        value: fixtures.context,
      });
      await this.diagnostics.captureBackendArtifact(traceId, {
        name: 'openid4vp.sample_authorization_response',
        mediaType: 'application/json',
        value: fixtures.response,
      });
      return this.verifySample({
        ...fixtures,
        onDiagnostic: (event) => this.event(traceId, { ...event, phase: 'progress' }),
      });
    });
  }

  async completeSignup(
    token: string,
    profile: SignupProfile,
  ): Promise<CompleteSignupResponse> {
    const signup = this.options.transactions.getSignup(token);
    if (!signup) throw new BadRequestError('Unknown or expired signup transaction.');
    const traceId = signup.traceId;
    try {
      if (signup.used) throw new BadRequestError('This signup transaction has already been used.');
      if (signup.expiresAt < Date.now()) throw new BadRequestError('The signup transaction expired. Start again.');
      await this.event(traceId, {
        level: 'info',
        operation: 'account.signup.complete',
        phase: 'start',
        message: 'Started completing the verified account profile.',
      });

      const existing = await this.options.accounts.findByEmail(signup.claims.email);
      const account = existing
        ? await this.options.accounts.markSignedIn(existing)
        : await this.options.accounts.create(signup.claims, normalizeSignupProfile(profile));
      const activity = await this.options.activity.recordSignIn({
        account,
        claims: signup.claims,
        source: signup.source,
        isNewAccount: !existing,
        traceId,
      });
      this.options.transactions.consumeSignup(token);
      await this.event(traceId, {
        level: 'info',
        operation: 'account.signup.complete',
        phase: 'success',
        message: 'Created the account and linked the authentication activity.',
        data: { accountId: account.id, activityId: activity.id },
      });
      await this.diagnostics.markSucceeded(traceId, {
        accountId: account.id,
        activityId: activity.id,
        source: signup.source,
      });
      return { status: 'signed_up', source: signup.source, account, trace_id: traceId };
    } catch (error) {
      await this.failTrace(traceId, 'account.signup.complete', errorMessage(error));
      throw error;
    }
  }

  private async verifyFlow(
    flowId: string,
    actualOrigin: string,
    source: CredentialSource,
    verify: (nonce: string, origin: string, traceId?: string) => Promise<VerificationResult>,
  ): Promise<VerifyResult> {
    const flow = this.options.transactions.getFlow(flowId);
    const traceId = flow?.traceId;
    try {
      if (!flow) throw new BadRequestError('Unknown or expired authentication flow.');
      if (flow.used) throw new BadRequestError('This authentication flow has already been used.');
      if (flow.expiresAt < Date.now()) {
        throw new BadRequestError('The authentication flow expired. Prepare a new request.');
      }
      if (actualOrigin !== flow.expectedOrigin) {
        throw new BadRequestError(
          `Browser origin changed during the flow. Expected ${flow.expectedOrigin}, received ${actualOrigin}.`,
        );
      }

      await this.diagnostics.setSource(traceId, source);
      await this.event(traceId, {
        level: 'info',
        operation: 'credential.verify',
        phase: 'start',
        message: `Started verifying the ${source} credential presentation.`,
        data: { flowId },
      });
      const verification = await verify(flow.nonce, flow.expectedOrigin, traceId);
      await this.event(traceId, {
        level: 'debug',
        operation: 'credential.verify',
        phase: 'success',
        message: 'Credential verification produced validated claims and diagnostics.',
        data: { verification: verification.debug },
      });

      const result = await this.finishVerifiedCredential(
        verification.claims,
        verification.debug,
        source,
        traceId,
      );
      this.options.transactions.consumeFlow(flowId);
      return result;
    } catch (error) {
      const message = errorMessage(error);
      await this.failTrace(traceId, 'credential.verify', message);
      if (error instanceof HttpError) throw error;
      throw new BadRequestError(message, error);
    }
  }

  private async finishVerifiedCredential(
    claims: VerifiedClaims,
    debug: unknown,
    source: CredentialSource,
    traceId?: string,
  ): Promise<VerifyResult> {
    const existing = await this.options.accounts.findByEmail(claims.email);
    if (existing) {
      const previousSignInAt = existing.lastSignInAt;
      const account = await this.options.accounts.markSignedIn(existing);
      const activityEntry = await this.options.activity.recordSignIn({
        account,
        claims,
        source,
        isNewAccount: false,
        traceId,
      });
      const activity = await this.options.activity.listByAccountId(account.id);
      await this.event(traceId, {
        level: 'info',
        operation: 'account.resolve',
        phase: 'success',
        message: 'Matched the verified email to an existing account.',
        data: { accountId: account.id, activityId: activityEntry.id },
      });
      await this.diagnostics.markSucceeded(traceId, {
        accountId: account.id,
        activityId: activityEntry.id,
        source,
      });
      return {
        status: 'signed_in',
        source,
        account,
        previous_sign_in_at: previousSignInAt,
        activity,
        debug,
        trace_id: traceId,
      };
    }

    const signup = this.options.transactions.createSignup(claims, source, this.options.signupTtlSeconds, traceId);
    await this.event(traceId, {
      level: 'info',
      operation: 'account.resolve',
      phase: 'progress',
      message: 'No account matched the verified email; profile confirmation is required.',
    });
    return {
      status: 'profile_required',
      source,
      signup_token: signup.token,
      profile: {
        email: claims.email,
        given_name: claims.given_name,
        family_name: claims.family_name,
        name: claims.name,
        picture: claims.picture,
        hd: claims.hd,
      },
      debug,
      trace_id: traceId,
    };
  }

  private async event(traceId: string | undefined, event: DiagnosticEventInput): Promise<void> {
    await this.diagnostics.recordBackendEvent(traceId, event);
  }

  private async failTrace(traceId: string | undefined, stage: string, message: string): Promise<void> {
    await this.event(traceId, {
      level: 'info',
      operation: stage,
      phase: 'failure',
      message,
    });
    await this.diagnostics.markFailed(traceId, stage, message);
  }
}

function normalizeOptionalProfileValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeSignupProfile(profile: SignupProfile): SignupProfile {
  return {
    name: normalizeOptionalProfileValue(profile.name),
    givenName: normalizeOptionalProfileValue(profile.givenName),
    familyName: normalizeOptionalProfileValue(profile.familyName),
    picture: normalizeOptionalProfileValue(profile.picture),
    jobTitle: normalizeOptionalProfileValue(profile.jobTitle),
    company: normalizeOptionalProfileValue(profile.company),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The authentication operation failed.';
}
