import type { IsoDateTime } from '@healthy360/domain-types';

import type {
    B2BAgreement,
    B2BApplicationContact,
    B2BApplicationLocation,
    B2BApplicationSection,
    B2BApplicationSections,
    B2BDocumentKind,
    B2BPaymentTerms,
    DocumentDownload,
    KycDocument,
    KycRejectionReason,
} from './b2b-application.ts';
import type { CursorPage } from './pagination.ts';

/**
 * The platform reviewer's side of B2B onboarding (`/platform-admin/b2b`).
 *
 * A separate repository from the applicant's `B2BApplicationRepository`, for the reason that
 * contract gives: a reviewer sees internal notes, duplicate matches and drafts, which must never
 * reach an applicant's client, and one bundle serving both would have to be trusted to filter.
 *
 * Every route behind it sits under `platform.context` and a `b2b_application.*_platform` code; the
 * screens gate each control on the same codes so a reviewer without one sees the state but not the
 * button.
 *
 * The decision writes answer `void`: the screen re-reads the application after each, because a
 * decision changes the queue as well as the file.
 */

/** The application's own status column, verbatim — the reviewer works the row, not the panel. */
export const PLATFORM_APPLICATION_STATUSES = [
    'draft',
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'declined',
    'withdrawn',
] as const;
export type PlatformApplicationStatus = (typeof PLATFORM_APPLICATION_STATUSES)[number];

/** One row of the review queue. */
export interface PlatformB2bApplicationSummary {
    readonly id: string;
    readonly reference: string;
    readonly status: PlatformApplicationStatus;
    readonly legalName: string | null;
    readonly tradingName: string | null;
    readonly countryCode: string | null;
    readonly submittedAt: IsoDateTime | null;
    readonly decidedAt: IsoDateTime | null;
    readonly reviewedBy: string | null;
    readonly lockVersion: number;
}

/** A KYC document as a reviewer sees it — with the facts the applicant's projection drops. */
export interface PlatformKycDocument extends KycDocument {
    /** The device's declared type disagreed with the sniffed one. */
    readonly mediaTypeMismatch: boolean;
    readonly hasExpired: boolean;
    readonly reviewNote: string | null;
}

/** One application, whole, as the reviewer works it. */
export interface PlatformB2bApplication extends PlatformB2bApplicationSummary {
    readonly sections: B2BApplicationSections;
    readonly completedSections: readonly B2BApplicationSection[];
    readonly contacts: readonly B2BApplicationContact[];
    readonly locations: readonly B2BApplicationLocation[];
    readonly documents: readonly PlatformKycDocument[];
    /** Required kinds not yet uploaded. Computed by the server, never from the applicant's claim. */
    readonly missingDocumentKinds: readonly B2BDocumentKind[];
    /** Other applications with the same registration or tax number. Surfaced, never acted on. */
    readonly duplicateApplications: readonly PlatformB2bApplicationSummary[];
    readonly informationRequest: string | null;
    readonly informationRequestedSections: readonly B2BApplicationSection[];
    /** What the applicant reads about a decision. */
    readonly applicantMessage: string | null;
    /** The reviewer's own note. Never served to the applicant. */
    readonly decisionNote: string | null;
    readonly provisionedOrganisationId: string | null;
    readonly createdAt: IsoDateTime | null;
}

export interface PlatformApplicationFilter {
    /** Omitted: everything except drafts. */
    readonly status?: PlatformApplicationStatus | undefined;
    readonly query?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
}

/**
 * The terms a reviewer writes. On an edit, an absent key leaves the term as it is and `null`
 * clears it.
 */
export interface AgreementTermsInput {
    readonly title?: string | undefined;
    readonly priceListId?: string | null | undefined;
    readonly currencyCode?: string | null | undefined;
    readonly paymentTerms?: B2BPaymentTerms | null | undefined;
    readonly creditLimitMinor?: number | null | undefined;
    readonly minimumOrderMinor?: number | null | undefined;
    readonly deliveryLeadTimeDays?: number | null | undefined;
    readonly noticePeriodDays?: number | null | undefined;
    readonly startsOn?: string | null | undefined;
    readonly endsOn?: string | null | undefined;
    readonly autoRenews?: boolean | undefined;
    readonly termsSummary?: string | null | undefined;
}

