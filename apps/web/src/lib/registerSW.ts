/**
 * registerSW — Service worker registration helper (Phase 12.2)
 *
 * Registers /sw.js only in production builds and only if the browser
 * supports service workers. Errors are logged but never thrown.
 */
export function registerSW(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Service worker registration failed:', err);
    });
  });
}
