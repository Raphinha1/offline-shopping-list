import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { ApiRequestError } from './api/request';
import * as deviceAuth from './auth/deviceAuth';
import * as catalogApi from './features/catalog/api';
import * as shoppingApi from './features/shopping-list/api';
import * as purchaseApi from './features/purchases/api';
import type { Product } from './features/catalog/api';
import type { PendingItem } from './features/shopping-list/api';
import type { CurrentPurchase } from './features/purchases/api';
import { readLocalSnapshot } from './data/localData';
import { readLocalAuthorization, readPendingOperations } from './data/localStore';

vi.mock('./features/catalog/api', () => ({
  listCategories: vi.fn(), listProducts: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(),
}));
vi.mock('./features/shopping-list/api', () => ({
  listPendingItems: vi.fn(), addPendingItem: vi.fn(), removePendingItem: vi.fn(),
}));
vi.mock('./features/purchases/api', () => ({
  getCurrentPurchase: vi.fn(), buyPendingItem: vi.fn(), changePurchasePrice: vi.fn(),
  undoPurchasedItem: vi.fn(), finishCurrentPurchase: vi.fn(),
}));
vi.mock('./auth/deviceAuth', () => ({ checkDeviceSession: vi.fn(), pairDevice: vi.fn() }));

const pantry = { id: 'pantry', name: 'Despensa', sortOrder: 0 };
const fridge = { id: 'fridge', name: 'Refrigerador', sortOrder: 1 };
let products: Product[];
let pending: PendingItem[];
let purchase: CurrentPurchase;

