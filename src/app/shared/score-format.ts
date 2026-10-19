/**
 * Display rule for official scores (the arithmetic average of the judges'
 * submitted totals, computed by the backend).
 *
 * ONE DECIMAL PLACE WHERE NECESSARY: a score renders with at most one decimal
 * and a whole number renders without decimals — 21.5 → "21.5", 21 → "21"
 * (never "21.0"). Averages that land beyond one decimal are rounded to one
 * decimal place (21.25 → "21.3"). Applies everywhere an official score is
 * shown: Results, rankings, winners and Certificates.
 */
export function formatScore(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
