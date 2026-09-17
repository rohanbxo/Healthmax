/**
 * The authenticated shell: a 480px column with a bottom tab bar on mobile and
 * desktop alike (SPEC.md §4).
 *
 * It publishes `--tab-bar-height` so the `Toaster` can float just above the
 * bar, and adds the iOS safe-area inset to the bar's own padding.
 */
import * as React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CalendarDays, ChartColumn, CircleCheck, type LucideIcon, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const TAB_BAR_HEIGHT_PX = 72;

type Tab = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** `/` must only match exactly, or it stays active everywhere. */
  end?: boolean;
};

const TABS: readonly Tab[] = [
  { to: '/', label: 'Today', icon: CircleCheck, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/stats', label: 'Stats', icon: ChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const shellStyle = { '--tab-bar-height': `${TAB_BAR_HEIGHT_PX}px` } as React.CSSProperties;

export function AppShell(): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-base" style={shellStyle}>
      <main
        className={cn(
          'mx-auto w-full max-w-[480px] flex-1 px-4 pt-[env(safe-area-inset-top)]',
          // Room for the fixed tab bar plus the home indicator.
          'pb-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom)+16px)]',
        )}
      >
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-base/95 backdrop-blur',
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <ul className="mx-auto flex w-full max-w-[480px] items-stretch justify-around px-2">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'tap-target flex h-[72px] flex-col items-center justify-center gap-1',
                    'rounded-control text-[11px] transition-colors',
                    isActive ? 'text-accent' : 'text-muted hover:text-text',
                  )
                }
              >
                <tab.icon className="size-6" aria-hidden />
                <span className="section-label text-[10px]">{tab.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
