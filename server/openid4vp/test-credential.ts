import { createHash } from 'node:crypto';
import { CompactSign, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { SampleCredentialFixtures } from './sample-fixtures.js';

/**
 * Mints a synthetic UserInfoCredential presentation for tests.
 *
 * The demo intentionally ships no sample credential of its own: a captured Google credential
 * carries the credential subject's personal data, so tests generate a throwaway one instead.
 */

const ISSUER = 'https://verifiablecredentials-pa.googleapis.com';
const VCT = 'UserInfoCredential';
const ISSUED_AT_SECONDS = 1_760_000_000;

export type SyntheticCredentialOptions = {
  claims?: Record<string, unknown>;
  nonce?: string;
  origin?: string;
};

export async function mintSampleCredential(
  options: SyntheticCredentialOptions = {},
): Promise<SampleCredentialFixtures> {
  const nonce = options.nonce ?? 'l2s-Tt2xY0nSyntheticDemoNonceValue0000000000';
  const origin = options.origin ?? 'http://localhost:8080';
  const claims = options.claims ?? {
    email: 'demo.user@example.com',
    email_verified: true,
    given_name: 'Demo',
    family_name: 'User',
    name: 'Demo User',
    hd: '',
  };

  const issuerKeys = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const holderKeys = await generateKeyPair('ES256', { extractable: true });
  const holderJwk = await exportJWK(holderKeys.publicKey);

  const disclosures = Object.entries(claims).map(([name, value], index) =>
    encodeDisclosure(`salt${index}${'0'.repeat(16)}`, name, value),
  );

  const issuerJwt = await sign(
    { alg: 'EdDSA', typ: 'vc+sd-jwt' },
    {
      _sd: disclosures.map(digest),
      _sd_alg: 'sha-256',
      cnf: { jwk: holderJwk },
      exp: ISSUED_AT_SECONDS + 604_800,
      iat: ISSUED_AT_SECONDS,
      iss: ISSUER,
      vct: VCT,
    },
    issuerKeys.privateKey,
  );

  const withoutKeyBinding = [issuerJwt, ...disclosures, ''].join('~');
  const keyBindingJwt = await sign(
    { alg: 'ES256', typ: 'kb+jwt' },
    {
      nonce,
      aud: origin,
      // Google's captured samples encode iat as a numeric string; keep that quirk covered.
      iat: String(ISSUED_AT_SECONDS),
      sd_hash: createHash('sha256').update(withoutKeyBinding).digest('base64url'),
    },
    holderKeys.privateKey,
  );

  const issuerPublicJwk = await exportJWK(issuerKeys.publicKey);
  return {
    context: {
      nonce,
      origin,
      validationTimeSeconds: ISSUED_AT_SECONDS,
      issuerJwk: {
        alg: 'EdDSA',
        crv: 'Ed25519',
        key_ops: ['verify'],
        kty: 'OKP',
        use: 'sig',
        x: issuerPublicJwk.x,
      } as JWK,
    },
    response: {
      protocol: 'openid4vp-v1-unsigned',
      data: {
        vp_token: {
          user_info_query: [`${withoutKeyBinding}${keyBindingJwt}`],
        },
      },
    },
  };
}

function encodeDisclosure(salt: string, name: string, value: unknown): string {
  return Buffer.from(JSON.stringify([salt, name, value]), 'utf8').toString('base64url');
}

function digest(disclosure: string): string {
  return createHash('sha256').update(disclosure).digest('base64url');
}

async function sign(
  header: { alg: string; typ: string },
  payload: Record<string, unknown>,
  key: CryptoKey,
): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader(header)
    .sign(key);
}