function pendingFrom(product: Product): PendingItem {
  return { productId: product.id, name: product.name, active: product.active, category: product.category, addedAt: '2026-01-01T00:00:00.000Z' };
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lista-domestica');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  window.history.replaceState(null, '', '/add');
  vi.resetAllMocks();
  vi.mocked(deviceAuth.checkDeviceSession).mockResolvedValue({ device: { id: 'device', name: 'Mi dispositivo' } });
  products = [
    { id: 'rice', name: 'Arroz', active: true, category: pantry },
    { id: 'milk', name: 'Leche', active: true, category: fridge },
  ];
  pending = [];
  purchase = {
    purchaseId: null, status: null, startedAt: null, items: [], totalPriceCents: 0,
    pricedItemCount: 0, unpricedItemCount: 0,
  };
  vi.mocked(catalogApi.listCategories).mockResolvedValue([pantry, fridge]);
  vi.mocked(catalogApi.listProducts).mockImplementation(async (search = '') =>
    products.filter((product) => product.active && product.name.toLowerCase().includes(search.trim().toLowerCase())));
  vi.mocked(catalogApi.createProduct).mockImplementation(async ({ name, categoryId }) => {
    const product = { id: 'new', name, active: true, category: categoryId === pantry.id ? pantry : fridge };
    products.push(product);
    return product;
  });
  vi.mocked(catalogApi.updateProduct).mockImplementation(async (id, changes) => {
    const product = products.find((item) => item.id === id)!;
    const updated = { ...product, ...changes, category: changes.categoryId === fridge.id ? fridge : product.category };
    products = products.map((item) => item.id === id ? updated : item);
    pending = pending.map((item) => item.productId === id ? pendingFrom(updated) : item);
    return updated;
  });
  vi.mocked(shoppingApi.listPendingItems).mockImplementation(async () => [...pending]);
  vi.mocked(shoppingApi.addPendingItem).mockImplementation(async (productId) => {
    const item = pendingFrom(products.find((product) => product.id === productId)!);
    pending.push(item);
    return item;
  });
  vi.mocked(shoppingApi.removePendingItem).mockImplementation(async (productId) => {
    pending = pending.filter((item) => item.productId !== productId);
  });
  vi.mocked(purchaseApi.getCurrentPurchase).mockImplementation(async () => ({ ...purchase, items: [...purchase.items] }));
  vi.mocked(purchaseApi.buyPendingItem).mockImplementation(async (productId) => {
    const item = pending.find((entry) => entry.productId === productId)!;
    pending = pending.filter((entry) => entry.productId !== productId);
    purchase = {
      ...purchase, purchaseId: purchase.purchaseId ?? 'purchase', status: 'ACTIVE', startedAt: '2026-01-01',
      items: [...purchase.items, { productId, productNameSnapshot: item.name, priceCents: null, purchasedAt: '2026-01-01', category: item.category }],
      unpricedItemCount: purchase.unpricedItemCount + 1,
    };
    return purchase;
  });
  vi.mocked(purchaseApi.changePurchasePrice).mockImplementation(async (productId, priceCents) => {
    purchase = { ...purchase, items: purchase.items.map((item) => item.productId === productId ? { ...item, priceCents } : item) };
    purchase.totalPriceCents = purchase.items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
    purchase.pricedItemCount = purchase.items.filter((item) => item.priceCents !== null).length;
    purchase.unpricedItemCount = purchase.items.length - purchase.pricedItemCount;
    return purchase;
  });
  vi.mocked(purchaseApi.undoPurchasedItem).mockImplementation(async (productId) => {
    const item = purchase.items.find((entry) => entry.productId === productId)!;
    pending.push(pendingFrom(products.find((product) => product.id === productId)!));
    purchase = { ...purchase, items: purchase.items.filter((entry) => entry.productId !== productId),
      totalPriceCents: purchase.totalPriceCents - (item.priceCents ?? 0),
      pricedItemCount: purchase.pricedItemCount - Number(item.priceCents !== null),
      unpricedItemCount: purchase.unpricedItemCount - Number(item.priceCents === null) };
    return purchase;
  });
  vi.mocked(purchaseApi.finishCurrentPurchase).mockImplementation(async () => {
    purchase = { purchaseId: null, status: null, startedAt: null, items: [], totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 0 };
    return { purchaseId: 'purchase', status: 'FINISHED', finishedAt: '2026-01-01' };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('catálogo y lista pendiente', () => {
  it('abre directamente /add para un dispositivo autorizado', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: '¿Qué hace falta?' })).toBeTruthy();
    expect(window.location.pathname).toBe('/add');
    expect(deviceAuth.checkDeviceSession).toHaveBeenCalledOnce();
  });

  it('muestra vinculación solo después de un 401 y permite canjear el código', async () => {
    vi.mocked(deviceAuth.checkDeviceSession).mockRejectedValue(new ApiRequestError('No autorizado', 401));
    vi.mocked(deviceAuth.pairDevice).mockResolvedValue({ device: { id: 'device', name: 'Mi dispositivo' } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Vincular dispositivo' })).toBeTruthy();
    expect(window.location.pathname).toBe('/add');
    expect(screen.queryByRole('heading', { name: '¿Qué hace falta?' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Código de 6 dígitos' }), { target: { value: '012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular dispositivo' }));
    await waitFor(() => expect(deviceAuth.pairDevice).toHaveBeenCalledWith('012345', 'Mi dispositivo'));
    expect(window.location.pathname).toBe('/add');
    expect(await screen.findByRole('heading', { name: '¿Qué hace falta?' })).toBeTruthy();
    expect(await screen.findByText('Arroz')).toBeTruthy();
    expect(await readLocalAuthorization()).toBe(true);
  });

  it('distingue servidor no disponible de dispositivo no autorizado', async () => {
    vi.mocked(deviceAuth.checkDeviceSession).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Servidor no disponible' })).toBeTruthy();
    expect(screen.queryByText('Vincular dispositivo')).toBeNull();
  });

  it('usa los datos locales tras perder red si antes estuvo autorizado', async () => {
    render(<App />);
    await screen.findByText('Arroz');
    await waitFor(async () => expect(await readLocalAuthorization()).toBe(true));
    cleanup();
    vi.mocked(deviceAuth.checkDeviceSession).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(catalogApi.listCategories).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(shoppingApi.listPendingItems).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Leche.*Marcar falta/ }));
    expect(await screen.findByRole('button', { name: /Leche.*Hace falta/ })).toBeTruthy();
    expect(window.location.pathname).toBe('/add');
    await waitFor(async () => expect(await readPendingOperations()).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: 'Vincular dispositivo' })).toBeNull();
  });

  it('conserva la operación tras 401 y la sincroniza al vincular de nuevo', async () => {
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValueOnce(new ApiRequestError('Vincula este dispositivo.', 401));
    vi.mocked(deviceAuth.pairDevice).mockResolvedValue({ device: { id: 'new-device', name: 'Mi dispositivo' } });
    render(<App />);
    await screen.findByRole('link', { name: 'Lista (0)' });
    fireEvent.click(await screen.findByRole('button', { name: /Leche.*Marcar falta/ }));
    expect(await screen.findByRole('heading', { name: 'Vincular dispositivo' })).toBeTruthy();
    expect(await readPendingOperations()).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Código de 6 dígitos' }), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular dispositivo' }));
    await waitFor(async () => expect(await readPendingOperations()).toHaveLength(0));
    expect(await screen.findByRole('button', { name: /Leche.*Hace falta/ })).toBeTruthy();
  });

  it('muestra el catálogo y filtra por categoría', async () => {
    render(<App />);
    expect(await screen.findByText('Arroz')).toBeTruthy();
    expect(screen.getByText('Leche')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refrigerador' }));
    expect(screen.queryByText('Arroz')).toBeNull();
    expect(screen.getByText('Leche')).toBeTruthy();
  });

  it('busca productos por nombre', async () => {
    render(<App />);
    await screen.findByText('Arroz');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar productos' }), { target: { value: 'lech' } });
    await waitFor(() => expect(screen.queryByText('Arroz')).toBeNull());
    expect(screen.getByText('Leche')).toBeTruthy();
    expect(catalogApi.listProducts).toHaveBeenCalledWith();
    expect(catalogApi.listProducts).not.toHaveBeenCalledWith('lech');
  });

  it('muestra el estado vacío del catálogo', async () => {
    products = [];
    render(<App />);
    expect(await screen.findByText('Todavía no hay productos. Usa + Producto para crear el primero.')).toBeTruthy();
  });

  it('crea un producto desde la acción secundaria', async () => {
    products = [];
    render(<App />);
    await screen.findByText('Todavía no hay productos. Usa + Producto para crear el primero.');
    fireEvent.click(screen.getByRole('button', { name: '+ Producto' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Azúcar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(catalogApi.createProduct).toHaveBeenCalledWith({ name: 'Azúcar', categoryId: pantry.id }));
    expect(await screen.findByText('Producto creado.')).toBeTruthy();
    expect(await screen.findByText('Azúcar')).toBeTruthy();
  });

  it('explica que crear productos requiere conexión cuando falla sin red', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(catalogApi.createProduct).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<App />);
    await screen.findByText('Arroz');
    fireEvent.click(screen.getByRole('button', { name: '+ Producto' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Azúcar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Necesitas conexión a internet para crear, editar o desactivar productos.');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('explica que editar productos requiere conexión cuando falla sin red', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(catalogApi.updateProduct).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<App />);
    await screen.findByText('Arroz');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Arroz' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Arroz integral' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Necesitas conexión a internet para crear, editar o desactivar productos.');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('explica que desactivar productos requiere conexión cuando falla sin red', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(catalogApi.updateProduct).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<App />);
    await screen.findByText('Arroz');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Arroz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar producto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Necesitas conexión a internet para crear, editar o desactivar productos.');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('muestra un error al cargar el catálogo y permite reintentar', async () => {
    vi.mocked(catalogApi.listProducts).mockRejectedValueOnce(new Error('No se pudo cargar el catálogo.'));
    render(<App />);
    expect((await screen.findAllByRole('alert')).some((alert) => alert.textContent?.includes('No se pudo cargar el catálogo.'))).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);
    expect(await screen.findByText('Arroz')).toBeTruthy();
  });

  it('mantiene edición y desactivación del catálogo', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    render(<App />);
    await screen.findByText('Arroz');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Arroz' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Arroz integral' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('Arroz integral')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Editar producto' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Editar Arroz integral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar producto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    await waitFor(() => expect(catalogApi.updateProduct).toHaveBeenCalledWith('rice', { active: false }));
    expect(await screen.findByText('Arroz integral se desactivó.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Arroz integral')).toBeNull());
  });

  it('marca los pendientes al cargar /add', async () => {
    pending = [pendingFrom(products[1])];
    render(<App />);
    const milk = await screen.findByRole('button', { name: /Leche.*Hace falta/ });
    expect(milk.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Lista (1)' })).toBeTruthy();
  });

  it('añade con un toque y actualiza el contador', async () => {
    render(<App />);
    await screen.findByRole('link', { name: 'Lista (0)' });
    fireEvent.click(screen.getByRole('button', { name: /Leche.*Marcar falta/ }));
    await waitFor(() => expect(shoppingApi.addPendingItem).toHaveBeenCalledWith('milk', expect.any(String)));
    expect(await screen.findByRole('button', { name: /Leche.*Hace falta/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lista (1)' })).toBeTruthy();
    expect((await readLocalSnapshot())?.pendingItems.map((item) => item.productId)).toEqual(['milk']);
  });

  it('quita un pendiente al tocarlo otra vez', async () => {
    pending = [pendingFrom(products[1])];
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Leche.*Hace falta/ }));
    await waitFor(() => expect(shoppingApi.removePendingItem).toHaveBeenCalledWith('milk', expect.any(String)));
    expect(await screen.findByRole('button', { name: /Leche.*Marcar falta/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lista (0)' })).toBeTruthy();
  });

  it('muestra solo pendientes en /list y permite quitarlos', async () => {
    pending = [pendingFrom(products[1])];
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Lista (1)' }));
    expect(screen.getByRole('heading', { name: 'Leche' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Arroz' })).toBeNull();
    expect(screen.getByText('1 pendiente')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar de la lista' }));
    await waitFor(() => expect(shoppingApi.removePendingItem).toHaveBeenCalledWith('milk', expect.any(String)));
    expect(await screen.findByText('La lista está vacía. En Agregar, toca un producto que haga falta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lista (0)' })).toBeTruthy();
  });

  it('muestra el estado vacío de /list', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Lista (0)' }));
    expect(screen.getByText('La lista está vacía. En Agregar, toca un producto que haga falta.')).toBeTruthy();
  });

  it('conserva en /list un pendiente cuyo producto fue desactivado', async () => {
    pending = [{ ...pendingFrom(products[1]), active: false }];
    window.history.replaceState(null, '', '/list');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Leche' })).toBeTruthy();
    expect(screen.getByText('Producto desactivado del catálogo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar de la lista' })).toBeTruthy();
  });

  it('mantiene la acción local y la cola cuando falla la API', async () => {
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValue(new Error('Sin conexión.'));
    render(<App />);
    await screen.findByRole('link', { name: 'Lista (0)' });
    fireEvent.click(screen.getByRole('button', { name: /Leche.*Marcar falta/ }));
    expect((await screen.findByRole('button', { name: /Leche.*Hace falta/ })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Lista (1)' })).toBeTruthy();
    await waitFor(async () => expect((await readPendingOperations()).map((operation) => operation.kind)).toEqual(['addPending']));
  });

  it('sincroniza la operación pendiente al recibir online', async () => {
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValueOnce(new TypeError('Sin red'));
    render(<App />);
    await screen.findByRole('link', { name: 'Lista (0)' });
    fireEvent.click(screen.getByRole('button', { name: /Leche.*Marcar falta/ }));
    await screen.findByRole('link', { name: 'Lista (1)' });
    await waitFor(async () => expect(await readPendingOperations()).toHaveLength(1));
    window.dispatchEvent(new Event('online'));
    await waitFor(async () => expect(await readPendingOperations()).toHaveLength(0));
    expect(shoppingApi.addPendingItem).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Leche.*Hace falta/ })).toBeTruthy();
  });

  it('muestra catálogo, pendientes y compra guardados al abrir sin red', async () => {
    pending = [pendingFrom(products[1])];
    purchase = { purchaseId: 'purchase', status: 'ACTIVE', startedAt: '2026-01-01',
      items: [{ productId: 'rice', productNameSnapshot: 'Arroz', priceCents: 2000,
        purchasedAt: '2026-01-01', category: pantry }], totalPriceCents: 2000,
      pricedItemCount: 1, unpricedItemCount: 0 };
    render(<App />);
    await screen.findByText('Leche');
    await waitFor(async () => expect((await readLocalSnapshot())?.purchase.purchaseId).toBe('purchase'));
    cleanup();

    vi.mocked(catalogApi.listCategories).mockRejectedValue(new Error('Sin conexión.'));
    vi.mocked(catalogApi.listProducts).mockRejectedValue(new Error('Sin conexión.'));
    vi.mocked(shoppingApi.listPendingItems).mockRejectedValue(new Error('Sin conexión.'));
    vi.mocked(purchaseApi.getCurrentPurchase).mockRejectedValue(new Error('Sin conexión.'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /Leche.*Hace falta/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lista (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Lista (1)' }));
    expect(await screen.findByRole('heading', { name: '✓ Arroz' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Leche' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('compra actual', () => {
  it('separa pendientes y comprados, y permite añadir, editar y quitar precio', async () => {
    pending = [pendingFrom(products[1]), pendingFrom(products[0])];
    window.history.replaceState(null, '', '/list');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Pendientes (2)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Comprados (0)' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprado' })[1]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comprados (1)' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: '✓ Leche' })).toBeTruthy();
    expect(screen.getByText('0 de 1 productos con precio · 1 sin precio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir precio' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Precio de Leche en MXN' }), { target: { value: '31.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    await waitFor(() => expect(purchaseApi.changePurchasePrice).toHaveBeenCalledWith('milk', 3150, expect.any(String)));
    await waitFor(() => expect(screen.getByText('1 de 1 productos con precio · 0 sin precio')).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Resumen de compra' })).getByText('$31.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editar precio' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Precio de Leche en MXN' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Resumen de compra' })).getByText('$40.00')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Editar precio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar precio' }));
    await waitFor(() => expect(screen.getByText('0 de 1 productos con precio · 1 sin precio')).toBeTruthy());
    await waitFor(() => expect(purchaseApi.changePurchasePrice).toHaveBeenLastCalledWith('milk', null, expect.any(String)));
  });

  it('valida precio, deshace comprado y conserva pendientes al finalizar con confirmación', async () => {
    pending = [pendingFrom(products[1]), pendingFrom(products[0])];
    window.history.replaceState(null, '', '/list');
    render(<App />);
    await screen.findByRole('heading', { name: 'Pendientes (2)' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprado' })[1]);
    await screen.findByRole('heading', { name: '✓ Leche' });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir precio' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Precio de Leche en MXN' }), { target: { value: '12.999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio' }));
    expect(screen.getByRole('alert').textContent).toContain('precio válido');
    expect(purchaseApi.changePurchasePrice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer comprado' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pendientes (2)' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Comprados (0)' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Comprado' })[1]);
    await screen.findByRole('heading', { name: '✓ Leche' });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar compra' }));
    expect(screen.getByText('¿Finalizar esta compra?')).toBeTruthy();
    expect(screen.getByText(/1 comprados · 1 pendientes · 1 sin precio/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(purchaseApi.finishCurrentPurchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar compra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalización' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comprados (0)' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Arroz' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Leche' })).toBeNull();
    expect(screen.getByText(/Compra finalizada/)).toBeTruthy();
  });

  it('conserva una compra local cuando la API falla', async () => {
    pending = [pendingFrom(products[1])];
    vi.mocked(purchaseApi.buyPendingItem).mockRejectedValue(new Error('Sin conexión.'));
    window.history.replaceState(null, '', '/list');
    render(<App />);
    await screen.findByRole('heading', { name: 'Pendientes (1)' });
    fireEvent.click(screen.getByRole('button', { name: 'Comprado' }));
    expect(await screen.findByRole('heading', { name: 'Pendientes (0)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Comprados (1)' })).toBeTruthy();
    await waitFor(async () => expect((await readPendingOperations()).map((operation) => operation.kind)).toEqual(['buyPending']));
  });
});
