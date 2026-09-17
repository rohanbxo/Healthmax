/**
 * Shared zod schemas (SPEC.md §5).
 *
 * The API validates every request body, param and query with these at the route
 * boundary; the web client parses responses with them in development builds.
 * Request bodies are strict objects, so unknown fields are rejected
 * (SPEC.md §12).
 */
import { z } from 'zod';
import { isValidDayKey, isValidTime, isValidTimeZone } from './time';

/* ------------------------------------------------------------------ atoms */

export const dayKeySchema = z
  .string()
  .refine(isValidDayKey, { message: 'Expected a real calendar day as YYYY-MM-DD' });

export const timeOfDaySchema = z
  .string()
  .refine(isValidTime, { message: 'Expected a 24-hour time as HH:mm' });

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'Unknown IANA time zone' });

export const weekStartSchema = z.union([z.literal(0), z.literal(1)]);

export const instantSchema = z.iso.datetime({ offset: true });

export const logStatusSchema = z.enum(['done', 'skipped']);

export const dayStatusSchema = z.enum([
  'done',
  'skipped',
  'snoozed',
  'overdue',
  'upcoming',
  'missed',
  'unscheduled',
]);

export const snoozeMinutesSchema = z.union([z.literal(15), z.literal(60), z.literal(180)]);

export const habitNameSchema = z.string().trim().min(1, 'Name is required').max(60);

export const userNameSchema = z.string().trim().min(1, 'Name is required').max(60);

export const emailSchema = z
  .email('Enter a valid email address')
  .max(254)
  .transform((value) => value.toLowerCase());

/** SPEC §9: minimum 10 characters. Capped so argon2 cannot be used as a DoS. */
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);

/* --------------------------------------------------------------- schedule */

const weekdaysArraySchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day')
  .max(7)
  .refine((days) => new Set(days).size === days.length, { message: 'Days must be unique' });

/** Accepts weekdays in any order and normalises them to sorted + unique. */
export const scheduleSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('daily') }),
    z.strictObject({ kind: z.literal('weekdays'), days: weekdaysArraySchema }),
    z.strictObject({ kind: z.literal('timesPerWeek'), count: z.number().int().min(1).max(7) }),
  ])
  .transform((schedule) =>
    schedule.kind === 'weekdays'
      ? { kind: 'weekdays' as const, days: [...schedule.days].sort((a, b) => a - b) }
      : schedule,
  );

/** The stored and serialised form: already normalised, so no transform. */
export const scheduleDtoSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily') }),
  z.strictObject({
    kind: z.literal('weekdays'),
    days: weekdaysArraySchema.refine(
      (days) => days.every((day, i) => i === 0 || day > (days[i - 1] ?? -1)),
      { message: 'Days must be sorted ascending' },
    ),
  }),
  z.strictObject({ kind: z.literal('timesPerWeek'), count: z.number().int().min(1).max(7) }),
]);

/* ------------------------------------------------------------------- DTOs */

export const habitDtoSchema = z.object({
  id: z.uuid(),
  name: habitNameSchema,
  schedule: scheduleDtoSchema,
  time: timeOfDaySchema,
  remind: z.boolean(),
  createdDayKey: dayKeySchema,
  archived: z.boolean(),
  order: z.number().int(),
});

export const logDtoSchema = z.object({
  habitId: z.uuid(),
  dayKey: dayKeySchema,
  status: logStatusSchema,
});

export const snoozeDtoSchema = z.object({
  habitId: z.uuid(),
  dayKey: dayKeySchema,
  until: instantSchema,
});

export const meDtoSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: userNameSchema,
  timeZone: z.string(),
  weekStart: weekStartSchema,
  onboarded: z.boolean(),
});

export const authDtoSchema = z.object({ accessToken: z.string().min(1), me: meDtoSchema });

export const todayDtoSchema = z.object({
  serverNow: instantSchema,
  dayKey: dayKeySchema,
  timeZone: z.string(),
  weekStart: weekStartSchema,
  habits: z.array(habitDtoSchema),
  logs: z.array(logDtoSchema),
  snoozes: z.array(snoozeDtoSchema),
});

