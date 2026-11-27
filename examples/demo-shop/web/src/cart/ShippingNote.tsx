import flagsmith from '@flagsmith/flagsmith';
import { formatPrice } from './cart';

/** Tells the shopper how far the basket is from free shipping. */
export function ShippingNote({ subtotalCents }: { subtotalCents: number }) {
  const thresholdDollars = Number(flagsmith.getValue('free_shipping_threshold'));
  if (!Number.isFinite(thresholdDollars) || thresholdDollars <= 0) {
    return null;
  }

  const remainingCents = thresholdDollars * 100 - subtotalCents;
  return (
    <p className="shipping-note">
      {remainingCents > 0
        ? `Add ${formatPrice(remainingCents)} more for free shipping.`
        : 'Your order ships free.'}
    </p>
  );
}
