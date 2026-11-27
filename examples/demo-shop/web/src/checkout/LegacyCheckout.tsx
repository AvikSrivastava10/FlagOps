import { useState, type FormEvent } from 'react';
import { formatPrice, type Cart } from '../cart/cart';

type Field = 'name' | 'street' | 'city' | 'postcode' | 'card' | 'expiry' | 'cvc';
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const addressFields: Field[] = ['name', 'street', 'city', 'postcode'];
const paymentFields: Field[] = ['card', 'expiry', 'cvc'];

const labels: Record<Field, string> = {
  name: 'Full name',
  street: 'Street address',
  city: 'City',
  postcode: 'Postcode',
  card: 'Card number',
  expiry: 'Expiry (MM/YY)',
  cvc: 'Security code',
};

const empty: Values = { name: '', street: '', city: '', postcode: '', card: '', expiry: '', cvc: '' };

const FLAT_SHIPPING_CENTS = 499;
const TAX_RATE = 0.08;

function totals(cart: Cart) {
  const subtotal = cart.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  return { subtotal, tax, total: subtotal + FLAT_SHIPPING_CENTS + tax };
}

function validate(values: Values): Errors {
  const errors: Errors = {};
  for (const field of [...addressFields, ...paymentFields]) {
    if (values[field].trim() === '') {
      errors[field] = `${labels[field]} is required`;
    }
  }
  if (values.card !== '' && !/^\d{16}$/.test(values.card.replace(/\s/g, ''))) {
    errors.card = 'Card number must have 16 digits';
  }
  if (values.expiry !== '' && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(values.expiry)) {
    errors.expiry = 'Expiry must look like 07/28';
  }
  if (values.cvc !== '' && !/^\d{3,4}$/.test(values.cvc)) {
    errors.cvc = 'Security code must have 3 or 4 digits';
  }
  return errors;
}

/** The original checkout form: address and card entered by hand, flat shipping and tax. */
export function LegacyCheckout({ cart }: { cart: Cart }) {
  const [values, setValues] = useState<Values>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [placed, setPlaced] = useState(false);
  const { subtotal, tax, total } = totals(cart);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setPlaced(Object.keys(found).length === 0);
  }

  function input(field: Field) {
    return (
      <label key={field} className="field">
        {labels[field]}
        <input
          name={field}
          value={values[field]}
          aria-invalid={errors[field] ? true : undefined}
          onChange={(event) => setValues({ ...values, [field]: event.target.value })}
        />
        {errors[field] && <span className="field-error">{errors[field]}</span>}
      </label>
    );
  }

  if (placed) {
    return <p role="status">Thank you. Your order is placed.</p>;
  }

  return (
    <form className="checkout" aria-label="Checkout" noValidate onSubmit={submit}>
      <h2>Checkout</h2>
      <fieldset>
        <legend>Shipping address</legend>
        {addressFields.map(input)}
      </fieldset>
      <fieldset>
        <legend>Payment</legend>
        {paymentFields.map(input)}
      </fieldset>
      <dl className="totals">
        <dt>Subtotal</dt>
        <dd>{formatPrice(subtotal)}</dd>
        <dt>Shipping</dt>
        <dd>{formatPrice(FLAT_SHIPPING_CENTS)}</dd>
        <dt>Tax</dt>
        <dd>{formatPrice(tax)}</dd>
        <dt>Total</dt>
        <dd>{formatPrice(total)}</dd>
      </dl>
      <button type="submit">Place order</button>
    </form>
  );
}
