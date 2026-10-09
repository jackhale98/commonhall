/** Campaign finance (FEC) as stored in member_finance. */
export interface MemberFinance {
  member_id: string;
  candidate_id: string;
  committee_name: string | null;
  election_year: number;
  period: number;
  coverage_end: string | null;
  receipts: number | null;
  disbursements: number | null;
  cash_on_hand: number | null;
  debts: number | null;
  individual_small: number | null;
  individual_large: number | null;
  pacs: number | null;
  party: number | null;
  self_funding: number | null;
  transfers: number | null;
  by_size: { size: number; total: number; count: number | null }[];
  in_state: number | null;
  out_of_state: number | null;
  top_states: { state: string; total: number }[];
  top_employers: { name: string; total: number; count: number | null }[];
  top_committees: { name: string; id: string | null; total: number; type: string | null }[];
}

export const FINANCE_COLUMNS =
  'member_id,candidate_id,committee_name,election_year,period,coverage_end,receipts,disbursements,cash_on_hand,debts,individual_small,individual_large,pacs,party,self_funding,transfers,by_size,in_state,out_of_state,top_states,top_employers,top_committees';

/** $4.47B, $4.4M, $512K, $950. */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  // Round half up from the whole amount (2,150,000 → 2.2M); toFixed on a float can round 2.15 down.
  const scaled = (unit: number, digits: number) =>
    (Math.round(abs / (unit / 10 ** digits)) / 10 ** digits).toFixed(digits);
  if (abs >= 1e9) return `${sign}$${scaled(1e9, abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${sign}$${scaled(1e6, abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${scaled(1e3, 0)}K`;
  return `${sign}$${Math.round(abs)}`;
}
