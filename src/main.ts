import './styles.css';
import type { ZodType } from 'zod';
import {
  completeSignupResponseSchema,
  prepareAuthResponseSchema,
  sampleCredentialContextSchema,
  sampleCredentialResponseSchema,
  verifyResultSchema,
  type AccountDto as Account,
  type BackendAuthRequest,
  type ClaimName,
  type CredentialSource,
  type DigitalCredentialsRequest,
  type OpenId4VpRequestProtocol,
  type SampleCredentialContextInput,
  type SampleCredentialResponseInput,
  type SignInActivityDto as SignInActivity,
  type VerifyResult,
} from '../shared/contracts/auth.js';
import {
  authenticationTraceSchema,
  diagnosticCapabilitiesSchema,
  diagnosticLevelSchema,
  type AuthenticationTrace,
  type DiagnosticCapabilities,
  type DiagnosticEventInput,
  type DiagnosticLevel,
} from '../shared/contracts/diagnostics.js';
import { shouldOfferSampleCredential } from './fallback-policy.js';
import { createGradientWaves } from './gradient-waves.js';

const EM_DASH = '\u2014';
const MAX_SAMPLE_UPLOAD_BYTES = 64 * 1024;
const SAMPLE_CONTEXT_HINT = 'Expected: nonce, origin, validationTimeSeconds, issuerJwk.';
const SAMPLE_RESPONSE_HINT = 'Expected: protocol and data.vp_token from the captured presentation.';

const AVAILABLE_CLAIMS: readonly ClaimName[] = [
  'email',
  'email_verified',
  'name',
  'given_name',
  'family_name',
  'picture',
  'hd',
];

const FLOW_STEPS = [
  'request_preparation',
  'wallet_invocation',
  'holder_consent',
  'vp_token_received',
  'presentation_verification',
  'verification_complete',
] as const;
type FlowStep = (typeof FLOW_STEPS)[number];

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly result: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const continueButton = document.querySelector<HTMLButtonElement>('#continue')!;
const retryButton = document.querySelector<HTMLButtonElement>('#retry')!;
const sampleFallbackPanel = document.querySelector<HTMLElement>('#sample-fallback')!;
const sampleCredentialButton = document.querySelector<HTMLButtonElement>('#use-sample')!;
const sampleContextInput = document.querySelector<HTMLInputElement>('#sample-context-file')!;
const sampleResponseInput = document.querySelector<HTMLInputElement>('#sample-response-file')!;
const sampleContextStatus = document.querySelector<HTMLElement>('#sample-context-status')!;
const sampleResponseStatus = document.querySelector<HTMLElement>('#sample-response-status')!;
const claimSelection = document.querySelector<HTMLFieldSetElement>('#claim-selection')!;
const claimInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-claim]'));
const signedProtocolInput = document.querySelector<HTMLInputElement>('#signed-protocol')!;
const protocolValue = document.querySelector<HTMLSpanElement>('#protocol-value')!;
const protocolNotice = document.querySelector<HTMLParagraphElement>('#protocol-notice')!;
const requestJsonPreview = document.querySelector<HTMLTextAreaElement>('#request-json-preview')!;
const flowProgress = document.querySelector<HTMLElement>('#flow-progress')!;
const progressCount = document.querySelector<HTMLSpanElement>('#progress-count')!;
const flowStepElements = new Map<FlowStep, HTMLLIElement>(
  FLOW_STEPS.map((step) => [step, document.querySelector<HTMLLIElement>(`[data-flow-step="${step}"]`)!]),
);
const flowStepDefaultDetails = new Map<FlowStep, string>(
  FLOW_STEPS.map((step) => [step, flowStepElements.get(step)!.querySelector('small')!.textContent ?? '']),
);
const profilePanel = document.querySelector<HTMLElement>('#profile-panel')!;
const profileForm = document.querySelector<HTMLFormElement>('#profile-form')!;
const emailInput = document.querySelector<HTMLInputElement>('#email')!;
const displayNameInput = document.querySelector<HTMLInputElement>('#display-name')!;
const givenNameInput = document.querySelector<HTMLInputElement>('#given-name')!;
const familyNameInput = document.querySelector<HTMLInputElement>('#family-name')!;
const pictureInput = document.querySelector<HTMLInputElement>('#picture')!;
const hostedDomainField = document.querySelector<HTMLElement>('#hosted-domain-field')!;
const hostedDomainInput = document.querySelector<HTMLInputElement>('#hosted-domain')!;
const jobTitleInput = document.querySelector<HTMLInputElement>('#job-title')!;
const companyInput = document.querySelector<HTMLInputElement>('#company')!;
const successPanel = document.querySelector<HTMLElement>('#success-panel')!;
const successTitle = document.querySelector<HTMLHeadingElement>('#success-title')!;
const welcomeMessage = document.querySelector<HTMLParagraphElement>('#welcome-message')!;
const accountCard = document.querySelector<HTMLDivElement>('#account-card')!;
const activityToggle = document.querySelector<HTMLButtonElement>('#activity-toggle')!;
const activityReport = document.querySelector<HTMLElement>('#activity-report')!;
const activityCount = document.querySelector<HTMLSpanElement>('#activity-count')!;
const activityList = document.querySelector<HTMLOListElement>('#activity-list')!;
const diagnosticControls = document.querySelector<HTMLElement>('#diagnostic-controls')!;
const diagnosticLevelSelect = document.querySelector<HTMLSelectElement>('#diagnostic-level')!;
const diagnosticCapabilitiesEl = document.querySelector<HTMLSpanElement>('#diagnostic-capabilities')!;
const diagnosticPanel = document.querySelector<HTMLDetailsElement>('#diagnostic-panel')!;
const diagnosticTraceIdEl = document.querySelector<HTMLSpanElement>('#diagnostic-trace-id')!;
const diagnosticRefreshButton = document.querySelector<HTMLButtonElement>('#diagnostic-refresh')!;
const debugOutput = document.querySelector<HTMLPreElement>('#debug-output')!;
const claimCount = document.querySelector<HTMLSpanElement>('#claim-count')!;
const capabilityProbe = document.querySelector<HTMLDListElement>('#capability-probe')!;
const traceSummary = document.querySelector<HTMLDListElement>('#trace-summary')!;
const traceEvents = document.querySelector<HTMLDivElement>('#trace-events')!;
const traceEventsCount = document.querySelector<HTMLSpanElement>('#trace-events-count')!;
const disclosedClaims = document.querySelector<HTMLElement>('#disclosed-claims')!;
const disclosedClaimsCount = document.querySelector<HTMLSpanElement>('#disclosed-claims-count')!;
const disclosedClaimsList = document.querySelector<HTMLDListElement>('#disclosed-claims-list')!;

