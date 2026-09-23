import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/** The test-id attribute, and the CSS selector that matches any element carrying it. */
const TESTID_ATTR = 'data-testid'
const TESTID_SELECTOR = '[data-testid]'

/** The generic post-redirect (PRG) flash notification banner. */
const FLASH_BANNER_SELECTOR = '[data-testid="work-item-flash-banner"]'

/** The application-details row key for the sampling and inspection plan. */
const SAMPLING_INSPECTION_PLAN_ROW = 'sampling-inspection-plan'

/**
 * Build an XPath 1.0 string literal that safely encodes a JS string,
 * including values that contain single quotes, double quotes or both.
 * XPath 1.0 has no escape syntax so mixed-quote strings have to be
 * stitched together with concat().
 */
/**
 * Replace non-breaking spaces with ordinary ones before a text comparison.
 *
 * RA-292 renders a `NEW: ` prefix, and `&nbsp;` is a legitimate way to keep
 * that prefix from wrapping away from the name it belongs to. It is visually
 * identical to a normal space, so failing a comparison on it would be
 * asserting markup taste rather than anything a regulator can see.
 */
function normaliseSpaces(value) {
  // \u00a0 written as an escape, not as a literal non-breaking space: the
  // literal is invisible in an editor and one careless reformat turns this
  // into a no-op that still compiles and silently stops normalising anything.
  return String(value).replaceAll('\u00a0', ' ')
}

