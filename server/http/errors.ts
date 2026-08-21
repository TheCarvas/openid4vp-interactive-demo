import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorResponse } from '../../shared/contracts/auth.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(400, message, cause);
    this.name = 'BadRequestError';
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const traceId = typeof res.locals.traceId === 'string' ? res.locals.traceId : undefined;
  if (error instanceof ZodError) {
    const response: ApiErrorResponse = {
      error: 'The API request does not match the expected contract.',
      details: error.flatten(),
      trace_id: traceId,
    };
    res.status(400).json(response);
    return;
  }

  if (error instanceof HttpError) {
    console.error('[request error]', error.cause ?? error);
    const response: ApiErrorResponse = { error: error.message, trace_id: traceId };
    res.status(error.status).json(response);
    return;
  }

  console.error('[unexpected error]', error);
  const response: ApiErrorResponse = { error: 'The server could not complete the request.', trace_id: traceId };
  res.status(500).json(response);
};
