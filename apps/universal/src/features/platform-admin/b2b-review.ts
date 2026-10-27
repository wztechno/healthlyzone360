import type {
    B2BAgreement,
    PlatformApplicationStatus,
    PlatformB2bApplication,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';

/**
 * The reviewer's view of where an application stands, and the one move that is the reviewer's to
 * make next.
 *
 * Pure, so the screen and its test agree on one table. The application's own status stops at
 * `approved`; after that the agreement says where it is — drafted, sent, signed — and
 * `provisionedOrganisationId` says it is done.
 */

/** The stages the stage strip draws, in order. Declined and withdrawn end the strip early. */
export const REVIEW_STAGES = [
    'submitted',
    'in_review',
    'approved',
    'agreement_sent',
    'signed',
    'provisioned',
] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export type ReviewStep =
    | { readonly kind: 'claim' }
    | { readonly kind: 'decide' }
    | { readonly kind: 'waiting_applicant' }
    | { readonly kind: 'draft_agreement' }
    | { readonly kind: 'send_agreement'; readonly agreement: B2BAgreement }
    | { readonly kind: 'waiting_signature'; readonly agreement: B2BAgreement }
    | { readonly kind: 'provision'; readonly agreement: B2BAgreement }
    | { readonly kind: 'provisioned' }
    | { readonly kind: 'closed' };

/** The agreement that matters now: the newest version that has not been ended. */
export function liveAgreement(agreements: readonly B2BAgreement[]): B2BAgreement | null {
    const live = agreements.filter((agreement) => agreement.status !== 'terminated');
    return [...live].sort((a, b) => b.version - a.version)[0] ?? null;
}

export function nextReviewStep(
    application: PlatformB2bApplication,
    agreements: readonly B2BAgreement[],
): ReviewStep {
    if (application.provisionedOrganisationId !== null) return { kind: 'provisioned' };

    switch (application.status) {
        case 'submitted':
            return { kind: 'claim' };
        case 'in_review':
            return { kind: 'decide' };
        case 'info_requested':
            return { kind: 'waiting_applicant' };
        case 'approved': {
            const agreement = liveAgreement(agreements);
            if (agreement === null) return { kind: 'draft_agreement' };
            if (agreement.status === 'draft') return { kind: 'send_agreement', agreement };
            if (agreement.status === 'pending_signature') {
                return { kind: 'waiting_signature', agreement };
            }
            return { kind: 'provision', agreement };
        }
        default:
            return { kind: 'closed' };
    }
}

/** How far along the strip the application is. `null` for a declined or withdrawn one. */
export function reviewStage(
    application: PlatformB2bApplication,
    agreements: readonly B2BAgreement[],
): ReviewStage | null {
    const step = nextReviewStep(application, agreements);

    switch (step.kind) {
        case 'claim':
            return 'submitted';
        case 'decide':
        case 'waiting_applicant':
            return 'in_review';
        case 'draft_agreement':
        case 'send_agreement':
            return 'approved';
        case 'waiting_signature':
            return 'agreement_sent';
        case 'provision':
            return 'signed';
        case 'provisioned':
            return 'provisioned';
        default:
            return null;
    }
}

export function applicationStatusTone(status: PlatformApplicationStatus): BadgeTone {
    switch (status) {
        case 'submitted':
            return 'info';
        case 'in_review':
            return 'brand';
        case 'info_requested':
            return 'warning';
        case 'approved':
            return 'success';
        case 'declined':
            return 'danger';
        default:
            return 'neutral';
    }
}

export function applicationStatusKey(status: PlatformApplicationStatus): string {
    return `platformAdmin:b2b.status.${status}`;
}

export function applicationRowTestId(id: string): string {
    return `platform-b2b-application-${id}`;
}