function toXPathString(value) {
  const s = String(value)
  if (!s.includes("'")) {
    return `'${s}'`
  }
  if (!s.includes('"')) {
    return `"${s}"`
  }
  const parts = s.split("'").map((p) => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

/**
 * RA-295 (AC01). The eight things the case header must carry, mapped to the
 * `data-testid` that surfaces each one. Exported so a spec asserts against the
 * same single source of truth the page object reads, rather than a second
 * hand-kept copy — and so a markup rename is a one-line change here rather
 * than a sweep through the specs.
 */
export const CASE_HEADER_FIELDS = {
  applicationsLink: 'case-header-applications-link',
  accreditationRef: 'case-header-accreditation-ref',
  orgName: 'case-header-org-name',
  orgId: 'case-header-org-id',
  material: 'case-header-material',
  status: 'case-header-status',
  assignedTo: 'case-header-assigned-to',
  dueOn: 'case-header-due-on',
  registrationNumber: 'case-header-registration-number'
}

/**
 * RA-295 (AC02). The application information rows, in the exact order the AC
 * prescribes. `bes` and `ors` are Exporter-only and are expected to be ABSENT
 * for a Reprocessor (re-accreditation) application, so ordering assertions
 * compare against the subset actually rendered rather than requiring all ten.
 */
export const APPLICATION_DETAIL_ROWS = [
  'site-address',
  'type',
  'material',
  'prn-tonnage',
  'prn-authorisers',
  'authority-to-issue',
  SAMPLING_INSPECTION_PLAN_ROW,
  'business-plan',
  'bes',
  'ors'
]

/** RA-295 (AC02). The Exporter-only rows, split out for the negative test. */
export const EXPORTER_ONLY_ROWS = ['bes', 'ors']

/**
 * RA-434 / RA-480. The "Additional information" tab's rows, in the fixed
 * order `buildAdditionalInformationRows` (management-fe) builds them in:
 * Registered name, Companies house number, Registered address, Site name,
 * Site address, Permit numbers, Contact full name, Contact email, Contact
 * phone, Contact job title. `site-name` has no producer field anywhere in
 * the chain today, so it is always omitted — every fixture's rendered row
 * set is this list minus `site-name` (and minus the four contact rows when
 * the fixture has no `submitterContactDetails`).
 */
export const ADDITIONAL_INFORMATION_ROWS = [
  'organisation-name',
  'companies-house-number',
  'company-registered-address',
  'site-name',
  'site-address',
  'permit-numbers',
  'contact-full-name',
  'contact-email',
  'contact-phone',
  'contact-job-title'
]

/** RA-480. The four contact rows, split out for the blank-fixture negative test. */
export const CONTACT_DETAIL_ROWS = [
  'contact-full-name',
  'contact-email',
  'contact-phone',
  'contact-job-title'
]

class WorkItemDetailPage extends Page {
  /**
   * The user-facing application reference shown as the page identity.
   *
   * RA-295 removed `app-heading` / `app-heading-caption` from the detail page
   * — the case header IS the page identity now — so this reads
   * `case-header-accreditation-ref`. The RA-249 rule is unchanged: it falls
   * back to the work item id when there is no RA-* reference.
   *
   * Handles BOTH page shapes deliberately. RA-295 rebuilt the detail and
   * audit-log pages around the case header, but the tasks sub-page still uses
   * the shared `appHeading` macro and its `app-heading-caption`. RA-196
   * asserts the reference on both, so a helper that understood only one of
   * them would force that spec to know which page it is on — exactly the
   * detail a page object exists to absorb.
   *
   * Prefers the caption when present so the tasks page keeps its existing
   * "Work item {ref}" text, and falls back to the case header elsewhere.
   */
  async getCaption() {
    const caption = await $('[data-testid="app-heading-caption"]')
    if (await caption.isExisting()) {
      return caption.getText()
    }
    return this.caseHeaderFieldText('accreditationRef')
  }

  /**
   * RA-295 moved status and assignee out of the envelope summary list and into
   * the case header's meta line. Roughly fifteen specs assert on those two
   * values via assertState / assertAssignedTo / assertUnassigned without
   * caring WHERE they are rendered, so the three helpers below read the case
   * header when it is present and fall back to the summary list otherwise.
   *
   * Keeping the fallback matters for more than the transition: the summary
   * list still renders on work item pages the redesign does not cover, and a
   * hard switch would have turned a UI relocation into a fifteen-spec rewrite
   * for no gain in what is actually being tested.
   */
  async hasCaseHeader() {
    return this.caseHeader().isExisting()
  }

  async assertState(expectedState) {
    if (await this.hasCaseHeader()) {
      await expect(this.caseHeaderField('status')).toHaveText(
        expect.stringContaining(expectedState)
      )
      return
    }
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${expectedState}")]`
      )
    ).toBeDisplayed()
  }

  /**
   * Assign the work item to a specific user.
   *
   * RA-295 (AC03) turned "Reassign the application" into a LINK, so the
   * assignee picker moved off the detail page onto a GET interstitial at
   * /work-items/{id}/assign (the same pattern as withdraw in RA-188 and query
   * in RA-291). The POST target is unchanged.
   *
   * Kept as one method rather than exposing the interstitial to callers: a
   * dozen specs across the suite just want "make this item assigned to X" and
   * have no interest in how many pages that now takes. Navigating via the
   * panel link rather than typing the URL means the specs still exercise the
   * affordance AC03 is actually about.
   */
  async assignTo(userId) {
    await this.assignmentControl('reassign').click()
    await $('[data-testid="assign-form"]').waitForDisplayed()
    await $('[data-testid="assign-select"]').selectByAttribute('value', userId)
    await $('[data-testid="assign-submit"]').click()
    await this.waitForDetailUrl()
  }

  /**
   * Clear the assignee via the unassign interstitial.
   *
   * The "Unassign the application" link is present in EVERY state (AC03), so
   * the interstitial has to cope with an item that is already unassigned — in
   * that case it renders `unassign-already-unassigned` and no submit button.
   * This throws rather than silently doing nothing in that situation, so a
   * caller whose assumptions have drifted gets a clear diagnostic instead of
   * an assertion failure several steps later.
   */
  async unassign() {
    await this.assignmentControl('unassign').click()
    const submit = await $('[data-testid="unassign-submit"]')
    if (!(await submit.isExisting())) {
      throw new Error(
        'unassign(): the item is already unassigned (the interstitial rendered ' +
          'unassign-already-unassigned and offered no submit button)'
      )
    }
    await submit.click()
    await this.waitForDetailUrl()
  }

  /**
   * Wait for a POST-redirect-GET back onto the work item detail page. The
   * assignment interstitials redirect to /work-items/{id} on success; without
   * this the caller races the navigation and reads the interstitial's DOM.
   */
  async waitForDetailUrl() {
    await browser.waitUntil(
      async () =>
        /\/work-items\/[^/]+$/.test(new URL(await browser.getUrl()).pathname),
      {
        timeout: 10000,
        timeoutMsg: 'Expected to land back on the work item detail page'
      }
    )
  }

  /**
   * Assert who holds the work item. Reads the RA-295 case header's "Assigned
   * to" field when present, else the envelope summary row.
   *
   * Both paths are scoped to the assignee field specifically, so neither can
   * pass on the name merely appearing somewhere else on the page.
   */
  async assertAssignedTo(displayName) {
    if (await this.hasCaseHeader()) {
      await expect(this.caseHeaderField('assignedTo')).toHaveText(
        expect.stringContaining(displayName)
      )
      return
    }
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)="Assigned to"]/following-sibling::*[contains(@class,"govuk-summary-list__value") and contains(.,"${displayName}")]`
      )
    ).toBeDisplayed()
  }

  /**
   * RA-153 self-assign quick action: take an unassigned work item. Submitting
   * it is a POST/redirect/GET, so this waits for the reloaded detail page
   * before returning — otherwise a caller reads the pre-assignment DOM and
   * sees a stale "Unassigned".
   */
  async selfAssign() {
    await this.assignmentControl('selfAssign').click()
    await browser.waitUntil(
      async () =>
        (await this.assignmentCurrent().isExisting()) &&
        !(await this.assignmentCurrent().getText()).includes('Unassigned'),
      {
        timeout: 10000,
        timeoutMsg:
          'Expected the work item to become assigned after self-assign'
      }
    )
  }

  /**
   * Assert the assignee field reads "Unassigned" — the literal rendered when
   * no assignee is set.
   */
  async assertUnassigned() {
    await this.assertAssignedTo('Unassigned')
  }

  /**
   * Navigate from the tasks sub-page back to the work item detail page.
   * Extracts the work item id from the current URL.
   */
  async gotoDetail() {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/]+)/)
    await this.open(`/work-items/${match[1]}`)
  }

  /**
   * RA-372. The `govuk-tag--*` modifier on the case header's status badge.
   *
   * Needed because `assessment-in-progress` and `updated` deliberately share
   * the display name "Updated" (RA-324 AC06, confirmed with the backend and
   * explicitly not reconciled), so `assertState('Updated')` cannot tell the
   * two apart — and telling them apart is the entire subject of this story.
   * The badge colour does distinguish them: `updated` is turquoise,
   * `assessment-in-progress` is blue (see `state-badge.js` in management-fe).
   */
  async stateTagClass() {
    const tag = await $('[data-testid="work-item-state-tag"]')
    if (!(await tag.isExisting())) {
      return ''
    }
    return (await tag.getAttribute('class')) ?? ''
  }

  /**
   * Polls rather than reading once, because callers reach for this straight
   * after an action that PRG-redirects. `getAttribute` is a single shot with
   * none of the implicit waiting the expect-webdriverio matchers do, so a
   * one-shot read here would intermittently assert against the pre-redirect
   * page — the classic source of a flaky state assertion.
   */
  async assertStateTagClass(modifier) {
    await browser.waitUntil(
      async () => (await this.stateTagClass()).split(/\s+/).includes(modifier),
      {
        timeout: 10000,
        timeoutMsg: `Expected the status badge to carry "${modifier}"`
      }
    )
  }

  /**
   * Trigger any work item action by its actionId (RA-133). The action
   * buttons are rendered with `data-testid="action-<actionId>"` so this
   * works for `payment-received`, `submit-for-decision`, `approve`, etc.
   */
  async triggerAction(actionId) {
    await $(`[data-testid="action-${actionId}"]`).click()
  }

  /**
   * Type into the optional decision-note textarea on the approval
   * interstitial (RA-132 / RA-203).
   */
  async setDecisionNote(text) {
    await $('[data-testid="approval-decision-note"]').setValue(text)
  }

  /**
   * Submit the approval interstitial form (RA-133).  After
   * triggerAction('approve') the browser is on the GET confirmation
   * page at /work-items/re-accreditation/{id}/approve.  This method
   * clicks the "Approve determination" submit button and waits for the
   * POST-redirect-GET back to the detail page.
   */
  async submitApproval() {
    await $('[data-testid="approval-submit"]').click()
    await browser.waitUntil(
      async () => !/\/approve$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg:
          'Expected redirect away from approval interstitial after submitting approval'
      }
    )
  }

  /**
   * Assert that the re-accreditation approval confirmation panel
   * (RA-133) is displayed and exposes the generated accreditation id.
   * Returns the accreditation id text so callers can assert on its
   * format.
   */
  async assertApprovalPanelVisible() {
    await expect(
      $('[data-testid="re-accreditation-approval-panel"]')
    ).toBeDisplayed()
    await expect(
      $('[data-testid="re-accreditation-approval-panel-id"]')
    ).toBeDisplayed()
  }

  /**
   * The inverse of {@link assertApprovalPanelVisible}: assert the approval
   * confirmation panel — and so the generated accreditation id — is NOT
   * rendered. That panel is built only for the `approved` state, so its
   * absence is what genuinely proves a refused or still-undecided item
   * granted nothing.
   *
   * This replaces an earlier `approveCta()` check against the retired RA-132
   * `re-accreditation-approve-cta` testid, which management-fe deletes: an
   * absence assertion on a testid no code path can emit is vacuously true and
   * would pass even if a stray approval control were reintroduced. The
   * approval panel is a live testid, so this catches that regression. Same
   * idiom as reject-terminal-flow / ra-346-approve-gating.
   */
  async assertNoApprovalPanel() {
    await expect(
      $('[data-testid="re-accreditation-approval-panel"]')
    ).not.toBeExisting()
  }

  async getAccreditationId() {
    return $('[data-testid="re-accreditation-approval-panel-id"]').getText()
  }

  async getAccreditationStartDate() {
    return $(
      '[data-testid="re-accreditation-accreditation-start-date"]'
    ).getText()
  }

  async getAccreditationYear() {
    return $('[data-testid="re-accreditation-accreditation-year"]').getText()
  }

  /**
   * Assert that the re-accreditation "Accreditation issued" success panel
   * (RA-177) renders ABOVE the generic envelope attributes summary in DOM
   * order, with the accreditation metadata between them. Uses an XPath
   * `following::` axis so the assertion is about document order, not
   * pixel position.
   */
  async assertApprovalPanelAboveSummary() {
    // RA-295 removed `work-item-summary`, which this used as the "everything
    // else on the page" landmark. Re-pointed at `application-details`, which
    // is the section that now occupies that position.
    //
    // This is not a cosmetic swap: an XPath naming a testid that no longer
    // exists anywhere can never match, so leaving it would have turned an
    // ordering guarantee into a permanently failing assertion (and, had it
    // been written as a negative, into one that could never fail).
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="application-details"]'
      )
    ).toExist()
    // The decision metadata must sit between the panel and the details.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="re-accreditation-decision-metadata"]' +
          '/following::*[@data-testid="application-details"]'
      )
    ).toExist()
  }

  /**
   * Assert the read-only "Outcome" panel that replaces the generic action
   * panel once a re-accreditation reaches a terminal state (RA-132). The
   * paragraph explains no further decision actions are available and a
   * govuk tag shows the terminal state. See re-accreditation/detail-v1.njk.
   */
  async assertReadOnlyOutcomePanel(expectedStateText) {
    await expect(
      $('[data-testid="re-accreditation-readonly-actions"]')
    ).toBeDisplayed()
    await expect($('[data-testid="re-accreditation-state-tag"]')).toHaveText(
      expect.stringContaining(expectedStateText)
    )
  }

  /**
   * Assert the generic decision action buttons are no longer offered on a
   * terminal work item — the read-only outcome panel suppresses them so a
   * user cannot click an action the backend would only reject.
   */
  async assertNoDecisionActions() {
    await expect($('[data-testid="action-approve"]')).not.toBeExisting()
    await expect($('[data-testid="action-reject"]')).not.toBeExisting()
  }

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }

  /**
   * Open the audit log.
   *
   * RA-295 replaced the "View audit log" link (`work-item-audit-log-link`,
   * now gone) with the "Application history" tab. The route is unchanged, so
   * the dozen specs that call this are unaffected by the change of
   * affordance — which is the point of it living here.
   */
  async gotoAudit() {
    await this.tab('history').click()
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/audit/.test(await browser.getUrl()),
      { timeoutMsg: 'Expected audit log URL after clicking the history tab' }
    )
  }

  /**
   * Open the "Additional information" tab (RA-434).
   *
   * Same pattern as gotoAudit(): its own bookmarkable page at
   * /work-items/{id}/additional-information rather than a JS widget.
   */
  async gotoAdditionalInformation() {
    await this.tab('additionalInformation').click()
    await browser.waitUntil(
      async () =>
        /\/work-items\/[^/]+\/additional-information/.test(
          await browser.getUrl()
        ),
      {
        timeoutMsg: 'Expected additional-information URL after clicking the tab'
      }
    )
  }

  /**
   * RA-372. The state transitions the audit log shows, in order — one entry
   * per `action-applied`, each as `"<from> → <to>"`.
   *
   * The audit log is where a state machine's edges become observable to a
   * regulator: management-fe's `summariseAuditEntry` renders every applied
   * action as `Action (from → to)` in the visible summary line, so this reads
   * the rendered page rather than reaching into the backend for
   * `fromStateId`.
   *
   * Returned as an ordered list rather than asserted one entry at a time so a
   * spec can pin the whole path. That matters for a waypoint state: whether
   * the waypoint was discharged through a declared edge or jumped across an
   * undeclared one is visible ONLY in the shape of the sequence — the start
   * and end states are identical either way.
   */
  async appliedTransitions() {
    const entries = await $$(
      '[data-testid="work-item-audit-log"] li[data-action="action-applied"]'
    )
    const transitions = []
    for (const entry of entries) {
      const text = await entry.getText()
      // The two segments around the arrow exclude the arrow itself (not just
      // the closing paren): with a shared `[^)]*` on both sides, a string
      // containing more than one arrow gives the engine multiple equally
      // valid ways to split the match, and it backtracks through all of them
      // before failing — superlinear on pathological input. Each side only
      // ever holds a state name (no arrow in it per the format this parses),
      // so narrowing the class costs nothing and makes the split unambiguous.
      const match = text.match(/\(([^)→]*→[^)→]*)\)/)
      transitions.push(
        match ? match[1].trim() : text.replace(/\s+/g, ' ').trim()
      )
    }
    return transitions
  }

  /**
   * RA-372. Whether an error summary is on the page.
   *
   * Deliberately reads the GOV.UK class, not the message. The copy belongs to
   * management-fe (and `epr-ewv8` is filed to change it), so pinning it here
   * would cement wording another repo intends to move — the same rule
   * `assertAssignRefused` below states for management-be's 409 text. What
   * this suite is entitled to assert is that the caseworker was NOT shown a
   * problem.
   */
  async hasErrorSummary() {
    return $('.govuk-error-summary').isExisting()
  }

  /**
   * A case tab. Note the ACTIVE tab renders as a <span aria-current="page">
   * and only the inactive one is an <a>, so callers must not assume both are
   * clickable — assert with isActiveTab() rather than clicking blindly.
   */
  tab(name) {
    const testIds = {
      summary: 'tab-application-summary',
      history: 'tab-application-history',
      additionalInformation: 'tab-additional-information'
    }
    const testId = testIds[name]
    if (!testId) {
      throw new Error(`Unknown case tab "${name}"`)
    }
    return $(`[data-testid="${testId}"]`)
  }

  async isActiveTab(name) {
    return (await this.tab(name).getAttribute('aria-current')) === 'page'
  }

  /**
   * The DOM position of the first audit entry containing `text`, or -1.
   *
   * Exists so a spec can assert the ORDER of two audit entries, not merely
   * that both exist. That matters wherever ordering is the mechanism rather
   * than a detail — RA-203's decision note has to be written BEFORE the
   * decision, because the notification hook reads the latest note during the
   * decision write and a note posted afterwards silently yields a blank
   * rationale.
   *
   * Entries arrive from the backend sorted NEWEST-FIRST (RA-568) and render
   * as a top-to-bottom timeline (`decorateAuditLog` in management-fe), so a
   * lower index means written LATER (more recently). Callers must not
   * assume the opposite.
   *
   * Returns an index rather than asserting, so the caller states the
   * relationship it wants and gets a failure message naming both positions.
   */
  async auditEntryIndex(text) {
    const entries = await $$('[data-testid="work-item-audit-log"] li')
    for (let i = 0; i < entries.length; i++) {
      if ((await entries[i].getText()).includes(text)) {
        return i
      }
    }
    return -1
  }

  async assertAuditEntry(action) {
    await expect(
      $(`//*[@data-testid="work-item-audit-log"]//*[contains(.,"${action}")]`)
    ).toBeDisplayed()
  }

  /**
   * The post-redirect flash banner element (e.g. after a determination
   * deadline change). Exposed so specs can assert its ABSENCE without
   * reaching for the inline selector — the assert* helpers below cover the
   * positive cases.
   */
  flashBanner() {
    return $(FLASH_BANNER_SELECTOR)
  }

  /**
   * Assert the post-redirect flash banner is shown on the detail page
   * (e.g. after a determination deadline change). Kept here so specs don't
   * reach for the inline selector.
   */
  async assertFlashBanner() {
    await expect(this.flashBanner()).toBeDisplayed()
  }

  /**
   * The converse: nothing was applied, so no banner flashed. Used by the
   * cancel paths, where a banner appearing would mean the abandoned form had
   * been saved after all.
   */
  async assertNoFlashBanner() {
    await expect(this.flashBanner()).not.toBeDisplayed()
  }

  /**
   * RA-372. The text of the generic flash banner, for callers that need to
   * distinguish WHICH operation flashed it rather than merely that one did.
   */
  async flashBannerText() {
    return $(FLASH_BANNER_SELECTOR).getText()
  }

  /**
   * epr-p86e. Assert the ERROR variant of the post-redirect flash banner.
   *
   * When the atomic decision, gated by the Registration & Accreditation service, fails (management-be returns 500 with
   * no state change), management-fe PRG-redirects back to the detail page and
   * flashes a generic error notification banner on the same
   * `work-item-flash-banner` test id — not a `.govuk-error-summary` and not a
   * full-page error template.
   *
   * GOV.UK's notification banner has only a DEFAULT and a `--success` variant —
   * there is no `--error` modifier class — so an error flash renders as the
   * default variant. Asserting the ABSENCE of `--success` is what keeps this
   * from latching onto a SUCCESS flash (create, SLA-extend) that shares the id,
   * without asserting management-fe's copy.
   */
  async assertErrorFlashBanner() {
    await expect($(FLASH_BANNER_SELECTOR)).toBeDisplayed()
    await expect(
      $(
        '[data-testid="work-item-flash-banner"].govuk-notification-banner--success'
      )
    ).not.toBeExisting()
  }

  /**
   * Assert the detail page no longer surfaces the payload pre block or
   * the template version summary row. RA-186 moved the payload into the
   * submitted audit log entry and removed template version from the
   * envelope summary.
   */
  async assertNoPayloadOrTemplateVersionOnDetail() {
    await expect($('[data-testid="work-item-payload"]')).not.toBeExisting()
    await expect(
      $(
        '//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  /**
   * Expand every "Show details" disclosure on the audit log page so
   * subsequent assertions can match content rendered inside them.
   */
  async expandAllAuditEntryDetails() {
    const disclosures = await $$(
      '[data-testid="work-item-audit-entry-details"]'
    )
    for (const disclosure of disclosures) {
      const isOpen = await disclosure.getAttribute('open')
      if (isOpen === null) {
        await disclosure.$('.govuk-details__summary').click()
      }
    }
  }

  /**
   * Expand every ORS `<details>` block on the Application summary tab
   * (collapsed by default) so assertions can read the site's own detail
   * fields and any nested interim site — both render inside the collapsed
   * `.govuk-details__text` body, where WebdriverIO's getText() reads as ""
   * until expanded. Mirrors expandAllAuditEntryDetails() above.
   */
  async expandAllOverseasSiteDetails() {
    const disclosures = await $$('[data-testid="overseas-site"]')
    for (const disclosure of disclosures) {
      const isOpen = await disclosure.getAttribute('open')
      if (isOpen === null) {
        await disclosure.$('.govuk-details__summary').click()
      }
    }
  }

  /**
   * The value (dd text) of a work-item snapshot row inside an audit entry's
   * "Show details" disclosure, keyed by the visible dt text (e.g. "Org ID",
   * "Type", "State"). Scoped to the Nth disclosure (1-based, default the
   * first): the audit-log controller builds ONE snapshot from the work item's
   * current payload and stamps it on every entry, so any disclosure carries
   * the same rows and the first is a reliable representative.
   *
   * Callers must expandAllAuditEntryDetails() first so the row is rendered.
   * Used by RA-450 to assert the Org ID row shows the operator organisation id
   * rather than the application reference. The key is XPath-escaped so labels
   * with quotes cannot corrupt the locator.
   */
  async auditSnapshotRowValue(key, nth = 1) {
    const needle = toXPathString(key)
    return $(
      `//*[@data-testid="work-item-audit-entry-details"][${nth}]` +
        `//dt[normalize-space(.)=${needle}]/following-sibling::dd`
    ).getText()
  }

  /**
   * Assert the Payload row on the work-item-submitted audit entry
   * contains the given substring. RA-186 surfaces the submission
   * payload inside the submitted entry's disclosure rather than as a
   * stand-alone panel on the detail page.
   *
   * Scoped to the <li data-action="work-item-submitted"> so the
   * assertion cannot pass against a Payload row on a different entry.
   * The substring is XPath-escaped via toXPathString so values that
   * include quotes do not corrupt the locator.
   */
  async assertSubmittedAuditPayloadContains(substring) {
    const needle = toXPathString(substring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action="work-item-submitted"]//dt[normalize-space(.)="Payload"]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  /**
   * The audit-log entries for a given backend `action` (RA-234). The
   * audit-log template stamps `data-action="{{ entry.action }}"` on every
   * `<li>`, so this scopes assertions to e.g. `notification-sent` /
   * `notification-failed` entries without matching unrelated rows.
   */
  auditEntriesForAction(action) {
    return $$(
      `//*[@data-testid="work-item-audit-log"]//li[@data-action=${toXPathString(
        action
      )}]`
    )
  }

  /**
   * Like `auditEntriesForAction`, but polls for the entry count to reach
   * `count` rather than checking once. Some pushes are deferred onto a
   * background task queue (e.g. RA-519's status-changed push, RA-368) and
   * complete after the triggering request has already returned, so a
   * one-shot DOM query can race ahead of them under load - this is what
   * that push actually finishing looks like from the browser's side,
   * rather than a fixed sleep guessing how long it takes.
   */
  async waitForAuditEntryCount(action, count, { timeout = 10000 } = {}) {
    await browser.waitUntil(
      async () => (await this.auditEntriesForAction(action)).length === count,
      {
        timeout,
        timeoutMsg: `Expected ${count} audit entr${count === 1 ? 'y' : 'ies'} for action "${action}"`
      }
    )
    return this.auditEntriesForAction(action)
  }

  /**
   * The audit entries for `action` whose "Notification type" detail row matches
   * `template` (e.g. "OfficerAssignment"). A work item carries several
   * notifications sharing one action — submit alone records both the operator
   * SubmissionConfirmation and the RA-240 RegulatorSubmission — so counting by
   * action conflates them; count by template to pin an assertion to the
   * notification actually under test. Callers must
   * `expandAllAuditEntryDetails()` first so the detail rows are present.
   */
  notificationEntriesForTemplate(action, template) {
    return $$(
      `//*[@data-testid="work-item-audit-log"]//li[@data-action=${toXPathString(
        action
      )}]` +
        `[.//dt[normalize-space(.)="Notification type"]/following-sibling::dd[contains(.,${toXPathString(
          template
        )})]]`
    )
  }

  /**
   * The `notification-sent` entries for `template`. Lets a caller assert that a
   * specific template did NOT send, without counting unrelated sends.
   */
  notificationSentEntriesForTemplate(template) {
    return this.notificationEntriesForTemplate('notification-sent', template)
  }

  /**
   * Assert a notification audit entry for `action` surfaces a detail row
   * whose key is exactly `key` and whose value contains `valueSubstring`
   * (RA-234). The notification detail rows (Recipient, Notification type,
   * Reference, Reason, Error) live inside the entry's "Show details"
   * disclosure, so callers must `expandAllAuditEntryDetails()` first.
   *
   * Scoped to the `<li data-action="...">` so a row on a different entry
   * cannot satisfy the assertion; both the key and the value substring are
   * XPath-escaped so quoted emails/refs cannot corrupt the locator.
   *
   * A work item usually carries several notifications sharing one action —
   * submit alone records both the operator SubmissionConfirmation and the
   * regulator RegulatorSubmission as `notification-sent`. Where the assertion
   * is about one specific template, use
   * `assertNotificationDetailRowForTemplate` instead so a row belonging to a
   * different template cannot satisfy it.
   */
  async assertNotificationDetailRow(action, key, valueSubstring) {
    await this.assertAuditDetailRow(action, key, valueSubstring)
  }

  /**
   * The XPath of the `<dd>` of the detail row whose `<dt>` is exactly `key`,
   * on an audit entry for `action`, whose value contains `valueSubstring`.
   *
   * The substring predicate sits on the `<dd>` rather than on the `<li>` so a
   * work item carrying SEVERAL entries for the same action (e.g. two
   * determination-deadline changes) is disambiguated by the row's own content
   * — no reliance on the audit log's newest-first/oldest-first ordering, which
   * is management-fe's to decide and not something these specs should pin.
   *
   * Action, key and substring are all XPath-escaped via toXPathString so
   * values containing quotes cannot corrupt the locator.
   */
  auditDetailRowValueXPath(action, key, valueSubstring) {
    const entry = toXPathString(action)
    const dt = toXPathString(key)
    const needle = toXPathString(valueSubstring)
    return (
      `//*[@data-testid="work-item-audit-log"]//li[@data-action=${entry}]` +
      `//dt[normalize-space(.)=${dt}]/following-sibling::dd[contains(.,${needle})]`
    )
  }

  /**
   * Assert an audit entry for `action` surfaces a detail row keyed exactly
   * `key` whose value contains `valueSubstring`.
   *
   * The general form of `assertNotificationDetailRow` (which now delegates
   * here): the detail-row mechanism is not specific to notifications —
   * management-fe's `detailRowsForAuditEntry` projects rows for many actions,
   * including the `sla-extended` "Reason for change" row.
   *
   * Detail rows live inside the entry's "Show details" disclosure, so callers
   * must `expandAllAuditEntryDetails()` first.
   */
  async assertAuditDetailRow(action, key, valueSubstring) {
    await expect(
      $(this.auditDetailRowValueXPath(action, key, valueSubstring))
    ).toBeDisplayed()
  }

  /**
   * The per-line paragraph texts of a MULTILINE audit detail row, identified
   * by `action` + `key` + a substring of its value.
   *
   * management-fe renders a row flagged `multiline` as one
   * `<p class="govuk-body">` per line inside the `<dd>` (see audit-log.njk),
   * rather than as a single run-on string. Returning the paragraphs lets a
   * spec assert the line structure itself, which `getText()` on the `<dd>`
   * cannot distinguish from a run-on line reliably.
   *
   * Each paragraph is trimmed: a browser normalises a `<textarea>`'s line
   * breaks to CRLF on form submit (HTML spec), and the template splits on
   * "\n", so every line but the last can carry a trailing carriage return
   * that is invisible to a regulator and is not what the assertion is about.
   *
   * Callers must `expandAllAuditEntryDetails()` first.
   */
  async auditDetailRowParagraphs(action, key, valueSubstring) {
    const paragraphs = await $$(
      `${this.auditDetailRowValueXPath(action, key, valueSubstring)}/p`
    )
    return Promise.all(paragraphs.map(async (p) => (await p.getText()).trim()))
  }

  /**
   * As `assertNotificationDetailRow`, but additionally scoped to the audit
   * entry whose "Notification type" row is `template`. Required whenever the
   * asserted value is not unique to the template under test — e.g. the England
   * regulator mailbox is the recipient of both RegulatorSubmission (fired on
   * submit) and OfficerAssignment, so an unscoped Recipient assertion would
   * pass on the submit entry alone and could never fail.
   */
  async assertNotificationDetailRowForTemplate(
    action,
    template,
    key,
    valueSubstring
  ) {
    const entry = toXPathString(action)
    const tpl = toXPathString(template)
    const dt = toXPathString(key)
    const needle = toXPathString(valueSubstring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action=${entry}]` +
          `[.//dt[normalize-space(.)="Notification type"]/following-sibling::dd[contains(.,${tpl})]]` +
          `//dt[normalize-space(.)=${dt}]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  /**
   * Assert that a failed-notification audit entry renders with the
   * visually-distinct error styling RA-234 introduced: the failure CSS
   * class `app-audit-entry--failure` (a red left border) on the entry and
   * the red GOV.UK "Failed" tag inside it.
   */
  async assertNotificationFailureStyling() {
    const failureEntry = $(
      '//*[@data-testid="work-item-audit-log"]//li[contains(@class,"app-audit-entry--failure")]'
    )
    await expect(failureEntry).toBeDisplayed()
    await expect(
      failureEntry.$('.//*[contains(@class,"govuk-tag--red")]')
    ).toHaveText('Failed')
  }

  async assertNoTemplateVersionOnAuditLog() {
    await expect(
      $(
        '//*[@data-testid="work-item-audit-log"]//dt[normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  // ── RA-295 AC01: case header ─────────────────────────────────────────────── //

  /** The case header panel that sits directly under the service navigation. */
  caseHeader() {
    return $('[data-testid="case-header"]')
  }

  /**
   * A single case-header field element, keyed by the logical names in
   * CASE_HEADER_FIELDS (e.g. 'orgName', 'dueOn'). Scoped to the header so a
   * value repeated elsewhere on the page cannot satisfy a header assertion —
   * "Plastic" appears in both the header and the Material detail row, so an
   * unscoped material assertion could never fail.
   */
  caseHeaderField(name) {
    const testId = CASE_HEADER_FIELDS[name]
    if (!testId) {
      throw new Error(`Unknown case header field "${name}"`)
    }
    return this.caseHeader().$(`[data-testid="${testId}"]`)
  }

  async caseHeaderFieldText(name) {
    return this.caseHeaderField(name).getText()
  }

  /**
   * Whether a case-header field is present.
   *
   * Guarded, because the field selectors are SCOPED to the header container:
   * calling `.$()` on an element that does not exist throws rather than
   * returning a not-found element, so on a page with no case header at all
   * this would raise `Can't call $ on element with selector
   * "[data-testid=case-header]"` instead of answering "no". A predicate named
   * `has…` must return a boolean for every page it is pointed at — callers
   * (and `hasRealDueOn` below) branch on it.
   */
  async hasCaseHeaderField(name) {
    if (!(await this.caseHeader().isExisting())) {
      return false
    }
    return this.caseHeaderField(name).isExisting()
  }

  /**
   * Whether the header's "Due on" carries a real date rather than the em-dash
   * "no value" fallback.
   *
   * RA-295 replaces the old SLA tracker badge with this absolute due date, so
   * this is what "the caseworker can see the SLA clock is running" looks like
   * after the redesign. Asserting the field merely EXISTS would not do — it is
   * rendered either way, showing an em dash when no clock has started.
   */
  async hasRealDueOn() {
    if (!(await this.hasCaseHeaderField('dueOn'))) {
      return false
    }
    const text = (await this.caseHeaderFieldText('dueOn')).trim()
    return text !== '' && text !== '—'
  }

  /**
   * Click the header's "Applications" link and wait until the browser is
   * actually on the Applications list. The AC is that the link *takes you
   * back to the list page*, so asserting the href alone would not prove it —
   * the click and the resulting navigation are the behaviour under test.
   */
  async clickApplicationsLink() {
    await this.caseHeaderField('applicationsLink').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/work-items',
      {
        timeout: 10000,
        timeoutMsg:
          'Expected the case header "Applications" link to navigate back to /work-items'
      }
    )
  }

  // ── RA-295: markup the redesign removes ──────────────────────────────────── //

  /**
   * The RA-98 reference-implementation notification banner ("Re-accreditation
   * work item" / "Reference implementation showing how a module supplies its
   * own detail template"), which AC01 removes.
   *
   * Deliberately matched on its body text rather than on
   * `.govuk-notification-banner` generally: the flash banner, the create
   * success banner and the notification-failure banner are all GOV.UK
   * notification banners too, so asserting "no notification banner exists"
   * would fail for unrelated, wanted reasons — and would pass vacuously on a
   * page where the RA-98 banner had merely been restyled.
   */
  ra98ReferenceBanner() {
    return $(
      '//*[contains(@class,"govuk-notification-banner")]' +
        '[contains(.,"Reference implementation showing how a module supplies its own detail template")]'
    )
  }

  /**
   * The SLA tracker badge — the "On track" / "At risk" / "Breached" govukTag
   * in the detail page's "SLA status" section. RA-295 removes it. The
   * container testid is the one the pre-RA-295 template stamped
   * (`sla-clock-info`), so this asserts the badge is genuinely gone rather
   * than merely renamed.
   */
  slaStatusBadge() {
    return $('[data-testid="sla-clock-info"]')
  }

  /**
   * The "View full application details" link that took the user to the
   * separate /application-details page. AC02 folds that page into the detail
   * page and removes the link.
   */
  viewApplicationDetailsLink() {
    return $('[data-testid="view-application-details-link"]')
  }

  // ── RA-295 AC02: single-page application information ─────────────────────── //

  /** The container holding the ordered application information rows. */
  applicationDetails() {
    return $('[data-testid="application-details"]')
  }

  applicationDetailRow(key) {
    return this.applicationDetails().$(`[data-testid="app-detail-row-${key}"]`)
  }

  async hasApplicationDetailRow(key) {
    return this.applicationDetailRow(key).isExisting()
  }

  async applicationDetailRowText(key) {
    return this.applicationDetailRow(key).getText()
  }

  /**
   * The application-information row keys actually rendered, in DOM order.
   *
   * Returns only keys the AC names (filtered through APPLICATION_DETAIL_ROWS)
   * so an unrelated row added later cannot break the ordering assertion, and
   * de-duplicates so a nested testid cannot report a key twice. A spec asserts
   * order by comparing this against APPLICATION_DETAIL_ROWS filtered to the
   * same set — which checks relative order without requiring every
   * conditional row to be present.
   */
  async applicationDetailRowOrder() {
    const rows = await this.applicationDetails().$$(TESTID_SELECTOR)
    const seen = []
    for (const row of rows) {
      const testId = await row.getAttribute(TESTID_ATTR)
      const key = (testId ?? '').replace(/^app-detail-row-/, '')
      if (
        testId?.startsWith('app-detail-row-') &&
        APPLICATION_DETAIL_ROWS.includes(key) &&
        !seen.includes(key)
      ) {
        seen.push(key)
      }
    }
    return seen
  }

  /**
   * The filenames of every supporting document listed against the sampling &
   * inspection plan row. AC02 requires ALL supporting documents to be listed,
   * so this returns the full set for a length + membership assertion; reading
   * only the first would pass against a template that renders `files[0]` and
   * stops, which is precisely the regression the AC guards against.
   */
  supportingDocumentLinks() {
    return this.documentLinksIn(SAMPLING_INSPECTION_PLAN_ROW)
  }

  /**
   * Every document link inside one application-details row, scoped to that
   * row. Parameterised because the BES-evidence row renders the same document
   * markup as the sampling & inspection plan and needs the same download
   * coverage — `download-file.controller.js` reaches BES files through a
   * SEPARATE `overseasSites.sites[].besEvidence.files` lookup, so proving the
   * sampling branch resolves says nothing about the BES one.
   */
  documentLinksIn(rowKey) {
    return this.applicationDetailRow(rowKey).$$(
      '[data-testid="app-detail-document"]'
    )
  }

  async supportingDocumentNames() {
    const links = await this.supportingDocumentLinks()
    return Promise.all([...links].map((link) => link.getText()))
  }

  /**
   * Request every supporting document's href from inside the browser session,
   * so the cookie carries over and the URL resolves against whatever host the
   * current environment's baseUrl points at (docker network name in CI,
   * localhost locally, the deployed host on BrowserStack).
   *
   * Mirrors fetchBesEvidenceFileDownloadResponse on the application-details
   * page object. Proves each listed document resolves to a real object rather
   * than just having a well-shaped href — which matters here precisely because
   * AC02 is about the documents beyond the first, the ones most likely to be
   * rendered with a copy-pasted or index-confused link.
   */
  async fetchSupportingDocumentResponses(
    rowKey = SAMPLING_INSPECTION_PLAN_ROW
  ) {
    const links = await this.documentLinksIn(rowKey)
    const allHrefs = await Promise.all(
      [...links].map((link) => link.getAttribute('href'))
    )
    // A document is only an <a> when it is `scanStatus: "Clean"` and has a
    // fileId; a quarantined or still-scanning file is listed as a <span> with
    // a govuk-tag and no href. Those are correctly not downloadable, so they
    // are filtered out rather than counted as failures — the caller asserts on
    // the documents that SHOULD resolve.
    const hrefs = allHrefs.filter(Boolean)
    const responses = await browser.execute(async (urls) => {
      const results = []
      for (const url of urls) {
        const res = await fetch(url)
        results.push({
          status: res.status,
          contentType: res.headers.get('content-type'),
          // The response BODY is the only thing that distinguishes the two
          // seeded objects. Status and content-type are identical for both,
          // so an href bug serving document one for both entries would look
          // like two healthy 200s — which is exactly the failure the backend
          // seeder warns about when it says to keep the two s3Keys distinct.
          body: await res.text()
        })
      }
      return results
    }, hrefs)
    // Returned alongside so a caller can assert the links are distinct even
    // before fetching anything.
    return responses.map((r, i) => ({ ...r, href: hrefs[i] }))
  }

  /**
   * The "S&I updated by" uploaded-at / uploaded-by metadata, which the Jira
   * notes explicitly RETAIN through the redesign.
   */
  samplingPlanUpdatedBy() {
    return $('[data-testid="app-detail-sampling-updated-by"]')
  }

  // ── RA-483: only SELECTED overseas sites reach case management ───────────── //

  /**
   * One block per overseas reprocessing site rendered in the ORS row.
   *
   * Scoped to the `ors` row on purpose. RA-292 gave the BES row its own
   * `bes-site` testid precisely so that this lookup returns N blocks for N
   * sites rather than 2N — see the `bes-sites` note in management-fe's
   * `application-summary.js`. A nested interim site carries `interim-site`,
   * so it is not double-counted here either, which is what makes the length
   * of this a trustworthy "how many ORSs is the regulator being shown" count.
   */
  overseasSiteBlocks() {
    return this.applicationDetailRow('ors').$$('[data-testid="overseas-site"]')
  }

  async overseasSiteCount() {
    const blocks = await this.overseasSiteBlocks()
    return [...blocks].length
  }

  /**
   * The site-name line of every ORS block, in DOM order.
   *
   * Reads `overseas-site-name` rather than the whole block so the returned
   * strings really are names — a block's full text also carries the address
   * and any nested interim site, which would let a membership assertion pass
   * on a substring that is not actually the site's name.
   */
  async overseasSiteNames() {
    const names = await this.applicationDetailRow('ors').$$(
      '[data-testid="overseas-site-name"]'
    )
    return Promise.all([...names].map((name) => name.getText()))
  }

  /** One block per site listed in the BES evidence row. */
  besSiteBlocks() {
    return this.applicationDetailRow('bes').$$('[data-testid="bes-site"]')
  }

  /**
   * The full text of every BES-evidence block. Whole-block text rather than a
   * name element because the BES block renders "<name> (<country>)" as one
   * line with no inner name hook, and the country is half of what RA-483 has
   * to prove absent.
   */
  async besSiteTexts() {
    const blocks = await this.besSiteBlocks()
    return Promise.all([...blocks].map((block) => block.getText()))
  }

  /**
   * All visible text on the detail page.
   *
   * RA-483's acceptance criterion is that a removed site is not visible
   * ANYWHERE, so the negative assertion has to be page-wide rather than
   * row-scoped: filtering the ORS row alone while the BES row (or any future
   * section reading the same `overseasSites` array) still listed the site
   * would satisfy a row-scoped check and miss the bug entirely.
   *
   * `getText()` is deliberately preferred over `getPageSource()`: the AC is
   * about what a regulator can SEE. Asserting page-wide is safe here because
   * RA-186 moved the raw submitted payload off this page and into the audit
   * log, so a removed site's name has no legitimate reason to appear.
   */
  async pageText() {
    return $('body').getText()
  }

  // ── RA-504: the Reference footer, removed ────────────────────────────────── //

  /**
   * RA-504. Assert the Reference footer is gone from the detail page.
   *
   * RA-295 had relocated a debugging "Reference" block —
   * `work-item-application-ref-footer`, its `.app-case-footer` wrapper and its
   * `work-item-reference-row-*` rows (application reference, identifiers,
   * declaration, timestamps, operator email) — to the foot of the page.
   * RA-504 removes that block entirely; nothing it carried moves elsewhere.
   *
   * Kept as a helper so the specs assert the removal through one hook rather
   * than repeating the selector, and so a regression that re-adds the footer
   * turns this suite red. The whole block hangs off the single footer testid,
   * so its absence is sufficient to prove every row went with it.
   */
  async assertNoReferenceFooter() {
    await expect(
      $('[data-testid="work-item-application-ref-footer"]')
    ).not.toBeExisting()
  }

  // ── RA-295 AC03: assignment panel ────────────────────────────────────────── //

  /** The bordered right-hand assignment panel. */
  assignmentPanel() {
    return $('[data-testid="case-assignment-panel"]')
  }

  /**
   * The three assignment affordances AC03 requires, scoped to the right-hand
   * panel so a control rendered elsewhere on the page cannot satisfy the AC
   * ("available on the right side panel box" is the requirement, not merely
   * "present somewhere").
   */
  /**
   * The three assignment affordances AC03 requires, scoped to the right-hand
   * panel so a control rendered elsewhere cannot satisfy the AC ("available on
   * the right side panel box" is the requirement, not merely "present").
   *
   * `reassign` and `unassign` are LINKS to interstitials, not submit buttons —
   * AC03 says "link", so the pickers moved off this page. The `assign-submit`
   * / `unassign-submit` buttons now live on those interstitials and are NOT
   * in this panel.
   */
  assignmentControl(name) {
    const testIds = {
      selfAssign: 'self-assign-submit',
      reassign: 'reassign-link',
      unassign: 'unassign-link',
      // RA-523. The START half of "Assign to yourself and start", split out
      // into a control of its own for a caller who ALREADY holds the item.
      //
      // MUTUALLY EXCLUSIVE WITH `selfAssign` BY CONSTRUCTION, which is the
      // whole point of the ticket: management-fe renders `self-assign-submit`
      // only when the caller is NOT the assignee, and `start-work-submit`
      // only when they ARE and the item sits in a state its module marks
      // `startsOnSelfAssign` (for re-accreditation, `duly-made`). Before the
      // fix, a `duly-made` item the caller already held still offered "Assign
      // to yourself and start" — a button proposing to assign them something
      // they were already holding.
      //
      // Listed HERE rather than reached through a hand-written selector so it
      // is panel-scoped like every other assignment affordance: a control
      // rendered elsewhere on the page must not satisfy an assertion about
      // what the assignment panel offers.
      startWork: 'start-work-submit'
    }
    const testId = testIds[name]
    if (!testId) {
      throw new Error(`Unknown assignment control "${name}"`)
    }
    return this.assignmentPanel().$(`[data-testid="${testId}"]`)
  }

  /** Guarded for the same reason as hasCaseHeaderField — the control
   * selectors are scoped to the panel, so a missing panel would throw
   * rather than answer "no". */
  async hasAssignmentControl(name) {
    if (!(await this.assignmentPanel().isExisting())) {
      return false
    }
    return this.assignmentControl(name).isExisting()
  }

  /**
   * RA-358 (assignment gating). Whether an assignment affordance is actually
   * USABLE — i.e. a live control the caseworker can act on.
   *
   * Deliberately tolerant of two valid implementations, because the
   * requirement is "a closed case offers no assignment affordance", not "the
   * markup is shaped a particular way": management-fe may either omit the
   * control entirely, or follow the RA-335 precedent and render an inert
   * `<span>` with the same test id (which `appActionLink` already does for
   * read-only users). Both satisfy the AC; a live `<a>` or `<button>` does
   * not, and that is what this returns true for.
   *
   * Written this way so the spec pins the behaviour rather than the choice
   * between those two, and does not need rewriting when the choice is made.
   */
  async hasUsableAssignmentControl(name) {
    if (!(await this.hasAssignmentControl(name))) {
      return false
    }
    const control = this.assignmentControl(name)
    const tagName = (await control.getTagName()).toLowerCase()
    if (tagName === 'span') {
      return false
    }
    // A link is only usable if it actually navigates; `appActionLink` drops
    // the href rather than the element in some states.
    if (tagName === 'a') {
      return Boolean(await control.getAttribute('href'))
    }
    return await control.isEnabled()
  }

  /**
   * RA-358. The panel's terminal-state explanation, which REPLACES the three
   * affordances on a closed case rather than merely disabling them.
   */
  assignmentClosedNotice() {
    return $('[data-testid="assignment-closed"]')
  }

  /**
   * RA-358. Assert a terminal-state case offers no usable assignment
   * affordance at all.
   *
   * Pairs the negative with a POSITIVE hook on purpose. management-fe
   * suppresses the three controls from the DOM, so an absence-only assertion
   * would also pass if the panel failed to render for an unrelated reason —
   * the page erroring, the testids being renamed, or the item not loading at
   * all. That is precisely how a false "pre-existing failure" wasted time
   * earlier in this work. Requiring `assignment-closed` to be displayed means
   * the panel demonstrably rendered and deliberately said the case is closed,
   * so the absences below are meaningful rather than vacuous.
   *
   * Checks all three affordances together and reports which survived, so a
   * failure names the offender instead of stopping at the first.
   */
  async assertNoUsableAssignmentAffordances() {
    await expect(this.assignmentPanel()).toBeDisplayed()
    await expect(this.assignmentClosedNotice()).toBeDisplayed()

    const names = ['selfAssign', 'reassign', 'unassign']
    const usable = []
    for (const name of names) {
      if (await this.hasUsableAssignmentControl(name)) {
        usable.push(name)
      }
    }
    expect(usable).toEqual([])
  }

  /**
   * RA-358. Assert an assign attempt on a terminal work item was REFUSED.
   *
   * management-be returns 409 and management-fe's BFF maps it to an error
   * render rather than a redirect, so the browser stays on the interstitial
   * URL and shows a GOV.UK error summary. Both are asserted: the error
   * summary alone would also appear for an ordinary validation failure, and
   * the URL alone would not distinguish a refusal from a page that simply
   * never submitted.
   *
   * The 409's COPY is deliberately not pinned. management-be owns that
   * wording, it changed once already during this work (it used to embed the
   * work item GUID, which RA-358 exists to remove), and its own tests cover
   * it. What this suite is entitled to assert is that the call was refused.
   */
  async assertAssignRefused() {
    const submit = $('button[type="submit"]')
    await submit.waitForClickable({
      timeout: 10000,
      timeoutMsg: 'Expected the assign interstitial to offer a submit button'
    })
    await submit.click()

    const errorSummary = $('.govuk-error-summary')
    await errorSummary.waitForDisplayed({
      timeout: 10000,
      timeoutMsg:
        'Expected an error summary after assigning a terminal work item'
    })
    const url = new URL(await browser.getUrl())
    expect(url.pathname).toMatch(/\/assign$/)
  }

  /**
   * Read the session's CSRF crumb from any form the current page rendered.
   *
   * The crumb cookie is HttpOnly by design, so the token has to come from a
   * hidden field rather than `document.cookie`. It is per-session, not
   * per-form, so a crumb captured on one page stays valid on another — which
   * is what makes the stale-form scenario below reproducible.
   */
  async readCrumb() {
    return browser.execute(
      () => document.querySelector('input[name="crumb"]')?.value
    )
  }

  /**
   * RA-358. POST the self-assign route directly, as a stale form would.
   *
   * Self-assign is a POST-only route with its own controller
   * (`makeSelfAssignController`), separate from the assign/reassign
   * interstitial, and it re-renders the detail page on failure rather than
   * redirecting. Once management-fe hides the button on a closed case there
   * is no clickable path left, so the only way to exercise the route — and
   * the real journey it models, a page opened before the case was withdrawn
   * and submitted after — is to post the captured crumb.
   *
   * `fetch` attaches the session cookies itself for a same-origin request.
   */
  async postSelfAssign(workItemId, crumb) {
    return browser.execute(
      async (id, crumbValue) => {
        const res = await fetch(`/work-items/${id}/self-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `crumb=${crumbValue}`
        })
        const body = await res.text()
        return {
          status: res.status,
          hasErrorSummary: body.includes('govuk-error-summary'),
          mentionsAssign: /assign/i.test(body)
        }
      },
      workItemId,
      crumb
    )
  }

  /**
   * The panel's assignment status line, reading exactly "Unassigned",
   * "Assigned to {Name}" or "Assigned to you".
   */
  assignmentCurrent() {
    return $('[data-testid="assignment-current"]')
  }

  /**
   * The value cell of an application-information row. Rows also carry
   * `app-detail-value-{key}` on the value side, so assertions can target the
   * submitted data without matching the row's own label — which matters for
   * short values ("Plastic") that could otherwise be satisfied by the label.
   */
  applicationDetailValue(key) {
    return this.applicationDetails().$(
      `[data-testid="app-detail-value-${key}"]`
    )
  }

  /** The "no supporting documents" empty state on the sampling plan row. */
  noDocumentsMessage() {
    return $('[data-testid="app-detail-documents-none"]')
  }

  // ── RA-295: prior-year section, folded onto the detail page ─────────────── //

  /**
   * The RA-254 prior-year block, which moved onto the detail page with the
   * rest of the application-details content.
   *
   * management-fe renders it only when the backend prior-year lookup succeeds
   * and is absent entirely when it fails, so callers must treat it as
   * optional rather than assuming it is always present.
   */
  priorYear(part = 'details') {
    const testIds = {
      heading: 'prior-year-heading',
      details: 'prior-year-details',
      tonnage: 'prior-year-tonnage',
      authorisers: 'prior-year-authorisers',
      businessPlan: 'prior-year-business-plan'
    }
    const testId = testIds[part]
    if (!testId) {
      throw new Error(`Unknown prior-year part "${part}"`)
    }
    return $(`[data-testid="${testId}"]`)
  }

  async hasPriorYear(part = 'details') {
    return this.priorYear(part).isExisting()
  }

  /**
   * RA-358 (AC1). The prominent "this application has been withdrawn" message
   * on the detail page of a withdrawn work item.
   *
   * Before RA-358 a withdrawn item announced itself only through the grey
   * `Withdrawn` status tag in the case header and a generic "This work item is
   * in a final state" Outcome panel — neither of which tells a regulator what
   * actually happened to the application. This is the explicit message.
   */
  withdrawnNotice() {
    return $('[data-testid="work-item-withdrawn-notice"]')
  }

  async hasWithdrawnNotice() {
    return this.withdrawnNotice().isExisting()
  }

  /**
   * RA-358 (AC1). The emphasised application reference inside the withdrawn
   * message. Rendered only when the case actually has one — the copy degrades
   * to an unqualified sentence rather than falling back to the GUID — so
   * callers that may hit a reference-less item must check existence first.
   */
  withdrawnNoticeReference() {
    return $('[data-testid="work-item-withdrawn-reference"]')
  }

  async withdrawnNoticeText() {
    return this.withdrawnNotice().getText()
  }

  /**
   * RA-358 (AC1). Assert the withdrawn message is on screen and says so.
   *
   * The exact wording belongs to management-fe and content design, so this
   * matches case-insensitively on "withdrawn" rather than pinning the whole
   * sentence — a copy tweak should not turn this suite red. What RA-358
   * actually guarantees (the message exists, is visible, and names the
   * withdrawal) is asserted; the identifier rules are asserted separately by
   * `assertWithdrawnNoticeIdentifiedBy` so a failure says which half broke.
   */
  async assertWithdrawnNotice() {
    await this.withdrawnNotice().waitForDisplayed({
      timeout: 10000,
      timeoutMsg:
        'Expected a withdrawn message on the detail page of a withdrawn work item'
    })
    await expect(this.withdrawnNotice()).toHaveText(/withdrawn/i)
  }

  /**
   * RA-358 (AC1). Where the withdrawn message names the case it must use the
   * user-facing application reference, never the system-generated work item
   * GUID.
   *
   * Scoped to the message itself rather than the whole page on purpose:
   * RA-196 deliberately KEEPS a "Work item ID" summary row carrying the GUID
   * on this page for debugging, so a page-wide GUID-absence assertion would
   * fail for a reason that has nothing to do with this AC.
   */
  async assertWithdrawnNoticeIdentifiedBy(applicationReference, workItemId) {
    const text = await this.withdrawnNoticeText()
    expect(text).toContain(applicationReference)
    expect(text).not.toContain(workItemId)
    await expect(this.withdrawnNoticeReference()).toHaveText(
      applicationReference
    )
  }

  /**
   * RA-346. Is an action affordance rendered on the detail page at all?
   *
   * A transition whose `requiresAllTasksComplete` gate is unmet is filtered
   * out of `availableActions` entirely, so the button is ABSENT rather than
   * disabled — unlike the read-only support-user case (RA-335), where the
   * control renders as an inert `<span>`. Specs therefore assert existence,
   * not enabledness.
   */
  async hasAction(actionId) {
    return $(`[data-testid="action-${actionId}"]`).isExisting()
  }

  /**
   * RA-346. Every element carrying an `action-*` testid, by the suffix.
   *
   * ⚠ This is NOT the engine's `availableActions`. The `action-` testid
   * prefix is reused by two independently-rendered panels in `detail.njk`:
   *
   *  - the actions panel, whose primary buttons and secondary query/withdraw
   *    links DO come from `availableActions`;
   *  - the assignment panel, where `action-sla-extend` renders as "Change
   *    determination deadline" gated on `canChangeDueDate`. `sla-extend` is
   *    deliberately filtered OUT of `availableActions` by the detail
   *    controller, so it never passes through the engine's gate at all.
   *    (RA-572 retired its `action-sla-override` sibling entirely.)
   *
   * So only a `withdraw-*` / `query` / primary-button id is evidence that
   * the actions panel rendered. Using an SLA id as a negative control would
   * pass even if the actions panel were missing entirely.
   */
  async availableActionIds() {
    const elements = await $$('[data-testid^="action-"]')
    const ids = []
    for (const element of elements) {
      const testId = await element.getAttribute(TESTID_ATTR)
      ids.push(testId.replace(/^action-/, ''))
    }
    return ids
  }

  // ── RA-364: the actions panel, scoped and counted ────────────────────────── //

  /**
   * The bordered actions card. Always rendered, even with no actions.
   */
  actionsPanel() {
    return $('[data-testid="actions-panel"]')
  }

  /**
   * The inner container holding the action controls. Rendered ONLY when the
   * (already filtered) action list is non-empty — management-fe filters in the
   * detail controller, before the data reaches the template, so the template's
   * length check sees the filtered list. That ordering is what makes "all
   * actions were non-caller-invocable" render the empty state rather than an
   * empty container, and is asserted by assertActionsPanelWellFormed().
   */
  workItemActions() {
    return $('[data-testid="work-item-actions"]')
  }

  /** The generic "No actions are currently available" empty state. */
  noActionsMessage() {
    return $('[data-testid="work-item-no-actions"]')
  }

  /**
   * RA-132. The re-accreditation terminal-state panel, which REPLACES the
   * generic actions panel body via the `actionsPanel` block override in
   * `re-accreditation/detail-v1.njk`. A withdrawn/granted/refused
   * re-accreditation item therefore shows THIS, not `work-item-no-actions` —
   * a distinction worth encoding, because a spec that expected the generic
   * empty state on a terminal item would fail for a reason that has nothing
   * to do with the behaviour under test.
   */
  readOnlyActionsNotice() {
    return $('[data-testid="re-accreditation-readonly-actions"]')
  }

  /**
   * RA-364. Every action control rendered INSIDE the actions panel.
   *
   * ⚠ Scoping to the panel is load-bearing, not tidiness. The `action-` testid
   * prefix is shared with the ASSIGNMENT panel, which renders `action-sla-extend`
   * ("Change determination deadline") gated on `canChangeDueDate`. It is a
   * sibling of this panel, not a child of it (`case-assignment-panel` and
   * `actions-panel` are separate `app-case-panel` divs), and `sla-extend` is
   * deliberately filtered OUT of `availableActions` by the detail controller —
   * so a page-wide `[data-testid^="action-"]` count silently includes a control
   * that never passed through the projection this ticket is about. That is
   * precisely how a count-based assertion becomes wrong and unfalsifiable.
   * (RA-572 retired `action-sla-override`, which used to be the second such
   * control; the scoping argument is unchanged, just one control lighter.)
   *
   * `availableActionIds()` above is the page-wide version and keeps its existing
   * callers; this is the panel-scoped one. They are NOT interchangeable.
   *
   * The wrapper itself is safe: `actions-panel` does not match
   * `[data-testid^="action-"]` (the 7th character is `s`, not `-`), so the
   * container cannot inflate the count.
   */
  actionControls() {
    return this.actionsPanel().$$('[data-testid^="action-"]')
  }

  /**
   * The action ids rendered in the panel, in DOM order.
   *
   * ⚠ Duplicates are DELIBERATELY PRESERVED. RA-364 is a bug about the same
   * control being rendered four times over, so de-duplicating here — as
   * `applicationDetailRowOrder()` legitimately does for its own purposes —
   * would destroy the only evidence the bug leaves behind and turn every
   * assertion below into one that could never fail.
   */
  async actionControlIds() {
    if (!(await this.actionsPanel().isExisting())) {
      return []
    }
    const controls = await this.actionControls()
    const ids = []
    for (const control of controls) {
      const testId = await control.getAttribute(TESTID_ATTR)
      ids.push((testId ?? '').replace(/^action-/, ''))
    }
    return ids
  }

  /**
   * The VISIBLE LABEL of each control in the panel, in DOM order, duplicates
   * preserved for the same reason as above.
   *
   * The label is the control's own text node — `action.displayName` straight
   * from the backend for buttons and withdraw links, and a hardcoded "Query"
   * for the query link. Labels are what the user actually sees duplicated, and
   * what the ticket's screenshot shows four of; asserting on ids alone would
   * miss a regression that reintroduced four DISTINCT ids all labelled
   * "Resume", which is exactly the shape of the original bug.
   */
  async actionControlLabels() {
    if (!(await this.actionsPanel().isExisting())) {
      return []
    }
    const controls = await this.actionControls()
    const labels = []
    for (const control of controls) {
      labels.push((await control.getText()).trim())
    }
    return labels
  }

  /**
   * How many controls in the panel carry `label`, compared case-insensitively
   * and trimmed. Used for the zero-Resume / exactly-one-Withdraw assertions:
   * a count is falsifiable against the bug, whereas "a Withdraw link exists"
   * passed happily while four broken Resume buttons sat next to it.
   */
  async countActionsLabelled(label) {
    const labels = await this.actionControlLabels()
    const needle = label.trim().toLowerCase()
    return labels.filter((text) => text.toLowerCase() === needle).length
  }

  /** How many controls in the panel carry exactly `actionId`. */
  async countActionsWithId(actionId) {
    const ids = await this.actionControlIds()
    return ids.filter((id) => id === actionId).length
  }

  /**
   * RA-364 (AC05). No action label may appear twice in the panel.
   *
   * This is the heart of the ticket, so it reports the offending labels with
   * their counts rather than just failing a length check — a bare
   * `expect(n).toBe(0)` on a regression would say "expected 4 to be 0" and
   * leave the next person to open a browser to find out which control it was.
   */
  async assertNoDuplicateActionLabels() {
    const labels = await this.actionControlLabels()
    const counts = new Map()
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label, count]) => `${label} ×${count}`)
    expect(duplicated).toEqual([])
  }

  /**
   * RA-364 (AC06). The actions panel must always be in exactly ONE of three
   * well-formed shapes, never a rendered-but-empty container:
   *
   *   1. `work-item-actions` present AND holding at least one control;
   *   2. `work-item-no-actions` — the generic empty state;
   *   3. `re-accreditation-readonly-actions` — the RA-132 terminal-state
   *      override, which replaces the panel body entirely.
   *
   * The regression this guards is specific: if the non-caller-invocable filter
   * ran AFTER the template's `availableActions.length > 0` check rather than
   * before it, a work item whose actions were all filtered away would render
   * `work-item-actions` as an EMPTY div — no controls, and no empty-state
   * message either. Asserting only "the empty state appears somewhere" would
   * not catch that; asserting the container is never empty is what does.
   */
  async assertActionsPanelWellFormed() {
    await expect(this.actionsPanel()).toBeDisplayed()

    const hasControls = await this.workItemActions().isExisting()
    const hasEmptyState = await this.noActionsMessage().isExisting()
    const hasReadOnlyNotice = await this.readOnlyActionsNotice().isExisting()

    const shapes = [hasControls, hasEmptyState, hasReadOnlyNotice].filter(
      Boolean
    ).length
    expect(shapes).toBe(1)

    if (hasControls) {
      const ids = await this.actionControlIds()
      // The container exists, so it must hold something. This is the
      // empty-panel assertion; `toBeGreaterThan(0)` on a count that came back
      // as `[]` is the failure mode being guarded.
      expect(ids.length).toBeGreaterThan(0)
    }
  }

  /**
   * RA-316. The "Duly make" CTA, rendered in the actions panel while the
   * item is in `submitted` and ABSENT FROM THE DOM in every other state
   * (management-fe removes it rather than hiding it, so presence — not
   * visibility — is the assertion that means anything here).
   *
   * `duly-make` is registered `CallerInvocable: false` in management-be, so
   * it never appears in `availableActions` and the generic
   * `/work-items/{id}/actions/duly-make` route cannot drive it — same shape
   * as `approve`. That is why this is a bespoke CTA accessor and not a
   * `triggerAction('duly-make')` call.
   */
  dulyMakeCta() {
    return $('[data-testid="duly-make-cta"]')
  }

  async hasDulyMakeCta() {
    return this.dulyMakeCta().isExisting()
  }

  async clickDulyMake() {
    await this.dulyMakeCta().click()
  }

  /**
   * RA-454. Is the "Continue review" control offered on the detail page?
   *
   * "Continue review" is NOT a bespoke CTA like `duly-make` or `log-decision`:
   * it is the generic `continue-review` action, rendered in the actions panel
   * as `data-testid="action-continue-review"` for an item in `updated`. So its
   * presence is derived from the SAME panel-scoped accessor every other action
   * uses (`countActionsWithId`), not from a hand-written selector.
   *
   * Panel-scoping matters here for the same reason RA-364 documents: only a
   * control INSIDE `actions-panel` is evidence the actions panel projected it.
   * A page-wide `[data-testid="action-continue-review"]` check would be
   * exact-match-safe today (no other panel renders that id), but deriving it
   * from the panel keeps this consistent with `countActionsWithId` and immune
   * to a future assignment-panel control reusing the label.
   *
   * This exists so the RA-454 specs read the intent — "is Continue review
   * offered?" — and assert on the SAME element the operator-bug let the user
   * click, rather than an action id in the spec body.
   */
  async hasContinueReviewCta() {
    return (await this.countActionsWithId('continue-review')) > 0
  }

  /**
   * RA-316. The RAW state id, from `data-state-id` on the re-accreditation
   * detail root.
   *
   * This exists because the visible status CANNOT distinguish
   * `assessment-in-progress` from `updated` — RA-324 gives both the display
   * name "Updated". Before this hook the raw id reached no part of the DOM,
   * so `assertState('Updated')` would happily pass against the wrong one of
   * the two. Assert on this wherever the distinction matters; it is a
   * contract with management-fe, not an incidental attribute.
   */
  async stateId() {
    return $('[data-testid="re-accreditation-detail"]').getAttribute(
      'data-state-id'
    )
  }

  async assertStateId(expected) {
    await expect($('[data-testid="re-accreditation-detail"]')).toHaveAttribute(
      'data-state-id',
      expected
    )
  }

  // ── RA-410: Tasks are gone ───────────────────────────────────────────────── //

  /**
   * RA-410 (AC02). Every `data-testid` the tasks feature ever stamped on a
   * work-item screen, as confirmed by management-fe when the templates and
   * routes were deleted.
   *
   * The first four were on the DETAIL page; the rest were on the tasks page
   * that no longer exists. Both sets are listed because AC02 is about work-item
   * SCREENS, not just the one page — a partial revert that restored the panel
   * without the sub-page would still be a failure, and vice versa.
   *
   * Held as one exported-by-accessor list rather than as a hand-kept literal in
   * a spec so that "did we get them all?" has exactly one answer. The last five
   * are PREFIXES: they were stamped per task id (`task-status-tag-verify-…`),
   * so an exact-match assertion on them could never fail.
   */
  static TASK_TESTIDS = [
    'tasks-panel',
    'work-item-tasks-link',
    'work-item-task-progress',
    'work-item-no-tasks'
  ]

  static TASK_TESTID_PREFIXES = [
    'work-item-task-',
    'task-group-',
    'task-status-tag-',
    'task-status-select-',
    'set-task-status-',
    'complete-task-'
  ]

  tasksPanel() {
    return $('[data-testid="tasks-panel"]')
  }

  async hasTasksPanel() {
    return this.tasksPanel().isExisting()
  }

  async hasTasksLink() {
    return $('[data-testid="work-item-tasks-link"]').isExisting()
  }

  async hasTaskProgress() {
    return $('[data-testid="work-item-task-progress"]').isExisting()
  }

  async hasNoTasksMessage() {
    return $('[data-testid="work-item-no-tasks"]').isExisting()
  }

  /**
   * RA-410 (AC02). Every task-related testid still present on the current page.
   *
   * Returns the offenders rather than a boolean so a failure NAMES what
   * survived instead of just saying "something did" — the difference between a
   * one-minute fix and a hunt through the templates.
   *
   * Covers both the exact ids and the per-task prefixes, so a leftover
   * `task-status-select-assess-financial-capacity` is caught even though no
   * spec knows that task id any more.
   */
  async residualTaskTestIds() {
    const exact = WorkItemDetailPage.TASK_TESTIDS
    const prefixes = WorkItemDetailPage.TASK_TESTID_PREFIXES
    return browser.execute(
      (exactIds, prefixIds) => {
        const found = []
        for (const el of document.querySelectorAll('[data-testid]')) {
          const id = el.getAttribute('data-testid') ?? ''
          if (
            exactIds.includes(id) ||
            prefixIds.some((p) => id.startsWith(p))
          ) {
            found.push(id)
          }
        }
        return [...new Set(found)]
      },
      exact,
      prefixes
    )
  }

  /**
   * RA-410 (AC01). Whether any nav item, tab, link or button on the page is
   * labelled "Tasks".
   *
   * Deliberately a TEXT search over interactive elements rather than a testid
   * check: AC01 is about what a regulator can read and click, so a link that
   * still says "Tasks" fails the AC whatever its markup is called — and a
   * testid-only assertion would pass against exactly that.
   *
   * Word-boundary matched so "Tasks" is caught but a legitimate word containing
   * it is not, and case-insensitive so "TASKS" in a nav cannot slip through.
   * Returns the offending labels for the same diagnostic reason as above.
   */
  async elementsLabelledTasks() {
    return browser.execute(() => {
      const found = []
      const selector = 'a, button, [role="tab"], nav *, .govuk-tabs__tab'
      for (const el of document.querySelectorAll(selector)) {
        // OPERATOR-SUPPLIED TEXT IS NOT SERVICE CHROME. The work-items list
        // renders each organisation's name as the tile link, so an operator
        // legitimately called "Task Force Recycling Ltd" would otherwise be
        // reported as an AC01 violation — and the assertion would be policing
        // a regulator's own data rather than this service's labels.
        //
        // This is not hypothetical: it fired on THIS suite's own fixture. A
        // work item created as "Tasks Removed <timestamp>" renders a matching
        // anchor, so the negative spec failed against the item it had just
        // created. The fixture was renamed too, but renaming alone would have
        // left a test that breaks the first time a real operator name
        // contains the word.
        //
        // Matched on `work-item-link-` specifically, NOT the broader
        // `work-item-` prefix: `work-item-tasks-link` shares that broader
        // prefix and is exactly the affordance AC01 is about, so excluding it
        // would open a hole precisely where the coverage is needed.
        if (el.closest('[data-testid^="work-item-link-"]')) {
          continue
        }
        const text = (el.textContent ?? '').trim()
        if (text && /\btasks?\b/i.test(text) && text.length < 60) {
          found.push(text.replace(/\s+/g, ' '))
        }
      }
      return [...new Set(found)]
    })
  }

  /**
   * RA-410 (AC03). GET a path from inside the browser session and report the
   * status, so the cookie carries over and the URL resolves against whatever
   * host the current environment's baseUrl points at.
   *
   * Used to prove `/work-items/{id}/tasks` is genuinely GONE. Driving this with
   * fetch rather than a navigation is deliberate: management-fe deletes the
   * route outright so Hapi 404s it, and a browser navigation would render the
   * generic error page and swallow the status — 404 versus a 302-to-detail is
   * exactly the distinction AC03 turns on.
   */
  async fetchStatus(path) {
    return browser.execute(async (url) => {
      const response = await fetch(url)
      return { status: response.status, url: response.url }
    }, path)
  }

  // ── RA-410: the green call-to-action lifecycle ───────────────────────────── //

  /**
   * RA-410. The "Log decision" CTA, rendered in the actions panel while the
   * item is in `assessment-in-progress` and ABSENT FROM THE DOM in every other
   * state (management-fe removes it rather than hiding it, so presence — not
   * visibility — is the assertion that means anything here).
   *
   * Shaped like `dulyMakeCta` above and for the same reason: the decision is
   * driven by a bespoke module route, not by a generic
   * `/work-items/{id}/actions/...` call. management-be no longer lists
   * `submit-for-decision` or `reject` in `availableActions` at all, so
   * `triggerAction('reject')` cannot reach a determination any more.
   */
  logDecisionCta() {
    return $('[data-testid="log-decision-cta"]')
  }

  async hasLogDecisionCta() {
    return this.logDecisionCta().isExisting()
  }

  /**
   * RA-447 (CM7). The CTA's visible label — renamed from "Log decision" to
   * "Make Determination". The `data-testid` is unchanged, so this reads text
   * rather than existence to guard the rename itself.
   */
  async logDecisionCtaText() {
    return this.logDecisionCta().getText()
  }

  async clickLogDecision() {
    await this.logDecisionCta().click()
  }

  /**
   * RA-410. "Assign to yourself and start" — the `duly-made` →
   * `assessment-in-progress` step.
   *
   * THE SAME BUTTON AS `selfAssign()`, deliberately. management-fe reuses
   * `self-assign-submit`; what RA-410 adds is server-side, and only from
   * `duly-made`: the handler applies `payment-received` as well as taking the
   * item.
   *
   * So this is not a different control, it is the same control with a
   * state-dependent side effect — which is precisely why it needs its own
   * method. `selfAssign()` waits only for the assignee to change and would
   * return happily before the transition landed, giving a caller that then
   * asserts the new state an intermittent failure. This waits for BOTH.
   *
   * Use `selfAssign()` from any other state, where no transition is expected.
   *
   * RA-523 NARROWED WHEN THIS IS AVAILABLE AT ALL. `self-assign-submit` no
   * longer renders in every non-closed state — it renders only for a caller
   * who is NOT the assignee. A caller who already holds the item gets
   * `start-work-submit` instead, so from `duly-made` this method requires an
   * item held by nobody (or by someone else, in which case it takes it over).
   * When the item is already yours, use `startWork()` below.
   */
  async selfAssignAndStart() {
    await this.assignmentControl('selfAssign').click()
    await browser.waitUntil(
      async () =>
        (await this.assignmentCurrent().isExisting()) &&
        !(await this.assignmentCurrent().getText()).includes('Unassigned') &&
        (await this.stateId()) === 'assessment-in-progress',
      {
        timeout: 10000,
        // Spelled out because this timeout has three quite different causes
        // and the browser state at the moment it fires tells them apart:
        //
        //  - Detail page, 200, still `duly-made`, error banner naming the
        //    assignment and the transition -> the transition FAILED. The
        //    handler awaits `applyAction` before redirecting, so a failure
        //    renders in place rather than redirecting; this is not lag.
        //  - Redirected to the detail page, assigned, but the state id trails
        //    -> read-your-own-write in management-be: the transition
        //    committed and the immediately-following GET did not observe it.
        //  - Never assigned at all -> the self-assign button was not rendered
        //    or not clickable, usually because the item was already assigned.
        timeoutMsg:
          'Expected the work item to become assigned AND move to ' +
          'assessment-in-progress after "Assign to yourself and start". ' +
          'If the page shows `duly-made` with an error banner the transition ' +
          'failed (management-fe renders in place on failure, so this is not ' +
          'a race); if it redirected and is assigned but the state trails, ' +
          'suspect backend read-your-own-write.'
      }
    )
  }

  /**
   * RA-523. The label on the start control.
   *
   * Read as TEXT rather than merely asserted present, because the label is
   * the fix. management-fe takes it from the module's own transition
   * `displayName` (`payment-received` -> "Payment received"), so this control
   * names the single operation it performs instead of the two-operation
   * "Assign to yourself and start" whose first half was already done. A
   * regression that restored the old label while keeping the new testid would
   * reintroduce exactly the confusion QA reported, and an existence-only
   * check would not see it.
   */
  async startWorkText() {
    return this.assignmentControl('startWork').getText()
  }

  /**
   * RA-523 / RA-410 recovery. Drive `duly-made` -> `assessment-in-progress`
   * as the caller who ALREADY holds the item.
   *
   * The counterpart to `selfAssignAndStart()` for the other side of the
   * `callerIsAssignee` split. This posts to the generic action route and
   * performs ONE operation, so unlike that method there is no assignment to
   * wait for — only the transition.
   *
   * This path is the reason RA-523 could not simply delete the button: if the
   * assign half of "Assign to yourself and start" lands and the transition
   * half does not, the caller becomes the assignee of a `duly-made` item and
   * `payment-received` is filtered out of the actions panel, so without this
   * control there is nothing left on the page that starts the work. A fix
   * that strands the caller there is not a fix, which is why a spec drives
   * this for real rather than only asserting the button exists.
   */
  async startWork() {
    await this.assignmentControl('startWork').click()
    await browser.waitUntil(
      async () => (await this.stateId()) === 'assessment-in-progress',
      {
        timeout: 10000,
        timeoutMsg:
          'Expected the work item to move to assessment-in-progress after ' +
          'clicking the start control ("Payment received"). management-fe ' +
          'awaits the action before redirecting, so a detail page still ' +
          'showing `duly-made` with an error banner means the transition was ' +
          'REFUSED rather than that it is lagging.'
      }
    )
  }

  /**
   * RA-132. The approve interstitial lives on a type-specific route, not
   * under the generic `/work-items/{id}/actions/...` namespace.
   */
  approvePath(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/approve`
  }

  /**
   * RA-346. Navigate straight to the approve interstitial, bypassing the
   * CTA. Hiding the CTA alone is not a control — the route itself has to
   * refuse when the decision tasks are incomplete.
   */
  async openApprovePathDirectly(workItemId) {
    await this.open(this.approvePath(workItemId))
  }

  /**
   * RA-346 (and RA-335, which established the pattern). POST to a route
   * from inside the page so the browser attaches the session cookie.
   *
   * The crumb cookie is HttpOnly by design, so the CSRF token is read from
   * whichever hidden `crumb` field the currently-rendered page already
   * carries — otherwise the request would be rejected as a CSRF failure and
   * we would learn nothing about the business-rule gate we are testing.
   *
   * Returns `{ status, redirected, url }` rather than a bare status because
   * the two guarded routes refuse in two different shapes: the generic
   * apply-action route re-renders in place with a 409, while the
   * re-accreditation approve route follows this app's PRG convention and
   * 302s back to the detail page. `redirect: 'manual'` is deliberately NOT
   * used — it yields an opaque response with status 0 and no readable
   * headers, so the redirect is followed and asserted via `redirected` +
   * the final `url` instead.
   */
  async postFromPage(path) {
    return browser.execute(async (url) => {
      const crumb = document.querySelector('input[name="crumb"]')?.value ?? ''
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `crumb=${encodeURIComponent(crumb)}`
      })
      return {
        status: response.status,
        redirected: response.redirected,
        url: response.url
      }
    }, path)
  }

  // ── RA-292: new ORS / interim site / authority-to-issue contact ─────────── //

  /**
   * RA-292. Every repeating block on the work item overview page that the
   * story can flag as NEW, resolved to the `data-testid` of the block itself.
   *
   * Specs address these by kind (`'overseasSite'`) rather than by raw testid so
   * a markup rename stays a one-line change here — the same reason
   * CASE_HEADER_FIELDS exists. The pairing of block testid to tag testid lives
   * in NEW_TAG_TESTIDS below rather than being derived by string concatenation:
   * `authority-to-issue-contact` takes an `authority-to-issue-new-tag`, not an
   * `authority-to-issue-contact-new-tag`, so a derived name would be wrong for
   * exactly one of the three and silently match nothing.
   */
  flaggedBlockTestId(kind) {
    return NEW_FLAG_BLOCKS[kind].block
  }

  newTagTestId(kind) {
    return NEW_FLAG_BLOCKS[kind].newTag
  }

  /** Every block of one kind rendered on the overview page, in DOM order. */
  flaggedBlocks(kind) {
    return $$(`[data-testid="${this.flaggedBlockTestId(kind)}"]`)
  }

  async flaggedBlockCount(kind) {
    return (await this.flaggedBlocks(kind)).length
  }

  /** The visible text of each block of one kind, in DOM order. */
  async flaggedBlockTexts(kind) {
    const blocks = await this.flaggedBlocks(kind)
    return Promise.all([...blocks].map((block) => block.getText()))
  }

  /**
   * The single block of `kind` whose OWN name line reads `name`.
   *
   * Deliberately matched on the block's `*-name` element rather than on the
   * block's whole `getText()`. management-fe nests each `interim-site` INSIDE
   * its parent `overseas-site` div (an interim site belongs to an ORS), so an
   * ORS block's text contains its interim site's text too — a substring match
   * over block text would return the ORS parent when asked for an interim
   * site, and every assertion scoped to it would then be reading the wrong
   * element while still finding plausible-looking content.
   *
   * Throws when the match is not unique. Uniqueness is not pedantry: every
   * negative assertion in RA-292 takes the form "site A is tagged new, site B
   * is not", and if `name` matched two blocks a `.isExisting()` on the tag
   * would answer for whichever came first and quietly pass regardless of which
   * one the badge was actually on.
   */
  async flaggedBlockNamed(kind, name) {
    const blocks = await this.flaggedBlocks(kind)
    const nameTestId = NEW_FLAG_BLOCKS[kind].name
    const matches = []
    for (const block of [...blocks]) {
      // The authority-to-issue contact has no separate name element — it
      // renders as a single "Name (email)" line — so `name` is matched against
      // the block's own text there. That is safe for contacts specifically
      // because, unlike the sites, they are never nested inside one another.
      const target = nameTestId
        ? block.$(`[data-testid="${nameTestId}"]`)
        : block
      if (nameTestId && !(await target.isExisting())) {
        continue
      }
      if ((await target.getText()).includes(name)) {
        matches.push(block)
      }
    }
    if (matches.length !== 1) {
      const names = await this.flaggedBlockNames(kind)
      throw new Error(
        `Expected exactly one "${kind}" block named "${name}", found ` +
          `${matches.length}. Blocks on the page: ${JSON.stringify(names)}`
      )
    }
    return matches[0]
  }

  /**
   * The name line of each block of one kind, in DOM order.
   *
   * Read from the block's own `*-name` element rather than from block text, so
   * the ORS list does not report its nested interim sites' names as its own.
   */
  async flaggedBlockNames(kind) {
    const blocks = await this.flaggedBlocks(kind)
    const nameTestId = NEW_FLAG_BLOCKS[kind].name
    const names = []
    for (const block of [...blocks]) {
      if (!nameTestId) {
        names.push(await block.getText())
        continue
      }
      const nameEl = block.$(`[data-testid="${nameTestId}"]`)
      names.push((await nameEl.isExisting()) ? await nameEl.getText() : null)
    }
    return names
  }

  /**
   * Whether the block of `kind` named `name` carries its "New" tag.
   *
   * The tag lookup is SCOPED INSIDE the matched block, which is the whole
   * point: a page-wide `$('[data-testid="overseas-site-new-tag"]').isExisting()`
   * cannot tell "the new site is badged" from "some other site is badged", and
   * would pass against a template that renders the tag unconditionally on the
   * first site in the list.
   *
   * The exact testid matters here too, for the same nesting reason: a suffix
   * selector such as `[data-testid$="new-tag"]` scoped to an `overseas-site`
   * would also match the interim site's tag inside it, so an untagged ORS with
   * a tagged interim site would report as tagged.
   */
  async blockHasNewTag(kind, name) {
    const block = await this.flaggedBlockNamed(kind, name)
    return block.$(`[data-testid="${this.newTagTestId(kind)}"]`).isExisting()
  }

  /**
   * One detail field read from EVERY block of a kind, as `{ name, value }`
   * pairs in DOM order, with `value` null where the row is omitted.
   *
   * Exists for assertions about how a value is distributed across the page
   * rather than about one named block — "exactly one site reports EU country
   * as No". That framing is deliberately independent of which site it is,
   * which lets the behaviour be pinned without the spec hard-coding a fixture
   * name it would otherwise have to guess at.
   */
  async flaggedBlockFieldValues(kind, fieldTestId) {
    const blocks = await this.flaggedBlocks(kind)
    const nameTestId = NEW_FLAG_BLOCKS[kind].name
    const rows = []
    for (const block of [...blocks]) {
      const nameEl = nameTestId
        ? block.$(`[data-testid="${nameTestId}"]`)
        : block
      const field = block.$(`[data-testid="${fieldTestId}"]`)
      rows.push({
        name: (await nameEl.isExisting()) ? await nameEl.getText() : null,
        value: (await field.isExisting())
          ? (await field.getText()).trim()
          : null
      })
    }
    return rows
  }

  /**
   * Whether the RENDERED LINE for the block of `kind` named `name` carries the
   * `NEW: ` prefix — read as text, independently of the marker element.
   *
   * The complement to `blockHasNewTag`, and it catches a different bug. That
   * one asks "is the conditional marker element present?", which is the right
   * question for the flag logic. This asks "does the user see the word NEW on
   * this line?", which is the right question for the page — and it is the only
   * one that catches a `NEW:` hardcoded into the template text, outside the
   * testid, where element-absence checks look perfectly clean.
   *
   * ⚠ SCOPED TO THE LINE, NEVER TO BLOCK TEXT. This is load-bearing now that
   * the marker is a string rather than an element. Interim sites render nested
   * INSIDE their parent `overseas-site` block, so an ORS block's text contains
   * its interim site's text: a block-scoped "does not contain NEW:" assertion
   * FAILS on a correctly-rendered established ORS that holds a new interim
   * site, and the mirror case is worse — a block-scoped PRESENCE check passes
   * for an ORS that is not new, because its new interim child supplied the
   * string. Reading the site's own name line is what keeps the two apart.
   */
  async blockLineHasNewPrefix(kind, name) {
    const block = await this.flaggedBlockNamed(kind, name)
    const lineTestId = NEW_FLAG_BLOCKS[kind].line
    const line = lineTestId ? block.$(`[data-testid="${lineTestId}"]`) : block
    const text = normaliseSpaces(await line.getText())
    return text.startsWith(NEW_PREFIX)
  }

  /**
   * The text of one detail field inside the block of `kind` named `name`.
   *
   * Returns `null` when the field is absent rather than throwing, because
   * management-fe OMITS a detail row entirely when its source value is
   * absent/null/blank — it renders no em-dash placeholder. "Absent" is
   * therefore a legitimate, assertable outcome and not a lookup failure.
   */
  async blockFieldText(kind, name, fieldTestId) {
    const block = await this.flaggedBlockNamed(kind, name)
    const field = block.$(`[data-testid="${fieldTestId}"]`)
    return (await field.isExisting()) ? (await field.getText()).trim() : null
  }

  /**
   * The joined text of EVERY element carrying `fieldTestId` inside the block
   * of `kind` named `name`, newline-separated, or null when there are none.
   *
   * The ORS address needs this. Design moved it out of the labelled detail
   * list to a line under the site name, and it now renders ONE `<p>` per
   * address line rather than one joined string — so `overseas-site-address`
   * matches three elements for a site with two address lines and a town.
   * `blockFieldText` reads the first match only, which silently returns
   * "1 Havenstraat" and would fail a town assertion while the page is
   * perfectly correct. Anything multi-element must come through here.
   */
  async blockFieldAllText(kind, name, fieldTestId) {
    const block = await this.flaggedBlockNamed(kind, name)
    const fields = await block.$$(`[data-testid="${fieldTestId}"]`)
    if (![...fields].length) {
      return null
    }
    const parts = await Promise.all([...fields].map((field) => field.getText()))
    return parts.join('\n').trim()
  }

  /**
   * Read several detail fields from one block in a single pass, as a
   * `{ fieldTestId: text | null }` map.
   *
   * AC04 asks for a whole set of site data points to be "clearly displayed",
   * so the natural assertion is over the set. Asserting field-by-field with a
   * separate `expect` each would report only the first missing one and hide
   * the rest behind it, which turns one fix-and-rerun cycle into six.
   */
  async blockFields(kind, name, fieldTestIds) {
    const block = await this.flaggedBlockNamed(kind, name)
    const values = {}
    for (const fieldTestId of fieldTestIds) {
      const field = block.$(`[data-testid="${fieldTestId}"]`)
      values[fieldTestId] = (await field.isExisting())
        ? (await field.getText()).trim()
        : null
    }
    return values
  }

  /**
   * How many blocks of `kind` carry a "New" tag.
   *
   * Counted per-block rather than by counting tag elements page-wide so a tag
   * rendered outside any block — or two tags inside one block — cannot be
   * mistaken for correct output.
   */
  async newTagCount(kind) {
    const blocks = await this.flaggedBlocks(kind)
    const testId = this.newTagTestId(kind)
    let count = 0
    for (const block of [...blocks]) {
      if (await block.$(`[data-testid="${testId}"]`).isExisting()) {
        count += 1
      }
    }
    return count
  }

  /**
   * RA-292. Every "new" marker of one kind must read exactly `NEW:` and must
   * render as a `NEW: ` prefix on the line the user actually reads.
   *
   * DESIGN CHANGE: this used to assert a blue `govuk-tag`. Design replaced the
   * tag with a literal `NEW: ` text prefix. The testids did not move — they
   * describe purpose, not implementation — so every structural assertion built
   * on them carries over unchanged; only the well-formedness check here does.
   *
   * Two assertions, and the second is the one that earns its keep:
   *
   *  1. The marker element reads exactly `NEW:` — uppercase, colon, and NO
   *     trailing space. The space the user sees is markup whitespace BETWEEN
   *     the marker element and the name, so it is not inside the element.
   *
   *  2. The rendered LINE reads `NEW: <name>`. This is what catches the
   *     failure mode the first assertion cannot see: if that inter-element
   *     whitespace is lost — a stray `{%- -%}`, a template reflow, a minifier
   *     — the marker element still reads a perfect `NEW:` while the page shows
   *     the user `NEW:Bharat Recycling`. Asserting the span alone would pass
   *     that happily.
   *
   * The separating space is asserted STRICTLY as ASCII U+0020. management-fe
   * considered a `&nbsp;` to stop the prefix wrapping away from its name and
   * deliberately rejected it, precisely because it renders identically and
   * would change the contract invisibly; if wrapping ever needs solving it
   * will be solved in CSS. So a non-breaking space here is a real contract
   * change and this should fail — but it would otherwise fail as
   * "expected 'NEW: ' to be 'NEW: '", two strings that look identical in a
   * terminal, so it is diagnosed by hand rather than left to the diff.
   */
  async assertNewPrefixesWellFormed(kind) {
    const blocks = await this.flaggedBlocks(kind)
    const testId = this.newTagTestId(kind)
    const lineTestId = NEW_FLAG_BLOCKS[kind].line
    for (const block of [...blocks]) {
      const marker = block.$(`[data-testid="${testId}"]`)
      if (!(await marker.isExisting())) {
        continue
      }

      expect(await marker.getText()).toBe(NEW_MARKER)

      // The line carrying the prefix: the name element for the two site
      // kinds, and the contact block itself for an authority-to-issue
      // contact, whose marker is a sibling of its name rather than inside it.
      const line = lineTestId ? block.$(`[data-testid="${lineTestId}"]`) : block
      const text = await line.getText()
      const prefix = text.slice(0, NEW_PREFIX.length)

      if (normaliseSpaces(prefix) === NEW_PREFIX && prefix !== NEW_PREFIX) {
        throw new Error(
          `"${kind}" renders the prefix with a NON-BREAKING space, not the ` +
            `agreed ASCII U+0020: ${JSON.stringify(prefix)}. This looks ` +
            `identical on screen and in a failure diff, which is why it is ` +
            `reported explicitly. Agree the change with management-fe before ` +
            `relaxing this — the ASCII space is a deliberate decision, not an ` +
            `accident.`
        )
      }
      expect(prefix).toBe(NEW_PREFIX)
    }
  }

  /**
   * Whether ANY of the three RA-292 "New" tags is present anywhere on the page.
   *
   * The backwards-compatibility case needs this. A pre-RA-292 work item carries
   * none of `isNewSite` / `isNew`, and Nunjucks resolves a missing key to
   * undefined — which is falsy, so the badge should not render. But a template
   * written as `{% if site.isNewSite != false %}` would badge every legacy site
   * on every historic case, which is a visible data-integrity bug and precisely
   * the regression a per-kind assertion on a NEW work item would never see.
   */
  async hasAnyNewTag() {
    for (const kind of Object.keys(NEW_FLAG_BLOCKS)) {
      const tag = $(`[data-testid="${this.newTagTestId(kind)}"]`)
      if (await tag.isExisting()) {
        return true
      }
    }
    return false
  }

  /**
   * RA-292 (AC04). The rendered text of the whole application-information
   * block, for asserting that a set of site detail values all made it onto the
   * page.
   *
   * Read once and asserted against in memory rather than one `$()` per field:
   * the ACs list ten-odd data points per site, and ten round trips to the
   * browser per assertion is where this suite's runtime goes.
   */
  async applicationDetailsText() {
    return this.applicationDetails().getText()
  }

  /**
   * RA-292 backwards compatibility. Nothing on the overview page may render as
   * `[object Object]` or `undefined`.
   *
   * This is the specific failure mode of the change under test. RA-292 adds
   * template code that reaches into nested site objects (`site.address.town`,
   * `site.wasteCodes`), and a legacy work item has those keys missing or shaped
   * differently. Nunjucks does not throw on either — it stringifies, so the
   * regression ships as a page that renders and looks fine to a smoke test
   * while showing operators `[object Object]` where a town should be.
   */
  async assertNoUnrenderedValues() {
    const text = await this.applicationDetailsText()
    expect(text).not.toContain('[object Object]')
    expect(text).not.toContain('undefined')
  }

  // ── RA-434: the "Additional information" tab ─────────────────────────────── //

  /** The summary list holding the six Additional information rows. */
  additionalInformation() {
    return $('[data-testid="additional-information"]')
  }

  additionalInformationRow(key) {
    return this.additionalInformation().$(
      `[data-testid="additional-information-row-${key}"]`
    )
  }

  async hasAdditionalInformationRow(key) {
    return this.additionalInformationRow(key).isExisting()
  }

  async additionalInformationRowText(key) {
    return this.additionalInformationRow(key).getText()
  }

  /**
   * The value cell of an Additional information row, scoped the same way as
   * applicationDetailValue() so a short value (e.g. a companies house
   * number) cannot be satisfied by matching the row's own label.
   */
  additionalInformationValue(key) {
    return this.additionalInformation().$(
      `[data-testid="additional-information-value-${key}"]`
    )
  }

  /**
   * The Additional information row keys actually rendered, in DOM order.
   * Mirrors applicationDetailRowOrder(): filtered through
   * ADDITIONAL_INFORMATION_ROWS and de-duplicated, so an unrelated element
   * cannot break the ordering assertion.
   */
  async additionalInformationRowOrder() {
    const rows = await this.additionalInformation().$$(TESTID_SELECTOR)
    const seen = []
    for (const row of rows) {
      const testId = await row.getAttribute(TESTID_ATTR)
      const key = (testId ?? '').replace(/^additional-information-row-/, '')
      if (
        testId?.startsWith('additional-information-row-') &&
        ADDITIONAL_INFORMATION_ROWS.includes(key) &&
        !seen.includes(key)
      ) {
        seen.push(key)
      }
    }
    return seen
  }

  // ── RA-469 / RA-486: the "Recycling operations" tab ──────────────────────── //

  /**
   * Navigate directly to the Recycling operations tab (RA-469).
   *
   * Deliberately NOT `this.tab('recyclingOperations').click()`, unlike
   * gotoAudit()/gotoAdditionalInformation(). A RA-469 follow-up hid this tab
   * from the case-tabs bar (`HIDDEN_TAB_KEYS` in management-fe's
   * case-header.js — product asked for it to stay hidden until the copy is
   * finalised), so there is no clickable link to drive today. The route,
   * controller and page are fully live for anyone who navigates to them
   * directly, which is what this does. Re-point this at `tab('recyclingOperations').click()`
   * once product turns the tab bar entry back on — `hasRecyclingOperationsTabLink()`
   * below exists so this suite notices that moment rather than needing to be
   * told about it.
   */
  async gotoRecyclingOperations() {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/]+)/)
    await this.open(`/work-items/${match[1]}/recycling-operations`)
    await browser.waitUntil(
      async () =>
        /\/work-items\/[^/]+\/recycling-operations/.test(
          await browser.getUrl()
        ),
      {
        timeoutMsg: 'Expected a recycling-operations URL after navigating to it'
      }
    )
  }

  /**
   * Navigate directly to the Recycling operations tab with a `?q=` search
   * term already applied. AC4's filtering runs on the query string
   * regardless of whether the search box itself is rendered — `showSearch`
   * only gates the BOX, not the filter — so this reaches the filtering
   * behaviour without needing the >20-site fixture that would make the box
   * appear.
   */
  async gotoRecyclingOperationsSearch(term) {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/]+)/)
    await this.open(
      `/work-items/${match[1]}/recycling-operations?q=${encodeURIComponent(term)}`
    )
  }

  /**
   * Whether the "Recycling operations" tab is offered in the case-tabs bar.
   * Currently always false in production — see gotoRecyclingOperations()'s
   * comment — asserted explicitly (rather than left unchecked) so a change
   * to that hidden state is a deliberate, visible decision in this suite.
   */
  async hasRecyclingOperationsTabLink() {
    return $('[data-testid="tab-recycling-operations"]').isExisting()
  }

  recyclingOperationsSiteList() {
    return $('[data-testid="recycling-operations-site-list"]')
  }

  recyclingOperationsSite(siteId) {
    return $(`[data-testid="recycling-operations-site-${siteId}"]`)
  }

  async recyclingOperationsSiteName(siteId) {
    return this.recyclingOperationsSite(siteId)
      .$('[data-testid="recycling-operations-site-name"]')
      .getText()
  }

  /**
   * The site ids of every row currently rendered, in DOM order — sites are
   * always sorted alphabetically by name (AC2) regardless of backend order,
   * so this is how a spec asserts that ordering without hand-computing it.
   */
  async recyclingOperationsSiteOrder() {
    const rows = await this.recyclingOperationsSiteList().$$(TESTID_SELECTOR)
    const ids = []
    for (const row of rows) {
      const testId = await row.getAttribute(TESTID_ATTR)
      if (testId?.startsWith('recycling-operations-site-')) {
        const id = testId.replace('recycling-operations-site-', '')
        // Excludes the nested `recycling-operations-site-name` /
        // `-codes` / `-interim` / `-audit` / `-change-{id}` testids inside
        // each row, which also start with the same prefix.
        if (
          !['name', 'codes', 'no-codes', 'interim', 'audit'].includes(id) &&
          !id.startsWith('change-')
        ) {
          ids.push(id)
        }
      }
    }
    return ids
  }

  /**
   * The bulleted recycling-operation code LABELS (full human-readable text,
   * not the bare code) rendered for one site, in DOM order. Empty when the
   * site carries no codes at all — pair with
   * hasRecyclingOperationsNoCodesMessage() for the AC7 empty-state row.
   */
  async recyclingOperationsSiteCodeLabels(siteId) {
    const items = await this.recyclingOperationsSite(siteId).$$(
      '[data-testid="recycling-operations-site-codes"] li'
    )
    return Promise.all([...items].map((li) => li.getText()))
  }

  /** AC7: the "No recycling operation codes are set for this site" row. */
  async hasRecyclingOperationsNoCodesMessage(siteId) {
    return this.recyclingOperationsSite(siteId)
      .$('[data-testid="recycling-operations-site-no-codes"]')
      .isExisting()
  }

  /**
   * AC6 (RA-486). Whether the "Associated interim site" line is rendered for
   * one ORS row. RA-486 decouples this from the ORS's own R12/R13 codes — it
   * is shown whenever the site HAS an associated interim site, regardless of
   * which codes (if any) the ORS itself carries.
   */
  async hasRecyclingOperationsInterimLine(siteId) {
    return this.recyclingOperationsSite(siteId)
      .$('[data-testid="recycling-operations-site-interim"]')
      .isExisting()
  }

  async recyclingOperationsInterimLineText(siteId) {
    return this.recyclingOperationsSite(siteId)
      .$('[data-testid="recycling-operations-site-interim"]')
      .getText()
  }

  recyclingOperationsChangeLink(siteId) {
    return this.recyclingOperationsSite(siteId).$(
      `[data-testid="recycling-operations-site-change-${siteId}"]`
    )
  }

  /**
   * AC3: the search box only renders once the application has more than one
   * page's worth of sites (>20) — absent here since this fixture seeds four.
   */
  recyclingOperationsSearchForm() {
    return $('[data-testid="recycling-operations-search-form"]')
  }

  recyclingOperationsNoSearchResults() {
    return $('[data-testid="recycling-operations-no-search-results"]')
  }
}

/**
 * RA-292. Block testid ↔ name-line testid ↔ "New" tag testid, fixed by the
 * cross-repo contract agreed with management-fe. Exported so a spec can assert
 * against the same single source of truth the page object reads.
 *
 * `name` is null for the authority-to-issue contact, which management-fe
 * renders as one "Name (email)" line with no separate name element; the page
 * object falls back to the block's own text for that kind.
 *
 * The tag testid is held here rather than derived by appending `-new-tag` to
 * the block testid, because that derivation is wrong for exactly one of the
 * three: `authority-to-issue-contact` takes an `authority-to-issue-new-tag`.
 * A derived name would match nothing and every contact assertion would report
 * "no tag" — passing the negatives and failing the positives for a reason that
 * has nothing to do with the code under test.
 */
export const NEW_FLAG_BLOCKS = {
  overseasSite: {
    block: 'overseas-site',
    name: 'overseas-site-name',
    // The marker sits INSIDE the name element, so the name element is also
    // the line that must read `NEW: <name>`.
    line: 'overseas-site-name',
    newTag: 'overseas-site-new-tag'
  },
  interimSite: {
    block: 'interim-site',
    name: 'interim-site-name',
    line: 'interim-site-name',
    newTag: 'interim-site-new-tag'
  },
  authorityToIssueContact: {
    block: 'authority-to-issue-contact',
    // Wraps the DISPLAY NAME only — the email follows outside it, as
    // "Grace Adeyemi (grace.adeyemi@example.com)". Matching on this rather
    // than on block text keeps a name lookup from being satisfied by an email
    // that happens to contain the same string.
    name: 'authority-to-issue-contact-name',
    // Unlike the two site kinds, the marker is a SIBLING of the name rather
    // than inside it, so the name element reads "Harry Edge" with no prefix.
    // The line the user reads is the contact block itself.
    line: null,
    newTag: 'authority-to-issue-new-tag'
  }
}

/**
 * RA-292. The literal text of the "new" marker element, and the prefix it
 * produces on the rendered line once markup whitespace separates it from the
 * name.
 *
 * The marker carries NO trailing space — the gap the user sees is whitespace
 * between the marker element and the name — which is why these are two
 * different constants rather than one trimmed comparison.
 */
export const NEW_MARKER = 'NEW:'
export const NEW_PREFIX = 'NEW: '

/**
 * RA-292 (AC04). The ORS data points the AC requires to be "clearly
 * displayed", as the testid management-fe puts on each value cell.
 *
 * `overseas-site-address` predates RA-292; the rest are new. Exported as a set
 * so the AC04 spec asserts over the whole list in one pass and reports every
 * missing field at once, rather than stopping at the first.
 */
export const ORS_DETAIL_FIELDS = [
  'overseas-site-ors-id',
  'overseas-site-address',
  'overseas-site-coordinates',
  'overseas-site-contact-name',
  'overseas-site-contact-email',
  'overseas-site-contact-phone',
  'overseas-site-operation-code',
  'overseas-site-waste-codes',
  'overseas-site-repatriated-loads',
  'overseas-site-conditions-of-export',
  'overseas-site-registered-now-accredited',
  'overseas-site-eu-country',
  'overseas-site-oecd-country'
]

/**
 * RA-292 (AC04). The interim-site data points, same contract.
 *
 * `interim-site-operation-code` is RA-486: the interim site gets its own
 * recycling operation code(s) (mandatory R12/R13, optional R3/R4/R5),
 * mirrored onto the Application summary tab display-only, same
 * key/label/reader shape as the ORS list's own `overseas-site-operation-code`
 * — there is no edit capability for it on this side (that lives on the
 * Recycling operations tab, and only for the ORS's own codes — see
 * ra-486-recycling-operations-tab.e2e.js).
 */
export const INTERIM_DETAIL_FIELDS = [
  'interim-site-site-number',
  'interim-site-address',
  'interim-site-contact-name',
  'interim-site-contact-email',
  'interim-site-contact-phone',
  'interim-site-operation-code'
]

export default new WorkItemDetailPage()
