/**
 * Communications, reports and petitions filed like bills ("A communication from the
 * Treasurer…", "Monthly report of…", "…FY26 Audited Financial Statements"): left out
 * of a state's latest bills (Overview and Bills tab) until the reader searches.
 * STATE_BILL_FILLER_PG is the same pattern for Postgres (\y for a word boundary), so
 * the database skips them before the limit and the count.
 */
export const STATE_BILL_FILLER =
  /^(an? |the )?(communication|message|letter|petition of|report)\b|\b(weekly|monthly|quarterly|annual) report|\breport$|\bfinancial statements\b/i;
export const STATE_BILL_FILLER_PG =
  '(^(an? |the )?(communication|message|letter|petition of|report)\\y)|\\y(weekly|monthly|quarterly|annual) report|\\yreport$|\\yfinancial statements\\y';
