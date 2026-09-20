/**
 * React Query bindings for the API (SPEC.md §11).
 *
 * Every hook returns `ApiError` as its error type, so screens can branch on the
 * SPEC §9 code. Reads pass the matching `@beta/core` schema to `apiFetch`,
 * which checks it in development builds only.
 */
import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type AuthDTO,
  type CreateHabitBody,
  type DayKey,
  type ForgotPasswordBody,
  type HabitDTO,
  type Instant,
  type LogDTO,
  type LogStatus,
  type LoginBody,
  type MeDTO,
  type PatchMeBody,
  type RegisterBody,
  type ResetPasswordBody,
  type SnoozeDTO,
  type SnoozeMinutes,
  type StatsDTO,
  type StatsRange,
  type TodayDTO,
  type UpdateHabitBody,
  MS_PER_SECOND,
  addMinutes,
  authDtoSchema,
  compareDayKeys,
  habitDtoSchema,
  instantToLocalParts,
  logDtoSchema,
  meDtoSchema,
  statsDtoSchema,
  todayDtoSchema,
} from '@beta/core';
import { useToast } from '@/components/ui';
import { type ApiError, apiFetch } from './client';
import { queryKeys } from './keys';

/** SPEC §11: Today is fresh for 30 seconds and refetches when the tab returns. */
const TODAY_STALE_TIME = 30_000;

const habitListSchema = habitDtoSchema.array();
const logListSchema = logDtoSchema.array();

/* ------------------------------------------------------------------- reads */

