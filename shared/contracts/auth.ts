import { z } from 'zod';

export const credentialSourceSchema = z.enum(['live', 'sample']);
export type CredentialSource = z.infer<typeof credentialSourceSchema>;

export const digitalCredentialsRequestSchema = z.object({
  protocol: z.string().min(1),
  data: z.record(z.unknown()),
}).passthrough();
export type DigitalCredentialsRequest = z.infer<typeof digitalCredentialsRequestSchema>;

export const claimNameSchema = z.enum([
  'email',
  'email_verified',
  'name',
  'given_name',
  'family_name',
  'picture',
  'hd',
]);
export type ClaimName = z.infer<typeof claimNameSchema>;

export const openId4VpRequestProtocolSchema = z.enum([
  'openid4vp-v1-unsigned',
  'openid4vp-v1-signed',
]);
export type OpenId4VpRequestProtocol = z.infer<typeof openId4VpRequestProtocolSchema>;

export const prepareAuthRequestSchema = z.object({
  claims: z.array(claimNameSchema).min(1).refine(
    (claims) => new Set(claims).size === claims.length,
    'claims must not contain duplicates',
  ).refine(
    (claims) => claims.includes('email') && claims.includes('email_verified'),
    'email and email_verified are required for sign-in',
  ),
  protocol: openId4VpRequestProtocolSchema,
}).strict();
export type PrepareAuthRequest = z.infer<typeof prepareAuthRequestSchema>;

export const prepareAuthResponseSchema = digitalCredentialsRequestSchema.extend({
  flow_id: z.string().uuid(),
  expires_at: z.string().datetime(),
  trace_id: z.string().uuid().optional(),
});
export type PrepareAuthResponse = z.infer<typeof prepareAuthResponseSchema>;
export type BackendAuthRequest = PrepareAuthResponse;

export const verifyCredentialRequestSchema = z.object({
  flow_id: z.string().uuid(),
  response: z.unknown(),
}).strict();
export type VerifyCredentialRequest = z.infer<typeof verifyCredentialRequestSchema>;

export const sampleCredentialIssuerJwkSchema = z.object({
  alg: z.literal('EdDSA'),
  crv: z.literal('Ed25519'),
  key_ops: z.array(z.string()).refine(
    (operations) => operations.includes('verify'),
    'issuerJwk must allow verification',
  ),
  kty: z.literal('OKP'),
  use: z.literal('sig'),
  x: z.string().min(1),
}).passthrough();

export const sampleCredentialContextSchema = z.object({
  nonce: z.string().min(1),
  origin: z.string().url().refine(
    (value) => new URL(value).origin === value,
    'origin must be a normalized origin',
  ),
  validationTimeSeconds: z.number().int().positive(),
  issuerJwk: sampleCredentialIssuerJwkSchema,
}).strict();
export type SampleCredentialContextInput = z.infer<typeof sampleCredentialContextSchema>;

export const sampleCredentialResponseSchema = z.object({
  protocol: z.literal('openid4vp-v1-unsigned'),
  data: z.object({
    vp_token: z.unknown(),
  }).passthrough(),
}).strict();
export type SampleCredentialResponseInput = z.infer<typeof sampleCredentialResponseSchema>;

export const verifySampleCredentialRequestSchema = z.object({
  flow_id: z.string().uuid(),
  context: sampleCredentialContextSchema,
  response: sampleCredentialResponseSchema,
}).strict();
export type VerifySampleCredentialRequest = z.infer<typeof verifySampleCredentialRequestSchema>;

export const accountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  createdAt: z.string().datetime(),
  lastSignInAt: z.string().datetime().optional(),
  credentialIssuer: z.string().url(),
  verifiedClaims: z.record(z.unknown()).optional(),
});
export type AccountDto = z.infer<typeof accountSchema>;

export const signInActivitySchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  email: z.string().email(),
  occurredAt: z.string().datetime(),
  event: z.literal('openid4vp_sign_in'),
  source: credentialSourceSchema,
  credentialIssuer: z.string().url(),
  attributes: z.record(z.unknown()),
  traceId: z.string().uuid().optional(),
});
export type SignInActivityDto = z.infer<typeof signInActivitySchema>;

export const profileRequiredResponseSchema = z.object({
  status: z.literal('profile_required'),
  source: credentialSourceSchema,
  signup_token: z.string().uuid(),
  profile: z.object({
    email: z.string().email(),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    name: z.string().optional(),
    picture: z.string().url().optional(),
    hd: z.string().optional(),
  }),
  debug: z.unknown().optional(),
  trace_id: z.string().uuid().optional(),
});

export const signedInResponseSchema = z.object({
  status: z.literal('signed_in'),
  source: credentialSourceSchema,
  account: accountSchema,
  previous_sign_in_at: z.string().datetime().optional(),
  activity: z.array(signInActivitySchema),
  debug: z.unknown().optional(),
  trace_id: z.string().uuid().optional(),
});

export const verifyResultSchema = z.discriminatedUnion('status', [
  profileRequiredResponseSchema,
  signedInResponseSchema,
]);
export type VerifyResult = z.infer<typeof verifyResultSchema>;

export const completeSignupRequestSchema = z.object({
  signup_token: z.string().uuid(),
  name: z.string().trim().max(150).optional(),
  given_name: z.string().trim().max(100).optional(),
  family_name: z.string().trim().max(100).optional(),
  picture: z.string().trim().url().or(z.literal('')).optional(),
  job_title: z.string().trim().max(120).optional(),
  company: z.string().trim().max(150).optional(),
}).strict();
export type CompleteSignupRequest = z.infer<typeof completeSignupRequestSchema>;

export const completeSignupResponseSchema = z.object({
  status: z.literal('signed_up'),
  source: credentialSourceSchema,
  account: accountSchema,
  trace_id: z.string().uuid().optional(),
});
export type CompleteSignupResponse = z.infer<typeof completeSignupResponseSchema>;

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  time: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
  trace_id: z.string().uuid().optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
