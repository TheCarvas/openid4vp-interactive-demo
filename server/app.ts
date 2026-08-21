import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAuthRouter } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import { errorHandler } from './http/errors.js';
import { DiagnosticTracer } from './diagnostics/diagnostic-tracer.js';
import { createDiagnosticsRouter } from './diagnostics/routes.js';

export function createApp(options: {
  authService: AuthService;
  diagnostics?: DiagnosticTracer;
  staticDirectory?: string;
}): Express {
  const diagnostics = options.diagnostics ?? DiagnosticTracer.disabled();
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth/email', createAuthRouter({
    service: options.authService,
    diagnostics,
  }));
  app.use('/api/diagnostics', createDiagnosticsRouter(diagnostics));

  if (options.staticDirectory && existsSync(options.staticDirectory)) {
    app.use(express.static(options.staticDirectory));
    app.get('/{*splat}', (_req, res) => res.sendFile(resolve(options.staticDirectory!, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