let preparedRequest: BackendAuthRequest | null = null;
let signupToken: string | null = null;
let browserApiAvailable = false;
let browserSupportReason: string | undefined;
let credentialRequestRejected = false;
let sampleContext: SampleCredentialContextInput | null = null;
let sampleResponse: SampleCredentialResponseInput | null = null;
let diagnosticCapabilities: DiagnosticCapabilities = {
  debugUiEnabled: false,
  captureCredentialArtifacts: false,
  availableLevels: ['off'],
};
let diagnosticLevel: DiagnosticLevel = 'off';
let activeTraceId: string | undefined;
let traceReady = false;
let tracePollTimer: ReturnType<typeof setInterval> | undefined;
let pendingFrontendEvents: DiagnosticEventInput[] = [];
let localFrontendEvents: DiagnosticEventInput[] = [];
let renderedTraceSignature = '';
const expandedTraceEvents = new Set<string>();

type KeyValueRow = { key: string; value: string; tone?: 'is-ok' | 'is-bad' };

type LedgerEvent = {
  key: string;
  timestamp: string;
  tier: string;
  operation: string;
  phase: string;
  message: string;
  raw: unknown;
};

const CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">'
  + '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="square"/></svg>';

function setStatus(message: string, kind: 'pending' | 'ready' | 'error' | 'success' = 'pending') {
  statusEl.textContent = message;
  statusEl.className = `status status-${kind}`;
}

function writeDebug(value: unknown) {
  const data = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
  const stage = typeof data.stage === 'string' ? data.stage : 'diagnostic';
  const failed = stage.includes('failed') || 'error' in data;
  recordFrontendEvent({
    level: 'debug',
    operation: `frontend.${stage}`,
    phase: failed ? 'failure' : 'progress',
    message: failed ? `Frontend stage ${stage} failed.` : `Frontend stage ${stage} produced diagnostic data.`,
    data: frontendEventData(data),
  });
}

async function api<T>(url: string, responseSchema: ZodType<T>, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (diagnosticCapabilities.debugUiEnabled) headers['X-Debug-Level'] = diagnosticLevel;
  if (activeTraceId) headers['X-Trace-Id'] = activeTraceId;
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const details = payload.details ? `\n${JSON.stringify(payload.details, null, 2)}` : '';
    throw new ApiError(`${message}${details}`, response.status, payload);
  }
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('The backend response did not match the shared API contract.', response.status, {
      payload,
      contract_error: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

function recordFrontendEvent(event: DiagnosticEventInput): void {
  if (!diagnosticCapabilities.debugUiEnabled || diagnosticLevel === 'off') return;
  if (event.level === 'debug' && diagnosticLevel !== 'debug') return;
  const timestamped = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
  localFrontendEvents.push(timestamped);
  renderLocalDiagnostics();
  if (!activeTraceId || !traceReady) {
    pendingFrontendEvents.push(timestamped);
    return;
  }
  void persistFrontendEvent(activeTraceId, timestamped);
}

async function persistFrontendEvent(traceId: string, event: DiagnosticEventInput): Promise<void> {
  try {
    await fetch(`/api/diagnostics/traces/${encodeURIComponent(traceId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.error('Could not persist a frontend diagnostic event.', error);
  }
}

async function captureFrontendArtifact(name: string, value: unknown): Promise<void> {
  if (!activeTraceId || !traceReady || diagnosticLevel !== 'debug'
    || !diagnosticCapabilities.captureCredentialArtifacts) return;
  try {
    await fetch(`/api/diagnostics/traces/${encodeURIComponent(activeTraceId)}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mediaType: 'application/json', value }),
    });
  } catch (error) {
    console.error('Could not persist a frontend credential artifact.', error);
  }
}

function frontendEventData(data: Record<string, unknown>): Record<string, unknown> {
  if (diagnosticCapabilities.captureCredentialArtifacts) return data;
  const sanitized = { ...data };
  delete sanitized.browser_credential_data;
  delete sanitized.response;
  return sanitized;
}

function beginDiagnosticTrace(): void {
  stopTracePolling();
  localFrontendEvents = [];
  pendingFrontendEvents = [];
  traceReady = false;
  activeTraceId = diagnosticCapabilities.debugUiEnabled && diagnosticLevel !== 'off'
    ? crypto.randomUUID()
    : undefined;
  diagnosticLevelSelect.disabled = Boolean(activeTraceId);
  diagnosticTraceIdEl.textContent = activeTraceId ? `Trace ${activeTraceId}` : 'Diagnostics are off';
  if (activeTraceId) diagnosticPanel.open = true;
}

