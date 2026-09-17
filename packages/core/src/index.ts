/**
 * Public surface of the domain core (SPEC.md §3).
 *
 * Pure TypeScript only: no Express, Prisma, Redis, React or platform APIs, so
 * the same rules run in the API and in the browser (SPEC.md §0.6).
 */
export * from './types';
export * from './time';
export * from './timeSelfCheck';
export * from './timezones';
export * from './schemas';
export * from './rules';
export * from './metrics';
export * from './reminderPlan';
