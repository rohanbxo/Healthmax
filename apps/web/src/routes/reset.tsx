/**
 * `/reset?token=` (SPEC.md §9). The token arrives in the emailed link; a
 * successful reset revokes every refresh token server-side, so the user signs
 * in again afterwards.
 */
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPasswordBodySchema } from '@beta/core';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { useResetPassword } from '@/api/hooks';
import { fieldErrors } from './form-utils';

const LINK_PROBLEM = 'That reset link is invalid or has expired. Ask for a new one.';

type ResetField = 'token' | 'password';

export function ResetRoute(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const resetPassword = useResetPassword();

  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<ResetField, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    const parsed = resetPasswordBodySchema.safeParse({ token, password });
    if (!parsed.success) {
      const issues = fieldErrors<ResetField>(parsed.error);
      setErrors(issues);
      if (issues.token) setFailure(LINK_PROBLEM);
      return;
    }
    setErrors({});

    try {
      await resetPassword.mutateAsync(parsed.data);
      setDone(true);
    } catch {
      setFailure(LINK_PROBLEM);
    }
  }

  return (
    <AuthLayout
      eyebrow="NEW PASSWORD"
      title="Choose a new password."
      footer={
        <Link to="/login" className="text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <p role="status" className="text-sm text-text">
          Your password has been updated. Sign in with it now.
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
        >
          <Field
            label="New password"
            hint="At least 10 characters."
            error={errors.password}
            required
          >
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure}
            </p>
          ) : null}

          <Button type="submit" variant="primary" fullWidth loading={resetPassword.isPending}>
            Set new password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
