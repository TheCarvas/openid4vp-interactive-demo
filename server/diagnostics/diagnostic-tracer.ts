import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  authenticationTraceSchema,
  type AuthenticationTrace,
  type CredentialArtifactInput,
  type DiagnosticCapabilities,
  type DiagnosticEvent,
  type DiagnosticEventInput,
  type DiagnosticLevel,
} from '../../shared/contracts/diagnostics.js';
import type { CredentialSource } from '../../shared/contracts/auth.js';

type ActiveDiagnosticLevel = Exclude<DiagnosticLevel, 'off'>;

export type StartTraceInput = {
  id: string;
  flowId?: string;
  level: ActiveDiagnosticLevel;
  operation: string;
  message: string;
  data?: Record<string, unknown>;
};

export class DiagnosticTracer {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: {
    directory: string;
    debugUiEnabled: boolean;
    captureCredentialArtifacts: boolean;
  }) {}

  static disabled(): DiagnosticTracer {
    return new DiagnosticTracer({
      directory: '.',
      debugUiEnabled: false,
      captureCredentialArtifacts: false,
    });
  }

  capabilities(): DiagnosticCapabilities {
    return {
      debugUiEnabled: this.options.debugUiEnabled,
      captureCredentialArtifacts: this.options.debugUiEnabled && this.options.captureCredentialArtifacts,
      availableLevels: this.options.debugUiEnabled ? ['off', 'info', 'debug'] : ['off'],
    };
  }

  async startTrace(input: StartTraceInput): Promise<void> {
    if (!this.options.debugUiEnabled) return;
    await this.enqueue(input.id, async () => {
      if (await this.readTraceFile(input.id)) return;
      const timestamp = new Date().toISOString();
      const trace: AuthenticationTrace = {
        id: input.id,
        flowId: input.flowId,
        startedAt: timestamp,
        outcome: 'in_progress',
        level: input.level,
        events: [{
          id: randomUUID(),
          timestamp,
          level: 'info',
          tier: 'backend',
          operation: input.operation,
          phase: 'start',
          message: input.message,
          data: serializableRecord(input.data),
        }],
        artifacts: [],
      };
      await this.writeTraceFile(trace);
    });
  }

  async recordBackendEvent(traceId: string | undefined, event: DiagnosticEventInput): Promise<void> {
    await this.recordEvent(traceId, 'backend', event);
  }

  async recordFrontendEvent(traceId: string, event: DiagnosticEventInput): Promise<void> {
    await this.recordEvent(traceId, 'frontend', event);
  }

  async captureBackendArtifact(
    traceId: string | undefined,
    artifact: CredentialArtifactInput,
  ): Promise<void> {
    await this.captureArtifact(traceId, 'backend', artifact);
  }

  async captureFrontendArtifact(traceId: string, artifact: CredentialArtifactInput): Promise<void> {
    await this.captureArtifact(traceId, 'frontend', artifact);
  }

  async markFailed(traceId: string | undefined, stage: string, message: string): Promise<void> {
    if (!traceId) return;
    await this.mutate(traceId, (trace) => {
      trace.outcome = 'failed';
      trace.completedAt = new Date().toISOString();
      trace.failure = { stage, message };
    });
  }

  async markSucceeded(traceId: string | undefined, input: {
    accountId: string;
    activityId: string;
    source: CredentialSource;
  }): Promise<void> {
    if (!traceId) return;
    await this.mutate(traceId, (trace) => {
      trace.accountId = input.accountId;
      trace.activityId = input.activityId;
      trace.source = input.source;
      trace.outcome = 'succeeded';
      trace.completedAt = new Date().toISOString();
      delete trace.failure;
    });
  }

  async setSource(traceId: string | undefined, source: CredentialSource): Promise<void> {
    if (!traceId) return;
    await this.mutate(traceId, (trace) => {
      trace.source = source;
      if (trace.outcome === 'failed') {
        trace.outcome = 'in_progress';
        delete trace.completedAt;
        delete trace.failure;
      }
    });
  }

  async getTrace(traceId: string): Promise<AuthenticationTrace | undefined> {
    assertTraceId(traceId);
    const queued = this.queues.get(traceId);
    if (queued) await queued;
    return this.readTraceFile(traceId);
  }

  private async recordEvent(
    traceId: string | undefined,
    tier: DiagnosticEvent['tier'],
    event: DiagnosticEventInput,
  ): Promise<void> {
    if (!traceId) return;
    await this.mutate(traceId, (trace) => {
      if (event.level === 'debug' && trace.level !== 'debug') return;
      trace.events.push({
        id: randomUUID(),
        timestamp: event.timestamp ?? new Date().toISOString(),
        level: event.level,
        tier,
        operation: event.operation,
        phase: event.phase,
        message: event.message,
        data: serializableRecord(event.data),
      });
    });
  }

  private async captureArtifact(
    traceId: string | undefined,
    tier: DiagnosticEvent['tier'],
    artifact: CredentialArtifactInput,
  ): Promise<void> {
    if (!traceId || !this.options.captureCredentialArtifacts) return;
    await this.mutate(traceId, (trace) => {
      if (trace.level !== 'debug') return;
      trace.artifacts.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        tier,
        name: artifact.name,
        mediaType: artifact.mediaType,
        value: serializableValue(artifact.value),
      });
    });
  }

  private async mutate(traceId: string, update: (trace: AuthenticationTrace) => void): Promise<void> {
    if (!this.options.debugUiEnabled) return;
    await this.enqueue(traceId, async () => {
      const trace = await this.readTraceFile(traceId);
      if (!trace) return;
      update(trace);
      await this.writeTraceFile(trace);
    });
  }

  private async enqueue(traceId: string, action: () => Promise<void>): Promise<void> {
    assertTraceId(traceId);
    const previous = this.queues.get(traceId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(action)
      .catch((error) => {
        console.error('[diagnostics persistence error]', error);
      });
    this.queues.set(traceId, current);
    await current;
    if (this.queues.get(traceId) === current) this.queues.delete(traceId);
  }

  private async readTraceFile(traceId: string): Promise<AuthenticationTrace | undefined> {
    try {
      const value = JSON.parse(await readFile(this.tracePath(traceId), 'utf8')) as unknown;
      return authenticationTraceSchema.parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async writeTraceFile(trace: AuthenticationTrace): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    const destination = this.tracePath(trace.id);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private tracePath(traceId: string): string {
    assertTraceId(traceId);
    return join(this.options.directory, `${traceId}.json`);
  }
}

function assertTraceId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Diagnostic trace identifiers must be UUIDs.');
  }
}

function serializableRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value === undefined ? undefined : serializableValue(value) as Record<string, unknown>;
}

function serializableValue(value: unknown): unknown {
  const json = JSON.stringify(value, (_key, nested) => {
    if (nested instanceof Error) {
      return { name: nested.name, message: nested.message, stack: nested.stack };
    }
    if (typeof nested === 'bigint') return nested.toString();
    return nested;
  });
  return json === undefined ? null : JSON.parse(json) as unknown;
}
