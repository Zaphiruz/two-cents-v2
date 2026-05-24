import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '@/lib/auth';

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();
  if (isLoading) return null;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
