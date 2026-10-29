import { Response } from 'express';
import { config } from '../config/env.js';

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(config.auth.sessionCookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.auth.sessionCookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

