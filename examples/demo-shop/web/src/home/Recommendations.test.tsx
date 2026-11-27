import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { Recommendations } from './Recommendations';

vi.mock('@flagsmith/flagsmith', async () => (await import('../../test/flagsmith')).clientModule);

describe('Recommendations', () => {
  it('shows the best sellers to the control group', () => {
    serveFlags({ recommendations_v2: { enabled: false, value: 'control' } });
    render(<Recommendations />);

    expect(screen.getByRole('heading', { name: 'Best sellers' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
