import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import ShareTargetPage from './ShareTargetPage';

function LocationSpy() {
  const loc = useLocation();
  return (
    <div data-testid="location">
      {loc.pathname}
      {loc.search}
    </div>
  );
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/share-target" element={<ShareTargetPage />} />
        <Route
          path="/requests/new"
          element={
            <div data-testid="new-request">
              <LocationSpy />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ShareTargetPage', () => {
  it('forwards url and title verbatim', async () => {
    renderAt('/share-target?url=https://example.com&title=Foo');
    const node = await screen.findByTestId('location');
    expect(node.textContent).toBe(
      '/requests/new?url=https%3A%2F%2Fexample.com&title=Foo',
    );
  });

  it('extracts url from text and strips trailing punctuation', async () => {
    renderAt(
      '/share-target?text=' +
        encodeURIComponent('Check this out https://example.com/x.'),
    );
    const node = await screen.findByTestId('location');
    const search = node.textContent!.replace('/requests/new', '');
    const params = new URLSearchParams(search);
    expect(params.get('url')).toBe('https://example.com/x');
    expect(params.get('text')).toBe('Check this out');
    expect(params.get('title')).toBeNull();
  });

  it('drops text when it equals title', async () => {
    renderAt('/share-target?title=Foo&text=Foo');
    const node = await screen.findByTestId('location');
    const search = node.textContent!.replace('/requests/new', '');
    const params = new URLSearchParams(search);
    expect(params.get('title')).toBe('Foo');
    expect(params.get('text')).toBeNull();
    expect(params.get('url')).toBeNull();
  });

  it('navigates without query string when no params', async () => {
    renderAt('/share-target');
    const node = await screen.findByTestId('location');
    expect(node.textContent).toBe('/requests/new');
  });
});
