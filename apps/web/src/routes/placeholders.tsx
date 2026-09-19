/**
 * Placeholders for the authenticated screens that later milestones own
 * (SPEC.md §15). They exist so the shell, the tab bar and the guards can be
 * exercised end to end; none of them implements its milestone's behaviour.
 *
 * The one piece of real behaviour here is signing out, because that is auth
 * plumbing this milestone owns.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { MilestonePlaceholder } from '@/components/MilestonePlaceholder';
import { Button, SectionLabel } from '@/components/ui';
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
    <div className="flex flex-col gap-4">
      <MilestonePlaceholder
        eyebrow="SETTINGS"
        title="Settings"
        milestone="M10"
        planned={[
          'Name, time zone and week start with debounced auto-save',
          'Notification permission status, enable and test (M9)',
          'Export, import with a replace confirmation, and delete account',
        ]}
      />

      <section className="flex flex-col gap-2">
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
