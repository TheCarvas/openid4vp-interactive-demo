import { createHash } from 'node:crypto';
import {
  compactVerify,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import type { CredentialSource } from '../../shared/contracts/auth.js';
import type { VerifiedClaims } from '../domain/types.js';
import type { SampleCredentialContext, SampleCredentialResponse } from './sample-fixtures.js';

const GOOGLE_ISSUER = process.env.GOOGLE_VC_ISSUER ?? 'https://verifiablecredentials-pa.googleapis.com';
const GOOGLE_JWKS = process.env.GOOGLE_VC_JWKS ?? `${GOOGLE_ISSUER}/.well-known/vc-public-jwks`;
const remoteJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS));

export type VerificationDebug = {
  source: CredentialSource;
  issuer: string;
  vct: string;
  issuerAlgorithm?: string;
  keyBindingAlgorithm?: string;
  audience: string | string[] | undefined;
  expectedAudience: string;
  nonceMatched: boolean;
  disclosureCount: number;
  emailDomain: string;
  nonGmailFreshnessWarning: boolean;
};

export type VerificationResult = {
  claims: VerifiedClaims;
  debug: VerificationDebug;
};

export type VerificationDiagnosticInput = {
  level: 'info' | 'debug';
  operation: string;
  message: string;
  data?: Record<string, unknown>;
};

type VerificationDiagnosticHandler = (event: VerificationDiagnosticInput) => Promise<void>;

type VerificationPolicy = {
  source: CredentialSource;
  expectedNonce: string;
  expectedAudience: string;
  expectedIssuer: string;
  validationTimeSeconds?: number;
  allowNumericStringIat: boolean;
  verifyIssuerJwt: (issuerJwt: string) => Promise<JWTPayload>;
  onDiagnostic?: VerificationDiagnosticHandler;
};

export async function verifyOpenId4VpResponse(input: {
  response: unknown;
  expectedNonce: string;
  expectedOrigin: string;
  onDiagnostic?: VerificationDiagnosticHandler;
}): Promise<VerificationResult> {
  return verifyResponseData(input.response, {
    source: 'live',
    expectedNonce: input.expectedNonce,
    expectedAudience: `origin:${normalizeOrigin(input.expectedOrigin)}`,
    expectedIssuer: GOOGLE_ISSUER,
    allowNumericStringIat: false,
    verifyIssuerJwt: async (issuerJwt) => {
      const verification = await jwtVerify(issuerJwt, remoteJwks, { issuer: GOOGLE_ISSUER });
      return verification.payload;
    },
    onDiagnostic: input.onDiagnostic,
  });
}

export async function verifySampleOpenId4VpResponse(input: {
  response: SampleCredentialResponse;
  context: SampleCredentialContext;
  onDiagnostic?: VerificationDiagnosticHandler;
}): Promise<VerificationResult> {
  const outer = asObject(input.response, 'Sample DigitalCredential');
  if (outer.protocol !== 'openid4vp-v1-unsigned') {
    throw new Error('Sample credential protocol must be openid4vp-v1-unsigned.');
  }
  const data = asObject(outer.data, 'Sample DigitalCredential.data');
  const issuerKey = await importJWK(input.context.issuerJwk as JWK, 'EdDSA');
  const currentDate = new Date(input.context.validationTimeSeconds * 1000);

  return verifyResponseData(data, {
    source: 'sample',
    expectedNonce: input.context.nonce,
    expectedAudience: input.context.origin,
    expectedIssuer: GOOGLE_ISSUER,
    validationTimeSeconds: input.context.validationTimeSeconds,
    allowNumericStringIat: true,
    verifyIssuerJwt: async (issuerJwt) => {
      const verification = await jwtVerify(issuerJwt, issuerKey, {
        algorithms: ['EdDSA'],
        issuer: GOOGLE_ISSUER,
        currentDate,
      });
      return verification.payload;
    },
    onDiagnostic: input.onDiagnostic,
  });
}

async function verifyResponseData(responseValue: unknown, policy: VerificationPolicy): Promise<VerificationResult> {
  const response = asObject(responseValue, 'DigitalCredential.data');
  if (typeof response.error === 'string') {
    throw new Error(`Wallet returned OpenID4VP error: ${response.error}`);
  }

  const vpToken = asObject(response.vp_token, 'vp_token');
  const entry = vpToken.user_info_query;
  if (!Array.isArray(entry) || typeof entry[0] !== 'string') {
    throw new Error('vp_token.user_info_query[0] did not contain an SD-JWT presentation.');
  }

  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.response.parse',
    message: 'The OpenID4VP response contains an SD-JWT presentation.',
  });

  return verifyGoogleUserInfoSdJwt(entry[0], policy);
}

