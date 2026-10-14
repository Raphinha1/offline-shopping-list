import Fastify from 'fastify';
import { getDatabaseUrl } from './config/databaseUrl.js';
import { createDatabase } from './db/client.js';
import { registerCategoryRoutes } from './domains/catalog/categories.routes.js';
import { registerDeviceAuth } from './domains/device-auth/routes.js';
import { registerProductRoutes } from './domains/catalog/products.routes.js';
import { registerPurchaseRoutes } from './domains/purchases/routes.js';
import { registerShoppingListRoutes } from './domains/shopping-list/routes.js';

export function buildApp(options: { databaseUrl?: string } = {}) {
  const app = Fastify({ logger: true });
  const { client, db } = createDatabase(options.databaseUrl ?? getDatabaseUrl());
  registerDeviceAuth(app, db);

  app.addHook('onClose', async () => client.end());
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode : undefined;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: 'INVALID_REQUEST', message: 'Revisa la solicitud.' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({
    error: { code: 'ROUTE_NOT_FOUND', message: 'La ruta no existe.' },
  }));

  app.get('/health', async () => ({ status: 'ok' }));
  registerCategoryRoutes(app, db);
  registerProductRoutes(app, db);
  registerShoppingListRoutes(app, db);
  registerPurchaseRoutes(app, db);

  return app;
}
