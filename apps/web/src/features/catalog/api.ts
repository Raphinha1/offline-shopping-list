import { request } from '../../api/request';

export type Category = { id: string; name: string; sortOrder: number };
export type Product = { id: string; name: string; active: boolean; category: Category };
export type ProductInput = { name: string; categoryId: string };

export function listCategories() {
  return request<Category[]>('/categories');
}

export function listProducts(search = '') {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return request<Product[]>(`/products${query}`);
}

export function createProduct(input: ProductInput) {
  return request<Product>('/products', { method: 'POST', body: JSON.stringify(input) });
}

export function updateProduct(id: string, input: Partial<ProductInput> & { active?: boolean }) {
  return request<Product>(`/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}
