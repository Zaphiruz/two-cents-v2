import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AuthProvider, RequireAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';

const Placeholder = ({ title }: { title: string }) => (
  <div className="p-6 text-sm text-muted-foreground">{title} (coming soon)</div>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Placeholder title="Requests queue" />} />
              <Route path="requests/new" element={<Placeholder title="New request" />} />
              <Route path="requests/:id" element={<Placeholder title="Request detail" />} />
              <Route
                path="requests/:id/edit"
                element={<Placeholder title="Edit request" />}
              />
              <Route
                path="appeals/new/:requestId"
                element={<Placeholder title="New appeal" />}
              />
              <Route path="appeals" element={<Placeholder title="Appeals" />} />
              <Route path="household" element={<Placeholder title="Household" />} />
              <Route
                path="settings/notifications"
                element={<Placeholder title="Notification settings" />}
              />
              <Route path="feedback/new" element={<Placeholder title="New feedback" />} />
              <Route path="feedback" element={<Placeholder title="Feedback" />} />
              <Route path="admin" element={<div className="p-6">Admin (coming soon)</div>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
