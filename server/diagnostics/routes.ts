import { Router } from 'express';
import { z } from 'zod';
import {
  credentialArtifactInputSchema,
  diagnosticEventInputSchema,
} from '../../shared/contracts/diagnostics.js';
import { HttpError } from '../http/errors.js';
import type { DiagnosticTracer } from './diagnostic-tracer.js';

const traceParamsSchema = z.object({ traceId: z.string().uuid() });

export function createDiagnosticsRouter(diagnostics: DiagnosticTracer): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(diagnostics.capabilities());
  });

  router.get('/traces/:traceId', async (req, res) => {
    ensureEnabled(diagnostics);
    const { traceId } = traceParamsSchema.parse(req.params);
    const trace = await diagnostics.getTrace(traceId);
    if (!trace) throw new HttpError(404, 'The diagnostic trace does not exist.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(trace);
  });

  router.post('/traces/:traceId/events', async (req, res) => {
    ensureEnabled(diagnostics);
    const { traceId } = traceParamsSchema.parse(req.params);
    const event = diagnosticEventInputSchema.parse(req.body);
    await diagnostics.recordFrontendEvent(traceId, event);
    if (event.phase === 'failure') {
      await diagnostics.markFailed(traceId, event.operation, event.message);
    }
    res.status(204).end();
  });

  router.post('/traces/:traceId/artifacts', async (req, res) => {
    ensureEnabled(diagnostics);
    if (!diagnostics.capabilities().captureCredentialArtifacts) {
      throw new HttpError(403, 'Credential artifact capture is disabled.');
    }
    const { traceId } = traceParamsSchema.parse(req.params);
    const artifact = credentialArtifactInputSchema.parse(req.body);
    await diagnostics.captureFrontendArtifact(traceId, artifact);
    res.status(204).end();
  });

  return router;
}

function ensureEnabled(diagnostics: DiagnosticTracer): void {
  if (!diagnostics.capabilities().debugUiEnabled) {
    throw new HttpError(404, 'Diagnostics are disabled.');
  }
}
