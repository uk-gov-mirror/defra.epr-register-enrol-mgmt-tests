import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import {
  farFutureDeadline,
  farFutureDeadlineDate
} from '../support/sla-extend-date.js'
import { formatUkDateGds } from '../support/uk-time.js'

/**
 * RA-572 — Case Management service: hide the "Override" function and reword
 * the "Change" function.
 *
 * During UAT regulators could not tell "Change determination date" and
 * "Override determination date" apart. Override is retired; Change becomes the
 * single route for amending a determination deadline, and its content stops
 * describing the amendment as an *extension*.
 *
 *   - AC01: no "Override determination date" action is offered, and the
 *           Override screen is unreachable through the normal Case Management
 *           journey. Change remains available.
 *   - AC02: the Change page content consistently describes a CHANGE, not an
 *           extension. The reason field's label reads "Reason for change".
 *   - AC04: saving a valid changed determination deadline works — the value is
 *           saved, the user is returned to the existing view, and the updated
 *           date is displayed.
 *   - AC05: Cancel returns to the application view and saves nothing.
 *   - AC06: removing Override does not stop an authorised regulator from
 *           changing the determination deadline (covered together with AC04 —
 *           the happy path below IS a regulator doing exactly that).
 *
 * AC03 IS DELIBERATELY NOT COVERED. It asked for a date picker; the reporter
 * confirmed that is out of scope and that the existing three-field
 * `govukDateInput` (day / month / year) is what is wanted. No calendar
 * component is asserted here, and none should be added later on this ticket's
 * authority.
 *
 * WHY THE FIXTURE GOES THROUGH ASSESSMENT. `canChangeDueDate` gates the
 * affordance, and a real due date only exists once `dulyMake` has started the
 * SLA clock from the payment date. Driving submitted -> duly-made ->
 * assessment-in-progress is therefore load-bearing twice over: it is the state
 * where the action is offered at all, and it is what makes AC04's "the updated
 * date is displayed" observable rather than vacuous. The preconditions are
 * asserted in `before` rather than assumed, so a fixture that silently failed
 * to get a clock cannot make the absence assertions below pass for the wrong
 * reason.
 *
 * ONE SHARED ITEM. Changing a deadline is a due-date change, not a workflow
 * transition through the engine gate, so the item stays in the same state
 * throughout and every block can re-anchor on it. AC05 (cancel saves nothing)
 * runs BEFORE AC04 (save works) on purpose: cancel has to be measured against
 * a due date nothing has moved yet.
 */
