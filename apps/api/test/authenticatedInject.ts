import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { createPairingCode, redeemPairingCode } from '../src/domains/device-auth/service.js';

export async function createTestDeviceCookie(db: Database) {
  const { code } = await createPairingCode(db);
  const session = await redeemPairingCode(db, code, 'Dispositivo de pruebas');
  if (!session) throw new Error('No se pudo vincular el dispositivo de pruebas.');
  return `__Host-hogar-session=${session.token}`;
}

type InjectOptions = Exclude<Parameters<FastifyInstance['inject']>[0], string>;

export function authenticatedInject(app: FastifyInstance, getCookie: () => string) {
  return (options: InjectOptions) => app.inject({
    ...options,
    headers: { ...options.headers, cookie: getCookie() },
  });
}
