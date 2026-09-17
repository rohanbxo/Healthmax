/**
 * `/forgot` (SPEC.md §9). The API always answers 204; the screen always shows
 * the same confirmation, success or failure, so the form cannot be used to
 * discover which addresses have accounts.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordBodySchema } from '@beta/core';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { useForgotPassword } from '@/api/hooks';
import { fieldErrors } from './form-utils';

export const FORGOT_CONFIRMATION = 'If that address has an account, we sent a link.';

export function ForgotRoute(): React.ReactElement {
  const forgotPassword = useForgotPassword();
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const parsed = forgotPasswordBodySchema.safeParse({ email });
    if (!parsed.success) {
      setError(fieldErrors<'email'>(parsed.error).email);
      return;
    }
    setError(undefined);

    try {
      await forgotPassword.mutateAsync(parsed.data);
    } catch {
      // Rate limited or offline: still say the same thing.
    }
    setSent(true);
  }

  return (
    <AuthLayout
      eyebrow="RESET PASSWORD"
      title="We will email you a link."
      footer={
        <Link to="/login" className="text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-sm text-text">
          {FORGOT_CONFIRMATION}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
        >
          <Field label="Email" error={error} required>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Button type="submit" variant="primary" fullWidth loading={forgotPassword.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
