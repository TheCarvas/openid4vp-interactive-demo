import { isAbsolute, resolve } from 'node:path';

export type AppConfig = {
  port: number;
  bindHost: string;
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
    bindHost: bindHost(environment.BIND_HOST ?? environment.HOST),
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

/**
 * The interface the server listens on. Loopback by default: behind a reverse
 * proxy, binding every interface also publishes the app on its raw port over
 * plaintext HTTP, which bypasses TLS and lets a flow be reached on an origin
 * other than the one the verifier bound it to. Set BIND_HOST=0.0.0.0 only where
 * that direct exposure is intended, such as inside a container.
 */
function bindHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '127.0.0.1';
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
