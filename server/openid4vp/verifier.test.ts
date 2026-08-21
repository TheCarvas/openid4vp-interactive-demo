import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeJwt } from 'jose';
import { loadSampleCredentialFixtures, type SampleCredentialFixtures } from './sample-fixtures.js';
import {
  assertAudience,
  assertFreshKeyBinding,
  assertIssuerCredentialClaims,
  assertKeyBindingNonce,
  assertPresentationHash,
  verifySampleOpenId4VpResponse,
} from './verifier.js';

const issuer = 'https://verifiablecredentials-pa.googleapis.com';

test('the unmodified fixture verifies cryptographically and independently of the current date', async () => {
  const fixtures = await loadSampleCredentialFixtures(process.cwd());
  const first = await verifySampleOpenId4VpResponse(fixtures);
  const second = await verifySampleOpenId4VpResponse(fixtures);

  assert.equal(first.claims.email, 'demo.user@example.com');
  assert.equal(first.claims.email_verified, true);
  assert.equal(first.debug.source, 'sample');
  assert.deepEqual(second.claims, first.claims);
});

test('a modified issuer signature fails', async () => {
  const fixtures = await clonedFixtures();
  replacePresentation(fixtures, (presentation) => {
    const segments = presentation.split('~');
    const jwt = segments[0].split('.');
    jwt[2] = mutate(jwt[2]);
    segments[0] = jwt.join('.');
    return segments.join('~');
  });
  await assert.rejects(verifySampleOpenId4VpResponse(fixtures), /signature verification failed/i);
});

test('a modified disclosure fails digest validation', async () => {
  const fixtures = await clonedFixtures();
  replacePresentation(fixtures, (presentation) => {
    const segments = presentation.split('~');
    segments[1] = mutate(segments[1]);
    return segments.join('~');
  });
  await assert.rejects(verifySampleOpenId4VpResponse(fixtures), /not referenced by the issuer JWT/i);
});

test('a modified Key Binding JWT fails signature verification', async () => {
  const fixtures = await clonedFixtures();
  replacePresentation(fixtures, (presentation) => {
    const segments = presentation.split('~');
    const jwt = segments[segments.length - 1].split('.');
    jwt[2] = mutate(jwt[2]);
    segments[segments.length - 1] = jwt.join('.');
    return segments.join('~');
  });
  await assert.rejects(verifySampleOpenId4VpResponse(fixtures), /signature verification failed/i);
});

test('sd_hash is compared with the disclosed SD-JWT', async () => {
  const fixtures = await loadSampleCredentialFixtures(process.cwd());
  const presentation = getPresentation(fixtures);
  const segments = presentation.split('~');
  const payload = decodeJwt(segments[segments.length - 1]);
  assert.doesNotThrow(() => assertPresentationHash(segments, payload));
  assert.throws(
    () => assertPresentationHash(segments, { ...payload, sd_hash: 'modified' }),
    /sd_hash does not match/i,
  );
});

test('issuer and credential type are explicit verification requirements', () => {
  assert.throws(
    () => assertIssuerCredentialClaims({ iss: 'https://attacker.example', vct: 'UserInfoCredential' }, issuer),
    /unexpected credential issuer/i,
  );
  assert.throws(
    () => assertIssuerCredentialClaims({ iss: issuer, vct: 'OtherCredential' }, issuer),
    /unexpected credential type/i,
  );
});

test('sample audience is checked against the captured context', async () => {
  const fixtures = await clonedFixtures();
  fixtures.context.origin = 'http://localhost:9999';
  await assert.rejects(verifySampleOpenId4VpResponse(fixtures), /audience mismatch/i);
  assert.throws(() => assertAudience('http://localhost:8080', 'http://localhost:9999'), /audience mismatch/i);
});

test('live nonce and freshness rules remain strict while sample time accepts the captured numeric string', () => {
  assert.throws(() => assertKeyBindingNonce({ nonce: 'captured' }, 'fresh-live-nonce'), /nonce does not match/i);
  assert.throws(() => assertFreshKeyBinding({ iat: 1_000 }, 1_601, false), /older than 10 minutes/i);
  assert.throws(() => assertFreshKeyBinding({ iat: '1000' } as never, 1_000, false), /numeric iat/i);
  assert.doesNotThrow(() => assertFreshKeyBinding({ iat: '1000' } as never, 1_000, true));
});

async function clonedFixtures(): Promise<SampleCredentialFixtures> {
  return structuredClone(await loadSampleCredentialFixtures(process.cwd()));
}

function getPresentation(fixtures: SampleCredentialFixtures): string {
  const token = fixtures.response.data.vp_token as { user_info_query: string[] };
  return token.user_info_query[0];
}

function replacePresentation(
  fixtures: SampleCredentialFixtures,
  transform: (presentation: string) => string,
): void {
  const token = fixtures.response.data.vp_token as { user_info_query: string[] };
  token.user_info_query[0] = transform(token.user_info_query[0]);
}

function mutate(value: string): string {
  if (!value) throw new Error('Cannot mutate an empty encoded value.');
  const replacement = value[0] === 'A' ? 'B' : 'A';
  return replacement + value.slice(1);
}
