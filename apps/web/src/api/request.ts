type ApiError = { error?: { code?: string; message?: string } };

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export function operationHeaders(operationId?: string) {
  return operationId ? { 'X-Operation-Id': operationId } : undefined;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    if (response.status === 401 && path !== '/device/session' && path !== '/device/pair') {
      window.dispatchEvent(new Event('device-unauthorized'));
    }
    throw new ApiRequestError(error?.message ?? 'No se pudo completar la solicitud. Intenta de nuevo.', response.status, error?.code);
  }
  return body as T;
}