describe('RA-572 Override retired, Change is the single deadline route', () => {
  let workItemId

  before(async () => {
    await login.login()
    // uniquePostcode() gives a per-run-unique suffix (SW1A outward keeps the
    // England + plastic fixture routing) so repeat or parallel runs never
    // collide on the same seeded item.
    workItemId = await createReAccreditation(
      'RA572 Change Deadline Ltd',
      uniquePostcode()
    )

    // Start the SLA clock (dulyMake, from the payment date) then reach
    // assessment, where the due date can be changed.
    await dulyMake(workItemId)
    await startAssessment(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Updated')
    // Without a real due date, "the updated date is displayed" (AC04) and
    // "cancel saved nothing" (AC05) would both be comparisons between two em
    // dashes — green, and proving nothing.
    expect(await detail.hasRealDueOn()).toBe(true)

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC01 — the Override affordance is gone, Change remains', () => {
    before(async () => {
      await login.login()
      await workItems.openWorkItem(workItemId)
      // Positive anchor: every assertion in this block reads off the detail
      // page, so prove the detail page rendered before trusting an absence.
      await detail.assertState('Updated')
    })

    after(async () => {
      await login.logout()
    })

    it('still offers the "Change determination deadline" action', async () => {
      // The other half of AC01, and the guard that keeps the absence checks
      // below honest: if the whole assignment panel regressed, this fails
      // first and says so, rather than letting "Override is gone" pass
      // because nothing rendered at all.
      await slaExtend.assertActionLinkFor(workItemId)
      expect(await slaExtend.actionLink().getText()).toBe(
        'Change determination deadline'
      )
    })

    it('no longer offers an "Override determination date" action', async () => {
      await slaExtend.assertNoOverrideAction()
    })

    it('does not reach an Override form by typing the override URL', async () => {
      // Unlinked is not the same as unreachable. management-fe no longer
      // registers GET /work-items/{id}/sla/override, so this 404s — what the
      // 404 renders is management-fe's to own and is not pinned here, only
      // that no override form comes back.
      await slaExtend.assertOverrideRouteUnreachable(workItemId)
    })
  })

  describe('AC02 — the Change page describes a change, not an extension', () => {
    before(async () => {
      await login.login()
      await slaExtend.gotoFor(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('headlines the page and its submit button "Change determination deadline"', async () => {
      expect(await slaExtend.pageHeadingText()).toBe(
        'Change determination deadline'
      )
      expect(await slaExtend.submitButtonText()).toBe(
        'Change determination deadline'
      )
    })

    it('labels the reason field "Reason for change"', async () => {
      expect(await slaExtend.reasonLabelText()).toBe('Reason for change')
      expect(await slaExtend.reasonHintText()).toBe(
        'Explain why the determination deadline needs to be changed.'
      )
    })

    it('shows no "extend"/"extending" wording anywhere on the page', async () => {
      // The sweeping half of AC02 — the two assertions above pin the strings
      // content design named, this one catches the copy nobody thought to
      // name. Scoped to rendered text in `main`: the word legitimately
      // survives in the URL and in the unchanged `sla-extend-*` testids.
      await slaExtend.assertNoStaleDeadlineWording()
    })
  })

  describe('AC05 — Cancel returns to the application and saves nothing', () => {
    let dueOnBefore

    before(async () => {
      await login.login()
      await workItems.openWorkItem(workItemId)
      dueOnBefore = (await detail.caseHeaderFieldText('dueOn')).trim()
    })

    after(async () => {
      await login.logout()
    })

    it('returns to the work item with no banner and an unchanged due date', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'RA-572: typed, then abandoned — nothing may be saved',
        date: farFutureDeadline()
      })
      await slaExtend.cancelFromInputPage()
      await slaExtend.waitForDetailUrl(workItemId)

      // Nothing was applied, so the PRG success banner must not appear.
      await detail.assertNoFlashBanner()
      expect((await detail.caseHeaderFieldText('dueOn')).trim()).toBe(
        dueOnBefore
      )
    })
  })

  describe('AC04 + AC06 — a regulator changes the deadline end to end', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('saves the new deadline, returns to the work item and displays it', async () => {
      // AC06 is this same case read from the other side: an ordinary
      // authorised caseworker (RA-323 — every caseworker holds the same role)
      // can still move a deadline now that Override is gone. There is no
      // separate override-only permission left to lose.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'RA-572: operator needs longer to supply the evidence',
        date: farFutureDeadline()
      })
      await slaExtend.submitForm()

      // Returned to the EXISTING view — the work item detail page, not a
      // bespoke confirmation screen.
      await slaExtend.waitForDetailUrl(workItemId)
      await detail.assertFlashBanner()

      // The updated date is displayed. The change flow moves the due date onto
      // exactly the calendar day submitted (it keeps the original due date's
      // time-of-day), so the expected value is derived from the same helper
      // the form was filled from rather than hard-coded — a fixed date would
      // go stale, and the form rejects anything not after the current due
      // date.
      await expect(detail.caseHeaderField('dueOn')).toHaveText(
        expect.stringContaining(formatUkDateGds(farFutureDeadlineDate()))
      )

      // A due-date change is not a transition — the item has not moved state.
      await detail.assertState('Updated')
    })

    // AC02 is not only the form's own copy: the change the regulator just
    // made is written into the Application history, and that heading is
    // composed in management-be, which RA-572 had no slice for. QA found the
    // tab still reading "Determination deadline extended" after the rest of
    // the journey had been reworded — the one place a regulator still saw the
    // retired terminology. Runs after the change above because that change IS
    // the entry under test.
    it('records the change in the Application history as a CHANGE, not an extension', async () => {
      await detail.gotoAudit()

      // The stored action value `sla-extended` is deliberately unchanged, so
      // the entry is still located by it — only the display string moved.
      expect(await detail.auditEntryHeadings('sla-extended')).toContain(
        'Determination deadline changed'
      )

      // ...and no "extend"/"extending"/"extended" prose survives in any
      // heading for that action.
      await detail.assertNoStaleDeadlineWordingInHistory('sla-extended')
    })
  })
})
