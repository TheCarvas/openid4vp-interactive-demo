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

test('sample verification contract accepts only a flow identifier', () => {
  assert.equal(verifySampleCredentialRequestSchema.safeParse({
    flow_id: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
  }).success, true);

  for (const bypass of [
    { response: { vp_token: {} } },
    { sampleMode: true },
    { skipNonce: true },
    { skipTime: true },
    { skipValidation: true },
  ]) {
    assert.equal(verifySampleCredentialRequestSchema.safeParse({
      flow_id: '7fc10dba-f7bd-4c25-a360-3554408a18b4',
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
