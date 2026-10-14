import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from './api/request';
import { PairDevicePage } from './auth/PairDevicePage';
import { checkDeviceSession } from './auth/deviceAuth';
import { hydrateLocalCatalog, hydrateLocalShopping, readLocalCatalog, readLocalShopping,
  type LocalCatalog, type LocalShopping } from './data/localData';
import { enqueueShoppingCommand, readLocalAuthorization, writeLocalAuthorization } from './data/localStore';
import type { ShoppingCommand } from './data/shoppingOperations';
import { syncOutbox } from './data/syncOutbox';
import { CatalogPage } from './features/catalog/CatalogPage';
import type { CurrentPurchase } from './features/purchases/api';
import { ShoppingListPage } from './features/shopping-list/ShoppingListPage';
import type { PendingViewProps } from './features/shopping-list/types';

type Route = '/add' | '/list';

const emptyPurchase: CurrentPurchase = {
  purchaseId: null, status: null, startedAt: null, items: [], totalPriceCents: 0,
  pricedItemCount: 0, unpricedItemCount: 0,
};

function currentRoute(): Route {
  return window.location.pathname === '/list' ? '/list' : '/add';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo actualizar la lista. Intenta de nuevo.';
}

function ShoppingApp({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [catalog, setCatalog] = useState<LocalCatalog | null>(null);
  const [shopping, setShopping] = useState<LocalShopping | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [busyPurchase, setBusyPurchase] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [shoppingRefresh, setShoppingRefresh] = useState(0);
  const pendingItems = shopping?.pendingItems ?? [];
  const purchase = shopping?.purchase ?? emptyPurchase;

  useEffect(() => {
    if (window.location.pathname === '/') window.history.replaceState(null, '', '/add');
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.title = `${route === '/list' ? 'Lista de compras' : '¿Qué hace falta?'} · Hogar natural`;
  }, [route]);

  useEffect(() => {
    let current = true;
    setCatalogLoading(true);
    setCatalogError('');
    async function load() {
      let cached: LocalCatalog | null = null;
      try {
        cached = await readLocalCatalog();
        if (current && cached) {
          setCatalog(cached);
          setCatalogLoading(false);
        }
        const hydrated = await hydrateLocalCatalog();
        if (current) setCatalog(hydrated);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) onUnauthorized();
        if (current && !cached) setCatalogError(errorMessage(error));
      } finally {
        if (current) setCatalogLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [catalogRefresh]);

  useEffect(() => {
    let current = true;
    setPendingLoading(true);
    setPendingError('');
    async function load() {
      let cached: LocalShopping | null = null;
      try {
        cached = await readLocalShopping();
        if (current && cached) {
          setShopping(cached);
          setPendingLoading(false);
        }
        const outcome = await syncOutbox();
        if (current) {
          if (outcome.unauthorized) onUnauthorized();
          if (outcome.shopping) setShopping(outcome.shopping);
          if (outcome.rejected.length) setActionError(outcome.rejected.join(' '));
          if (!cached && !outcome.shopping) setPendingError('No se pudo cargar la lista. Intenta de nuevo.');
        }
      } catch (error) {
        if (current && !cached) setPendingError(errorMessage(error));
      } finally {
        if (current) setPendingLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [shoppingRefresh]);

  useEffect(() => {
    const onOnline = () => { void syncShopping(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  async function syncShopping() {
    try {
      const outcome = await syncOutbox();
      if (outcome.unauthorized) { onUnauthorized(); return; }
      if (outcome.shopping) setShopping(outcome.shopping);
      if (outcome.rejected.length) setActionError(outcome.rejected.join(' '));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function refreshLocalCatalog() {
    const hydrated = await hydrateLocalCatalog();
    setCatalog(hydrated);
    setCatalogError('');
  }

  async function refreshLocalShopping() {
    const hydrated = await hydrateLocalShopping();
    setShopping(hydrated);
    setPendingError('');
  }

  async function refreshAfterCatalogChange(affectsPending: boolean) {
    await refreshLocalCatalog();
    if (affectsPending) {
      try { await refreshLocalShopping(); } catch (error) { if (!shopping) setPendingError(errorMessage(error)); }
    }
  }

  function navigate(next: Route) {
    if (next !== route) {
      window.history.pushState(null, '', next);
      setRoute(next);
      setActionError('');
      setNotice('');
    }
  }

  async function togglePending(productId: string) {
    if (pendingLoading || pendingError || busyProductId || busyPurchase) return;
    const existing = pendingItems.find((item) => item.productId === productId);
    setBusyProductId(productId);
    setActionError('');
    setNotice('');
    try {
      if (existing) {
        setShopping((await enqueueShoppingCommand({ kind: 'removePending', productId })).shopping);
        setNotice(`${existing.name} ya no hace falta.`);
      } else {
        setShopping((await enqueueShoppingCommand({ kind: 'addPending', productId })).shopping);
        const product = catalog?.products.find((item) => item.id === productId);
        setNotice(`${product?.name ?? 'El producto'} hace falta.`);
      }
      void syncShopping();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyProductId(null);
    }
  }

  async function runPurchaseAction(command: ShoppingCommand, success: string, productId: string | null = null) {
    if (pendingLoading || pendingError || busyProductId || busyPurchase) return false;
    setBusyPurchase(true);
    setBusyProductId(productId);
    setActionError('');
    setNotice('');
    try {
      setShopping((await enqueueShoppingCommand(command)).shopping);
      setNotice(success);
      void syncShopping();
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusyProductId(null);
      setBusyPurchase(false);
    }
  }

  const shared: PendingViewProps = {
    pendingItems, pendingLoading, pendingError, actionError, notice, busyProductId,
    onRetryPending: () => setShoppingRefresh((value) => value + 1), onTogglePending: togglePending,
  };

  return (
    <>
      {route === '/add' ? <CatalogPage {...shared} categories={catalog?.categories ?? []} products={catalog?.products ?? []}
        catalogLoading={catalogLoading} catalogError={catalogError} onRetryCatalog={() => setCatalogRefresh((value) => value + 1)}
        onCatalogChanged={refreshAfterCatalogChange} /> : <ShoppingListPage {...shared}
        purchase={purchase} busyPurchase={busyPurchase}
        onBuy={(productId) => runPurchaseAction({ kind: 'buyPending', productId }, 'Producto marcado como comprado.', productId)}
        onChangePrice={(productId, priceCents) => runPurchaseAction({ kind: 'changePrice', productId, priceCents }, 'Precio actualizado.', productId)}
        onUndo={(productId) => runPurchaseAction({ kind: 'undoPurchased', productId }, 'Producto devuelto a pendientes.', productId)}
        onFinish={() => runPurchaseAction({ kind: 'finishPurchase' }, 'Compra finalizada. Los productos pendientes siguen en la lista.')}
      />}
      <nav aria-label="Navegación principal" className="app-nav">
        <div className="app-nav-inner">
          <a href="/add" aria-current={route === '/add' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate('/add'); }} className="app-nav-link">
            <span aria-hidden="true" className="app-nav-icon">+</span><span>Agregar</span>
          </a>
          <a href="/list" aria-label={pendingLoading || pendingError ? 'Lista' : `Lista (${pendingItems.length})`}
            aria-current={route === '/list' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate('/list'); }} className="app-nav-link">
            <span aria-hidden="true" className="app-nav-icon">▣</span><span>Lista</span>
          </a>
        </div>
      </nav>
    </>
  );
}

type AuthorizationState = 'checking' | 'authorized' | 'unauthorized' | 'unavailable';

export function App() {
  const [authorization, setAuthorization] = useState<AuthorizationState>('checking');
  const checkSequence = useRef(0);
  const markerWrite = useRef<Promise<void>>(Promise.resolve());

  const saveAuthorization = useCallback((authorized: boolean) => {
    const write = markerWrite.current.catch(() => undefined).then(() => writeLocalAuthorization(authorized));
    markerWrite.current = write;
    return write;
  }, []);

  const unauthorized = useCallback(() => {
    checkSequence.current += 1;
    void saveAuthorization(false).catch(() => undefined);
    setAuthorization('unauthorized');
  }, [saveAuthorization]);

  const verifySession = useCallback(async () => {
    const sequence = ++checkSequence.current;
    try {
      await checkDeviceSession();
      if (sequence !== checkSequence.current) return;
      await saveAuthorization(true);
      if (sequence === checkSequence.current) setAuthorization('authorized');
    } catch (error) {
      if (sequence !== checkSequence.current) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        unauthorized();
      } else {
        const wasAuthorized = await readLocalAuthorization().catch(() => false);
        if (sequence === checkSequence.current) setAuthorization(wasAuthorized ? 'authorized' : 'unavailable');
      }
    }
  }, [saveAuthorization, unauthorized]);

  useEffect(() => {
    if (authorization === 'unauthorized') document.title = 'Vincular dispositivo · Hogar natural';
    if (authorization === 'unavailable') document.title = 'Servidor no disponible · Hogar natural';
  }, [authorization]);

  useEffect(() => {
    void verifySession();
    const onOnline = () => { void verifySession(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('device-unauthorized', unauthorized);
    return () => {
      checkSequence.current += 1;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('device-unauthorized', unauthorized);
    };
  }, [verifySession, unauthorized]);

  if (authorization === 'checking') return <main className="app-screen"><div className="app-content" role="status">Cargando…</div></main>;
  if (authorization === 'unavailable') return <main className="app-screen"><div className="app-content">
    <h1 className="app-title">Servidor no disponible</h1>
    <p className="app-subtitle mt-2">Conéctate al servidor para vincular este dispositivo.</p>
    <button type="button" className="app-primary mt-6 px-5" onClick={() => void verifySession()}>Reintentar</button>
  </div></main>;
  if (authorization === 'unauthorized') return <PairDevicePage onPaired={async () => {
    checkSequence.current += 1;
    await saveAuthorization(true);
    setAuthorization('authorized');
  }} />;
  return <ShoppingApp onUnauthorized={unauthorized} />;
}
