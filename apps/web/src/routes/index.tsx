/**
 * The route table (SPEC.md §11 "Routing").
 *
 *   public        /login  /register  /forgot  /reset?token=
 *   authenticated /onboarding
 *   authenticated + shell  /  /calendar  /stats  /settings
 *   development   /dev/time-check
 *   fallback      *
 *
 * `/habits/new` and `/habits/:id` are modal routes M7 adds on top of the shell.
 * Exported separately from `App` so tests can mount it inside a `MemoryRouter`.
 */
import * as React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { PublicOnly, RequireAuth } from '@/auth/RequireAuth';
import { LoginRoute } from './login';
import { RegisterRoute } from './register';
import { ForgotRoute } from './forgot';
import { ResetRoute } from './reset';
import { OnboardingRoute } from './onboarding';
import { CalendarRoute, SettingsRoute, StatsRoute, TodayRoute } from './placeholders';
import { TimeCheckRoute } from './time-check';
import { NotFoundRoute } from './not-found';

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/register" element={<RegisterRoute />} />
        <Route path="/forgot" element={<ForgotRoute />} />
        <Route path="/reset" element={<ResetRoute />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingRoute />} />

        <Route element={<AppShell />}>
          <Route index element={<TodayRoute />} />
          <Route path="/calendar" element={<CalendarRoute />} />
          <Route path="/stats" element={<StatsRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
        </Route>
      </Route>

      {import.meta.env.DEV ? <Route path="/dev/time-check" element={<TimeCheckRoute />} /> : null}

      <Route path="*" element={<NotFoundRoute />} />
    </Routes>
  );
}
