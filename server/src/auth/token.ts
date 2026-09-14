import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

export function getOrCreateToken(filePath: string): string {
  try {
    const existing = readFileSync(filePath, 'utf8').trim();
    if (existing.length > 0) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(filePath, token, { mode: 0o600, flag: 'wx' });
    return token;
  } catch (err) {
    // Another process won the race and created it first (or it was an
    // empty file we're now overwriting) — re-read rather than trust our
    // own write blindly.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST' && existsSync(filePath)) {
      const winner = readFileSync(filePath, 'utf8').trim();
      if (winner.length > 0) return winner;
      // The file exists but is still empty — not a race winner, just a
      // pre-existing empty file. Populate it directly (no longer
      // exclusive, since we've established there's no real token to race
      // against). writeFileSync's `mode` option only applies to a file it
      // actually creates — since this file already exists, we must chmod
      // explicitly or the secret token would be left at the file's
      // existing (likely world/group-readable) permission bits.
      writeFileSync(filePath, token);
      chmodSync(filePath, 0o600);
      return token;
    }
    throw err;
  }
}

function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function tokenMiddleware(getToken: () => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.header('x-allay-token');
    if (!provided || !safeTokenEquals(provided, getToken())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return LOCAL_ORIGIN_PATTERN.test(origin);
}

export function isAllowedLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOST_PATTERN.test(host);
}

export function hostMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedLocalHost(req.header('host'))) {
      res.status(400).json({ error: 'bad host' });
      return;
    }
    next();
  };
}

export function verifyWsToken(getToken: () => string, req: IncomingMessage): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  const provided = url.searchParams.get('token');
  return provided !== null && safeTokenEquals(provided, getToken());
}
