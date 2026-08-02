/**
 * B2B onboarding — the applicant's side (plan Phase B1).
 *
 * Five screens over one contract: an entry, a six-step wizard whose draft lives on the server, the
 * document vault, the eleven-state status panel, the agreement with its click-wrap acceptance, and
 * the provisioning progression.
 *
 * ## What is deliberately exported, and to whom
 *
 * * **The screens** go through `./screens/index.ts` so the routes share one chunk.
 * * **{@link StatusPanel}** is exported because more than one surface will want it — a reviewer's
 *   workspace and the corporate hub both have a reason to draw "where does this stand".
 * * **The pure modules** (`./sections.ts`, `./vocabularies.ts`) carry every rule worth testing
 *   without a rendered tree, which is the same split `features/account` and `features/commerce` use.
 * * **`./repositories-shim.ts` is not exported.** It is temporary scaffolding the integrator wave
 *   deletes, and nothing outside `data/b2b-application-hooks.ts` should learn to depend on it.
 */

export { AgreementPanel } from './agreement-panel.tsx';
export type { AgreementPanelProps } from './agreement-panel.tsx';

export { DocumentSlotList, buildSlots } from './document-slot-list.tsx';
export type { DocumentSlot, DocumentSlotListProps } from './document-slot-list.tsx';

export { StatusPanel } from './status-panel.tsx';
export type { StatusPanelProps } from './status-panel.tsx';

export {
    B2B_STEPS,
    B2B_STEP_COUNT,
    B2B_STEP_SLUGS,
    FIRST_B2B_STEP,
    SECTION_SCHEMAS,
    awaitsSignature,
    firstIncompleteStep,
    isApplicantEditable,
    isB2BStepSlug,
    isProvisioning,
    isStepComplete,
    isStepEditable,
    missingDocumentKinds,
    outstandingCount,
    sectionForStep,
    sectionState,
    sectionValues,
    stepAfter,
    stepBefore,
    stepForSection,
    validateSection,
} from './sections.ts';
export type { B2BStepDescriptor, B2BStepSlug, SectionErrors } from './sections.ts';

export { OPTIONAL_DOCUMENT_KINDS, VOCABULARIES } from './vocabularies.ts';
export type { VocabularyName } from './vocabularies.ts';

export {
    ApplyAgreementScreen,
    ApplyEntryScreen,
    ApplyProvisioningScreen,
    ApplyStatusScreen,
    ApplyStepScreen,
} from './screens/index.ts';
export type { ApplyStepScreenProps } from './screens/index.ts';
