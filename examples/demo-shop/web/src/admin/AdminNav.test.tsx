import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { AdminNav } from './AdminNav';

vi.mock('@flagsmith/flagsmith/react', async () => (await import('../../test/flagsmith')).reactModule);

describe('AdminNav', () => {
  it('links staff to the sales reports', () => {
    serveFlags({ admin_reports: { enabled: true } });
    render(<AdminNav />);

    expect(screen.getByRole('link', { name: 'Sales reports' }).getAttribute('href')).toBe(
      '/admin/reports',
    );
  });

  it('shows customers only their orders', () => {
    serveFlags({ admin_reports: { enabled: false } });
    render(<AdminNav />);

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Orders']);
  });
});
