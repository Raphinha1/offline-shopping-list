import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { findAuthorizedDevice, redeemPairingCode, sessionLifetimeSeconds } from './service.js';

const cookieName = '__Host-hogar-session';
const publicPaths = new Set(['/health', '/api/device/session', '/api/device/pair']);
const unauthorized = { error: { code: 'DEVICE_UNAUTHORIZED', message: 'Vincula este dispositivo para continuar.' } };
const invalidCode = { error: { code: 'INVALID_PAIRING_CODE', message: 'El código no es válido o ya expiró.' } };
const pairingInput = z.strictObject({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(80) });

function readSessionToken(cookieHeader: string | undefined) {
  const matches = cookieHeader?.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`)) ?? [];
  return matches.length === 1 ? matches[0].slice(cookieName.length + 1) : undefined;
}

function sameOrigin(origin: string | undefined, host: string | undefined) {
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function registerDeviceAuth(app: FastifyInstance, db: Database) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request.headers.origin, request.headers.host)) {
      return reply.code(403).send({ error: { code: 'INVALID_ORIGIN', message: 'Origen de solicitud no permitido.' } });
    }
    if (publicPaths.has(request.url.split('?')[0])) return;
    if (!request.url.startsWith('/api/')) return;
    const device = await findAuthorizedDevice(db, readSessionToken(request.headers.cookie));
    if (!device) return reply.code(401).send(unauthorized);
  });

  app.get('/api/device/session', async (request, reply) => {
    const device = await findAuthorizedDevice(db, readSessionToken(request.headers.cookie));
    return device ? { device } : reply.code(401).send(unauthorized);
  });

  app.post('/api/device/pair', async (request, reply) => {
    const parsed = pairingInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidCode);
    const result = await redeemPairingCode(db, parsed.data.code, parsed.data.name);
    if (!result) return reply.code(400).send(invalidCode);
    reply.header('Set-Cookie', `${cookieName}=${result.token}; Path=/; Max-Age=${sessionLifetimeSeconds}; HttpOnly; Secure; SameSite=Strict`);
    return reply.code(201).send({ device: result.device });
  });
}
