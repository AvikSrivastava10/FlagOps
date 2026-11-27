import flagsmith from '@flagsmith/flagsmith';

const bestSellers = ['Enamel mug', 'Organic cotton tee', 'Canvas tote'];
const pickedForYou = ['Walnut coaster set', 'Linen apron', 'Pour-over kettle'];

/**
 * Product recommendations. The experiment compares the best-seller list ("control") with
 * personalised picks ("v2").
 */
export function Recommendations() {
  const variant = flagsmith.getValue('recommendations_v2');
  const personalised = variant === 'v2';
  const products = personalised ? pickedForYou : bestSellers;

  return (
    <section className="recommendations" aria-labelledby="recommendations-heading">
      <h2 id="recommendations-heading">{personalised ? 'Picked for you' : 'Best sellers'}</h2>
      <ul>
        {products.map((product) => (
          <li key={product}>{product}</li>
        ))}
      </ul>
    </section>
  );
}
