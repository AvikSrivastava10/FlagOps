import { useFlags } from '@flagsmith/flagsmith/react';

/** The account links in the header. Staff also get the sales reports. */
export function AdminNav() {
  const { admin_reports } = useFlags(['admin_reports']);

  return (
    <nav className="account-nav" aria-label="Account">
      <a href="/orders">Orders</a>
      {admin_reports.enabled && <a href="/admin/reports">Sales reports</a>}
    </nav>
  );
}
