import 'dotenv/config';
import { FileAccountRepository } from './accounts/file-account-repository.js';
import { FileActivityRepository } from './activity/file-activity-repository.js';
import { createApp } from './app.js';
import { AuthService } from './auth/service.js';
import { TransactionStore } from './auth/transaction-store.js';
import { loadConfig } from './config.js';
import { DiagnosticTracer } from './diagnostics/diagnostic-tracer.js';

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
  diagnostics,
});
const app = createApp({
  authService,
  diagnostics,
  staticDirectory: config.staticDirectory,
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`OpenID4VP verified-email API listening on http://127.0.0.1:${config.port}`);
  console.log(`Google VC issuer: ${process.env.GOOGLE_VC_ISSUER ?? 'https://verifiablecredentials-pa.googleapis.com'}`);
  console.log(`Test diagnostics: ${config.debugUiEnabled ? 'enabled' : 'disabled'}; credential artifacts: ${config.captureCredentialArtifacts ? 'enabled' : 'disabled'}`);
});
