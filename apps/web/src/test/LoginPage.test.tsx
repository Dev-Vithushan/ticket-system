import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '@/features/auth/LoginPage';
import { AuthProvider } from '@/hooks/useAuth';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.cookie = 'tms_csrf=t; path=/';
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/me' || url === '/api/auth/refresh') return Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }));
      if (url === '/api/auth/config') return Promise.resolve(json(200, { data: { organizationName: 'Acme', allowSelfRegistration: false } }));
      if (url === '/api/auth/login') return Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }));
      return Promise.resolve(json(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('validates on the client before calling the API', async () => {
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/login')).toBe(false);
  });

  it('shows the server error for bad credentials', async () => {
    renderLogin();
    await userEvent.type(await screen.findByLabelText('Email'), 'someone@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    await waitFor(() => expect(screen.getByText('Welcome to Acme')).toBeInTheDocument());
  });
});
