import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeSignupRequestSchema,
  prepareAuthRequestSchema,
  verifySampleCredentialRequestSchema,
} from './auth.js';

test('request preparation contract accepts selected claims and a known OpenID4VP request type', () => {
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-unsigned',
    claims: ['email', 'email_verified', 'name'],
  }).success, true);
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-signed',
    claims: ['email', 'email_verified'],
  }).success, true);
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-unsigned',
    claims: ['attacker_controlled_claim'],
  }).success, false);
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-unsigned',
    claims: [],
  }).success, false);
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-unsigned',
    claims: ['email', 'email'],
  }).success, false);
  assert.equal(prepareAuthRequestSchema.safeParse({
    protocol: 'openid4vp-v1-unsigned',
    claims: ['name'],
  }).success, false);
});

const sampleUpload = {
  context: {
    nonce: 'captured-transaction-nonce',
    origin: 'http://localhost:8080',
    validationTimeSeconds: 1_760_000_000,
    issuerJwk: {
      alg: 'EdDSA',
      crv: 'Ed25519',
      key_ops: ['verify'],
      kty: 'OKP',
      use: 'sig',
      x: 'dCCZZmy3Zuy8R8i0ed0GEa0Hhqum2OrhR1lJ7x4vN_E',
    },
  },
  response: {
    protocol: 'openid4vp-v1-unsigned',
    data: { vp_token: { user_info_query: ['header.payload.signature~disclosure~kb.jwt.signature'] } },
  },
};

test('sample verification contract requires an uploaded credential and nothing else', () => {
  assert.equal(verifySampleCredentialRequestSchema.safeParse({
    flow_id: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
    ...sampleUpload,
  }).success, true);

  // The server no longer holds a sample of its own, so a bare flow id cannot verify anything.
  assert.equal(verifySampleCredentialRequestSchema.safeParse({
    flow_id: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
  }).success, false);

  for (const bypass of [
    { response: { vp_token: {} } },
    { context: { ...sampleUpload.context, origin: 'http://localhost:8080/path' } },
    { context: { ...sampleUpload.context, validationTimeSeconds: -1 } },
    { sampleMode: true },
    { skipNonce: true },
    { skipTime: true },
    { skipValidation: true },
  ]) {
    assert.equal(verifySampleCredentialRequestSchema.safeParse({
      flow_id: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
      ...sampleUpload,
      ...bypass,
    }).success, false);
  }
});

test('signup contract rejects unexpected fields and overlong profile values', () => {
  assert.equal(completeSignupRequestSchema.safeParse({
    signup_token: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
    name: 'Sample User',
    given_name: 'Sample',
    family_name: 'User',
    picture: 'https://example.com/profile.png',
    job_title: 'Engineer',
    company: 'Example Co',
  }).success, true);
  assert.equal(completeSignupRequestSchema.safeParse({
    signup_token: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
    admin: true,
  }).success, false);
  assert.equal(completeSignupRequestSchema.safeParse({
    signup_token: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
    given_name: 'x'.repeat(101),
  }).success, false);
  assert.equal(completeSignupRequestSchema.safeParse({
    signup_token: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
    picture: 'not-a-url',
  }).success, false);
});
