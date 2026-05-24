import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

describe('App', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('renders without crashing', () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
