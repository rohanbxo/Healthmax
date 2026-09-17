/**
 * `/register` (SPEC.md §9 "Auth", §11). The timezone is pre-filled from the
 * browser and stays editable; onboarding confirms it.
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { guessTimeZone, registerBodySchema } from '@beta/core';
import { AuthLayout } from '@/components/AuthLayout';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { Button, Field, Input } from '@/components/ui';
import { useRegister } from '@/api/hooks';
import { isApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { HOME_PATH } from '@/auth/RequireAuth';
import { fieldErrors } from './form-utils';

type RegisterField = 'name' | 'email' | 'password' | 'timeZone';

export function RegisterRoute(): React.ReactElement {
  const register = useRegister();
  const auth = useAuth();
  const navigate = useNavigate();

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [timeZone, setTimeZone] = React.useState(() => guessTimeZone());
  const [errors, setErrors] = React.useState<Partial<Record<RegisterField, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    const parsed = registerBodySchema.safeParse({ name, email, password, timeZone });
    if (!parsed.success) {
      setErrors(fieldErrors<RegisterField>(parsed.error));
      return;
    }
    setErrors({});

    try {
      const session = await register.mutateAsync(parsed.data);
      auth.signIn(session);
      // A fresh account is not onboarded, so the guard forwards to /onboarding.
      navigate(HOME_PATH, { replace: true });
    } catch (error) {
      setFailure(
        isApiError(error) && error.code === 'CONFLICT'
          ? 'That email already has an account.'
          : 'We could not create your account. Try again.',
      );
    }
  }

  return (
    <AuthLayout
      eyebrow="CREATE ACCOUNT"
      title="Start with one habit."
      description="Beta reminds you when it is due. One tap marks it done."
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/login" className="text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <Field label="Name" error={errors.name} required>
          <Input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Email" error={errors.email} required>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Password" hint="At least 10 characters." error={errors.password} required>
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Field
          label="Time zone"
          hint="Used for due times and reminders."
          error={errors.timeZone}
          required
        >
          <TimeZonePicker value={timeZone} onChange={setTimeZone} />
        </Field>

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={register.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
