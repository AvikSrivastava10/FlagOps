import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { ShippingNote } from './ShippingNote';

vi.mock('@flagsmith/flagsmith', async () => (await import('../../test/flagsmith')).clientModule);

describe('ShippingNote', () => {
  beforeEach(() => {
    serveFlags({ free_shipping_threshold: { enabled: true, value: 50 } });
  });

  it('says how much more the basket needs for free shipping', () => {
    render(<ShippingNote subtotalCents={4250} />);

    expect(screen.getByText('Add $7.50 more for free shipping.')).toBeTruthy();
  });

  it('confirms free shipping once the basket reaches the threshold', () => {
    render(<ShippingNote subtotalCents={5000} />);

    expect(screen.getByText('Your order ships free.')).toBeTruthy();
  });
});
