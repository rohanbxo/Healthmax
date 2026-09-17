import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressSegments } from './progress-segments';

describe('ProgressSegments', () => {
  it('exposes the progress to assistive technology', () => {
    render(<ProgressSegments total={7} completed={3} label="Today's progress" />);

    const bar = screen.getByRole('progressbar', { name: "Today's progress" });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '7');
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 7 done');
  });

  it('renders one segment per item and fills the completed ones', () => {
    render(<ProgressSegments total={4} completed={2} />);

    const segments = screen.getByRole('progressbar').children;
    expect(segments).toHaveLength(4);
    expect(segments[0]?.className).toContain('bg-accent');
    expect(segments[1]?.className).toContain('bg-accent');
    expect(segments[2]?.className).toContain('bg-raised');
    expect(segments[3]?.className).toContain('bg-raised');
  });

  it('clamps completed to the segment count', () => {
    render(<ProgressSegments total={3} completed={9} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 3 done');
  });

  it('accepts a custom value text', () => {
    render(<ProgressSegments total={2} completed={0} valueText="Nothing done yet" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Nothing done yet');
  });
});
