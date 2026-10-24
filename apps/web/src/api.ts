let token: string | null = null;
try { token = localStorage.getItem('ff_token'); } catch { /* storage unavailable */ }

export const setToken = (t: string | null) => {
  token = t;
  try { t ? localStorage.setItem('ff_token', t) : localStorage.removeItem('ff_token'); } catch { /* ignore */ }
};
export const hasToken = () => !!token;

export class ApiError extends Error { constructor(public status: number, public body: any) { super(body?.error ?? 'error'); } }

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}