export const habitStatsDtoSchema = z.object({
  habitId: z.uuid(),
  currentStreak: z.number().int().min(0),
  bestStreak: z.number().int().min(0),
  accuracy30: z.number().min(0).max(1).nullable(),
  last30: z.array(z.object({ dayKey: dayKeySchema, status: dayStatusSchema })),
});

export const statsRangeSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]);

export const statsDtoSchema = z.object({
  range: statsRangeSchema,
  dayKey: dayKeySchema,
  overallAccuracy: z.number().min(0).max(1).nullable(),
  habits: z.array(habitStatsDtoSchema),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'NOT_FOUND',
      'CONFLICT',
      'UNPROCESSABLE',
      'RATE_LIMITED',
      'INTERNAL',
    ]),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});

/* --------------------------------------------------------------- requests */

export const registerBodySchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  name: userNameSchema,
  timeZone: timeZoneSchema,
});

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const forgotPasswordBodySchema = z.strictObject({ email: emailSchema });

export const resetPasswordBodySchema = z.strictObject({
  token: z.string().min(16).max(512),
  password: passwordSchema,
});

export const patchMeBodySchema = z
  .strictObject({
    name: userNameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    weekStart: weekStartSchema.optional(),
    onboarded: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export const deleteMeBodySchema = z.strictObject({ password: z.string().min(1).max(200) });

export const createHabitBodySchema = z.strictObject({
  name: habitNameSchema,
  schedule: scheduleSchema,
  time: timeOfDaySchema,
  remind: z.boolean().optional(),
  order: z.number().int().min(0).max(10_000).optional(),
});

export const updateHabitBodySchema = z
  .strictObject({
    name: habitNameSchema.optional(),
    schedule: scheduleSchema.optional(),
    time: timeOfDaySchema.optional(),
    remind: z.boolean().optional(),
    archived: z.boolean().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export const putLogBodySchema = z.strictObject({ status: logStatusSchema });

export const putSnoozeBodySchema = z.strictObject({ minutes: snoozeMinutesSchema });

export const habitIdParamsSchema = z.object({ id: z.uuid('Unknown habit') });

export const habitDayParamsSchema = z.object({
  id: z.uuid('Unknown habit'),
  dayKey: dayKeySchema,
});

/** SPEC §8: log range queries are capped at 400 days. */
export const MAX_LOG_RANGE_DAYS = 400;

export const logsQuerySchema = z.object({
  from: dayKeySchema,
  to: dayKeySchema,
  habitId: z.uuid().optional(),
});

export const statsQuerySchema = z.object({
  range: z.coerce.number().pipe(statsRangeSchema).default(30),
});

export const pushSubscriptionBodySchema = z.strictObject({
  endpoint: z.url().max(1024),
  keys: z.strictObject({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
  userAgent: z.string().max(512).optional(),
});

export const pushUnsubscribeBodySchema = z.strictObject({ endpoint: z.url().max(1024) });

export const exportDtoSchema = z.object({
  app: z.literal('beta'),
  schemaVersion: z.literal(1),
  exportedAt: instantSchema,
  me: meDtoSchema,
  habits: z.array(habitDtoSchema),
  logs: z.array(logDtoSchema),
});

/** Import accepts an export file; the server ignores `me` and writes the caller's data. */
export const importBodySchema = z.object({
  app: z.literal('beta'),
  schemaVersion: z.literal(1),
  habits: z.array(habitDtoSchema).max(500),
  logs: z.array(logDtoSchema).max(200_000),
});

/* ------------------------------------------------------------ inferred IO */

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type PatchMeBody = z.infer<typeof patchMeBodySchema>;
export type DeleteMeBody = z.infer<typeof deleteMeBodySchema>;
export type CreateHabitBody = z.infer<typeof createHabitBodySchema>;
export type UpdateHabitBody = z.infer<typeof updateHabitBodySchema>;
export type PutLogBody = z.infer<typeof putLogBodySchema>;
export type PutSnoozeBody = z.infer<typeof putSnoozeBodySchema>;
export type LogsQuery = z.infer<typeof logsQuerySchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;
export type ImportBody = z.infer<typeof importBodySchema>;