async function activateDiagnosticTrace(traceId: string | undefined): Promise<void> {
  if (!traceId) return;
  activeTraceId = traceId;
  traceReady = true;
  diagnosticTraceIdEl.textContent = `Trace ${traceId}`;
  const queued = pendingFrontendEvents;
  pendingFrontendEvents = [];
  await Promise.all(queued.map((event) => persistFrontendEvent(traceId, event)));
  startTracePolling();
}

function startTracePolling(): void {
  stopTracePolling();
  if (!activeTraceId || !traceReady) return;
  void refreshDiagnosticTrace();
  tracePollTimer = setInterval(() => void refreshDiagnosticTrace(), 500);
}

function stopTracePolling(): void {
  if (tracePollTimer) clearInterval(tracePollTimer);
  tracePollTimer = undefined;
}

async function refreshDiagnosticTrace(): Promise<void> {
  if (!activeTraceId || !traceReady) return;
  try {
    const response = await fetch(`/api/diagnostics/traces/${encodeURIComponent(activeTraceId)}`);
    if (!response.ok) return;
    const parsed = authenticationTraceSchema.safeParse(await response.json());
    if (!parsed.success) return;
    renderDiagnosticTrace(parsed.data);
    if (parsed.data.outcome !== 'in_progress') {
      stopTracePolling();
      diagnosticLevelSelect.disabled = false;
    }
  } catch (error) {
    console.error('Could not refresh the diagnostic trace.', error);
  }
}

function renderDiagnosticTrace(trace: AuthenticationTrace): void {
  debugOutput.textContent = JSON.stringify(trace, null, 2);
  renderKeyValues(traceSummary, [
    { key: 'traceId', value: trace.id },
    { key: 'flowId', value: trace.flowId ?? EM_DASH },
    { key: 'source', value: trace.source ?? EM_DASH },
    { key: 'level', value: trace.level },
    { key: 'startedAt', value: formatClockTime(trace.startedAt) },
    { key: 'completedAt', value: trace.completedAt ? formatClockTime(trace.completedAt) : EM_DASH },
    { key: 'duration', value: traceDuration(trace) },
    {
      key: 'outcome',
      value: trace.outcome,
      tone: trace.outcome === 'succeeded' ? 'is-ok' : trace.outcome === 'failed' ? 'is-bad' : undefined,
    },
    { key: 'artifacts', value: String(trace.artifacts.length) },
  ]);
  renderTraceEvents(trace.events.map((event) => ({
    key: event.id,
    timestamp: event.timestamp,
    tier: event.tier,
    operation: event.operation,
    phase: event.phase,
    message: event.message,
    raw: event,
  })));
}