/** A kitchen's negotiated price list, as the agreement editor's seller picker offers it. */
export interface SellerPriceListOption {
    readonly id: string;
    readonly organisationId: string;
    readonly organisationName: string;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string | null;
    readonly currencyCode: string;
    readonly status: 'draft' | 'active';
    /** The application whose live agreement already holds it. A taken list cannot be chosen. */
    readonly boundToApplicationId: string | null;
}

export const PLATFORM_INVITATION_STATUSES = ['live', 'accepted', 'revoked', 'expired'] as const;
export type PlatformInvitationStatus = (typeof PLATFORM_INVITATION_STATUSES)[number];

/** Somebody provisioning invited into the new company. */
export interface PlatformInvitation {
    readonly id: string;
    readonly email: string;
    readonly roleCode: string;
    readonly status: PlatformInvitationStatus;
    readonly expiresAt: IsoDateTime;
    readonly acceptedAt: IsoDateTime | null;
    readonly createdAt: IsoDateTime | null;
}

/** What provisioning made. */
export interface ProvisionOutcome {
    readonly organisationId: string;
    readonly organisationName: string;
    readonly invitationsIssued: number;
    readonly ownerMembershipCreated: boolean;
}

interface LockedApplication {
    readonly applicationId: string;
    readonly lockVersion: number;
}

interface LockedAgreement {
    readonly agreementId: string;
    readonly lockVersion: number;
}

export interface PlatformB2bRepository {
    listApplications(
        filter?: PlatformApplicationFilter,
    ): Promise<CursorPage<PlatformB2bApplicationSummary>>;
    getApplication(applicationId: string): Promise<PlatformB2bApplication>;

    claim(request: LockedApplication): Promise<void>;
    requestInformation(
        request: LockedApplication & {
            readonly message: string;
            readonly sections: readonly B2BApplicationSection[];
        },
    ): Promise<void>;
    approve(
        request: LockedApplication & {
            readonly applicantMessage?: string | undefined;
            readonly internalNote?: string | undefined;
        },
    ): Promise<void>;
    decline(
        request: LockedApplication & {
            readonly applicantMessage: string;
            readonly internalNote?: string | undefined;
        },
    ): Promise<void>;

    reviewDocument(request: {
        readonly documentId: string;
        readonly verdict: 'accepted' | 'rejected';
        readonly rejectionReason?: KycRejectionReason | undefined;
        readonly note?: string | undefined;
    }): Promise<void>;
    /** An audited, short-lived link. */
    getDocumentDownload(request: {
        readonly applicationId: string;
        readonly documentId: string;
    }): Promise<DocumentDownload>;

    /** Every version, newest first, drafts included. */
    listAgreements(applicationId: string): Promise<readonly B2BAgreement[]>;
    draftAgreement(request: {
        readonly applicationId: string;
        readonly title: string;
        readonly terms: AgreementTermsInput;
    }): Promise<B2BAgreement>;
    updateAgreement(
        request: LockedAgreement & { readonly terms: AgreementTermsInput },
    ): Promise<B2BAgreement>;
    sendAgreement(request: LockedAgreement): Promise<B2BAgreement>;
    /** Takes back an unsigned agreement and answers the next version as a draft. */
    reviseAgreement(request: LockedAgreement): Promise<B2BAgreement>;
    listSellerPriceLists(query?: string): Promise<readonly SellerPriceListOption[]>;

    /** Refused until the agreement is signed. Safe to retry. */
    provision(applicationId: string): Promise<ProvisionOutcome>;
    listInvitations(applicationId: string): Promise<readonly PlatformInvitation[]>;
    resendInvitation(request: {
        readonly applicationId: string;
        readonly invitationId: string;
    }): Promise<void>;
}
