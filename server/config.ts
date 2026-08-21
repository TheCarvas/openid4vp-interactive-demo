import { isAbsolute, resolve } from 'node:path';

export type AppConfig = {
  port: number;
  flowTtlSeconds: number;
  signupTtlSeconds: number;
  debugUiEnabled: boolean;
  captureCredentialArtifacts: boolean;
  projectRoot: string;
  publicOrigin?: string;
  dataDirectory: string;
  accountsFile: string;
  activityFile: string;
  diagnosticTraceDirectory: string;
  staticDirectory: string;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
): AppConfig {
  const dataDirectory = directory(environment.DATA_DIR, projectRoot, '.data');
  return {
    port: positiveNumber(environment.PORT, 3000),
    flowTtlSeconds: positiveNumber(environment.FLOW_TTL_SECONDS, 300),
    signupTtlSeconds: positiveNumber(environment.SIGNUP_TTL_SECONDS, 600),
    debugUiEnabled: booleanValue(environment.DEBUG_UI_ENABLED, false),
    captureCredentialArtifacts: booleanValue(environment.CAPTURE_CREDENTIAL_ARTIFACTS, false),
    projectRoot,
    publicOrigin: normalizedOrigin(environment.PUBLIC_ORIGIN),
    dataDirectory,
    accountsFile: resolve(dataDirectory, 'accounts.json'),
    activityFile: resolve(dataDirectory, 'activity.json'),
    diagnosticTraceDirectory: resolve(dataDirectory, 'diagnostic-traces'),
    staticDirectory: directory(environment.STATIC_DIR, projectRoot, 'dist'),
  };
}

function directory(value: string | undefined, projectRoot: string, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return resolve(projectRoot, fallback);
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(projectRoot, trimmed);
}

/**
 * The deployment's canonical browser origin. When set, it is the only origin the
 * verifier will bind a flow to, so a spoofed `X-Forwarded-Host` behind the
 * hosting proxy cannot move the OpenID4VP audience onto another host.
 */
function normalizedOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`PUBLIC_ORIGIN must be an absolute URL, received "${trimmed}".`);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(`PUBLIC_ORIGIN must use https, received "${trimmed}".`);
  }
  return parsed.origin;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value.toLowerCase() === 'true';
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
