import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { mswState, signInMswUser } from '@/test/msw/handlers';

describe('route guards', () => {
  it('sends an anonymous visitor to /login when the boot refresh fails', async () => {
    // No session in MSW: POST /auth/refresh answers 401 on load.
    renderWithProviders(<AppRoutes />, { route: '/' });

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
    expect(mswState.refreshCalls).toBe(1);
  });

  it('redirects an authenticated but un-onboarded user to /onboarding', async () => {
    signInMswUser({ onboarded: false });

    renderWithProviders(<AppRoutes />, { route: '/' });

    expect(await screen.findByRole('heading', { name: 'A few details.' })).toBeInTheDocument();
  });

  it('leaves an onboarded user on Today', async () => {
    signInMswUser({ onboarded: true });

    renderWithProviders(<AppRoutes />, { route: '/' });

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'A few details.' })).not.toBeInTheDocument();
  });

  it('keeps an onboarded user out of /onboarding', async () => {
    signInMswUser({ onboarded: true });

    renderWithProviders(<AppRoutes />, { route: '/onboarding' });

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('marks the active tab in the shell', async () => {
    signInMswUser({ onboarded: true });

    renderWithProviders(<AppRoutes />, { route: '/stats' });

    const stats = await screen.findByRole('link', { name: 'Stats' });
    expect(stats).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
  });

  it('refreshes exactly once while restoring the session', async () => {
    signInMswUser({ onboarded: true });

    renderWithProviders(<AppRoutes />, { route: '/' });

    await screen.findByRole('heading', { name: 'Today' });
    expect(mswState.refreshCalls).toBe(1);
  });
});
