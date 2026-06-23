/**
 * Lightweight pub/sub so the API layer can notify the UI about connectivity /
 * server failures without importing React. A single overlay listens and shows
 * an animated popup instead of letting the error bubble up and crash the app.
 */

export type ApiErrorKind = 'network' | 'server';

export interface ApiErrorEvent {
  kind: ApiErrorKind;
  /** HTTP status (0 when the request never reached the server). */
  status: number;
  /** User-facing Turkish message. */
  message: string;
}

type Listener = (event: ApiErrorEvent) => void;

const listeners = new Set<Listener>();

export function onApiError(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitApiError(event: ApiErrorEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A broken listener must never take down the request path.
    }
  });
}

/** Maps a status code to a friendly Turkish message. */
export function messageForStatus(status: number): string {
  if (status === 0) return 'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.';
  if (status === 401 || status === 403) return 'Oturumun sona ermiş olabilir.';
  if (status === 404) return 'Aradığın içerik bulunamadı.';
  if (status === 429) return 'Çok fazla istek gönderildi, biraz bekle.';
  if (status >= 500) return 'Sunucumuzda bir sorun var. Birazdan tekrar dene.';
  return 'Bir şeyler ters gitti.';
}
