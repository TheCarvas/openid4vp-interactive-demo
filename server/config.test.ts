import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadConfig } from './config.js';

const projectRoot = '/srv/app';

test('data files default to the project .data directory', () => {
  const config = loadConfig({}, projectRoot);
  assert.equal(config.dataDirectory, resolve(projectRoot, '.data'));
  assert.equal(config.accountsFile, resolve(projectRoot, '.data', 'accounts.json'));
  assert.equal(config.staticDirectory, resolve(projectRoot, 'dist'));
});

test('DATA_DIR relocates every datastore so redeploys cannot wipe them', () => {
  const config = loadConfig({ DATA_DIR: '/home/demo/persistent' }, projectRoot);
  assert.equal(config.dataDirectory, '/home/demo/persistent');
  assert.equal(config.accountsFile, resolve('/home/demo/persistent', 'accounts.json'));
  assert.equal(config.activityFile, resolve('/home/demo/persistent', 'activity.json'));
  assert.equal(config.diagnosticTraceDirectory, resolve('/home/demo/persistent', 'diagnostic-traces'));
});

test('relative DATA_DIR and STATIC_DIR resolve against the project root', () => {
  const config = loadConfig({ DATA_DIR: 'var/data', STATIC_DIR: 'public' }, projectRoot);
  assert.equal(config.dataDirectory, resolve(projectRoot, 'var/data'));
  assert.equal(config.staticDirectory, resolve(projectRoot, 'public'));
});

test('debug and artifact capture stay off unless explicitly enabled', () => {
  const config = loadConfig({}, projectRoot);
  assert.equal(config.debugUiEnabled, false);
  assert.equal(config.captureCredentialArtifacts, false);
});

test('the server binds loopback unless a bind host is set explicitly', () => {
  assert.equal(loadConfig({}, projectRoot).bindHost, '127.0.0.1');
  assert.equal(loadConfig({ BIND_HOST: '   ' }, projectRoot).bindHost, '127.0.0.1');
});

test('BIND_HOST opts into a wider bind, and takes precedence over HOST', () => {
  assert.equal(loadConfig({ BIND_HOST: '0.0.0.0' }, projectRoot).bindHost, '0.0.0.0');
  assert.equal(loadConfig({ HOST: '0.0.0.0' }, projectRoot).bindHost, '0.0.0.0');
  assert.equal(
    loadConfig({ BIND_HOST: '127.0.0.1', HOST: '0.0.0.0' }, projectRoot).bindHost,
    '127.0.0.1',
  );
});

test('PUBLIC_ORIGIN is normalized to a bare origin', () => {
  const config = loadConfig({ PUBLIC_ORIGIN: 'https://openid4vp.lionwolfstar.tech/demo' }, projectRoot);
  assert.equal(config.publicOrigin, 'https://openid4vp.lionwolfstar.tech');
});

test('PUBLIC_ORIGIN is optional', () => {
  assert.equal(loadConfig({}, projectRoot).publicOrigin, undefined);
  assert.equal(loadConfig({ PUBLIC_ORIGIN: '  ' }, projectRoot).publicOrigin, undefined);
});

test('PUBLIC_ORIGIN rejects non-https deployments but allows local development', () => {
  assert.throws(
    () => loadConfig({ PUBLIC_ORIGIN: 'http://openid4vp.lionwolfstar.tech' }, projectRoot),
    /must use https/,
  );
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'not-a-url' }, projectRoot), /absolute URL/);
  assert.equal(
    loadConfig({ PUBLIC_ORIGIN: 'http://localhost:5173' }, projectRoot).publicOrigin,
    'http://localhost:5173',
  );
});
