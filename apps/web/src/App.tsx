import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider, RequireAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';
import QueuePage from '@/pages/QueuePage';
import NewRequestPage from '@/pages/NewRequestPage';
import RequestDetailPage from '@/pages/RequestDetailPage';
import EditRequestPage from '@/pages/EditRequestPage';
import AppealsPage from '@/pages/AppealsPage';
import NewAppealPage from '@/pages/NewAppealPage';
import NotificationSettingsPage from '@/pages/NotificationSettingsPage';
import HouseholdPage from '@/pages/HouseholdPage';
import FeedbackPage from '@/pages/FeedbackPage';
import NewFeedbackPage from '@/pages/NewFeedbackPage';
import ShareTargetPage from '@/pages/ShareTargetPage';
import RequireAdmin from './pages/admin/RequireAdmin';
import AdminLayout from './pages/admin/AdminLayout';
import PeoplePage from './pages/admin/PeoplePage';
import HouseholdsPage from './pages/admin/HouseholdsPage';
import AdminAppealsPage from './pages/admin/AdminAppealsPage';

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
              <Route index element={<QueuePage />} />
              <Route path="requests/new" element={<NewRequestPage />} />
              <Route path="requests/:id" element={<RequestDetailPage />} />
              <Route path="requests/:id/edit" element={<EditRequestPage />} />
              <Route path="appeals/new/:requestId" element={<NewAppealPage />} />
              <Route path="appeals" element={<AppealsPage />} />
              <Route path="household" element={<HouseholdPage />} />
              <Route path="settings/notifications" element={<NotificationSettingsPage />} />
              <Route path="feedback/new" element={<NewFeedbackPage />} />
              <Route path="feedback" element={<FeedbackPage />} />
              <Route path="share-target" element={<ShareTargetPage />} />
              <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
                <Route index element={<Navigate to="people" replace />} />
                <Route path="people" element={<PeoplePage />} />
                <Route path="households" element={<HouseholdsPage />} />
                <Route path="appeals" element={<AdminAppealsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
