import { useFlags } from '@flagsmith/flagsmith/react';

/** Account settings: tells the user which theme the shop shows them. */
export function Appearance() {
  const flags = useFlags(['dark_mode']);

  return (
    <section className="appearance" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <p>
        {flags.dark_mode.enabled
          ? 'The dark theme is on for your account.'
          : 'A dark theme is on its way to your account.'}
      </p>
    </section>
  );
}
