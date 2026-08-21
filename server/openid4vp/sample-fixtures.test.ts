import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadSampleCredentialFixtures, SampleFixtureError } from './sample-fixtures.js';

test('loads and validates the editable sample fixture files', async () => {
  const fixtures = await loadSampleCredentialFixtures(process.cwd());
  assert.equal(fixtures.response.protocol, 'openid4vp-v1-unsigned');
  assert.equal(fixtures.context.issuerJwk.crv, 'Ed25519');
  assert.equal(typeof fixtures.response.data.vp_token, 'object');
});

test('missing fixture files produce a controlled error without exposing their path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openid4vp-missing-'));
  try {
    await assert.rejects(
      loadSampleCredentialFixtures(root),
      (error: unknown) => error instanceof SampleFixtureError
        && error.status === 500
        && !error.message.includes(root),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed fixture files are re-read and rejected on the next invocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openid4vp-malformed-'));
  try {
    const fixtureDirectory = join(root, 'fixtures');
    await mkdir(fixtureDirectory);
    await writeFile(join(fixtureDirectory, 'sample-credential-context.json'), '{}', 'utf8');
    await writeFile(join(fixtureDirectory, 'sample-credential-response.json'), '{}', 'utf8');
    await assert.rejects(
      loadSampleCredentialFixtures(root),
      /missing required fields/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
