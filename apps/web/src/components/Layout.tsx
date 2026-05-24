import { Outlet } from 'react-router-dom';
import { IOSInstallHint } from './IOSInstallHint';
import { Nav } from './Nav';

export function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <IOSInstallHint />
        <Outlet />
      </main>
    </div>
  );
}
