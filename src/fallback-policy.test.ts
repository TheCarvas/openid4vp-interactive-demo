import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldOfferSampleCredential } from './fallback-policy.js';

test('sample fallback is offered only after a flow exists and browser capture is unavailable', () => {
  assert.equal(shouldOfferSampleCredential({
    hasPreparedFlow: true,
    browserApiAvailable: false,
    browserProtocolAllowed: true,
    credentialRequestRejected: false,
  }), true);
  assert.equal(shouldOfferSampleCredential({
    hasPreparedFlow: false,
    browserApiAvailable: false,
    browserProtocolAllowed: true,
    credentialRequestRejected: false,
  }), false);
});

test('sample fallback is offered after a live credential request rejects', () => {
  assert.equal(shouldOfferSampleCredential({
    hasPreparedFlow: true,
    browserApiAvailable: true,
    browserProtocolAllowed: true,
    credentialRequestRejected: true,
  }), true);
  assert.equal(shouldOfferSampleCredential({
    hasPreparedFlow: true,
    browserApiAvailable: true,
    browserProtocolAllowed: true,
    credentialRequestRejected: false,
  }), false);
});

test('sample fallback is offered when the browser rejects the backend protocol', () => {
  assert.equal(shouldOfferSampleCredential({
    hasPreparedFlow: true,
    browserApiAvailable: true,
    browserProtocolAllowed: false,
    credentialRequestRejected: false,
  }), true);
});