export function useMe(options: { enabled?: boolean } = {}): UseQueryResult<MeDTO, ApiError> {
  return useQuery<MeDTO, ApiError>({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => apiFetch<MeDTO>('/me', { schema: meDtoSchema, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useToday(): UseQueryResult<TodayDTO, ApiError> {
  return useQuery<TodayDTO, ApiError>({
    queryKey: queryKeys.today(),
    queryFn: ({ signal }) => apiFetch<TodayDTO>('/today', { schema: todayDtoSchema, signal }),
    staleTime: TODAY_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useHabits(): UseQueryResult<HabitDTO[], ApiError> {
  return useQuery<HabitDTO[], ApiError>({
    queryKey: queryKeys.habits(),
    queryFn: ({ signal }) => apiFetch<HabitDTO[]>('/habits', { schema: habitListSchema, signal }),
  });
}

/** `GET /logs` for an inclusive day range (SPEC.md §9; at most 400 days). */
export function useLogs(from: DayKey, to: DayKey): UseQueryResult<LogDTO[], ApiError> {
  return useQuery<LogDTO[], ApiError>({
    queryKey: queryKeys.logs(from, to),
    queryFn: ({ signal }) =>
      apiFetch<LogDTO[]>('/logs', { query: { from, to }, schema: logListSchema, signal }),
  });
}

export function useStats(range: StatsRange): UseQueryResult<StatsDTO, ApiError> {
  return useQuery<StatsDTO, ApiError>({
    queryKey: queryKeys.stats(range),
    queryFn: ({ signal }) =>
      apiFetch<StatsDTO>('/stats', { query: { range }, schema: statsDtoSchema, signal }),
  });
}

/* --------------------------------------------------------- auth mutations */

export function useLogin(): UseMutationResult<AuthDTO, ApiError, LoginBody> {
  return useMutation<AuthDTO, ApiError, LoginBody>({
    mutationFn: (body) =>
      apiFetch<AuthDTO>('/auth/login', { method: 'POST', body, schema: authDtoSchema }),
  });
}

export function useRegister(): UseMutationResult<AuthDTO, ApiError, RegisterBody> {
  return useMutation<AuthDTO, ApiError, RegisterBody>({
    mutationFn: (body) =>
      apiFetch<AuthDTO>('/auth/register', { method: 'POST', body, schema: authDtoSchema }),
  });
}

/**
 * Revokes the refresh-token family server-side. The caller then drops the local
 * session with `useAuth().signOut()`.
 */
export function useLogout(): UseMutationResult<void, ApiError, void> {
  return useMutation<void, ApiError, void>({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  });
}

/** `POST /push/test` — one notification to each of the caller's devices. */
export type PushTestReport = { sent: number; removed: number; failed: number };

export function useSendTestNotification(): UseMutationResult<PushTestReport, ApiError, void> {
  return useMutation<PushTestReport, ApiError, void>({
    mutationFn: () => apiFetch<PushTestReport>('/push/test', { method: 'POST' }),
  });
}

export function useForgotPassword(): UseMutationResult<void, ApiError, ForgotPasswordBody> {
  return useMutation<void, ApiError, ForgotPasswordBody>({
    mutationFn: (body) => apiFetch<void>('/auth/forgot-password', { method: 'POST', body }),
  });
}

export function useResetPassword(): UseMutationResult<void, ApiError, ResetPasswordBody> {
  return useMutation<void, ApiError, ResetPasswordBody>({
    mutationFn: (body) => apiFetch<void>('/auth/reset-password', { method: 'POST', body }),
  });
}

/* ------------------------------------------------------------ account */

/**
 * `PATCH /me`. A timezone or week-start change moves every due instant, so the
 * derived reads are dropped as well (SPEC.md §6 "Timezone change").
 */
export function useUpdateMe(): UseMutationResult<MeDTO, ApiError, PatchMeBody> {
  const queryClient = useQueryClient();

  return useMutation<MeDTO, ApiError, PatchMeBody>({
    mutationFn: (body) => apiFetch<MeDTO>('/me', { method: 'PATCH', body, schema: meDtoSchema }),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me(), me);
      void queryClient.invalidateQueries({ queryKey: queryKeys.today() });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/* -------------------------------------------------------- habit mutations */

/** Both habit writes drop the two reads that a schedule change can move. */
function useHabitInvalidation(): () => void {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.today() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.habits() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll() });
    // Deleting a habit hides its logs from every range (SPEC.md §8).
    void queryClient.invalidateQueries({ queryKey: queryKeys.logsAll() });
  }, [queryClient]);
}

export function useCreateHabit(): UseMutationResult<HabitDTO, ApiError, CreateHabitBody> {
  const invalidate = useHabitInvalidation();

  return useMutation<HabitDTO, ApiError, CreateHabitBody>({
    mutationFn: (body) =>
      apiFetch<HabitDTO>('/habits', { method: 'POST', body, schema: habitDtoSchema }),
    onSuccess: invalidate,
  });
}

export type UpdateHabitVariables = { id: string; body: UpdateHabitBody };

export function useUpdateHabit(): UseMutationResult<HabitDTO, ApiError, UpdateHabitVariables> {
  const invalidate = useHabitInvalidation();

  return useMutation<HabitDTO, ApiError, UpdateHabitVariables>({
    mutationFn: ({ id, body }) =>
      apiFetch<HabitDTO>(`/habits/${id}`, { method: 'PATCH', body, schema: habitDtoSchema }),
    onSuccess: invalidate,
  });
}

export function useDeleteHabit(): UseMutationResult<void, ApiError, string> {
  const invalidate = useHabitInvalidation();

  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiFetch<void>(`/habits/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/* ---------------------------------------------------- optimistic today ops */

/**
 * An ISO instant built from epoch milliseconds without touching `Date`, which
 * the date guard bans outside `packages/core/src/time.ts` (SPEC.md §13).
 * Only the optimistic snooze needs it: everything else reads instants.
 */
function toInstant(ms: number): Instant {
  const { year, month, day, hour, minute, second } = instantToLocalParts(ms, 'UTC');
  const millis = ((ms % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millis, 3)}Z`;
}

/** Everything a mutation needs to address one habit on one day. */
export type TodayTarget = { habitId: string; dayKey: DayKey };

export type LogVariables = TodayTarget & { status: LogStatus };
export type SnoozeVariables = TodayTarget & { minutes: SnoozeMinutes };

type TodayMutationContext = { previous: TodayDTO | undefined };

function withoutLog(logs: LogDTO[], target: TodayTarget): LogDTO[] {
  return logs.filter((log) => log.habitId !== target.habitId || log.dayKey !== target.dayKey);
}

function withoutSnooze(snoozes: SnoozeDTO[], target: TodayTarget): SnoozeDTO[] {
  return snoozes.filter((snooze) => snooze.habitId !== target.habitId);
}

/**
 * The one optimistic path (SPEC.md §11): `onMutate` cancels `['today']`,
 * snapshots it and applies `patch` to the cache so the tap lands instantly;
 * `onError` puts the snapshot back and toasts; `onSettled` invalidates
 * `['today']` and `['stats']` so the server has the last word.
 *
 * Undo is not a special case — it is the inverse variables sent back through
 * this same hook.
 */
function useOptimisticToday<TVariables>(options: {
  mutationFn: (variables: TVariables) => Promise<void>;
  patch: (today: TodayDTO, variables: TVariables) => TodayDTO;
  errorMessage: string;
}): UseMutationResult<void, ApiError, TVariables, TodayMutationContext> {
  const { mutationFn, patch, errorMessage } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<void, ApiError, TVariables, TodayMutationContext>({
    mutationFn,

    onMutate: async (variables) => {
      // An in-flight refetch would otherwise land on top of the optimistic edit.
      await queryClient.cancelQueries({ queryKey: queryKeys.today() });

      const previous = queryClient.getQueryData<TodayDTO>(queryKeys.today());
      if (previous !== undefined) {
        queryClient.setQueryData<TodayDTO>(queryKeys.today(), patch(previous, variables));
      }
      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context !== undefined) {
        queryClient.setQueryData<TodayDTO>(queryKeys.today(), context.previous);
      }
      toast({ title: errorMessage, description: error.message, variant: 'error' });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.today() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll() });
      // The Calendar may hold today in a cached range.
      void queryClient.invalidateQueries({ queryKey: queryKeys.logsAll() });
    },
  });
}

/**
 * Complete or skip (SPEC.md §6 "Actions"): an idempotent upsert that also
 * clears that day's snooze — so the optimistic patch clears it too.
 */
export function useLogMutation(): UseMutationResult<
  void,
  ApiError,
  LogVariables,
  TodayMutationContext
> {
  return useOptimisticToday<LogVariables>({
    mutationFn: ({ habitId, dayKey, status }) =>
      apiFetch<void>(`/habits/${habitId}/logs/${dayKey}`, { method: 'PUT', body: { status } }),
    patch: (today, variables) => ({
      ...today,
      logs: [
        ...withoutLog(today.logs, variables),
        { habitId: variables.habitId, dayKey: variables.dayKey, status: variables.status },
      ],
      snoozes: withoutSnooze(today.snoozes, variables),
    }),
    errorMessage: 'We could not save that.',
  });
}

/** Deletes the log, putting the habit back in its unlogged section. */
export function useClearLog(): UseMutationResult<
  void,
  ApiError,
  TodayTarget,
  TodayMutationContext
> {
  return useOptimisticToday<TodayTarget>({
    mutationFn: ({ habitId, dayKey }) =>
      apiFetch<void>(`/habits/${habitId}/logs/${dayKey}`, { method: 'DELETE' }),
    patch: (today, variables) => ({ ...today, logs: withoutLog(today.logs, variables) }),
    errorMessage: 'We could not undo that.',
  });
}

/** 15, 60 or 180 minutes from now; replaces any existing snooze (SPEC.md §6). */
export function useSnoozeMutation(): UseMutationResult<
  void,
  ApiError,
  SnoozeVariables,
  TodayMutationContext
> {
  return useOptimisticToday<SnoozeVariables>({
    mutationFn: ({ habitId, minutes }) =>
      apiFetch<void>(`/habits/${habitId}/snooze`, { method: 'PUT', body: { minutes } }),
    patch: (today, variables) => ({
      ...today,
      snoozes: [
        ...withoutSnooze(today.snoozes, variables),
        {
          habitId: variables.habitId,
          dayKey: variables.dayKey,
          until: toInstant(addMinutes(Date.now(), variables.minutes)),
        },
      ],
    }),
    errorMessage: 'We could not snooze that.',
  });
}

export function useClearSnooze(): UseMutationResult<
  void,
  ApiError,
  TodayTarget,
  TodayMutationContext
> {
  return useOptimisticToday<TodayTarget>({
    mutationFn: ({ habitId }) => apiFetch<void>(`/habits/${habitId}/snooze`, { method: 'DELETE' }),
    patch: (today, variables) => ({ ...today, snoozes: withoutSnooze(today.snoozes, variables) }),
    errorMessage: 'We could not clear that snooze.',
  });
}

/* ------------------------------------------------ calendar backfill (M8) */

/** `status: null` clears the day's log. */
export type DayLogVariables = TodayTarget & { status: LogStatus | null };

type LogsSnapshot = { snapshot: [readonly unknown[], LogDTO[] | undefined][] };

/** Whether a cached `['logs', from, to]` range contains `dayKey`. */
function rangeCovers(key: readonly unknown[], dayKey: DayKey): boolean {
  const [, from, to] = key;
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  return compareDayKeys(from, dayKey) <= 0 && compareDayKeys(dayKey, to) <= 0;
}

/**
 * Sets or clears one day's log from the Calendar's Day view (SPEC.md §6
 * "Backfill", §11). Optimistic like the Today path, but over every cached log
 * range that contains the day — Month and Year hold different ranges, and both
 * must move together. `onError` puts each range back; `onSettled` lets the
 * server have the last word on logs, Today and Stats.
 */
export function useDayLogMutation(): UseMutationResult<
  void,
  ApiError,
  DayLogVariables,
  LogsSnapshot
> {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<void, ApiError, DayLogVariables, LogsSnapshot>({
    mutationFn: ({ habitId, dayKey, status }) =>
      status === null
        ? apiFetch<void>(`/habits/${habitId}/logs/${dayKey}`, { method: 'DELETE' })
        : apiFetch<void>(`/habits/${habitId}/logs/${dayKey}`, { method: 'PUT', body: { status } }),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.logsAll() });

      const snapshot = queryClient.getQueriesData<LogDTO[]>({ queryKey: queryKeys.logsAll() });
      for (const [key, logs] of snapshot) {
        if (logs === undefined || !rangeCovers(key, variables.dayKey)) continue;
        const rest = withoutLog(logs, variables);
        queryClient.setQueryData<LogDTO[]>(
          key,
          variables.status === null
            ? rest
            : [
                ...rest,
                { habitId: variables.habitId, dayKey: variables.dayKey, status: variables.status },
              ],
        );
      }
      return { snapshot };
    },

    onError: (error, _variables, context) => {
      for (const [key, logs] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, logs);
      }
      toast({ title: 'We could not save that day.', description: error.message, variant: 'error' });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.logsAll() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.today() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll() });
    },
  });
}
