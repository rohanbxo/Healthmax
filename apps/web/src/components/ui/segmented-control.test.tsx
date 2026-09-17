import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { SegmentedControl } from './segmented-control';

type View = 'day' | 'month' | 'year';

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const satisfies readonly { value: View; label: string }[];

function Controlled({ onChange }: { onChange?: (value: View) => void }) {
  const [value, setValue] = React.useState<View>('month');
  return (
    <SegmentedControl
      label="Calendar view"
      value={value}
      options={OPTIONS}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('exposes a radiogroup with the selected state', () => {
    render(<Controlled />);

    const group = screen.getByRole('radiogroup', { name: 'Calendar view' });
    expect(group).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'false');
  });

  it('changes value with the mouse', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Year' }));

    expect(onChange).toHaveBeenCalledWith('year');
    expect(screen.getByRole('radio', { name: 'Year' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'false');
  });

  it('ignores a click on the already selected segment (no deselect)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Month' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('changes value with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('year');
    expect(screen.getByRole('radio', { name: 'Year' })).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('month');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled segments and supports numeric ranges', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Range"
        value="7"
        options={[
          { value: '7', label: '7D' },
          { value: '30', label: '30D', disabled: true },
          { value: '90', label: '90D' },
        ]}
        onValueChange={onChange}
      />,
    );

    await user.click(screen.getByRole('radio', { name: '30D' }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: '90D' }));
    expect(onChange).toHaveBeenCalledWith('90');
  });
});
