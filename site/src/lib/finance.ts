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

/** $4.4M, $512K, $950. */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
