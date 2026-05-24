import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import RequireAdmin from './RequireAdmin';
import * as auth from '@/lib/auth';

vi.mock('@/lib/auth');
const useUserMock = vi.mocked(auth.useUser);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route path="people" element={<div>People Stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin + AdminLayout', () => {
  beforeEach(() => useUserMock.mockReset());

  it('redirects non-admin to home', () => {
    useUserMock.mockReturnValue({
      user: { id: 1, name: 'Joe', isAdmin: false },
      isLoading: false,
      error: null,
    });
    renderAt('/admin/people');
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('People Stub')).toBeNull();
  });

  it('shows sidebar links and child route when user is admin', () => {
    useUserMock.mockReturnValue({
      user: { id: 2, name: 'Admin', isAdmin: true },
      isLoading: false,
      error: null,
    });
    renderAt('/admin/people');
    expect(screen.getByText('People Stub')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /people/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /households/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /appeals/i })).toBeInTheDocument();
  });

  it('shows nothing (loading state) while user is loading', () => {
    useUserMock.mockReturnValue({ user: null, isLoading: true, error: null });
    renderAt('/admin/people');
    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.queryByText('People Stub')).toBeNull();
  });
});
