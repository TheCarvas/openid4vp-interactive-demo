import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DiagnosticTracer } from './diagnostic-tracer.js';

test('INFO traces persist lifecycle events but omit DEBUG details and credential artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openid4vp-diagnostics-'));
  const traceId = crypto.randomUUID();
  const tracer = new DiagnosticTracer({
    directory,
    debugUiEnabled: true,
    captureCredentialArtifacts: true,
  });

  try {
    await tracer.startTrace({
      id: traceId,
      level: 'info',
      operation: 'auth.test',
      message: 'Started the test trace.',
    });
    await tracer.recordBackendEvent(traceId, {
      level: 'debug',
      operation: 'auth.test.details',
      phase: 'progress',
      message: 'Detailed value.',
      data: { secret: 'credential' },
    });
    await tracer.recordBackendEvent(traceId, {
      level: 'info',
      operation: 'auth.test.step',
      phase: 'progress',
      message: 'Completed an observable step.',
    });
    await tracer.captureBackendArtifact(traceId, {
      name: 'credential',
      mediaType: 'application/json',
      value: { secret: 'credential' },
    });
    await tracer.markFailed(traceId, 'auth.test.step', 'Expected failure.');

    const trace = await tracer.getTrace(traceId);
    assert.ok(trace);
    assert.equal(trace.outcome, 'failed');
    assert.equal(trace.accountId, undefined);
    assert.deepEqual(trace.events.map((event) => event.level), ['info', 'info']);
    assert.equal(trace.artifacts.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('disabled diagnostics expose only the OFF level and do not create traces', async () => {
  const tracer = DiagnosticTracer.disabled();
  const traceId = crypto.randomUUID();
  assert.deepEqual(tracer.capabilities().availableLevels, ['off']);
  await tracer.startTrace({
    id: traceId,
    level: 'debug',
    operation: 'auth.test',
    message: 'This trace must not be stored.',
  });
  assert.equal(await tracer.getTrace(traceId), undefined);
});
