import { z } from 'zod';
import { getDatabaseUrl } from '../../config/databaseUrl.js';
import { createDatabase } from '../../db/client.js';
import { createPairingCode, listDevices, revokeDevice, revokeSession } from './service.js';

const [command, argument] = process.argv.slice(2);
const { client, db } = createDatabase(getDatabaseUrl());

try {
  if (command === 'code' && !argument) {
    const { code, expiresAt } = await createPairingCode(db);
    console.log(`Código de vinculación: ${code}\nVálido hasta: ${expiresAt.toISOString()}`);
  } else if (command === 'list' && !argument) {
    const devices = await listDevices(db);
    for (const device of devices) {
      console.log(`${device.id}  ${device.name}  ${device.revokedAt ? 'revocado' : 'activo'}  creado ${device.createdAt.toISOString()}`);
      for (const session of device.sessions) {
        console.log(`  sesión ${session.id}  ${session.revokedAt ? 'revocada' : session.expiresAt <= new Date() ? 'expirada' : 'activa'}  vence ${session.expiresAt.toISOString()}`);
      }
    }
    if (devices.length === 0) console.log('No hay dispositivos vinculados.');
  } else if ((command === 'revoke-device' || command === 'revoke-session') && z.uuid().safeParse(argument).success) {
    const revoked = command === 'revoke-device' ? await revokeDevice(db, argument) : await revokeSession(db, argument);
    if (!revoked) throw new Error('No existe un registro activo con ese identificador.');
    console.log(command === 'revoke-device' ? 'Dispositivo y sesiones revocados.' : 'Sesión revocada.');
  } else {
    throw new Error('Uso: device:code | device:list | device:revoke <deviceId> | session:revoke <sessionId>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Error desconocido.');
  process.exitCode = 1;
} finally {
  await client.end();
}
