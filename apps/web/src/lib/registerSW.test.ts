import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSW } from './registerSW';

describe('registerSW', () => {
  const originalProd = import.meta.env.PROD;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    (import.meta.env as Record<string, unknown>).PROD = originalProd;
    // Clean up any serviceWorker we attached
    if ('serviceWorker' in navigator) {
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    }
  });

  it('skips registration when not in production', () => {
    (import.meta.env as Record<string, unknown>).PROD = false;
    (navigator as unknown as Record<string, unknown>).serviceWorker = {
      register: vi.fn(),
    };

    registerSW();

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('skips registration when serviceWorker is not in navigator', () => {
    (import.meta.env as Record<string, unknown>).PROD = true;
    // Ensure serviceWorker absent
    if ('serviceWorker' in navigator) {
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    }

    registerSW();

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('registers /sw.js on window load when in production with serviceWorker support', () => {
    (import.meta.env as Record<string, unknown>).PROD = true;
    const register = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as Record<string, unknown>).serviceWorker = { register };

    registerSW();

    expect(addEventListenerSpy).toHaveBeenCalledWith('load', expect.any(Function));
    const handler = addEventListenerSpy.mock.calls[0]![1] as () => void;
    handler();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });
});
