import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { lockCurrentPurchase, type PurchaseTransaction } from '../../db/currentPurchaseLock.js';
import { mutationOperations } from './schema.js';

export type MutationResult = { status: number; body: unknown };

export function sendMutationResult(reply: FastifyReply, result: MutationResult) {
  return result.status === 204 ? reply.code(204).send() : reply.code(result.status).send(result.body);
}

const invalidOperationId: MutationResult = {
  status: 400, body: { error: { code: 'INVALID_OPERATION_ID', message: 'El identificador de operación no es válido.' } },
};

export async function runMutation(
  db: Database,
  request: FastifyRequest,
  fingerprint: string,
  perform: (tx: PurchaseTransaction) => Promise<MutationResult>,
): Promise<MutationResult> {
  const header = request.headers['x-operation-id'];
  const operationId = typeof header === 'string' ? header : undefined;
  if (header !== undefined && (!operationId || !z.uuid().safeParse(operationId).success)) return invalidOperationId;

  return db.transaction(async (tx) => {
    await lockCurrentPurchase(tx);
    if (operationId) {
      const [inserted] = await tx.insert(mutationOperations).values({
        operationId, fingerprint, responseStatus: 0, responseBody: null,
      }).onConflictDoNothing().returning({ operationId: mutationOperations.operationId });
      if (!inserted) {
        const [recorded] = await tx.select().from(mutationOperations)
          .where(eq(mutationOperations.operationId, operationId));
        if (recorded.fingerprint !== fingerprint) return {
          status: 409, body: { error: { code: 'OPERATION_ID_REUSED', message: 'La operación ya se usó para otra acción.' } },
        };
        return { status: recorded.responseStatus, body: recorded.responseBody };
      }
    }

    const result = await perform(tx);
    if (operationId) await tx.update(mutationOperations).set({
      responseStatus: result.status, responseBody: result.body,
    }).where(eq(mutationOperations.operationId, operationId));
    return result;
  });
}