function renderLocalDiagnostics(): void {
  debugOutput.textContent = JSON.stringify({
    traceId: activeTraceId,
    status: traceReady ? 'persisting' : 'waiting_for_backend_trace',
    frontendEvents: localFrontendEvents,
  }, null, 2);
  renderKeyValues(traceSummary, [
    { key: 'traceId', value: activeTraceId ?? EM_DASH },
    { key: 'status', value: traceReady ? 'persisting' : 'waiting for backend trace' },
    { key: 'level', value: diagnosticLevel },
  ]);
  renderTraceEvents(localFrontendEvents.map((event, index) => ({
    key: `local:${index}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    tier: 'frontend',
    operation: event.operation,
    phase: event.phase,
    message: event.message,
    raw: event,
  })));
}

function traceDuration(trace: AuthenticationTrace): string {
  if (!trace.completedAt) return 'in progress';
  const elapsed = Date.parse(trace.completedAt) - Date.parse(trace.startedAt);
  return Number.isNaN(elapsed) ? EM_DASH : `${(elapsed / 1000).toFixed(3)} s`;
}

/** One ledger row per trace event; the full event JSON stays behind its own disclosure. */
function renderTraceEvents(events: LedgerEvent[]): void {
  traceEventsCount.textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  const signature = events.map((event) => `${event.key}|${event.phase}|${event.message}`).join('~');
  if (signature === renderedTraceSignature) return;
  renderedTraceSignature = signature;
  traceEvents.innerHTML = '';

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'trace-empty';
    empty.textContent = 'No events captured yet.';
    traceEvents.appendChild(empty);
    return;
  }

  for (const event of events) traceEvents.appendChild(buildTraceEvent(event));
}

function buildTraceEvent(event: LedgerEvent): HTMLDetailsElement {
  const container = document.createElement('details');
  container.className = 'trace-event';
  container.open = expandedTraceEvents.has(event.key);
  container.addEventListener('toggle', () => {
    if (container.open) expandedTraceEvents.add(event.key);
    else expandedTraceEvents.delete(event.key);
  });

  const summary = document.createElement('summary');

  const timestamp = document.createElement('span');
  timestamp.className = 'ev-ts';
  timestamp.textContent = formatClockTime(event.timestamp);

  const main = document.createElement('span');
  main.className = 'ev-main';
  const operation = document.createElement('span');
  operation.className = 'ev-op';
  operation.textContent = event.operation;
  const message = document.createElement('span');
  message.className = 'ev-msg';
  message.textContent = event.message;
  main.append(operation, message);

  const tier = document.createElement('span');
  tier.className = 'ev-tier';
  tier.textContent = event.tier;

  const phase = document.createElement('span');
  phase.className = `ev-res is-${event.phase}`;
  phase.textContent = event.phase;

  const chevron = document.createElement('span');
  chevron.className = 'ev-chev';
  chevron.innerHTML = CHEVRON_SVG;

  summary.append(timestamp, main, tier, phase, chevron);

  const json = document.createElement('pre');
  json.textContent = JSON.stringify(event.raw, null, 2);

  container.append(summary, json);
  return container;
}

function renderKeyValues(target: HTMLElement, rows: KeyValueRow[]): void {
  target.innerHTML = '';
  for (const row of rows) {
    const line = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = row.key;
    const value = document.createElement('dd');
    value.textContent = row.value;
    if (row.tone) value.className = row.tone;
    line.append(term, value);
    target.appendChild(line);
  }
}

function formatClockTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString().slice(11, 23);
}

function renderCapabilityProbe(support: { ok: boolean; reason?: string }): void {
  const credentialsGet = 'credentials' in navigator && typeof navigator.credentials?.get === 'function';
  const digitalCredential = 'DigitalCredential' in window;
  renderKeyValues(capabilityProbe, [
    {
      key: 'isSecureContext',
      value: window.isSecureContext ? 'true' : 'false',
      tone: window.isSecureContext ? 'is-ok' : 'is-bad',
    },
    {
      key: 'navigator.credentials.get',
      value: credentialsGet ? 'available' : 'missing',
      tone: credentialsGet ? 'is-ok' : 'is-bad',
    },
    {
      key: 'DigitalCredential',
      value: digitalCredential ? 'exposed' : 'missing',
      tone: digitalCredential ? 'is-ok' : 'is-bad',
    },
    {
      key: 'wallet invocation',
      value: support.ok ? 'ready' : 'unavailable',
      tone: support.ok ? 'is-ok' : 'is-bad',
    },
  ]);
}

function updateClaimCount(): void {
  claimCount.textContent = `${selectedClaims().length} of ${AVAILABLE_CLAIMS.length} selected`;
}

/** Claims the holder actually disclosed, as recorded on the account by the verifier. */
function renderDisclosedClaims(account: Account): void {
  const entries = Object.entries(account.verifiedClaims ?? {});
  disclosedClaims.classList.toggle('hidden', entries.length === 0);
  if (entries.length === 0) return;
  disclosedClaimsCount.textContent = `${entries.length} ${entries.length === 1 ? 'claim' : 'claims'}`;
  renderKeyValues(disclosedClaimsList, entries.map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    tone: value === true ? 'is-ok' as const : undefined,
  })));
}

async function initializeDiagnostics(): Promise<void> {
  try {
    const response = await fetch('/api/diagnostics/config');
    const parsed = diagnosticCapabilitiesSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) return;
    diagnosticCapabilities = parsed.data;
  } catch {
    return;
  }

  if (!diagnosticCapabilities.debugUiEnabled) return;
  diagnosticControls.classList.remove('hidden');
  diagnosticPanel.classList.remove('hidden');
  const stored = diagnosticLevelSchema.safeParse(sessionStorage.getItem('openid4vp.diagnosticLevel'));
  diagnosticLevel = stored.success && diagnosticCapabilities.availableLevels.includes(stored.data)
    ? stored.data
    : 'info';
  diagnosticLevelSelect.value = diagnosticLevel;
  diagnosticCapabilitiesEl.textContent = diagnosticCapabilities.captureCredentialArtifacts
    ? 'DEBUG includes persistent credential artifacts.'
    : 'Credential artifact capture is disabled by the backend.';
}

function digitalCredentialSupport(): { ok: boolean; reason?: string } {
  if (!window.isSecureContext) {
    return { ok: false, reason: 'This page is not a secure context. Open it over HTTPS on the phone.' };
  }
  if (!('credentials' in navigator) || typeof navigator.credentials?.get !== 'function') {
    return { ok: false, reason: 'navigator.credentials.get() is not available in this browser.' };
  }
  const DigitalCredentialCtor = (window as unknown as { DigitalCredential?: { userAgentAllowsProtocol?: (protocol: string) => boolean } }).DigitalCredential;
  if (!DigitalCredentialCtor) {
    return { ok: false, reason: 'DigitalCredential is not exposed by this browser.' };
  }
  return { ok: true };
}

function selectedClaims(): ClaimName[] {
  const selected = new Set(
    claimInputs.filter((input) => input.checked).map((input) => input.dataset.claim as ClaimName),
  );
  return AVAILABLE_CLAIMS.filter((claim) => selected.has(claim));
}

function selectedProtocol(): OpenId4VpRequestProtocol {
  return signedProtocolInput.checked ? 'openid4vp-v1-signed' : 'openid4vp-v1-unsigned';
}

function digitalRequest(request: BackendAuthRequest): DigitalCredentialsRequest {
  return { protocol: request.protocol, data: request.data };
}

function setConfigurationDisabled(disabled: boolean) {
  claimSelection.disabled = disabled;
  claimSelection.classList.toggle('is-disabled', disabled);
  signedProtocolInput.disabled = disabled;
}

function resetFlowProgress() {
  flowProgress.classList.remove('hidden');
  for (const element of flowStepElements.values()) {
    element.classList.remove('is-active', 'is-complete', 'is-error');
    element.removeAttribute('aria-current');
  }
  for (const step of FLOW_STEPS) {
    flowStepElements.get(step)!.querySelector('small')!.textContent = flowStepDefaultDetails.get(step)!;
  }
  progressCount.textContent = `0 of ${FLOW_STEPS.length}`;
}

function setFlowStep(step: FlowStep, state: 'active' | 'complete' | 'error', detail?: string) {
  const element = flowStepElements.get(step)!;
  element.classList.remove('is-active', 'is-complete', 'is-error');
  element.classList.add(`is-${state}`);
  if (state === 'active') element.setAttribute('aria-current', 'step');
  else element.removeAttribute('aria-current');
  if (detail) element.querySelector('small')!.textContent = detail;
  const completed = Array.from(flowStepElements.values()).filter((item) => item.classList.contains('is-complete')).length;
  progressCount.textContent = `${completed} of ${FLOW_STEPS.length}`;
  recordFrontendEvent({
    level: 'info',
    operation: `frontend.flow.${step}`,
    phase: state === 'active' ? 'start' : state === 'complete' ? 'success' : 'failure',
    message: detail ?? element.querySelector('small')!.textContent ?? `${step}: ${state}`,
  });
}

function refreshSampleFallback() {
  const visible = shouldOfferSampleCredential({
    hasPreparedFlow: preparedRequest !== null,
    browserApiAvailable,
    browserProtocolAllowed: preparedRequest ? browserAllowsProtocol(preparedRequest.protocol) : true,
    credentialRequestRejected,
  });
  sampleFallbackPanel.classList.toggle('hidden', !visible);
  if (visible) refreshSampleCredentialButton();
}

function hideSampleFallback() {
  sampleFallbackPanel.classList.add('hidden');
  clearSampleUploads();
}

function refreshSampleCredentialButton() {
  sampleCredentialButton.disabled = sampleContext === null || sampleResponse === null;
}

/** Drops the uploaded credential from memory so it never outlives the attempt that used it. */
function clearSampleUploads() {
  sampleContext = null;
  sampleResponse = null;
  sampleContextInput.value = '';
  sampleResponseInput.value = '';
  setUploadStatus(sampleContextStatus, SAMPLE_CONTEXT_HINT, 'hint');
  setUploadStatus(sampleResponseStatus, SAMPLE_RESPONSE_HINT, 'hint');
  refreshSampleCredentialButton();
}

function setUploadStatus(element: HTMLElement, message: string, kind: 'hint' | 'ready' | 'error') {
  element.textContent = message;
  element.className = `sample-upload-status is-${kind}`;
}

async function readSampleUpload<T>(
  input: HTMLInputElement,
  status: HTMLElement,
  schema: ZodType<T>,
  hint: string,
): Promise<T | null> {
  const file = input.files?.[0];
  if (!file) {
    setUploadStatus(status, hint, 'hint');
    return null;
  }
  if (file.size > MAX_SAMPLE_UPLOAD_BYTES) {
    setUploadStatus(status, `${file.name} is larger than ${MAX_SAMPLE_UPLOAD_BYTES / 1024} KB.`, 'error');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    setUploadStatus(status, `${file.name} is not valid JSON.`, 'error');
    return null;
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const [issue] = validated.error.issues;
    const path = issue?.path.join('.');
    setUploadStatus(
      status,
      `${file.name} does not match the expected shape${path ? ` (${path}: ${issue.message})` : ''}.`,
      'error',
    );
    return null;
  }

  setUploadStatus(status, `${file.name} loaded.`, 'ready');
  return validated.data;
}

function browserAllowsProtocol(protocol: string): boolean {
  const DigitalCredentialCtor = (window as unknown as { DigitalCredential?: { userAgentAllowsProtocol?: (value: string) => boolean } }).DigitalCredential;
  return DigitalCredentialCtor?.userAgentAllowsProtocol?.(protocol) ?? true;
}

function isVpTokenResponse(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).vp_token === 'object'
    && (value as Record<string, unknown>).vp_token !== null;
}

function isHolderCancellation(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  return name === 'NotAllowedError' || name === 'AbortError';
}

function restoreSignInControls() {
  setConfigurationDisabled(false);
  continueButton.disabled = selectedClaims().length === 0;
  retryButton.classList.remove('hidden');
}

async function invokeDigitalCredential() {
  const claims = selectedClaims();
  if (claims.length === 0) {
    setStatus('Select at least one claim before starting the presentation request.', 'error');
    return;
  }

  preparedRequest = null;
  beginDiagnosticTrace();
  continueButton.disabled = true;
  retryButton.classList.add('hidden');
  credentialRequestRejected = false;
  hideSampleFallback();
  setConfigurationDisabled(true);
  resetFlowProgress();
  setFlowStep('request_preparation', 'active');
  setStatus('Preparing the OpenID4VP authorization request on the backend…', 'pending');

  try {
    preparedRequest = await api('/api/auth/email/request', prepareAuthResponseSchema, {
      claims,
      protocol: selectedProtocol(),
    });
    await activateDiagnosticTrace(preparedRequest.trace_id ?? activeTraceId);
  } catch (error) {
    await activateDiagnosticTrace(activeTraceId);
    setFlowStep('request_preparation', 'error', 'The backend could not create the authorization request.');
    setStatus(`Authorization request preparation failed: ${errorMessage(error)}`, 'error');
    writeDebug({ stage: 'request_preparation_failed', error: extractError(error) });
    restoreSignInControls();
    return;
  }

  const authRequest = preparedRequest;
  const request = digitalRequest(authRequest);
  requestJsonPreview.value = JSON.stringify(request, null, 2);
  setFlowStep('request_preparation', 'complete');
  writeDebug({
    stage: 'authorization_request_prepared',
    selected_claims: claims,
    flow_id: authRequest.flow_id,
    expires_at: authRequest.expires_at,
    request,
  });

  if (!browserApiAvailable || !browserAllowsProtocol(authRequest.protocol)) {
    const reason = browserApiAvailable
      ? `The browser does not allow ${authRequest.protocol}.`
      : browserSupportReason ?? 'The Digital Credentials API is unavailable.';
    setFlowStep('wallet_invocation', 'error', reason);
    setStatus(`The authorization request is ready, but wallet invocation is unavailable: ${reason}`, 'error');
    credentialRequestRejected = true;
    restoreSignInControls();
    refreshSampleFallback();
    return;
  }

  let credential: Credential | null;
  try {
    setFlowStep('wallet_invocation', 'active');
    setStatus('Invoking the wallet through the browser Digital Credentials API…', 'pending');
    const credentialPromise = navigator.credentials.get({
      digital: {
        requests: [request],
      },
    } as CredentialRequestOptions & { digital: unknown });
    setFlowStep('wallet_invocation', 'complete');
    setFlowStep('holder_consent', 'active');
    setStatus('Waiting for holder credential selection and disclosure consent…', 'pending');
    credential = await credentialPromise;
  } catch (error) {
    const details = extractError(error);
    const cancelled = isHolderCancellation(error);
    setFlowStep(
      cancelled ? 'holder_consent' : 'wallet_invocation',
      'error',
      cancelled ? 'The holder declined or cancelled the presentation request.' : errorMessage(error),
    );
    setStatus(cancelled ? 'Credential sharing was declined or cancelled.' : errorMessage(error), 'error');
    writeDebug({
      stage: 'digital_credentials_api_failed',
      holder_cancelled: cancelled,
      backend_verify_called: false,
      error: details,
    });
    credentialRequestRejected = true;
    restoreSignInControls();
    refreshSampleFallback();
    return;
  }

  const raw = credential ? (credential as unknown as { data?: unknown }).data : undefined;
  await captureFrontendArtifact('browser.digital_credential_data', raw ?? null);
  writeDebug({
    stage: 'credential_received',
    browser_credential_data: raw ?? null,
  });

  if (!credential || !raw || !isVpTokenResponse(raw)) {
    const walletError = typeof raw === 'object' && raw !== null && 'error' in raw
      ? String((raw as { error?: unknown }).error)
      : null;
    const error = new Error(walletError
      ? `Wallet returned OpenID4VP error: ${walletError}`
      : credential && raw ? 'The authorization response did not contain a VP token.' : 'The browser returned no credential.');
    setFlowStep('holder_consent', 'complete');
    setFlowStep('vp_token_received', 'error', error.message);
    setStatus(error.message, 'error');
    writeDebug({
      stage: 'credential_received',
      backend_verify_called: false,
      browser_credential_data: raw ?? null,
      error: extractError(error),
    });
    restoreSignInControls();
    return;
  }

  setFlowStep('holder_consent', 'complete');
  setFlowStep('vp_token_received', 'complete');
  setFlowStep('presentation_verification', 'active');
  setStatus('VP token received. Verifying the presentation on the backend…', 'pending');

  let result: VerifyResult;
  try {
    result = await api('/api/auth/email/verify', verifyResultSchema, {
      flow_id: authRequest.flow_id,
      response: raw,
    });
  } catch (error) {
    setFlowStep('presentation_verification', 'error', errorMessage(error));
    setStatus(errorMessage(error), 'error');
    writeDebug({
      stage: 'backend_verification_failed',
      backend_verify_called: true,
      result: error instanceof ApiError ? error.result : { error: extractError(error) },
    });
    restoreSignInControls();
    return;
  }

  setFlowStep('presentation_verification', 'complete');
  setFlowStep('verification_complete', 'complete');
  handleVerificationResult(result, authRequest);
}

async function invokeSampleCredential() {
  const authRequest = preparedRequest;
  if (!authRequest) {
    setStatus('No prepared request is available. Prepare a new request before using the sample.', 'error');
    retryButton.classList.remove('hidden');
    return;
  }
  const context = sampleContext;
  const response = sampleResponse;
  if (!context || !response) {
    setStatus('Upload both the sample context and response files before using the sample credential.', 'error');
    return;
  }

  sampleCredentialButton.disabled = true;
  diagnosticLevelSelect.disabled = Boolean(activeTraceId);
  if (activeTraceId) startTracePolling();
  continueButton.disabled = true;
  resetFlowProgress();
  setFlowStep('request_preparation', 'complete', 'Using the existing backend transaction and the uploaded sample.');
  setFlowStep('wallet_invocation', 'complete', 'Browser wallet invocation bypassed by the explicit demo fallback.');
  setFlowStep('holder_consent', 'complete', 'The user explicitly selected the sample credential fallback.');
  setFlowStep('vp_token_received', 'complete', 'The uploaded sample VP token was submitted to the backend.');
  setFlowStep('presentation_verification', 'active');
  setStatus('Cryptographically verifying the uploaded sample credential…', 'pending');
  writeDebug({
    stage: 'sample_verification_started',
    credential_source: 'sample',
    flow_id: authRequest.flow_id,
  });

  try {
    const result = await api('/api/auth/email/verify-sample', verifyResultSchema, {
      flow_id: authRequest.flow_id,
      context,
      response,
    });
    setFlowStep('presentation_verification', 'complete');
    setFlowStep('verification_complete', 'complete');
    handleVerificationResult(result, authRequest);
  } catch (error) {
    setFlowStep('presentation_verification', 'error', errorMessage(error));
    setStatus(`Sample credential verification failed: ${errorMessage(error)}`, 'error');
    writeDebug({
      stage: 'sample_verification_failed',
      credential_source: 'sample',
      result: error instanceof ApiError ? error.result : { error: extractError(error) },
    });
    refreshSampleCredentialButton();
    restoreSignInControls();
  }
}

function handleVerificationResult(result: VerifyResult, authRequest: BackendAuthRequest) {
  writeDebug({
    stage: 'backend_verification_completed',
    backend_verify_called: true,
    credential_source: result.source,
    result,
  });
  if (preparedRequest === authRequest) preparedRequest = null;
  credentialRequestRejected = false;
  hideSampleFallback();

  if (result.status === 'profile_required') {
    signupToken = result.signup_token;
    emailInput.value = result.profile.email;
    displayNameInput.value = result.profile.name ?? '';
    givenNameInput.value = result.profile.given_name ?? '';
    familyNameInput.value = result.profile.family_name ?? '';
    pictureInput.value = result.profile.picture ?? '';
    hostedDomainInput.value = result.profile.hd ?? '';
    hostedDomainField.classList.toggle('hidden', !result.profile.hd);
    jobTitleInput.value = '';
    companyInput.value = '';
    profilePanel.classList.remove('hidden');
    continueButton.classList.add('hidden');
    retryButton.classList.add('hidden');
    setStatus(`Verified email received in ${result.source} mode. Confirm the profile to create the account.`, 'success');
    return;
  }

  const displayName = accountDisplayName(result.account);
  showSuccess(`Welcome back, ${displayName}`, result.account, result.source, {
    previousSignInAt: result.previous_sign_in_at,
    activity: result.activity,
  });
}

function extractError(error: unknown): Record<string, unknown> {
  const candidate = typeof error === 'object' && error !== null
    ? error as Record<string, unknown> & { constructor?: { name?: unknown } }
    : null;
  const details: Record<string, unknown> = {
    constructor: typeof candidate?.constructor?.name === 'string' ? candidate.constructor.name : typeof error,
    name: typeof candidate?.name === 'string' ? candidate.name : 'Error',
    message: typeof candidate?.message === 'string' ? candidate.message : String(error),
  };

  for (const property of ['code', 'url', 'stack'] as const) {
    const value = candidate?.[property];
    if (value !== undefined) details[property] = value;
  }
  return details;
}

function errorMessage(error: unknown): string {
  const details = extractError(error);
  const name = typeof details.name === 'string' ? details.name : 'Error';
  const message = typeof details.message === 'string' ? details.message : 'Unknown error';
  return name === 'Error' || name === 'ApiError' ? message : `${name}: ${message}`;
}

function showSuccess(
  title: string,
  account: Account,
  source: CredentialSource,
  returningUser?: { previousSignInAt?: string; activity: SignInActivity[] },
) {
  profilePanel.classList.add('hidden');
  continueButton.classList.add('hidden');
  retryButton.classList.add('hidden');
  successPanel.classList.remove('hidden');
  successTitle.textContent = title;
  welcomeMessage.textContent = returningUser
    ? returningUser.previousSignInAt
      ? `We haven't seen you since ${formatDateTime(returningUser.previousSignInAt)}.`
      : 'Welcome back. No earlier sign-in timestamp is available for this account.'
    : 'Your verified presentation has been linked to your new account.';
  accountCard.innerHTML = '';

  if (account.picture) {
    const img = document.createElement('img');
    img.src = account.picture;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    accountCard.appendChild(img);
  } else {
    const monogram = document.createElement('div');
    monogram.className = 'account-monogram';
    monogram.textContent = accountInitials(account);
    accountCard.appendChild(monogram);
  }

  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = accountDisplayName(account);
  const email = document.createElement('span');
  email.textContent = account.email;
  text.append(strong, email);
  if (account.jobTitle || account.company) {
    const profile = document.createElement('span');
    profile.textContent = [account.jobTitle, account.company].filter(Boolean).join(' at ');
    text.appendChild(profile);
  }
  accountCard.appendChild(text);
  activityReport.classList.add('hidden');
  activityToggle.setAttribute('aria-expanded', 'false');
  activityToggle.textContent = 'View your OPENID4VP sign-in activity';
  activityToggle.classList.toggle('hidden', !returningUser);
  renderDisclosedClaims(account);
  if (returningUser) renderActivityReport(returningUser.activity);
  setStatus(`Authentication flow completed successfully in ${source} mode.`, 'success');
  void refreshDiagnosticTrace();
}

function accountInitials(account: Account): string {
  const source = accountDisplayName(account);
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join('');
  return (letters || source.slice(0, 2)).toUpperCase();
}

function accountDisplayName(account: Account): string {
  return account.name
    || [account.givenName, account.familyName].filter(Boolean).join(' ')
    || account.email;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function renderActivityReport(activity: SignInActivity[]) {
  activityList.innerHTML = '';
  activityCount.textContent = `${activity.length} ${activity.length === 1 ? 'sign-in' : 'sign-ins'}`;

  for (const entry of activity) {
    const item = document.createElement('li');
    const summary = document.createElement('div');
    summary.className = 'activity-summary';

    const timestamp = document.createElement('strong');
    timestamp.textContent = formatDateTime(entry.occurredAt);
    const source = document.createElement('span');
    source.textContent = entry.source === 'sample' ? 'Sample credential' : 'Wallet credential';
    summary.append(timestamp, source);

    const details = document.createElement('p');
    const accountStatus = entry.attributes.account_status === 'new' ? 'Account created' : 'Existing account';
    details.textContent = `${accountStatus} · ${entry.email}`;
    item.append(summary, details);
    if (entry.traceId && diagnosticCapabilities.debugUiEnabled) {
      const traceButton = document.createElement('button');
      traceButton.type = 'button';
      traceButton.className = 'activity-trace';
      traceButton.textContent = 'View diagnostic trace';
      traceButton.addEventListener('click', () => {
        activeTraceId = entry.traceId;
        traceReady = true;
        diagnosticPanel.open = true;
        diagnosticTraceIdEl.textContent = `Trace ${entry.traceId}`;
        void refreshDiagnosticTrace();
      });
      item.appendChild(traceButton);
    }
    activityList.appendChild(item);
  }
}

signedProtocolInput.addEventListener('change', () => {
  if (!signedProtocolInput.checked) return;
  protocolNotice.classList.remove('hidden');
  signedProtocolInput.checked = false;
  protocolValue.textContent = 'openid4vp-v1-unsigned';
  setStatus('Signed verifier requests are not supported yet. The unsigned request type remains selected.', 'ready');
});

for (const input of claimInputs) {
  input.addEventListener('change', () => {
    const hasClaims = selectedClaims().length > 0;
    continueButton.disabled = !hasClaims;
    updateClaimCount();
    if (!hasClaims) setStatus('Select at least one claim to create a DCQL query.', 'error');
    else setStatus('Request options updated. Start sign-in when ready.', 'ready');
  });
}

activityToggle.addEventListener('click', () => {
  const willOpen = activityReport.classList.contains('hidden');
  activityReport.classList.toggle('hidden', !willOpen);
  activityToggle.setAttribute('aria-expanded', String(willOpen));
  activityToggle.textContent = willOpen
    ? 'Hide OPENID4VP sign-in activity'
    : 'View your OPENID4VP sign-in activity';
});

diagnosticLevelSelect.addEventListener('change', () => {
  const parsed = diagnosticLevelSchema.safeParse(diagnosticLevelSelect.value);
  if (!parsed.success || !diagnosticCapabilities.availableLevels.includes(parsed.data)) return;
  diagnosticLevel = parsed.data;
  sessionStorage.setItem('openid4vp.diagnosticLevel', diagnosticLevel);
  diagnosticTraceIdEl.textContent = diagnosticLevel === 'off'
    ? 'Diagnostics are off'
    : `Next flow will capture ${diagnosticLevel.toUpperCase()} events`;
});

diagnosticRefreshButton.addEventListener('click', () => {
  void refreshDiagnosticTrace();
});

continueButton.addEventListener('click', () => {
  void invokeDigitalCredential();
});

sampleContextInput.addEventListener('change', () => {
  void (async () => {
    sampleContext = await readSampleUpload(
      sampleContextInput,
      sampleContextStatus,
      sampleCredentialContextSchema,
      SAMPLE_CONTEXT_HINT,
    );
    refreshSampleCredentialButton();
  })();
});

sampleResponseInput.addEventListener('change', () => {
  void (async () => {
    sampleResponse = await readSampleUpload(
      sampleResponseInput,
      sampleResponseStatus,
      sampleCredentialResponseSchema,
      SAMPLE_RESPONSE_HINT,
    );
    refreshSampleCredentialButton();
  })();
});

sampleCredentialButton.addEventListener('click', () => {
  void invokeSampleCredential();
});

retryButton.addEventListener('click', () => {
  void invokeDigitalCredential();
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signupToken) return;

  const submit = profileForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.disabled = true;
  setStatus('Creating the account…', 'pending');

  try {
    const result = await api('/api/auth/email/signup', completeSignupResponseSchema, {
      signup_token: signupToken,
      name: displayNameInput.value.trim(),
      given_name: givenNameInput.value.trim(),
      family_name: familyNameInput.value.trim(),
      picture: pictureInput.value.trim(),
      job_title: jobTitleInput.value.trim(),
      company: companyInput.value.trim(),
    });
    await activateDiagnosticTrace(result.trace_id ?? activeTraceId);
    signupToken = null;
    writeDebug({ stage: 'signup_completed', result });
    showSuccess('Account created', result.account, result.source);
  } catch (error) {
    setStatus(errorMessage(error), 'error');
    submit.disabled = false;
  }
});

/**
 * Swaps the static SVG backdrop for the live wave field. Left alone when the browser cannot run
 * WebGL2, or when the visitor asked for reduced motion: the SVG in the markup is the fallback.
 */
function startBackground(): void {
  const backdrop = document.querySelector<HTMLElement>('.bg');
  const host = document.querySelector<HTMLElement>('#bg-waves');
  if (!backdrop || !host) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const narrow = window.matchMedia('(max-width: 720px)').matches;
  const teardown = createGradientWaves(host, {
    // The far field is almost entirely horizonColor, so a dark horizon renders the whole effect
    // invisible against the page. A near-white crest blows the near band out instead, so the
    // crest stays a mid azure and brightness does the lifting.
    // Wide colour separation between wave body and crest is what gives the ridges definition;
    // a light wave colour flattens them into a wash.
    horizonColor: '#6b4712',
    waveColor: '#a85f10',
    crestColor: '#ffd06a',
    speed: 0.26,
    amplitude: 3.4,
    waveScale: 1.3,
    waveRatio: 0.9,
    swell: 40,
    turbulence: 24,
    tilt: 1.14,
    zoom: 1,
    height: 5.5,
    // fogDepth this high clamps the whole near field to fully opaque, which flattens the bottom
    // of the frame into a single wash. Keep it short enough that near crests still fall off.
    fogDepth: 22,
    detail: narrow ? 'low' : 'medium',
    brightness: 2.3,
    opacity: 1,
    mouseInteraction: !narrow,
    parallaxStrength: 0.55,
    grain: true,
    grainIntensity: 0.04,
  });

  if (!teardown) return;
  backdrop.classList.add('has-webgl');
  window.addEventListener('pagehide', teardown, { once: true });
}

startBackground();

const support = digitalCredentialSupport();
browserApiAvailable = support.ok;
browserSupportReason = support.reason;
renderCapabilityProbe(support);
updateClaimCount();
continueButton.disabled = selectedClaims().length === 0;
if (!support.ok) {
  setStatus(`You can prepare a request, but this browser cannot invoke a wallet: ${support.reason}`, 'ready');
}
void initializeDiagnostics();
