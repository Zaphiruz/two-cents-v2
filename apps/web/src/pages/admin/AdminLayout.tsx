import { NavLink, Outlet } from 'react-router-dom';

const sections = [
  { to: 'people', label: 'People' },
  { to: 'households', label: 'Households' },
  { to: 'appeals', label: 'Appeals' },
  // Feedback + Search added in PR 2
];

export default function AdminLayout() {
  return (
    <div className="flex gap-6 p-6">
      <nav className="w-48 shrink-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Admin
        </h2>
        <ul className="space-y-1">
          {sections.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                className={({ isActive }) =>
                  `block rounded px-2 py-1 text-sm ${
                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  }`
                }
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
