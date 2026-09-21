/**
 * Settings (SPEC.md §11 "Screens"): account details that save themselves,
 * notifications, export and import, sign out, and deleting the account.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, SectionLabel } from '@/components/ui';
import { AccountSettings } from '@/components/AccountSettings';
import { DataSettings } from '@/components/DataSettings';
import { NotificationSettings } from '@/components/NotificationSettings';
import { useLogout } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { LOGIN_PATH } from '@/auth/RequireAuth';

export function SettingsRoute(): React.ReactElement {
  const { me, signOut } = useAuth();
  const logout = useLogout();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    try {
      // Revokes the refresh-token family; the local session goes either way.
      await logout.mutateAsync();
    } catch {
      // Already expired server-side: signing out locally is still correct.
    }
    signOut();
    navigate(LOGIN_PATH, { replace: true });
  }

  return (
    <div className="flex flex-col gap-6 pt-4 pb-4">
      <header className="flex flex-col gap-1">
        <SectionLabel>SETTINGS</SectionLabel>
        <h1 className="sr-only">Settings</h1>
      </header>

      <AccountSettings />
      <NotificationSettings />
      <DataSettings />

      <section className="flex flex-col gap-2" aria-label="Session">
        <SectionLabel>SESSION</SectionLabel>
        <p className="font-mono text-sm text-muted">{me?.email}</p>
        <Button
          variant="outline"
          fullWidth
          loading={logout.isPending}
          onClick={() => void handleSignOut()}
        >
          Sign out
        </Button>
      </section>
    </div>
  );
}
