import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '../api/request';
import { pairDevice } from './deviceAuth';

export function PairDevicePage({ onPaired }: { onPaired: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('Mi dispositivo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || !name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await pairDevice(code, name.trim());
      await onPaired();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'No se pudo conectar con el servidor. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="app-screen">
    <div className="app-content">
      <h1 className="app-title">Vincular dispositivo</h1>
      <p className="app-subtitle mt-2">Introduce el código temporal generado en el servidor.</p>
      <form onSubmit={(event) => void submit(event)} className="app-surface mt-6 space-y-4 p-5">
        <div>
          <label htmlFor="pairing-code" className="app-section-title block mb-2">Código de 6 dígitos</label>
          <input id="pairing-code" className="app-field" type="text" inputMode="numeric" pattern="[0-9]{6}"
            autoComplete="one-time-code" maxLength={6} required value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
        <div>
          <label htmlFor="device-name" className="app-section-title block mb-2">Nombre del dispositivo</label>
          <input id="device-name" className="app-field" type="text" maxLength={80} required value={name}
            onChange={(event) => setName(event.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
        <button type="submit" className="app-primary w-full" disabled={submitting || code.length !== 6 || !name.trim()}>
          {submitting ? 'Vinculando…' : 'Vincular dispositivo'}
        </button>
      </form>
    </div>
  </main>;
}
