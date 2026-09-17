/**
 * React Query bindings for the API (SPEC.md §11).
 *
 * Every hook returns `ApiError` as its error type, so screens can branch on the
 * SPEC §9 code. Reads pass the matching `@beta/core` schema to `apiFetch`,
 * which checks it in development builds only.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  type AuthDTO,
  type ForgotPasswordBody,
  type HabitDTO,
  type LoginBody,
  type MeDTO,
  type PatchMeBody,
  type RegisterBody,
  type ResetPasswordBody,
  type StatsDTO,
  type StatsRange,
  type TodayDTO,
  authDtoSchema,
  habitDtoSchema,
  meDtoSchema,
  statsDtoSchema,
  todayDtoSchema,
} from '@beta/core';
import { type ApiError, apiFetch } from './client';
import { queryKeys } from './keys';

/** SPEC §11: Today is fresh for 30 seconds and refetches when the tab returns. */
const TODAY_STALE_TIME = 30_000;

const habitListSchema = habitDtoSchema.array();

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

/*
 * M7 adds the optimistic log / skip / clear / snooze mutations here
 * (SPEC.md §11 "React Query"): `onMutate` cancels ['today'], snapshots it and
 * applies the change; `onError` restores the snapshot and toasts; `onSettled`
 * invalidates ['today'] and ['stats']. Undo replays the inverse mutation
 * through the same path.
 */
