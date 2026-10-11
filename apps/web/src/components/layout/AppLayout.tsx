import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScrollText,
  Search,
  Settings,
  Sun,
  Ticket,
  User,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { P, useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  show: boolean;
  end?: boolean;
}

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  if (!user) return null;

  const main: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true, end: true },
    { to: '/tickets', label: user.role.isStaff ? 'Tickets' : 'My tickets', icon: Ticket, show: true },
    { to: '/reports', label: 'Reports', icon: BarChart3, show: can(P.REPORT_VIEW) },
    { to: '/notifications', label: 'Notifications', icon: Bell, show: true },
  ];
  const admin: NavItem[] = [
    { to: '/admin/users', label: 'Users', icon: Users, show: can(P.USER_MANAGE) },
    { to: '/admin/roles', label: 'Roles & permissions', icon: KeyRound, show: can(P.ROLE_MANAGE) },
    { to: '/admin/organization', label: 'Organization', icon: Building2, show: can(P.ORG_MANAGE) },
    { to: '/admin/sla', label: 'SLA & business hours', icon: Gauge, show: can(P.SLA_MANAGE) },
    { to: '/admin/settings', label: 'System settings', icon: Settings, show: can(P.SETTINGS_MANAGE) },
    { to: '/admin/audit', label: 'Audit log', icon: ScrollText, show: can(P.AUDIT_VIEW) },
  ].filter((i) => i.show);

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-white/5 hover:text-sidebar-foreground',
          isActive && 'bg-white/10 text-sidebar-foreground',
        )
      }
    >
      <item.icon className="h-4 w-4" aria-hidden />
      {item.label}
    </NavLink>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <ClipboardList className="h-4 w-4 text-white" aria-hidden />
        </div>
        <span className="font-semibold tracking-tight">Support Desk</span>
      </div>
      {can(P.TICKET_CREATE) && (
        <div className="px-3 pb-2">
          <Button className="w-full justify-start" onClick={() => navigate('/tickets/new')}>
            <Plus /> New ticket
          </Button>
        </div>
      )}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2" aria-label="Main">
        <div className="space-y-1">{main.filter((i) => i.show).map(link)}</div>
        {admin.length > 0 && (
          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-muted/70">Administration</p>
            <div className="space-y-1">{admin.map(link)}</div>
          </div>
        )}
      </nav>
      <div className="border-t border-white/10 p-3 text-xs text-sidebar-muted">
        Signed in as <span className="font-medium text-sidebar-foreground">{user.role.name}</span>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            {sidebar}
            <button className="absolute right-3 top-4 text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <form
            className="relative max-w-md flex-1"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/tickets?search=${encodeURIComponent(search.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets by number, subject or requester…"
              aria-label="Search tickets"
              className="h-9 w-full rounded-md border border-input bg-muted/40 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 flex items-center gap-2 rounded-md p-1 hover:bg-accent" aria-label="Account menu">
                  <Avatar name={user.name} />
                  <span className="hidden text-left text-sm leading-tight md:block">
                    <span className="block font-medium">{user.name}</span>
                    <span className="block text-xs text-muted-foreground">{user.role.name}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <User /> Profile & security
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 p-3 sm:p-5 lg:p-6">
          <Suspense fallback={<div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-64" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
