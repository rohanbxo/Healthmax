import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { VALID_PASSWORD, failLogin, mswState } from '@/test/msw/handlers';
import { getAccessToken } from '@/auth/tokenStore';

async function renderLogin() {
  const view = renderWithProviders(<AppRoutes />, { route: '/login' });
  await screen.findByRole('heading', { name: 'Welcome back.' });
  return view;
}

describe('login screen', () => {
  it('validates the form before calling the API', async () => {
    const { user } = await renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(mswState.loginCalls).toBe(0);
    expect(getAccessToken()).toBeNull();
  });

  it('shows one generic message for any rejected sign-in', async () => {
    failLogin();
    const { user } = await renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'rider@example.com');
    await user.type(screen.getByLabelText(/password/i), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(mswState.loginCalls).toBe(1);
    expect(getAccessToken()).toBeNull();
    // Still on the login screen.
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });

  it('stores the token and navigates on a successful sign-in', async () => {
    const { user } = await renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'rider@example.com');
    await user.type(screen.getByLabelText(/password/i), VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(getAccessToken()).toBe(mswState.session?.accessToken);
    expect(mswState.loginCalls).toBe(1);
  });
});
