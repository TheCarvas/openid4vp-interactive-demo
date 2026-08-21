import 'dotenv/config';
import { FileAccountRepository } from './accounts/file-account-repository.js';
import { FileActivityRepository } from './activity/file-activity-repository.js';
import { createApp } from './app.js';
import { AuthService } from './auth/service.js';
import { TransactionStore } from './auth/transaction-store.js';
import { loadConfig } from './config.js';
import { DiagnosticTracer } from './diagnostics/diagnostic-tracer.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const config = loadConfig();
const diagnostics = new DiagnosticTracer({
  directory: config.diagnosticTraceDirectory,
  debugUiEnabled: config.debugUiEnabled,
  captureCredentialArtifacts: config.captureCredentialArtifacts,
});
const authService = new AuthService({
  transactions: new TransactionStore(),
  accounts: new FileAccountRepository(config.accountsFile),
  activity: new FileActivityRepository(config.activityFile),
  flowTtlSeconds: config.flowTtlSeconds,
  signupTtlSeconds: config.signupTtlSeconds,
  projectRoot: config.projectRoot,
  diagnostics,
});
const app = createApp({
  authService,
  diagnostics,
  staticDirectory: config.staticDirectory,
  publicOrigin: config.publicOrigin,
});

app.listen(config.port, config.bindHost, () => {
  console.log(`OpenID4VP verified-email API listening on http://${config.bindHost}:${config.port}`);
  if (!LOOPBACK_HOSTS.has(config.bindHost)) {
    console.warn(
      `Warning: BIND_HOST=${config.bindHost} publishes this API on every interface, so it is ` +
        `reachable on port ${config.port} over plaintext HTTP even behind a TLS-terminating proxy. ` +
        'Unset BIND_HOST to listen on 127.0.0.1 only.',
    );
  }
  console.log(`Public origin: ${config.publicOrigin ?? 'derived per request'}`);
  console.log(`Data directory: ${config.dataDirectory}`);
  console.log(`Google VC issuer: ${process.env.GOOGLE_VC_ISSUER ?? 'https://verifiablecredentials-pa.googleapis.com'}`);
  console.log(`Test diagnostics: ${config.debugUiEnabled ? 'enabled' : 'disabled'}; credential artifacts: ${config.captureCredentialArtifacts ? 'enabled' : 'disabled'}`);
});
