import { ApiRequestError } from '../api/request';
import { buyPendingItem, changePurchasePrice, finishCurrentPurchase, undoPurchasedItem } from '../features/purchases/api';
import { addPendingItem, removePendingItem } from '../features/shopping-list/api';
import { hydrateLocalShopping, readLocalShopping, type LocalShopping } from './localData';
import { confirmOperation, readPendingOperations, rejectOperation } from './localStore';
import type { OutboxOperation } from './shoppingOperations';

export type SyncOutcome = { shopping: LocalShopping | null; rejected: string[]; retryableError: boolean; unauthorized: boolean };

async function sendOperation(operation: OutboxOperation): Promise<void> {
  switch (operation.kind) {
    case 'addPending': await addPendingItem(operation.productId, operation.operationId); return;
    case 'removePending': await removePendingItem(operation.productId, operation.operationId); return;
    case 'buyPending': await buyPendingItem(operation.productId, operation.operationId); return;
    case 'changePrice': await changePurchasePrice(operation.productId, operation.priceCents, operation.operationId); return;
    case 'undoPurchased': await undoPurchasedItem(operation.productId, operation.operationId); return;
    case 'finishPurchase': await finishCurrentPurchase(operation.operationId); return;
  }
}

function isDefinitiveRejection(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500
    && error.status !== 401 && error.status !== 403 && error.status !== 408 && error.status !== 429;
}

async function syncOnce(): Promise<SyncOutcome> {
  const rejected: string[] = [];
  while (true) {
    const [operation] = await readPendingOperations();
    if (!operation) break;
    try {
      await sendOperation(operation);
      await confirmOperation(operation.operationId);
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        await rejectOperation(operation, error.message);
        rejected.push(error.message);
        continue;
      }
      return { shopping: await readLocalShopping(), rejected, retryableError: true,
        unauthorized: error instanceof ApiRequestError && error.status === 401 };
    }
  }
  try {
    return { shopping: await hydrateLocalShopping(), rejected, retryableError: false, unauthorized: false };
  } catch (error) {
    return { shopping: await readLocalShopping(), rejected, retryableError: true,
      unauthorized: error instanceof ApiRequestError && error.status === 401 };
  }
}

let syncQueue: Promise<unknown> = Promise.resolve();

export function syncOutbox(): Promise<SyncOutcome> {
  const run = syncQueue.catch(() => undefined).then(syncOnce);
  syncQueue = run;
  return run;
}
