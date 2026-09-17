import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { signInMswUser } from '@/test/msw/handlers';

describe('routing', () => {
  it('renders the not-found screen for an unknown path', async () => {
    signInMswUser({ onboarded: true });

    renderWithProviders(<AppRoutes />, { route: '/nope' });

    expect(await screen.findByRole('heading', { name: 'Nothing lives here.' })).toBeInTheDocument();
  });

  it('serves the register screen publicly', async () => {
    renderWithProviders(<AppRoutes />, { route: '/register' });

    expect(
      await screen.findByRole('heading', { name: 'Start with one habit.' }),
    ).toBeInTheDocument();
  });

  it('confirms a password reset request without revealing the address', async () => {
    const { user } = renderWithProviders(<AppRoutes />, { route: '/forgot' });
    await screen.findByRole('heading', { name: 'We will email you a link.' });

    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText('If that address has an account, we sent a link.'),
    ).toBeInTheDocument();
  });

  it('exposes the time self-check in development builds', async () => {
    renderWithProviders(<AppRoutes />, { route: '/dev/time-check' });

    expect(
      await screen.findByRole('heading', { name: 'Intl known-answer tests' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('time-check-summary')).toHaveTextContent(/\d+ \/ \d+ passed/);
  });
});
