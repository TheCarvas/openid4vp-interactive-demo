import type { Request } from 'express';
import { BadRequestError } from './errors.js';

export function requestOrigin(req: Request): string {
  const originHeader = req.get('origin');
  if (originHeader && originHeader !== 'null') return new URL(originHeader).origin;

  const forwardedProto = firstHeader(req.get('x-forwarded-proto'));
  const forwardedHost = firstHeader(req.get('x-forwarded-host'));
  const proto = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get('host');
  if (!host) throw new BadRequestError('Could not determine the verifier origin.');
  return new URL(`${proto}://${host}`).origin;
}

function firstHeader(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}
