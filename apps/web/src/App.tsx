import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth, RequirePermission } from '@/components/layout/guards';
import { EmptyState } from '@/components/ui/misc';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { P } from '@/hooks/useAuth';

// Route-level code splitting: each page loads on demand
const AuditLogPage = lazy(() => import('@/features/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const OrganizationPage = lazy(() => import('@/features/admin/OrganizationPage').then((m) => ({ default: m.OrganizationPage })));
const RolesPage = lazy(() => import('@/features/admin/RolesPage').then((m) => ({ default: m.RolesPage })));
const SettingsPage = lazy(() => import('@/features/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SlaPage = lazy(() => import('@/features/admin/SlaPage').then((m) => ({ default: m.SlaPage })));
const UsersPage = lazy(() => import('@/features/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const NewTicketPage = lazy(() => import('@/features/tickets/NewTicketPage').then((m) => ({ default: m.NewTicketPage })));
const TicketDetailPage = lazy(() => import('@/features/tickets/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })));
const TicketsPage = lazy(() => import('@/features/tickets/TicketsPage').then((m) => ({ default: m.TicketsPage })));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="tickets/new" element={<RequirePermission anyOf={[P.TICKET_CREATE]}><NewTicketPage /></RequirePermission>} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="reports" element={<RequirePermission anyOf={[P.REPORT_VIEW]}><ReportsPage /></RequirePermission>} />
          <Route path="admin/users" element={<RequirePermission anyOf={[P.USER_MANAGE]}><UsersPage /></RequirePermission>} />
          <Route path="admin/roles" element={<RequirePermission anyOf={[P.ROLE_MANAGE]}><RolesPage /></RequirePermission>} />
          <Route path="admin/organization" element={<RequirePermission anyOf={[P.ORG_MANAGE]}><OrganizationPage /></RequirePermission>} />
          <Route path="admin/sla" element={<RequirePermission anyOf={[P.SLA_MANAGE]}><SlaPage /></RequirePermission>} />
          <Route path="admin/settings" element={<RequirePermission anyOf={[P.SETTINGS_MANAGE]}><SettingsPage /></RequirePermission>} />
          <Route path="admin/audit" element={<RequirePermission anyOf={[P.AUDIT_VIEW]}><AuditLogPage /></RequirePermission>} />
          <Route path="*" element={<EmptyState title="Page not found" description="The page you’re looking for doesn’t exist." />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
