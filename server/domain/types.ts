import type { AccountDto, CredentialSource } from '../../shared/contracts/auth.js';
import type { DiagnosticLevel } from '../../shared/contracts/diagnostics.js';

export type FlowRecord = {
  id: string;
  nonce: string;
  expectedOrigin: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  traceId?: string;
  diagnosticLevel: DiagnosticLevel;
};

export type VerifiedClaims = {
  email: string;
  email_verified: true;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  hd?: string;
  iss: string;
  vct: string;
};

export type SignupProfile = {
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  jobTitle?: string;
  company?: string;
};

export type SignInActivity = {
  id: string;
  accountId: string;
  email: string;
  occurredAt: string;
  event: 'openid4vp_sign_in';
  source: CredentialSource;
  credentialIssuer: string;
  attributes: Record<string, unknown>;
  traceId?: string;
};

export type SignupRecord = {
  token: string;
  claims: VerifiedClaims;
  source: CredentialSource;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  traceId?: string;
};

export type Account = AccountDto;
