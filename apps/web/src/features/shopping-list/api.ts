import { operationHeaders, request } from '../../api/request';
import type { Category } from '../catalog/api';

export type PendingItem = {
  productId: string;
  name: string;
  active: boolean;
  addedAt: string;
  category: Category;
};

export function listPendingItems() {
  return request<PendingItem[]>('/shopping-list');
}

export function addPendingItem(productId: string, operationId?: string) {
  return request<PendingItem>('/shopping-list/items', {
    method: 'POST', body: JSON.stringify({ productId }), headers: operationHeaders(operationId),
  });
}

export function removePendingItem(productId: string, operationId?: string) {
  return request<void>(`/shopping-list/items/${encodeURIComponent(productId)}`, { method: 'DELETE', headers: operationHeaders(operationId) });
}
