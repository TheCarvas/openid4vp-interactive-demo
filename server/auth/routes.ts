import { Router, type Request, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  completeSignupRequestSchema,
  prepareAuthRequestSchema,
  verifyCredentialRequestSchema,
  verifySampleCredentialRequestSchema,
  type VerifyResult,
} from '../../shared/contracts/auth.js';
import { diagnosticLevelSchema, type DiagnosticLevel } from '../../shared/contracts/diagnostics.js';
import type { DiagnosticTracer } from '../diagnostics/diagnostic-tracer.js';
import { requestOrigin } from '../http/origin.js';
import { setDemoSessionCookie } from '../http/session.js';
import type { AuthService } from './service.js';

export function createAuthRouter(options: { service: AuthService; diagnostics: DiagnosticTracer }): Router {
  const router = Router();

  router.post('/request', asyncHandler(async (req, res) => {
    const input = prepareAuthRequestSchema.parse(req.body ?? {});
    const diagnosticContext = requestDiagnosticContext(req, options.diagnostics);
    res.locals.traceId = diagnosticContext.traceId;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await options.service.prepare(requestOrigin(req), input, diagnosticContext));
  }));

  router.post('/verify', asyncHandler(async (req, res) => {
    res.locals.traceId = requestedTraceId(req);
    const input = verifyCredentialRequestSchema.parse(req.body);
    const result = await options.service.verifyLiveCredential(input.flow_id, input.response, requestOrigin(req));
    res.locals.traceId = result.trace_id ?? res.locals.traceId;
    sendVerificationResult(res, result, requestDebugEnabled(req, options.diagnostics));
  }));

  router.post('/verify-sample', asyncHandler(async (req, res) => {
    res.locals.traceId = requestedTraceId(req);
    const input = verifySampleCredentialRequestSchema.parse(req.body);
    const result = await options.service.verifySampleCredential(input.flow_id, requestOrigin(req));
    res.locals.traceId = result.trace_id ?? res.locals.traceId;
    sendVerificationResult(res, result, requestDebugEnabled(req, options.diagnostics));
  }));

  router.post('/signup', asyncHandler(async (req, res) => {
    res.locals.traceId = requestedTraceId(req);
    const input = completeSignupRequestSchema.parse(req.body);
    const result = await options.service.completeSignup(
      input.signup_token,
      {
        name: input.name,
        givenName: input.given_name,
        familyName: input.family_name,
        picture: input.picture,
        jobTitle: input.job_title,
        company: input.company,
      },
    );
    res.locals.traceId = result.trace_id ?? res.locals.traceId;
    setDemoSessionCookie(res);
    res.json(result);
  }));

  return router;
}

function sendVerificationResult(res: Response, result: VerifyResult, includeDebug: boolean): void {
  if (result.status === 'signed_in') setDemoSessionCookie(res);
  if (includeDebug) {
    res.json(result);
    return;
  }
  const { debug: _debug, ...withoutDebug } = result;
  res.json(withoutDebug);
}

function requestDiagnosticContext(
  req: Request,
  diagnostics: DiagnosticTracer,
): { traceId?: string; level: DiagnosticLevel } {
  if (!diagnostics.capabilities().debugUiEnabled) return { level: 'off' };
  const parsedLevel = diagnosticLevelSchema.safeParse(firstHeader(req.headers['x-debug-level']));
  const level = parsedLevel.success ? parsedLevel.data : 'off';
  if (level === 'off') return { level };
  return {
    level,
    traceId: requestedTraceId(req) ?? randomUUID(),
  };
}

function requestDebugEnabled(req: Request, diagnostics: DiagnosticTracer): boolean {
  return diagnostics.capabilities().debugUiEnabled
    && firstHeader(req.headers['x-debug-level']) === 'debug';
}

function requestedTraceId(req: Request): string | undefined {
  const value = firstHeader(req.headers['x-trace-id']);
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type AsyncRequestHandler = (req: Request, res: Response) => Promise<void>;

function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}
