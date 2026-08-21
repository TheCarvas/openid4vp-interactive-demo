import { resolve } from 'node:path';

export type AppConfig = {
  port: number;
  flowTtlSeconds: number;
  signupTtlSeconds: number;
  debugUiEnabled: boolean;
  captureCredentialArtifacts: boolean;
  projectRoot: string;
  accountsFile: string;
  activityFile: string;
  diagnosticTraceDirectory: string;
  staticDirectory: string;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): AppConfig {
  return {
    port: positiveNumber(environment.PORT, 3000),
    flowTtlSeconds: positiveNumber(environment.FLOW_TTL_SECONDS, 300),
    signupTtlSeconds: positiveNumber(environment.SIGNUP_TTL_SECONDS, 600),
    debugUiEnabled: booleanValue(environment.DEBUG_UI_ENABLED, false),
    captureCredentialArtifacts: booleanValue(environment.CAPTURE_CREDENTIAL_ARTIFACTS, false),
    projectRoot,
    accountsFile: resolve(projectRoot, '.data', 'accounts.json'),
    activityFile: resolve(projectRoot, '.data', 'activity.json'),
    diagnosticTraceDirectory: resolve(projectRoot, '.data', 'diagnostic-traces'),
    staticDirectory: resolve(projectRoot, 'dist'),
  };
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value.toLowerCase() === 'true';
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
