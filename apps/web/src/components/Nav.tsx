import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { logout, useUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'text-sm font-medium transition-colors hover:text-foreground',
    isActive ? 'text-foreground' : 'text-muted-foreground',
  );

export function Nav() {
  const { user } = useUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex items-center gap-4">
          <NavLink to="/" className="text-base font-semibold">
            Two Cents
          </NavLink>
          <NavLink to="/settings/notifications" className={linkClass}>
            Settings
          </NavLink>
          <NavLink to="/household" className={linkClass}>
            Household
          </NavLink>
          <NavLink to="/feedback" className={linkClass}>
            Feedback
          </NavLink>
          {user?.isAdmin && (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          )}
        </nav>
        <div className="flex items-center gap-3">
          {user && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.name}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
