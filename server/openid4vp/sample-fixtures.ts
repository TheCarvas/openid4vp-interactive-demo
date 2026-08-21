import type { JWK } from 'jose';
import {
  sampleCredentialContextSchema,
  sampleCredentialResponseSchema,
  type SampleCredentialContextInput,
  type SampleCredentialResponseInput,
} from '../../shared/contracts/auth.js';
import { HttpError } from '../http/errors.js';

export type SampleCredentialContext = Omit<SampleCredentialContextInput, 'issuerJwk'> & {
  issuerJwk: JWK;
};
export type SampleCredentialResponse = SampleCredentialResponseInput;
export type SampleCredentialFixtures = {
  context: SampleCredentialContext;
  response: SampleCredentialResponse;
};

/**
 * Validates the sample context/response documents supplied by the operator for this request.
 * Nothing is read from disk and nothing is retained: the demo fallback only ever verifies a
 * credential the caller uploaded themselves.
 */
export function parseSampleCredentialFixtures(input: {
  context: unknown;
  response: unknown;
}): SampleCredentialFixtures {
  const context = sampleCredentialContextSchema.safeParse(input.context);
  if (!context.success) {
    throw new SampleFixtureError(
      'The uploaded sample credential context is missing required fields.',
      context.error,
    );
  }
  const response = sampleCredentialResponseSchema.safeParse(input.response);
  if (!response.success) {
    throw new SampleFixtureError(
      'The uploaded sample credential response is missing required fields.',
      response.error,
    );
  }

  return {
    context: context.data as SampleCredentialContext,
    response: response.data,
  };
}

export class SampleFixtureError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(400, message, cause);
    this.name = 'SampleFixtureError';
  }
}
