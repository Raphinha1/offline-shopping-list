import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { getDatabaseUrl } from '../src/config/databaseUrl.js';
import { deviceSessions, pairingCodes } from '../src/domains/device-auth/schema.js';
import { createPairingCode, revokeDevice, revokeSession } from '../src/domains/device-auth/service.js';

const sourceUrl = new URL(getDatabaseUrl());
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)) throw new Error('Las pruebas requieren PostgreSQL local.');
const databaseName = `lista_test_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const admin = postgres(adminUrl.toString(), { max: 1 });
const client = postgres(testUrl.toString());
const db = drizzle(client);
const app = buildApp({ databaseUrl: testUrl.toString() });

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
});

afterAll(async () => {
  await app.close();
  await client.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
});

async function pair(code: string, name = 'Demo device') {
  return app.inject({ method: 'POST', url: '/api/device/pair', payload: { code, name } });
}

describe('vinculación de dispositivo', () => {
  it('protege los datos y permite solo health y estado de vinculación sin sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/device/session' })).statusCode).toBe(401);
    for (const [method, url] of [
      ['GET', '/api/categories'], ['GET', '/api/products'], ['GET', '/api/shopping-list'],
      ['GET', '/api/purchases/current'], ['POST', '/api/shopping-list/items'],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('DEVICE_UNAUTHORIZED');
    }
  });

  it('canjea un código válido una vez, crea cookie segura y persiste la sesión', async () => {
    const { code } = await createPairingCode(db);
    expect(code).toMatch(/^\d{6}$/);
    const [stored] = await db.select().from(pairingCodes);
    expect(stored.codeHash).not.toBe(code);
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);

    const linked = await pair(code);
    expect(linked.statusCode).toBe(201);
    const cookie = linked.headers['set-cookie'] as string;
    expect(cookie).toContain('__Host-hogar-session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    const requestCookie = cookie.split(';')[0];
    const status = await app.inject({ method: 'GET', url: '/api/device/session', headers: { cookie: requestCookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json().device.name).toBe('Demo device');
    expect((await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie: requestCookie } })).statusCode).toBe(200);
    const [session] = await db.select().from(deviceSessions);
    expect(session.tokenHash).not.toBe(requestCookie.split('=')[1]);

    const restarted = buildApp({ databaseUrl: testUrl.toString() });
    try {
      const afterRestart = await restarted.inject({ method: 'GET', url: '/api/device/session', headers: { cookie: requestCookie } });
      expect(afterRestart.statusCode).toBe(200);
    } finally {
      await restarted.close();
    }
    expect((await pair(code)).statusCode).toBe(400);
  });

  it('rechaza código incorrecto y expirado', async () => {
    const { code } = await createPairingCode(db);
    const wrong = code === '999999' ? '999998' : '999999';
    expect((await pair(wrong)).statusCode).toBe(400);
    expect((await pair(code)).statusCode).toBe(201);
    const expired = await createPairingCode(db, new Date(Date.now() - 11 * 60 * 1000));
    expect((await pair(expired.code)).statusCode).toBe(400);
  });

  it('bloquea el código tras cinco intentos fallidos y solo deja ganar a un canje simultáneo', async () => {
    const limited = await createPairingCode(db);
    const wrong = limited.code === '999999' ? '999998' : '999999';
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await pair(wrong)).statusCode).toBe(400);
    expect((await pair(limited.code)).statusCode).toBe(400);

    const concurrent = await createPairingCode(db);
    const responses = await Promise.all([pair(concurrent.code), pair(concurrent.code)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 400]);
  });

  it('revoca una sesión o el dispositivo y corta acceso de inmediato', async () => {
    const first = await createPairingCode(db);
    const firstLink = await pair(first.code, 'Tablet');
    const firstCookie = (firstLink.headers['set-cookie'] as string).split(';')[0];
    const [firstSession] = await db.select().from(deviceSessions)
      .where(eq(deviceSessions.deviceId, firstLink.json().device.id));
    expect(await revokeSession(db, firstSession.id)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/device/session', headers: { cookie: firstCookie } })).statusCode).toBe(401);

    const second = await createPairingCode(db);
    const secondLink = await pair(second.code, 'Teléfono');
    const secondCookie = (secondLink.headers['set-cookie'] as string).split(';')[0];
    expect(await revokeDevice(db, secondLink.json().device.id)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/shopping-list', headers: { cookie: secondCookie } })).statusCode).toBe(401);
  });

  it('rechaza mutaciones con Origin ajeno incluso si hay cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/device/pair',
      headers: { origin: 'https://sitio-ajeno.example' }, payload: { code: '123456', name: 'Otro' } });
    expect(response.statusCode).toBe(403);
  });
});
