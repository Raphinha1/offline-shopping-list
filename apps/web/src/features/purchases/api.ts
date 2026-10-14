import { operationHeaders, request } from '../../api/request';
import type { Category } from '../catalog/api';

export type PurchasedItem = {
  productId: string;
  productNameSnapshot: string;
  priceCents: number | null;
  purchasedAt: string;
  category: Category;
};

export type CurrentPurchase = {
  purchaseId: string | null;
  status: 'ACTIVE' | null;
  startedAt: string | null;
  items: PurchasedItem[];
  totalPriceCents: number;
  pricedItemCount: number;
  unpricedItemCount: number;
};

export function getCurrentPurchase() {
  return request<CurrentPurchase>('/purchases/current');
}

export function buyPendingItem(productId: string, operationId?: string) {
  return request<CurrentPurchase>('/purchases/current/items', {
    method: 'POST', body: JSON.stringify({ productId }), headers: operationHeaders(operationId),
  });
}

export function changePurchasePrice(productId: string, priceCents: number | null, operationId?: string) {
  return request<CurrentPurchase>(`/purchases/current/items/${encodeURIComponent(productId)}`, {
    method: 'PATCH', body: JSON.stringify({ priceCents }), headers: operationHeaders(operationId),
  });
}

export function undoPurchasedItem(productId: string, operationId?: string) {
  return request<CurrentPurchase>(`/purchases/current/items/${encodeURIComponent(productId)}`, { method: 'DELETE', headers: operationHeaders(operationId) });
}

export function finishCurrentPurchase(operationId?: string) {
  return request<{ purchaseId: string; status: 'FINISHED'; finishedAt: string }>('/purchases/current/finish', { method: 'POST', headers: operationHeaders(operationId) });
}
