import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { authorizedDevices, deviceSessions, pairingCodes } from './schema.js';

const pairingLifetimeMs = 10 * 60 * 1000;
export const sessionLifetimeSeconds = 365 * 24 * 60 * 60;
const maxPairingAttempts = 5;

function pairingHash(code: string, salt: string): Buffer {
  return scryptSync(code, Buffer.from(salt, 'hex'), 32);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPairingCode(db: Database, now = new Date()) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + pairingLifetimeMs);
  await db.insert(pairingCodes).values({ salt, codeHash: pairingHash(code, salt).toString('hex'), expiresAt });
  return { code, expiresAt };
}

export async function redeemPairingCode(db: Database, code: string, name: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const available = await tx.select().from(pairingCodes)
      .where(and(isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, now), lt(pairingCodes.attempts, maxPairingAttempts)))
      .orderBy(pairingCodes.createdAt).for('update');
    const suppliedHash = available.map((entry) => pairingHash(code, entry.salt));
    const match = available.find((entry, index) => timingSafeEqual(suppliedHash[index], Buffer.from(entry.codeHash, 'hex')));
    if (!match) {
      for (const entry of available) {
        await tx.update(pairingCodes).set({ attempts: sql`${pairingCodes.attempts} + 1` }).where(eq(pairingCodes.id, entry.id));
      }
      return null;
    }
    const [device] = await tx.insert(authorizedDevices).values({ name }).returning();
    const token = randomBytes(32).toString('base64url');
    await tx.insert(deviceSessions).values({
      deviceId: device.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(now.getTime() + sessionLifetimeSeconds * 1000),
    });
    await tx.update(pairingCodes).set({ usedAt: now }).where(eq(pairingCodes.id, match.id));
    return { token, device: { id: device.id, name: device.name } };
  });
}

export async function findAuthorizedDevice(db: Database, token: string | undefined, now = new Date()) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.select({ id: authorizedDevices.id, name: authorizedDevices.name })
    .from(deviceSessions).innerJoin(authorizedDevices, eq(deviceSessions.deviceId, authorizedDevices.id))
    .where(and(eq(deviceSessions.tokenHash, tokenHash(token)), isNull(deviceSessions.revokedAt),
      gt(deviceSessions.expiresAt, now), isNull(authorizedDevices.revokedAt)));
  return row ?? null;
}

export async function listDevices(db: Database) {
  const devices = await db.select().from(authorizedDevices).orderBy(authorizedDevices.createdAt);
  const sessions = await db.select({ id: deviceSessions.id, deviceId: deviceSessions.deviceId,
    createdAt: deviceSessions.createdAt, expiresAt: deviceSessions.expiresAt,
    revokedAt: deviceSessions.revokedAt }).from(deviceSessions).orderBy(deviceSessions.createdAt);
  return devices.map((device) => ({ ...device, sessions: sessions.filter((session) => session.deviceId === device.id) }));
}

export async function revokeDevice(db: Database, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [device] = await tx.update(authorizedDevices).set({ revokedAt: now })
      .where(and(eq(authorizedDevices.id, id), isNull(authorizedDevices.revokedAt))).returning({ id: authorizedDevices.id });
    if (!device) return false;
    await tx.update(deviceSessions).set({ revokedAt: now })
      .where(and(eq(deviceSessions.deviceId, id), isNull(deviceSessions.revokedAt)));
    return true;
  });
}

export async function revokeSession(db: Database, id: string, now = new Date()) {
  const [session] = await db.update(deviceSessions).set({ revokedAt: now })
    .where(and(eq(deviceSessions.id, id), isNull(deviceSessions.revokedAt))).returning({ id: deviceSessions.id });
  return Boolean(session);
}
