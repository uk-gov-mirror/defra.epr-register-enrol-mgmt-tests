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
 * RA-201 — Extend SLA sends the operator a "SLA extended" email.
 *
 * Regression cover for the bug where extend-SLA emails never sent: the
 * SlaExtended GOV.UK Notify template requires an ((sla_deadline))
 * placeholder that the notification hook never supplied, so Notify
 * rejected the send with "Missing personalisation: sla_deadline".
 *
 * Observed through the UI: after a team leader changes the determination
 * deadline on a re-accreditation work item (which has an operator email and
 * an SLA clock started at payment-received), the audit log gains a
 * "Determination deadline changed email sent" entry. In the e2e stack
 * NOTIFY_API_KEY is absent so the NoOpNotifyClient stands in and reports
 * success, which exercises the same notification-sent audit path as
 * production.
 *
 * WORDING. RA-447 (CM5) renamed the underlying actionDisplayName from
 * "SLA extended" to "Determination deadline extended"; an RA-572 follow-up
 * renames it again to "Determination deadline changed", the notification hook
 * appending " email sent" to that base itself. Only the display string moved:
 * the notification template key is still `SlaExtended`, the transition id
 * still `sla-extend` and the stored audit action still `sla-extended`, so the
 * Notify template id and every selector here are untouched.
 *
 * The extend itself only succeeds once an SLA clock exists, so the
 * work item is driven to "Assessment in progress" first (payment-received
 * stamps the clock).
 */
describe('RA-201 Extend SLA sends operator notification', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Notify Test Ltd',
        siteAddressLine1: '3 Notification Way',
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

    // Duly made -> Assessment in progress. payment-received stamps the
    // SLA clock, without which the extend below would fail with
    // "clock not started" and no notification would fire.
    await startAssessment(workItemId)
    await detail.assertState('Updated')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  it('records a "Determination deadline changed email sent" audit entry after a successful change', async () => {
    await login.login()

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

    // The extend succeeded (clock present) so a success banner shows.
    await detail.assertFlashBanner()

    // The notification hook fired and the send succeeded, so the audit
    // log carries the "Determination deadline changed email sent" entry —
    // proving the change wires through to a notification end-to-end. (In
    // this stack NOTIFY_API_KEY is absent so the NoOpNotifyClient stands
    // in; the sla_deadline placeholder-contract regression itself is
    // guarded by the management-be NotifyTemplateContractTests, which the
    // real GovukNotifyClient would otherwise have 400'd on.)
    await detail.gotoAudit()
    await detail.assertAuditEntry('Determination deadline changed email sent')
  })
})
