import { useState } from 'react';
import type { CurrentPurchase, PurchasedItem } from '../purchases/api';
import { formatMxnCents, parseMxnCents } from '../purchases/money';
import type { PendingViewProps } from './types';

type PurchaseViewProps = PendingViewProps & {
  purchase: CurrentPurchase;
  busyPurchase: boolean;
  onBuy: (productId: string) => Promise<boolean>;
  onChangePrice: (productId: string, priceCents: number | null) => Promise<boolean>;
  onUndo: (productId: string) => Promise<boolean>;
  onFinish: () => Promise<boolean>;
};

const buttonClass = 'app-secondary px-4 disabled:opacity-60';

function PurchasedRow({ item, disabled, onChangePrice, onUndo }: {
  item: PurchasedItem;
  disabled: boolean;
  onChangePrice: PurchaseViewProps['onChangePrice'];
  onUndo: PurchaseViewProps['onUndo'];
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');

  async function savePrice(event: React.FormEvent) {
    event.preventDefault();
    const cents = input.trim() === '' ? null : parseMxnCents(input);
    if (cents === null && input.trim() !== '') {
      setInputError('Escribe un precio válido en pesos, con hasta dos decimales.');
      return;
    }
    setInputError('');
    if (await onChangePrice(item.productId, cents)) setEditing(false);
  }

  return <li>
    <div className="flex min-h-12 items-center gap-2 rounded-xl bg-[#fcf9f1] px-3">
      <span aria-hidden="true" className="w-5 shrink-0 text-lg font-bold text-[#3f684e]">✓</span>
      <h3 className="min-w-0 flex-1 truncate text-sm font-bold"><span className="sr-only">✓ </span>{item.productNameSnapshot}</h3>
      <p className="shrink-0 text-sm font-semibold">{item.priceCents === null ? 'Sin precio' : formatMxnCents(item.priceCents)}</p>
      <button type="button" aria-label={item.priceCents === null ? 'Añadir precio' : 'Editar precio'} disabled={disabled}
        onClick={() => { setEditing((value) => !value); setInput(item.priceCents === null ? '' : `${Math.floor(item.priceCents / 100)}.${String(item.priceCents % 100).padStart(2, '0')}`); setInputError(''); }}
        className="app-text-action w-11 shrink-0 text-lg">✎</button>
      <button type="button" aria-label="Deshacer comprado" disabled={disabled} onClick={() => void onUndo(item.productId)}
        className="app-text-action w-11 shrink-0 text-xl">↶</button>
    </div>
    {editing && <form onSubmit={(event) => void savePrice(event)} className="app-surface mt-2 p-3">
      <label htmlFor={`price-${item.productId}`} className="block font-semibold">Precio de {item.productNameSnapshot} en MXN</label>
      <input id={`price-${item.productId}`} value={input} onChange={(event) => { setInput(event.target.value); setInputError(''); }}
        inputMode="decimal" placeholder="Ej. 31.50" className="app-field mt-2 text-lg" />
      {inputError && <p role="alert" className="mt-2 text-red-800">{inputError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={disabled} className="app-primary px-4">Guardar precio</button>
        {item.priceCents !== null && <button type="button" disabled={disabled} onClick={() => void onChangePrice(item.productId, null).then((ok) => { if (ok) setEditing(false); })} className={buttonClass}>Quitar precio</button>}
        <button type="button" onClick={() => setEditing(false)} className={buttonClass}>Cancelar</button>
      </div>
    </form>}
  </li>;
}

export function ShoppingListPage({ pendingItems, pendingLoading, pendingError, actionError, notice,
  busyProductId, onRetryPending, onTogglePending, purchase, busyPurchase, onBuy, onChangePrice, onUndo, onFinish }: PurchaseViewProps) {
  const [confirmFinish, setConfirmFinish] = useState(false);
  const items = [...pendingItems].sort((a, b) =>
    a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name, 'es')
    || a.name.localeCompare(b.name, 'es') || a.addedAt.localeCompare(b.addedAt) || a.productId.localeCompare(b.productId));
  const disabled = pendingLoading || busyPurchase || busyProductId !== null;

  return (
    <main className="app-screen" data-local-write-pending={busyPurchase || busyProductId !== null ? '' : undefined}>
      <div className="app-content">
        <header className="mb-7">
          <h1 className="app-title">Lista de compras</h1>
          {!pendingLoading && !pendingError && <p className="app-subtitle mt-2">
            {items.length === 1 ? '1 pendiente' : `${items.length} pendientes`}
          </p>}
        </header>

        {notice && <p role="status" className="app-surface mb-4 p-3 font-semibold text-[#3f684e]">{notice}</p>}
        {actionError && <p role="alert" className="mb-4 rounded-xl border border-red-700 bg-red-50 p-3 text-red-950">{actionError}</p>}
        {pendingLoading && <p role="status" className="app-subtitle">Cargando lista…</p>}
        {pendingError && <div role="alert" className="rounded-xl border border-red-700 bg-red-50 p-4 text-red-950">
          <p>No se pudo cargar la lista. {pendingError}</p>
          <button type="button" onClick={onRetryPending} className="mt-2 min-h-11 font-semibold underline">Reintentar</button>
        </div>}
        {!pendingLoading && !pendingError && <>
          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" aria-label={`Pendientes (${items.length})`} className="app-section-label mb-3">Pendientes</h2>
            {items.length === 0 ? <p className="app-surface p-4 text-[#667269]">
              {purchase.items.length ? 'No quedan productos pendientes.' : 'La lista está vacía. En Agregar, toca un producto que haga falta.'}
            </p> : <ul className="space-y-3">
              {items.map((item) => <li key={item.productId} className="flex min-h-[58px] items-center gap-2 rounded-xl bg-[#fcf9f1] px-1.5 py-1">
                <button type="button" aria-label="Comprado" disabled={disabled} onClick={() => void onBuy(item.productId)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-60">
                  <span aria-hidden="true" className="h-7 w-7 rounded-full border-2 border-[#3f684e] bg-[#e3efe5]" />
                </button>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold">{item.name}</h3>
                  <p className="text-xs text-[#667269]">{item.category.name}</p>
                  {!item.active && <p className="text-xs font-bold text-amber-900">Producto desactivado del catálogo</p>}
                </div>
                <button type="button" aria-label="Quitar de la lista" disabled={disabled} onClick={() => void onTogglePending(item.productId)}
                  className="app-text-action w-11 shrink-0 text-xl">×</button>
              </li>)}
            </ul>}
          </section>

          <section aria-labelledby="purchased-heading" className="mt-6">
            <h2 id="purchased-heading" aria-label={`Comprados (${purchase.items.length})`} className="app-section-label mb-3">Comprados</h2>
            {purchase.items.length === 0 ? <p className="app-surface p-4 text-[#667269]">Todavía no hay productos comprados en esta compra.</p>
              : <ul className="space-y-3">{purchase.items.map((item) => <PurchasedRow key={item.productId} item={item} disabled={disabled} onChangePrice={onChangePrice} onUndo={onUndo} />)}</ul>}
          </section>

          {purchase.purchaseId && <section aria-label="Resumen de compra" className="mt-6">
            <div className="rounded-2xl border border-[#d8e2d8] bg-[#f0f6f0] px-4 py-2.5">
              <h2 className="text-sm text-[#667269]">Total registrado</h2>
              <p className="mt-1 text-2xl font-bold"><span>{formatMxnCents(purchase.totalPriceCents)}</span> <span className="text-lg">MXN</span></p>
              <p className="mt-1 text-xs text-[#667269]">{purchase.pricedItemCount} de {purchase.items.length} productos con precio · {purchase.unpricedItemCount} sin precio</p>
            </div>
            {!confirmFinish ? <button type="button" disabled={disabled} onClick={() => setConfirmFinish(true)} className="app-primary mt-4 w-full">Finalizar compra</button>
              : <div className="app-surface mt-4 p-3">
                <p className="font-bold">¿Finalizar esta compra?</p>
                <p className="mt-1">{purchase.items.length} comprados · {items.length} pendientes · {purchase.unpricedItemCount} sin precio · Total registrado {formatMxnCents(purchase.totalPriceCents)}.</p>
                <p className="mt-1">Los pendientes seguirán en la lista.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={disabled} onClick={() => void onFinish().then((ok) => { if (ok) setConfirmFinish(false); })} className="app-primary px-4">Confirmar finalización</button>
                  <button type="button" onClick={() => setConfirmFinish(false)} className={buttonClass}>Cancelar</button>
                </div>
              </div>}
          </section>}
        </>}
      </div>
    </main>
  );
}
