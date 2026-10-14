import { useState, type FormEvent } from 'react';
import type { PendingViewProps } from '../shopping-list/types';
import { createProduct, updateProduct, type Category, type Product } from './api';

type ProductForm = { id?: string; name: string; categoryId: string };

function messageFrom(error: unknown) {
  if (!navigator.onLine || error instanceof TypeError) {
    return 'Necesitas conexión a internet para crear, editar o desactivar productos. Vuelve a intentarlo cuando estés en línea.';
  }
  return error instanceof Error ? error.message : 'Ocurrió un error. Intenta de nuevo.';
}

export function CatalogPage({ pendingItems, pendingLoading, pendingError, actionError, notice, busyProductId,
  onRetryPending, onTogglePending, onCatalogChanged, categories, products, catalogLoading, catalogError, onRetryCatalog
}: PendingViewProps & { categories: Category[]; products: Product[]; catalogLoading: boolean; catalogError: string;
  onRetryCatalog: () => void; onCatalogChanged: (affectsPending: boolean) => Promise<void> }) {
  const [formError, setFormError] = useState('');
  const [catalogNotice, setCatalogNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState<ProductForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const term = search.trim().toLowerCase();
  const visibleProducts = products.filter((product) => (!term || product.name.toLowerCase().includes(term))
    && (!categoryId || product.category.id === categoryId));
  const pendingIds = new Set(pendingItems.map((item) => item.productId));
  const productGroups = [...new Map(visibleProducts.map((product) => [product.category.id, product.category])).values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')).map((category) => ({
      category,
      items: visibleProducts.filter((product) => product.category.id === category.id),
    }));

  function openForm(product?: Product) {
    if (saving) return;
    setForm(product
      ? { id: product.id, name: product.name, categoryId: product.category.id }
      : { name: '', categoryId: categoryId || categories[0]?.id || '' });
    setFormError('');
    setCatalogNotice('');
    setConfirmDeactivate(false);
    if (product) window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setFormError('');
    try {
      const saved = form.id
        ? await updateProduct(form.id, { name: form.name, categoryId: form.categoryId })
        : await createProduct({ name: form.name, categoryId: form.categoryId });
      setCatalogNotice(form.id ? 'Producto actualizado.' : 'Producto creado.');
      await onCatalogChanged(Boolean(form.id));
      setForm(null);
      setSearch('');
      setCategoryId(saved.category.id);
    } catch (error) {
      setFormError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateProduct() {
    if (!form?.id || saving) return;
    setSaving(true);
    setFormError('');
    try {
      await updateProduct(form.id, { active: false });
      setCatalogNotice(`${form.name} se desactivó.`);
      await onCatalogChanged(true);
      setForm(null);
      setConfirmDeactivate(false);
    } catch (error) {
      setFormError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-screen" data-local-write-pending={busyProductId !== null ? '' : undefined}>
      <div className="app-content">
        <header className="mb-6">
          <h1 className="app-title">¿Qué hace falta?</h1>
          {!pendingLoading && !pendingError && <p className="app-subtitle mt-2">{pendingItems.length} {pendingItems.length === 1 ? 'producto' : 'productos'} en tu lista</p>}
        </header>

        {notice && <p role="status" className="app-surface mb-4 p-3 font-semibold text-[#3f684e]">{notice}</p>}
        {catalogNotice && <p role="status" className="app-surface mb-4 p-3 font-semibold text-[#3f684e]">{catalogNotice}</p>}
        {actionError && <p role="alert" className="mb-4 rounded-xl border border-red-700 bg-red-50 p-3 text-red-950">{actionError}</p>}
        {pendingLoading && <p role="status" className="mb-4 text-stone-700">Cargando pendientes…</p>}
        {pendingError && <div role="alert" className="mb-4 rounded-xl border border-red-700 bg-red-50 p-3 text-red-950">
          <p>No se pudo cargar la lista. {pendingError}</p>
          <button type="button" onClick={onRetryPending} className="mt-2 min-h-11 font-semibold underline">Reintentar</button>
        </div>}

        <section aria-label="Catálogo">
          <label htmlFor="product-search" className="sr-only">Buscar productos</label>
          <div className="relative">
            <span aria-hidden="true" className="search-icon" />
            <input id="product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar producto..." className="app-field search-field text-sm" />
          </div>

          {form && <form onSubmit={saveProduct} className="app-surface mt-5 p-4">
            <h2 className="app-section-title mb-4">{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
            {formError && <p role="alert" className="mb-4 rounded-xl border border-red-700 bg-red-50 p-3 text-red-950">{formError}</p>}
            <label htmlFor="product-name" className="mb-1 block font-semibold">Nombre</label>
            <input id="product-name" name="name" required maxLength={120} autoComplete="off" value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="app-field mb-4" />
            <label htmlFor="product-category" className="mb-1 block font-semibold">Categoría</label>
            <select id="product-category" name="categoryId" required value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              className="app-field mb-5">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={saving} className="app-primary px-5 disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar producto'}</button>
              <button type="button" disabled={saving} onClick={() => { setForm(null); setFormError(''); }} className="app-secondary px-5">Cancelar</button>
            </div>
            {form.id && <div className="mt-5 border-t border-stone-200 pt-4">
              {!confirmDeactivate ? <button type="button" onClick={() => setConfirmDeactivate(true)} className="min-h-11 text-sm font-semibold text-red-900 underline">Desactivar producto</button>
                : <div><p className="mb-2 text-sm">¿Desactivar {form.name}? Si ya hace falta, seguirá en la lista.</p>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" disabled={saving} onClick={() => void deactivateProduct()} className="min-h-11 rounded-xl bg-red-800 px-4 font-semibold text-white">Confirmar desactivación</button>
                    <button type="button" disabled={saving} onClick={() => setConfirmDeactivate(false)} className="min-h-11 rounded-xl border border-stone-500 px-4 font-semibold">Cancelar</button>
                  </div>
                </div>}
            </div>}
          </form>}

          <h2 className="sr-only">Categorías</h2>
          {catalogLoading && <p role="status" className="text-stone-700">Cargando categorías…</p>}
          {catalogError && <div role="alert" className="rounded-xl border border-red-700 bg-red-50 p-3 text-red-950">
            <p>{catalogError}</p><button type="button" onClick={onRetryCatalog} className="mt-2 min-h-11 font-semibold underline">Reintentar</button>
          </div>}
          {!catalogLoading && !catalogError && categories.length === 0 && <p className="text-stone-700">Aún no hay categorías disponibles.</p>}
          {categories.length > 0 && <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por categoría">
            <button type="button" aria-pressed={!categoryId} onClick={() => setCategoryId('')}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold ${!categoryId ? 'border-[#3f684e] bg-[#3f684e] text-white' : 'border-[#d8e2d8] bg-[#fcf9f1] text-[#263129]'}`}>Todas</button>
            {categories.map((category) => <button key={category.id} type="button" aria-pressed={categoryId === category.id} onClick={() => setCategoryId(category.id)}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold ${categoryId === category.id ? 'border-[#3f684e] bg-[#3f684e] text-white' : 'border-[#d8e2d8] bg-[#fcf9f1] text-[#263129]'}`}>{category.name}</button>)}
          </div>}

          <h2 className="sr-only">Productos</h2>
          {catalogLoading && <p role="status" className="text-stone-700">Cargando productos…</p>}
          {!catalogLoading && !catalogError && visibleProducts.length === 0 && <p className="app-surface mt-5 p-5 text-[#667269]">
            {search ? 'No se encontraron productos con esa búsqueda.' : categoryId ? 'No hay productos activos en esta categoría.' : 'Todavía no hay productos. Usa + Producto para crear el primero.'}
          </p>}
          {!catalogLoading && !catalogError && productGroups.map((group) => <section key={group.category.id} aria-label={group.category.name} className="mt-3">
            <h3 className="app-section-title mb-3">{group.category.name}</h3>
            <ul className="grid grid-cols-2 gap-3">
              {group.items.map((product) => {
                const isPending = pendingIds.has(product.id);
                return <li key={product.id} className={`product-card ${isPending ? 'is-pending' : ''}`}>
                  <button type="button" aria-label={`${product.name} ${product.category.name} ${isPending ? 'Hace falta' : 'Marcar falta'}`}
                    aria-pressed={isPending} disabled={pendingLoading || Boolean(pendingError) || busyProductId !== null}
                    onClick={() => void onTogglePending(product.id)}
                    className="product-card-main">
                    <span aria-hidden="true" className="product-mark">{isPending ? '✓' : ''}</span>
                    <span className="block min-w-0 truncate text-base font-bold">{product.name}</span>
                    <span className="block text-xs text-[#667269]">{busyProductId === product.id ? 'Guardando…' : isPending ? 'Hace falta' : 'Toca para agregar'}</span>
                  </button>
                  <button type="button" aria-label={`Editar ${product.name}`} onClick={() => openForm(product)} className="product-edit">✎</button>
                </li>;
              })}
            </ul>
          </section>)}
          {!form && <button type="button" aria-label="+ Producto" disabled={catalogLoading || categories.length === 0} onClick={() => openForm()}
            className="app-text-action mt-4 inline-flex items-center gap-2 disabled:opacity-60"><span aria-hidden="true" className="text-xl">+</span>Nuevo producto</button>}
        </section>
      </div>
    </main>
  );
}