async function verifyGoogleUserInfoSdJwt(
  presentation: string,
  policy: VerificationPolicy,
): Promise<VerificationResult> {
  const segments = presentation.split('~');
  if (segments.length < 3) {
    throw new Error('The SD-JWT presentation is missing disclosures or a Key Binding JWT.');
  }

  const issuerJwt = segments[0];
  const kbJwt = segments[segments.length - 1];
  if (!issuerJwt || !kbJwt || kbJwt.split('.').length !== 3) {
    throw new Error('The SD-JWT presentation does not contain a valid issuer JWT and Key Binding JWT.');
  }

  const disclosures = segments.slice(1, -1).filter(Boolean);
  await emitDiagnostic(policy, {
    level: 'debug',
    operation: 'credential.presentation.parse',
    message: 'Parsed the SD-JWT presentation segments.',
    data: { segmentCount: segments.length, disclosureCount: disclosures.length },
  });
  const issuerHeader = decodeProtectedHeader(issuerJwt);
  const issuerPayload = await policy.verifyIssuerJwt(issuerJwt);
  const { issuer, vct } = assertIssuerCredentialClaims(issuerPayload, policy.expectedIssuer);
  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.issuer.verify',
    message: 'Verified the credential issuer signature and credential type.',
  });
  await emitDiagnostic(policy, {
    level: 'debug',
    operation: 'credential.issuer.verify',
    message: 'Issuer verification details are available.',
    data: { issuer, vct, algorithm: issuerHeader.alg },
  });

  const disclosed = applyTopLevelDisclosures(issuerPayload, disclosures);
  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.disclosures.verify',
    message: `Verified ${disclosures.length} SD-JWT disclosure${disclosures.length === 1 ? '' : 's'}.`,
  });
  const cnf = asObject(issuerPayload.cnf, 'cnf');
  const holderJwk = asObject(cnf.jwk, 'cnf.jwk') as JWK;

  const kbHeader = decodeProtectedHeader(kbJwt);
  if (!kbHeader.alg) throw new Error('Key Binding JWT has no alg header.');
  const holderKey = await importJWK(holderJwk, kbHeader.alg);
  const kbPayload = policy.allowNumericStringIat
    ? await verifySampleKeyBindingJwt(kbJwt, holderKey, kbHeader.alg)
    : (await jwtVerify(kbJwt, holderKey, { algorithms: [kbHeader.alg] })).payload;
  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.holder_signature.verify',
    message: 'Verified the holder Key Binding JWT signature.',
  });

  assertKeyBindingNonce(kbPayload, policy.expectedNonce);
  assertAudience(kbPayload.aud, policy.expectedAudience);
  assertPresentationHash(segments, kbPayload);
  assertFreshKeyBinding(
    kbPayload,
    policy.validationTimeSeconds ?? Math.floor(Date.now() / 1000),
    policy.allowNumericStringIat,
  );
  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.key_binding.verify',
    message: 'Verified the nonce, audience, presentation hash, and freshness.',
  });
  await emitDiagnostic(policy, {
    level: 'debug',
    operation: 'credential.key_binding.verify',
    message: 'Key binding verification details are available.',
    data: {
      algorithm: kbHeader.alg,
      audience: kbPayload.aud,
      expectedAudience: policy.expectedAudience,
      nonceMatched: true,
    },
  });

  const email = stringClaim(disclosed.email, 'email');
  if (disclosed.email_verified !== true) {
    throw new Error('The credential did not assert email_verified=true.');
  }

  const claims: VerifiedClaims = {
    email,
    email_verified: true,
    given_name: optionalString(disclosed.given_name),
    family_name: optionalString(disclosed.family_name),
    name: optionalString(disclosed.name),
    picture: optionalString(disclosed.picture),
    hd: optionalString(disclosed.hd),
    iss: issuer,
    vct,
  };
  await emitDiagnostic(policy, {
    level: 'info',
    operation: 'credential.claims.validate',
    message: 'Validated the verified email and disclosed profile claims.',
  });

  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return {
    claims,
    debug: {
      source: policy.source,
      issuer,
      vct,
      issuerAlgorithm: issuerHeader.alg,
      keyBindingAlgorithm: kbHeader.alg,
      audience: kbPayload.aud,
      expectedAudience: policy.expectedAudience,
      nonceMatched: true,
      disclosureCount: disclosures.length,
      emailDomain: domain,
      nonGmailFreshnessWarning: domain !== 'gmail.com',
    },
  };
}

