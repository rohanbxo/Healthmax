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

export function CalendarRoute(): React.ReactElement {
  return (
    <MilestonePlaceholder
      eyebrow="CALENDAR"
      title="Calendar"
      milestone="M8"
      planned={[
        'Day / Month / Year segmented control, defaulting to Month',
        'Cells shaded by done against scheduled, with a habit filter',
        'Day view with editable statuses inside the backfill window',
      ]}
    />
  );
}

export function StatsRoute(): React.ReactElement {
  return (
    <MilestonePlaceholder
      eyebrow="STATS"
      title="Stats"
      milestone="M8"
      planned={[
        'Overall accuracy over 7, 30 and 90 days',
        'Per habit current streak, best streak and 30-day accuracy',
        'A 30-day dot strip per habit',
      ]}
    />
  );
}

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
