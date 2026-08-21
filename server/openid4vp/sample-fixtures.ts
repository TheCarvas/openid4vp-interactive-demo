import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JWK } from 'jose';
import { z } from 'zod';
import { HttpError } from '../http/errors.js';

const issuerJwkSchema = z.object({
  alg: z.literal('EdDSA'),
  crv: z.literal('Ed25519'),
  key_ops: z.array(z.string()).refine((operations) => operations.includes('verify'), 'issuerJwk must allow verification'),
  kty: z.literal('OKP'),
  use: z.literal('sig'),
  x: z.string().min(1),
}).passthrough();

const sampleCredentialContextSchema = z.object({
  nonce: z.string().min(1),
  origin: z.string().url().refine((value) => new URL(value).origin === value, 'origin must be a normalized origin'),
  validationTimeSeconds: z.number().int().positive(),
  issuerJwk: issuerJwkSchema,
}).strict();

const sampleCredentialResponseSchema = z.object({
  protocol: z.literal('openid4vp-v1-unsigned'),
  data: z.object({
    vp_token: z.unknown(),
  }).passthrough(),
}).strict();

export type SampleCredentialContext = Omit<z.infer<typeof sampleCredentialContextSchema>, 'issuerJwk'> & {
  issuerJwk: JWK;
};
export type SampleCredentialResponse = z.infer<typeof sampleCredentialResponseSchema>;
export type SampleCredentialFixtures = {
  context: SampleCredentialContext;
  response: SampleCredentialResponse;
};

export async function loadSampleCredentialFixtures(projectRoot: string): Promise<SampleCredentialFixtures> {
  const contextValue = await readFixture(
    resolve(projectRoot, 'fixtures', 'sample-credential-context.json'),
    'Sample credential context fixture is unavailable or malformed.',
  );
  const responseValue = await readFixture(
    resolve(projectRoot, 'fixtures', 'sample-credential-response.json'),
    'Sample credential response fixture is unavailable or malformed.',
  );

  const context = sampleCredentialContextSchema.safeParse(contextValue);
  if (!context.success) {
    throw new SampleFixtureError('Sample credential context fixture is missing required fields.', context.error);
  }
  const response = sampleCredentialResponseSchema.safeParse(responseValue);
  if (!response.success) {
    throw new SampleFixtureError('Sample credential response fixture is missing required fields.', response.error);
  }

  return {
    context: context.data as SampleCredentialContext,
    response: response.data,
  };
}

async function readFixture(path: string, publicMessage: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new SampleFixtureError(publicMessage, error);
  }
}

export class SampleFixtureError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(500, message, cause);
    this.name = 'SampleFixtureError';
  }
}
