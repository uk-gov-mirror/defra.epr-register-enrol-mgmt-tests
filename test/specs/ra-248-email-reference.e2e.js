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
 * RA-248 — lifecycle emails carry the human application reference, not the
 * internal work-item Guid.
 *
 * The bug: every re-accreditation lifecycle email (Extend SLA, Duly made,
 * Assessment in progress, Decision, Withdrawn, Submission confirmation)
 * put `workItem.Id` — a UUID like `9c6bb177-fb91-4d5a-9c80-8ebac1123943` —
 * into the GOV.UK Notify `((reference))` placeholder, so operators saw a
 * UUID under "Reference number". It must instead be the server-generated
 * application reference `payload.applicationReference` (RA-318 format:
 * `AP` + year + agency + orgId + postcode suffix + material prefix).
 *
 * The email body itself is not observable through the case-management UI —
 * in the e2e stack NOTIFY_API_KEY is absent so the NoOpNotifyClient stands
 * in and discards the personalisation. The value the email now uses IS
 * observable, though: it is exactly the application reference shown as the
 * work-item detail page caption (RA-196). This spec proves that reference
 * is the human `AP`-prefixed form (never a Guid) and that the extend-SLA
 * notification journey still fires end-to-end. The management-be
 * ReAccreditation*HookTests / PaymentService tests assert the `((reference))`
 * personalisation now carries this same application reference.
 */
describe('RA-248 lifecycle email reference is the application reference', () => {
  let workItemId

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Reference Number Test Ltd',
        siteAddressLine1: '248 Reference Road',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'test@defra.gov.uk'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress. payment-received stamps the SLA
    // clock, without which the extend below would fail with "clock not started".
    await startAssessment(workItemId)
    await detail.assertState('Updated')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  it('surfaces the RA-######### application reference and still fires the extend-SLA notification', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)

    // The detail-page caption reads "Work item AP..." (RA-196); the
    // bare reference after the "Work item " prefix is the exact value the
    // lifecycle emails now put in the ((reference)) placeholder. It must be
    // the human application reference, not the internal work-item Guid.
    const applicationReference = (await detail.getCaption())
      .replace(/^Work item\s+/, '')
      .trim()

    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)
    expect(applicationReference).not.toMatch(UUID_RE)
    expect(applicationReference).not.toBe(workItemId)

    // Extend the SLA. The notification-sent audit path is the same one
    // production uses; its presence proves the extend wires through to a
    // notification whose reference is now the application reference above.
    await slaExtend.gotoFor(workItemId)
    // RA-447 (CM6): the additionalDays count is replaced by an absolute
    // date, which must be after the item's CURRENT due date rather than a
    // fixed number of days from today — see sla-extend-date.js.
    await slaExtend.fillForm({
      reason: 'Operator providing additional evidence',
      date: farFutureDeadline()
    })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)

    await detail.assertFlashBanner()

    // RA-447 (CM5) renamed the underlying actionDisplayName from
    // "SLA extended" to "Determination deadline extended"; an RA-572
    // follow-up renames it again to "Determination deadline changed", the
    // notification hook appending " email sent" to that base. The template
    // key `SlaExtended` and the transition id `sla-extend` are unchanged —
    // this is a content change only.
    await detail.gotoAudit()
    await detail.assertAuditEntry('Determination deadline changed email sent')
  })
})
