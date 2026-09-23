import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'

/**
 * RA-572 follow-up — the "Reason for change" reaches the Application history.
 *
 * QA reported: "the reason for change is not being sent to the application
 * history and is lost." A regulator changing a determination deadline must
 * supply a mandatory reason (max 500 characters), but the Application history
 * entry's "Show details" panel showed only the generic work-item snapshot
 * (Type, State, Submitted at, Submitted by, Last modified, Assigned to) — the
 * regulator's own words never appeared anywhere in the UI.
 *
 * The reason was never actually lost: management-be persists it as
 * `details.reason` on the audit entry whose action is `sla-extended`. The gap
 * was in management-fe's `detailRowsForAuditEntry`, which had no `case` for
 * that action and so fell through to the generic snapshot. The paired
 * management-fe branch (identically named, `audit-history-reason-for-change`)
 * adds it.
 *
 * What this spec pins, and deliberately does not:
 *   - PINNED: the reason a regulator typed is readable, verbatim, on the
 *     history entry for the change they made.
 *   - PINNED: a reason containing line breaks renders as separate paragraphs,
 *     not as one run-on line — management-fe flags the row `multiline`, and
 *     audit-log.njk emits one <p> per line for such rows.
 *   - PINNED: a reason at the field's 500-character maximum survives the round
 *     trip untruncated.
 *   - NOT pinned: the entry's heading text. A separate branch is rewording it
 *     from "Determination deadline extended" to "...changed"; asserting it
 *     here would couple two independent PRs and go red on merge order alone.
 *
 * Three changes are made against ONE work item so the expensive journey setup
 * (submitted -> duly made -> assessment in progress, which is what stamps the
 * SLA clock the change flow requires) is paid once. Each change needs a date
 * strictly after the one the previous change set, hence the increasing
 * `farFutureDeadline` offsets. The assertions locate their row by its own
 * distinctive marker rather than by ordinal, so the audit log's ordering is
 * management-fe's to choose and not something this spec pins.
 */

/** The backend audit action a determination-deadline change records. */
const SLA_EXTENDED_ACTION = 'sla-extended'

/**
 * The detail-row key management-fe renders for the reason, matching the form
 * field's own "Reason for change" label (RA-572 (AC02) renamed it from
 * "Reason for extension").
 */
const REASON_ROW_KEY = 'Reason for change'

/**
 * The supporting rows management-fe projects alongside the reason, in render
 * order. Their VALUES are deliberately not asserted: the two deadlines render
 * as GDS-formatted dates and "Changed by" as an actor display name, all of
 * which are content design's to tune. Their PRESENCE is worth pinning —
 * `detailRowsForAuditEntry` guards each row individually on its source data,
 * so a projection that quietly stopped emitting one would otherwise be
 * invisible. They land on the SAME branch as the reason row, so this couples
 * nothing that is not already coupled.
 *
 * The generic work-item snapshot rows (Org ID, Type, State, Submitted at,
 * Submitted by, Last modified, Assigned to) are still appended AFTER these,
 * which is why every assertion here scopes by `<dt>` text and never by row
 * index.
 */
const SUPPORTING_ROW_KEYS = ['Previous deadline', 'New deadline', 'Changed by']

/** management-fe's REASON_MAX_LENGTH (sla.service.js). */
const REASON_MAX_LENGTH = 500

// Markers deliberately unlike any other copy on the page — a generic string
// such as "test" could be satisfied by unrelated fixture text and the
// assertion could then never fail.
const SINGLE_LINE_MARKER = 'QA-REASON-ECHO-7741'
const MULTILINE_MARKER = 'QA-REASON-MULTILINE-8825'
const MAX_LENGTH_MARKER = 'QA-REASON-MAXLEN-9903'

const SINGLE_LINE_REASON = `${SINGLE_LINE_MARKER} operator supplied the Annex VII paperwork after the cut-off`

/**
 * Three lines, no blank line between them: the AC is that line breaks survive
 * as separate paragraphs, and a blank line would additionally pin how the
 * template treats an empty <p>, which is not what QA reported.
 */
