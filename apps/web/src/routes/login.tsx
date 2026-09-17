/**
 * `/login` (SPEC.md §11). The failure message is deliberately generic so the
 * form never reveals whether an email exists (SPEC.md §9, §12).
 */
import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginBodySchema } from '@beta/core';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { useLogin } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { type FromLocationState, HOME_PATH, LOGIN_PATH } from '@/auth/RequireAuth';
import { fieldErrors } from './form-utils';

const GENERIC_FAILURE = 'Invalid email or password';

type LoginField = 'email' | 'password';

export function LoginRoute(): React.ReactElement {
  const login = useLogin();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<LoginField, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);

    const parsed = loginBodySchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors<LoginField>(parsed.error));
      return;
    }
    setErrors({});

    try {
      const session = await login.mutateAsync(parsed.data);
      auth.signIn(session);

      const from = (location.state as FromLocationState | null)?.from?.pathname;
      navigate(from && from !== LOGIN_PATH ? from : HOME_PATH, { replace: true });
    } catch {
      // Wrong password, unknown email, locked out: one message for all of them.
      setFailure(GENERIC_FAILURE);
    }
  }

  return (
    <AuthLayout
      eyebrow="SIGN IN"
      title="Welcome back."
      description="Beta tells you what is due and when."
      footer={
        <span>
          No account yet?{' '}
          <Link to="/register" className="text-accent underline-offset-4 hover:underline">
            Create one
          </Link>
        </span>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
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

        <Field label="Password" error={errors.password} required>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        ) : null}

        <Button type="submit" variant="primary" fullWidth loading={login.isPending}>
          Sign in
        </Button>

        <Link
          to="/forgot"
          className="self-center text-sm text-muted underline-offset-4 hover:text-text hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  );
}
