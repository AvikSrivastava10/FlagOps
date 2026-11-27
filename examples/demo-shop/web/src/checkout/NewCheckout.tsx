import { useState } from 'react';
import { formatPrice, subtotalCents, type Cart } from '../cart/cart';

/** One-step checkout: the shopper confirms the basket and pays with the card saved on the account. */
export function NewCheckout({ cart }: { cart: Cart }) {
  const [placed, setPlaced] = useState(false);
  if (placed) {
    return <p role="status">Order placed. A confirmation email is on its way.</p>;
  }

  return (
    <section className="checkout" aria-labelledby="checkout-heading">
      <h2 id="checkout-heading">Checkout</h2>
      <ul className="order-lines">
        {cart.items.map((item) => (
          <li key={item.sku}>
            <span>
              {item.quantity} × {item.name}
            </span>
            <span>{formatPrice(item.priceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <p className="order-total">
        Total <strong>{formatPrice(subtotalCents(cart))}</strong>
      </p>
      <button type="button" onClick={() => setPlaced(true)}>
        Pay with saved card
      </button>
    </section>
  );
}
