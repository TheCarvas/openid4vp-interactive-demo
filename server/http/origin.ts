import type { Request } from 'express';
import { BadRequestError } from './errors.js';

/**
 * The origin the verifier binds the flow to. When the app is configured with a
 * canonical `publicOrigin`, a request that resolves to anything else is
 * rejected rather than silently trusted: behind a hosting proxy the
 * `X-Forwarded-*` headers are attacker-controllable, and the resolved origin
 * becomes the OpenID4VP audience.
 */
export function requestOrigin(req: Request): string {
  const resolved = resolveOrigin(req);
  const expected = req.app.locals.publicOrigin as string | undefined;
  if (expected && resolved !== expected) {
    throw new BadRequestError(
      `Requests must be made against ${expected}, received ${resolved}.`,
    );
  }
  return resolved;
}

function resolveOrigin(req: Request): string {
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
