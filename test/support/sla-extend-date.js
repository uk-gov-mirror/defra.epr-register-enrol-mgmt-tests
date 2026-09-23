/**
 * RA-447 (CM6) — dates for the Extend SLA / "Determination Deadline" date
 * input.
 *
 * CM6 replaces the additionalDays count with an absolute calendar date, and
 * the new validation requires that date to be strictly AFTER the work
 * item's CURRENT due date — not after today. A short, fixed offset from
 * today (e.g. "+7 days", which is what the old additionalDays-based specs
 * used) is no longer safe: whether it lands after the current due date
 * depends on how far out that due date already is, which these specs don't
 * read or parse. Two years out is safe for every fixture in this suite
 * without needing to.
 */

export function farFutureDeadlineDate(yearsAhead = 2) {
  // Midday rather than midnight: the parts below are read in the runner's
  // local zone while the case header renders in Europe/London, and a midnight
  // instant can straddle the BST boundary into the previous calendar day.
  const date = new Date()
  date.setFullYear(date.getFullYear() + yearsAhead)
  date.setHours(12, 0, 0, 0)
  return date
}

/**
 * `yearsAhead` exists so a spec can change the SAME work item's deadline more
 * than once: each change must be strictly after the deadline the PREVIOUS one
 * set, so a second change needs a date later than the first, not merely a date
 * later than today. Defaults to the original two years for every existing
 * caller.
 */
export function farFutureDeadline(yearsAhead = 2) {
  const date = farFutureDeadlineDate(yearsAhead)
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear()
  }
}

/**
 * A date guaranteed to be before any current, unelapsed due date — used to
 * prove the extension-only guard (CM6: the new date must be strictly after
 * the current due date, never a reduction).
 */
export function pastDeadline() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear()
  }
}
