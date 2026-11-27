import { useState } from 'react';

/** The seasonal sale banner across the top of the shop. Shoppers can dismiss it. */
export function HolidayBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) {
    return null;
  }

  return (
    <aside className="banner" aria-label="Holiday sale">
      <p>
        <strong>Holiday sale:</strong> 20% off everything until 2 January.
      </p>
      <button type="button" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </aside>
  );
}