const MULTILINE_REASON_LINES = [
  `${MULTILINE_MARKER} awaiting the revised sampling and inspection plan`,
  'The site visit was rearranged at the operator request.',
  'Deadline moved so the visit findings can be assessed.'
]
const MULTILINE_REASON = MULTILINE_REASON_LINES.join('\n')

/**
 * Exactly at the field maximum, trimmed of any trailing space so the rendered
 * text compares byte-for-byte. A length limit is the classic place a value
 * gets silently truncated on the way to storage, which is the same failure
 * mode QA reported by a different route.
 */
const MAX_LENGTH_REASON = `${MAX_LENGTH_MARKER} `
  .concat('the operator requested more time to complete the plan. '.repeat(10))
  .slice(0, REASON_MAX_LENGTH)
  .trimEnd()

describe('RA-572 follow-up: reason for change in the application history', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Reason History Test Ltd',
        siteAddressLine1: '9 Audit Trail Road',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made -> Assessment in progress. The change-deadline
    // action is only available in the latter, and payment-received is what
    // stamps the SLA clock without which the change is rejected outright.
    await dulyMake(workItemId)
    await startAssessment(workItemId)
    await detail.assertState('Updated')

    await changeDeadline(SINGLE_LINE_REASON, 2)
    await changeDeadline(MULTILINE_REASON, 3)
    await changeDeadline(MAX_LENGTH_REASON, 4)

    // Land on the Application history tab once, with every disclosure open,
    // and let each assertion read from it. waitForAuditEntryCount polls rather
    // than checking once: the entries are written by the request that has just
    // redirected, and a one-shot query can race a slow write under load.
    await detail.gotoAudit()
    await detail.waitForAuditEntryCount(SLA_EXTENDED_ACTION, 3)
    await detail.expandAllAuditEntryDetails()
  })

  after(async () => {
    await login.logout()
  })

  /**
   * One pass of the change-deadline flow. `yearsAhead` increases per call
   * because each new deadline must be strictly after the previous one.
   */
  async function changeDeadline(reason, yearsAhead) {
    await slaExtend.gotoFor(workItemId)
    await slaExtend.fillForm({ reason, date: farFutureDeadline(yearsAhead) })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)
    // The change applied rather than bouncing off validation — without this
    // the history assertions below could fail for the wrong reason.
    await detail.assertFlashBanner()
  }

  it('shows the reason the regulator typed on the history entry for that change', async () => {
    await detail.assertAuditDetailRow(
      SLA_EXTENDED_ACTION,
      REASON_ROW_KEY,
      SINGLE_LINE_REASON
    )
  })

  it('renders a reason containing line breaks as separate paragraphs', async () => {
    const paragraphs = await detail.auditDetailRowParagraphs(
      SLA_EXTENDED_ACTION,
      REASON_ROW_KEY,
      MULTILINE_MARKER
    )
    // Equality, not a length check: a run-on single line would collapse this
    // to one element, and a reordering or a dropped line would change it too.
    expect(paragraphs).toEqual(MULTILINE_REASON_LINES)
  })

  it('keeps a reason at the 500-character maximum intact', async () => {
    await detail.assertAuditDetailRow(
      SLA_EXTENDED_ACTION,
      REASON_ROW_KEY,
      MAX_LENGTH_REASON
    )
  })

  it('does not leave the reason rows keyed alike, so each change keeps its own words', async () => {
    // The regression was every entry falling through to ONE shared work-item
    // snapshot, which made all three disclosures identical. Asserting the
    // OTHER two markers are absent from the multiline entry's reason row is
    // what distinguishes a real per-entry projection from that fallback.
    const paragraphs = await detail.auditDetailRowParagraphs(
      SLA_EXTENDED_ACTION,
      REASON_ROW_KEY,
      MULTILINE_MARKER
    )
    const rendered = paragraphs.join('\n')
    expect(rendered).not.toContain(SINGLE_LINE_MARKER)
    expect(rendered).not.toContain(MAX_LENGTH_MARKER)
  })

  it('surfaces the supporting rows alongside the reason', async () => {
    // Keys only — see SUPPORTING_ROW_KEYS for why the values are not pinned.
    await detail.assertAuditDetailRowKeys(
      SLA_EXTENDED_ACTION,
      SUPPORTING_ROW_KEYS
    )
  })
})
