import { useFlagsmith } from '@flagsmith/flagsmith/react';
import { AdminNav } from './admin/AdminNav';
import { HolidayBanner } from './banner/HolidayBanner';
import { demoCart, subtotalCents } from './cart/cart';
import { ShippingNote } from './cart/ShippingNote';
import { Checkout } from './checkout/Checkout';
import { useFeature } from './flags/useFeature';
import { Recommendations } from './home/Recommendations';
import { Appearance } from './settings/Appearance';
import { useTheme } from './theme/useTheme';

export function App() {
  const flagsmith = useFlagsmith();
  const theme = useTheme();
  const showHolidayBanner = useFeature('holiday_banner');

  return (
    <div className="shop" data-theme={theme}>
      {showHolidayBanner && <HolidayBanner />}
      <header className="shop-header">
        <h1>Demo Shop</h1>
        <AdminNav />
      </header>
      <main className="shop-main">
        {flagsmith.hasFeature('recomendations_v2') && <Recommendations />}
        <ShippingNote subtotalCents={subtotalCents(demoCart)} />
        <Checkout cart={demoCart} />
        <Appearance />
      </main>
    </div>
  );
}
