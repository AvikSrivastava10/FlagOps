import type { FlagType } from '@flagops/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteBullet, bulletShape, flagTypeLabel } from './RouteBullet';
import { setUpComponentTests } from './test-utils';

setUpComponentTests();

describe('RouteBullet', () => {
  const cases: [FlagType | null, string, string, string][] = [
    ['release', 'circle', 'R', 'Release flag'],
    ['experiment', 'circle', 'E', 'Experiment flag'],
    ['ops', 'diamond', 'O', 'Ops flag'],
    ['permission', 'diamond', 'P', 'Permission flag'],
    [null, 'unclassified', '?', 'Unclassified flag'],
  ];

  it.each(cases)('draws %s as a %s with the letter %s', (type, shape, letter, label) => {
    render(<RouteBullet type={type} />);
    const bullet = screen.getByRole('img', { name: label });
    expect(bullet.getAttribute('data-shape')).toBe(shape);
    expect(bullet.querySelector('text')?.textContent).toBe(letter);
    expect(bulletShape(type)).toBe(shape);
    expect(flagTypeLabel(type)).toBe(label);
  });

  it('draws temporary types as circles and permanent types as diamonds', () => {
    const { container } = render(
      <>
        <RouteBullet type="release" />
        <RouteBullet type="ops" />
      </>,
    );
    const [circle, diamond] = container.querySelectorAll('svg');
    expect(circle?.querySelector('circle')).not.toBeNull();
    expect(diamond?.querySelector('path')).not.toBeNull();
    expect(diamond?.querySelector('circle')).toBeNull();
  });

  it('has a 20px list size and a 32px header size', () => {
    const { container } = render(
      <>
        <RouteBullet type="release" />
        <RouteBullet type="release" size="header" />
      </>,
    );
    const boxes = [...container.querySelectorAll('svg')].map((svg) => svg.getAttribute('viewBox'));
    expect(boxes).toEqual(['0 0 20 20', '0 0 32 32']);
  });
});
