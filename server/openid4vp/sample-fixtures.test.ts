import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSampleCredentialFixtures, SampleFixtureError } from './sample-fixtures.js';
import { mintSampleCredential } from './test-credential.js';

test('validates an uploaded context/response pair', async () => {
  const uploaded = await mintSampleCredential();
  const fixtures = parseSampleCredentialFixtures(uploaded);

  assert.equal(fixtures.response.protocol, 'openid4vp-v1-unsigned');
  assert.equal(fixtures.context.issuerJwk.crv, 'Ed25519');
  assert.equal(typeof fixtures.response.data.vp_token, 'object');
});

test('an incomplete upload is rejected as a client error, not a server fault', async () => {
  const { response } = await mintSampleCredential();

  assert.throws(
    () => parseSampleCredentialFixtures({ context: {}, response }),
    (error: unknown) => error instanceof SampleFixtureError
      && error.status === 400
      && /context is missing required fields/i.test(error.message),
  );
});

test('a malformed response document is rejected', async () => {
  const { context } = await mintSampleCredential();

  assert.throws(
    () => parseSampleCredentialFixtures({ context, response: { protocol: 'openid4vp-v1-unsigned' } }),
    (error: unknown) => error instanceof SampleFixtureError
      && error.status === 400
      && /response is missing required fields/i.test(error.message),
  );
});

test('unknown top-level keys are rejected so uploads cannot smuggle verifier options', async () => {
  const uploaded = await mintSampleCredential();

  assert.throws(
    () => parseSampleCredentialFixtures({
      context: { ...uploaded.context, skipValidation: true },
      response: uploaded.response,
    }),
    SampleFixtureError,
  );
});
