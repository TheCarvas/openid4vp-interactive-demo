import { z } from 'zod';

export const diagnosticLevelSchema = z.enum(['off', 'info', 'debug']);
export type DiagnosticLevel = z.infer<typeof diagnosticLevelSchema>;

export const diagnosticEventLevelSchema = z.enum(['info', 'debug']);
export const diagnosticTierSchema = z.enum(['frontend', 'backend']);
export const diagnosticPhaseSchema = z.enum(['start', 'progress', 'success', 'failure']);

export const diagnosticEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  level: diagnosticEventLevelSchema,
  tier: diagnosticTierSchema,
  operation: z.string().min(1),
  phase: diagnosticPhaseSchema,
  message: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;

export const diagnosticEventInputSchema = diagnosticEventSchema.omit({
  id: true,
  timestamp: true,
  tier: true,
}).extend({
  timestamp: z.string().datetime().optional(),
}).strict();
export type DiagnosticEventInput = z.infer<typeof diagnosticEventInputSchema>;

export const credentialArtifactSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  tier: diagnosticTierSchema,
  name: z.string().min(1),
  mediaType: z.string().min(1),
  value: z.unknown(),
});
export type CredentialArtifact = z.infer<typeof credentialArtifactSchema>;

export const credentialArtifactInputSchema = z.object({
  name: z.string().min(1),
  mediaType: z.string().min(1).default('application/json'),
  value: z.unknown(),
}).strict();
export type CredentialArtifactInput = z.infer<typeof credentialArtifactInputSchema>;

export const authenticationTraceSchema = z.object({
  id: z.string().uuid(),
  flowId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  source: z.enum(['live', 'sample']).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  outcome: z.enum(['in_progress', 'succeeded', 'failed']),
  level: diagnosticEventLevelSchema,
  events: z.array(diagnosticEventSchema),
  artifacts: z.array(credentialArtifactSchema),
  failure: z.object({
    stage: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
});
export type AuthenticationTrace = z.infer<typeof authenticationTraceSchema>;

export const diagnosticCapabilitiesSchema = z.object({
  debugUiEnabled: z.boolean(),
  captureCredentialArtifacts: z.boolean(),
  availableLevels: z.array(diagnosticLevelSchema),
});
export type DiagnosticCapabilities = z.infer<typeof diagnosticCapabilitiesSchema>;
