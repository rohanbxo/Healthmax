/** The two modal routes that sit on top of Today (SPEC.md §11 "Routing"). */
export const NEW_HABIT_PATH = '/habits/new';

export function editHabitPath(habitId: string): string {
  return `/habits/${habitId}`;
}