async function emitDiagnostic(
  policy: VerificationPolicy,
  event: VerificationDiagnosticInput,
): Promise<void> {
  await policy.onDiagnostic?.(event);
}

async function verifySampleKeyBindingJwt(
  jwt: string,
  key: CryptoKey | Uint8Array,
  algorithm: string,
): Promise<JWTPayload> {
  const verification = await compactVerify(jwt, key, { algorithms: [algorithm] });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(verification.payload)) as unknown;
  } catch {
    throw new Error('Key Binding JWT payload is not valid JSON.');
  }
  return asObject(payload, 'Key Binding JWT payload') as JWTPayload;
}

export function assertIssuerCredentialClaims(
  payload: JWTPayload,
  expectedIssuer: string,
): { issuer: string; vct: string } {
  const issuer = stringClaim(payload.iss, 'iss');
  if (issuer !== expectedIssuer) throw new Error(`Unexpected credential issuer: ${issuer}`);
  const vct = stringClaim(payload.vct, 'vct');
  if (vct !== 'UserInfoCredential') throw new Error(`Unexpected credential type: ${vct}`);
  return { issuer, vct };
}

export function applyTopLevelDisclosures(payload: JWTPayload, disclosures: string[]): Record<string, unknown> {
  const sd = payload._sd;
  if (!Array.isArray(sd) || !sd.every((value) => typeof value === 'string')) {
    throw new Error('Issuer JWT does not contain a valid top-level _sd digest list.');
  }
  const sdAlg = payload._sd_alg ?? 'sha-256';
  if (sdAlg !== 'sha-256') {
    throw new Error(`Unsupported SD-JWT disclosure hash algorithm: ${String(sdAlg)}`);
  }

  const digestSet = new Set(sd as string[]);
  const result: Record<string, unknown> = { ...payload };
  delete result._sd;
  delete result._sd_alg;

  for (const encoded of disclosures) {
    const digest = createHash('sha256').update(encoded).digest('base64url');
    if (!digestSet.has(digest)) {
      throw new Error('A disclosure is not referenced by the issuer JWT _sd digest list.');
    }

    let disclosure: unknown;
    try {
      disclosure = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw new Error('Could not decode an SD-JWT disclosure.');
    }

    if (!Array.isArray(disclosure) || disclosure.length !== 3 || typeof disclosure[1] !== 'string') {
      throw new Error('Only standard top-level object claim disclosures are supported by this verifier.');
    }

    const [, claimName, claimValue] = disclosure;
    if (Object.prototype.hasOwnProperty.call(result, claimName)) {
      throw new Error(`Disclosure would overwrite an existing claim: ${claimName}`);
    }
    result[claimName] = claimValue;
  }

  return result;
}

export function assertKeyBindingNonce(payload: JWTPayload, expectedNonce: string): void {
  if (payload.nonce !== expectedNonce) {
    throw new Error('Key Binding nonce does not match the expected transaction nonce.');
  }
}

export function assertAudience(audience: JWTPayload['aud'], expectedAudience: string): void {
  const matches = typeof audience === 'string'
    ? audience === expectedAudience
    : Array.isArray(audience) && audience.includes(expectedAudience);
  if (!matches) {
    throw new Error(`Key Binding audience mismatch. Expected ${expectedAudience}, received ${JSON.stringify(audience)}.`);
  }
}

export function assertPresentationHash(segments: string[], payload: JWTPayload): void {
  const sdJwtWithoutKb = `${segments.slice(0, -1).join('~')}~`;
  const expectedSdHash = createHash('sha256').update(sdJwtWithoutKb).digest('base64url');
  if (payload.sd_hash !== expectedSdHash) {
    throw new Error('Key Binding sd_hash does not match the presented SD-JWT.');
  }
}

export function assertFreshKeyBinding(
  payload: JWTPayload,
  nowSeconds: number,
  allowNumericString: boolean,
): void {
  const rawIat = payload.iat;
  const issuedAt = typeof rawIat === 'number'
    ? rawIat
    : allowNumericString && typeof rawIat === 'string' && /^\d+$/.test(rawIat)
      ? Number(rawIat)
      : undefined;
  if (issuedAt === undefined) throw new Error('Key Binding JWT has no numeric iat claim.');
  if (issuedAt > nowSeconds + 60) throw new Error('Key Binding JWT iat is too far in the future.');
  if (issuedAt < nowSeconds - 600) throw new Error('Key Binding JWT is older than 10 minutes.');
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function asObject(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, any>;
}

function stringClaim(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required ${label} claim.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
