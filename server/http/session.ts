import type { Response } from 'express';

export function setDemoSessionCookie(res: Response): void {
  res.cookie('demo_session', crypto.randomUUID(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000,
  });
}
