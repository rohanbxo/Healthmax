/**
 * Turns a zod failure into the `{ field: message }` map the screens feed to
 * `Field`'s `error` prop. Only the first issue per field is shown.
 */

type IssueLike = { path: readonly PropertyKey[]; message: string };

export function fieldErrors<TField extends string>(error: {
  issues: readonly IssueLike[];
}): Partial<Record<TField, string>> {
  const errors: Partial<Record<TField, string>> = {};

  for (const issue of error.issues) {
    const [first] = issue.path;
    if (typeof first !== 'string') continue;
    const key = first as TField;
    if (errors[key] === undefined) errors[key] = issue.message;
  }

  return errors;
}
