import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Lamp, type ServeState } from './Lamp';
import { setUpComponentTests } from './test-utils';

setUpComponentTests();

describe('Lamp', () => {
  const cases: [ServeState, string][] = [
    ['on', 'ON'],
    ['partial', 'PARTIAL'],
    ['off', 'OFF'],
  ];

  it.each(cases)('labels the %s state with text, not colour alone', (state, label) => {
    const { container } = render(<Lamp state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe(state);
  });

  it('draws a different shape for each state', () => {
    const shapes = cases.map(([state]) => {
      const { container, unmount } = render(<Lamp state={state} />);
      const shape = container.querySelector('svg')?.innerHTML ?? '';
      unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(3);
    // ON is a filled circle, OFF a ring, PARTIAL a ring with a filled half.
    expect(shapes[0]).toContain('fill="currentColor"');
    expect(shapes[2]).not.toContain('fill="currentColor"');
    expect(shapes[1]).toContain('<path');
  });

  it('shows the value in mono with a spoken separator', () => {
    const { container } = render(<Lamp state="on" value='"v2"' />);
    expect(container.querySelector('code')?.textContent).toBe('"v2"');
    expect(container.textContent).toBe('ON, value "v2"');
  });

  it('leaves the value out when there is none', () => {
    const { container } = render(<Lamp state="off" value={null} />);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('OFF');
  });
});
