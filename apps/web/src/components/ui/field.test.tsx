import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field } from './field';
import { Input } from './input';
import { Switch } from './switch';

describe('Field', () => {
  it('associates the label with the control', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Habit name">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText('Habit name');
    await user.type(input, 'Read');
    expect(input).toHaveValue('Read');
  });

  it('describes the control with its hint', () => {
    render(
      <Field label="Time" hint="When the reminder fires">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText('Time')).toHaveAccessibleDescription('When the reminder fires');
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <Field label="Habit name" error="Name is required">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText('Habit name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Name is required');

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Name is required');
    expect(error.className).toContain('text-danger');
  });

  it('describes the control with both hint and error', () => {
    render(
      <Field label="Password" hint="At least 10 characters" error="Too short">
        <Input type="password" />
      </Field>,
    );

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 10 characters Too short',
    );
  });

  it('leaves a valid control without aria-invalid', () => {
    render(
      <Field label="Habit name">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Habit name')).not.toHaveAttribute('aria-invalid');
  });

  it('honours an explicit id and a required flag', () => {
    render(
      <Field id="habit-name" label="Habit name" required>
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText(/Habit name/);
    expect(input).toHaveAttribute('id', 'habit-name');
    expect(input).toBeRequired();
  });

  it('supports a render function for controls that are not auto-wired', () => {
    render(
      <Field label="Notes" error="Pick one">
        {(control) => <textarea {...control} />}
      </Field>,
    );

    const control = screen.getByLabelText('Notes');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription('Pick one');
  });

  it('wires a Switch inside a field', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Remind me" hint="Web push at the due time">
        <Switch />
      </Field>,
    );

    const toggle = screen.getByLabelText('Remind me');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAccessibleDescription('Web push at the due time');

    await user.click(toggle);
    expect(toggle).toBeChecked();
  });
});
