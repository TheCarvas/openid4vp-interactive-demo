import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { FileAccountRepository } from './accounts/file-account-repository.js';
import { FileActivityRepository } from './activity/file-activity-repository.js';
import { createApp } from './app.js';
import { AuthService } from './auth/service.js';
import { TransactionStore } from './auth/transaction-store.js';
import { DiagnosticTracer } from './diagnostics/diagnostic-tracer.js';
import { mintSampleCredential } from './openid4vp/test-credential.js';

test('sample endpoint verifies an uploaded credential and reuses the normal signup/sign-in flow', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'openid4vp-api-'));
  const accountsFile = join(dataRoot, 'accounts.json');
  const activityFile = join(dataRoot, 'activity.json');
  const diagnosticTraceDirectory = join(dataRoot, 'diagnostic-traces');
  await Promise.all([
    writeFile(accountsFile, '', 'utf8'),
    writeFile(activityFile, '', 'utf8'),
  ]);
  const diagnostics = new DiagnosticTracer({
    directory: diagnosticTraceDirectory,
    debugUiEnabled: true,
    captureCredentialArtifacts: true,
  });
  const service = new AuthService({
    transactions: new TransactionStore(),
    accounts: new FileAccountRepository(accountsFile),
    activity: new FileActivityRepository(activityFile),
    flowTtlSeconds: 300,
    signupTtlSeconds: 600,
    diagnostics,
  });
  const uploaded = await mintSampleCredential();
  const app = createApp({ authService: service, diagnostics });
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const firstTraceId = crypto.randomUUID();
    const prepared = await post(baseUrl, '/api/auth/email/request', {
      protocol: 'openid4vp-v1-unsigned',
      claims: ['email', 'email_verified'],
    }, firstTraceId);
    assert.equal(prepared.status, 200);
    assert.equal(prepared.body.protocol, 'openid4vp-v1-unsigned');
    assert.equal(prepared.body.trace_id, firstTraceId);
    assert.deepEqual(
      prepared.body.data.dcql_query.credentials[0].claims,
      [{ path: ['email'] }, { path: ['email_verified'] }],
    );

    const unsupportedSigned = await post(baseUrl, '/api/auth/email/request', {
      protocol: 'openid4vp-v1-signed',
      claims: ['email', 'email_verified'],
    });
    assert.equal(unsupportedSigned.status, 400);
    assert.match(unsupportedSigned.body.error, /not supported yet/i);
    const rejectedByContract = await post(baseUrl, '/api/auth/email/verify-sample', {
      flow_id: prepared.body.flow_id,
      response: { attacker: 'controlled' },
      skipValidation: true,
    });
    assert.equal(rejectedByContract.status, 400);

    const rejectedWithoutUpload = await post(baseUrl, '/api/auth/email/verify-sample', {
      flow_id: prepared.body.flow_id,
    });
    assert.equal(rejectedWithoutUpload.status, 400);

    const verified = await post(baseUrl, '/api/auth/email/verify-sample', {
      flow_id: prepared.body.flow_id,
      ...uploaded,
    }, firstTraceId);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, 'profile_required');
    assert.equal(verified.body.source, 'sample');

    const signup = await post(baseUrl, '/api/auth/email/signup', {
      signup_token: verified.body.signup_token,
      name: 'Demo User',
      given_name: 'Demo',
      family_name: 'User',
      job_title: 'Developer Advocate',
      company: 'Example Co',
    }, firstTraceId);
    assert.equal(signup.status, 200);
    assert.equal(signup.body.source, 'sample');
    assert.equal(signup.body.account.jobTitle, 'Developer Advocate');

    const secondTraceId = crypto.randomUUID();
    const nextPrepared = await post(baseUrl, '/api/auth/email/request', {
      protocol: 'openid4vp-v1-unsigned',
      claims: ['email', 'email_verified'],
    }, secondTraceId);
    const signedIn = await post(baseUrl, '/api/auth/email/verify-sample', {
      flow_id: nextPrepared.body.flow_id,
      ...uploaded,
    }, secondTraceId);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.status, 'signed_in');
    assert.equal(signedIn.body.account.id, signup.body.account.id);
    assert.equal(signedIn.body.previous_sign_in_at, signup.body.account.lastSignInAt);
    assert.equal(signedIn.body.activity.length, 2);
    assert.deepEqual(
      signedIn.body.activity.map((entry: Record<string, any>) => entry.attributes.account_status),
      ['existing', 'new'],
    );

    const persistedAccounts = JSON.parse(await readFile(accountsFile, 'utf8'));
    const persistedActivity = JSON.parse(await readFile(activityFile, 'utf8'));
    assert.equal(persistedAccounts[0].email, signup.body.account.email);
    assert.equal(persistedAccounts[0].verifiedClaims.email_verified, true);
    assert.equal(persistedActivity.length, 2);
    assert.equal(persistedActivity[0].email, signup.body.account.email);
    assert.equal(persistedActivity[0].traceId, firstTraceId);
    assert.equal(persistedActivity[1].traceId, secondTraceId);

    const successfulTrace = JSON.parse(await readFile(join(diagnosticTraceDirectory, `${firstTraceId}.json`), 'utf8'));
    assert.equal(successfulTrace.outcome, 'succeeded');
    assert.equal(successfulTrace.accountId, signup.body.account.id);
    assert.equal(successfulTrace.artifacts.length > 0, true);

    const failedTraceId = crypto.randomUUID();
    const failedPrepared = await post(baseUrl, '/api/auth/email/request', {
      protocol: 'openid4vp-v1-unsigned',
      claims: ['email', 'email_verified'],
    }, failedTraceId);
    const failed = await post(baseUrl, '/api/auth/email/verify', {
      flow_id: failedPrepared.body.flow_id,
      response: {},
    }, failedTraceId);
    assert.equal(failed.status, 400);
    const failedTrace = JSON.parse(await readFile(join(diagnosticTraceDirectory, `${failedTraceId}.json`), 'utf8'));
    assert.equal(failedTrace.outcome, 'failed');
    assert.equal(failedTrace.accountId, undefined);
    assert.equal(failedTrace.failure.stage, 'credential.verify');
    assert.equal((await readdir(dataRoot)).some((name) => name.endsWith('.tmp')), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataRoot, { recursive: true, force: true });
  }
});

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  traceId?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:8080',
      ...(traceId ? { 'X-Debug-Level': 'debug', 'X-Trace-Id': traceId } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}
