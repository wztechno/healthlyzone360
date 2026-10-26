import type { B2BAgreement, DocumentDownload } from '../contracts/b2b-application.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    AgreementTermsInput,
    PlatformApplicationFilter,
    PlatformB2bApplication,
    PlatformB2bApplicationSummary,
    PlatformB2bRepository,
    PlatformInvitation,
    PlatformKycDocument,
    ProvisionOutcome,
    SellerPriceListOption,
} from '../contracts/platform-b2b.ts';
import type {
    B2bAgreement as WireAgreement,
    B2bApplicationReviewEnvelope,
    B2bApplicationSummary as WireSummary,
    B2bProvisioningEnvelope,
    CreateB2bAgreementRequest,
    KycDocumentDownload as WireDownload,
    KycDocumentReview as WireDocument,
    OrganisationInvitation as WireInvitation,
    PaginationMeta,
    SellerPriceList as WireSellerPriceList,
    UpdateB2bAgreementRequest,
} from '../generated/types.ts';
import {
    mapAgreement,
    mapContact,
    mapDocument,
    mapLocation,
    mapSections,
} from './b2b-repository.ts';
import type { Transport } from './transport.ts';

/**
 * The platform reviewer's B2B onboarding surface, over `/platform/b2b/*`.
 *
 * Born real, like `platform-admin-repository.ts`. Every response is read out of its envelope —
 * `{ application }`, `{ agreement }`, `{ invitation }` — never as the bare row; reading a body as
 * the row is the bug that sent `/b2b/applications/undefined/…` on the applicant side.
 *
 * `If-Match` is sent from the `lockVersion` the caller read; provisioning sends a fresh
 * `Idempotency-Key`, which the endpoint demands.
 */

const BASE = '/platform/b2b';

type ReviewBody = B2bApplicationReviewEnvelope['data'];

function mapSummary(wire: WireSummary): PlatformB2bApplicationSummary {
    return {
        id: wire.id,
        reference: wire.reference,
        status: wire.status,
        legalName: wire.legal_name ?? null,
        tradingName: wire.trading_name ?? null,
        countryCode: wire.country_code ?? null,
        submittedAt: wire.submitted_at ?? null,
        decidedAt: wire.decided_at ?? null,
        reviewedBy: wire.reviewed_by ?? null,
        lockVersion: wire.lock_version,
    };
}

function mapReviewDocument(wire: WireDocument): PlatformKycDocument {
    return {
        ...mapDocument(wire),
        purgeAfter: wire.purge_after ?? null,
        mediaTypeMismatch: wire.media_type_mismatch,
        hasExpired: wire.has_expired,
        reviewNote: wire.review_note ?? null,
    };
}

export function mapPlatformApplication(body: ReviewBody): PlatformB2bApplication {
    const wire = body.application;

    return {
        id: wire.id,
        reference: wire.reference,
        status: wire.status,
        legalName: wire.legal_name ?? null,
        tradingName: wire.trading_name ?? null,
        countryCode: wire.country_code ?? null,
        submittedAt: wire.submitted_at ?? null,
        decidedAt: wire.decided_at ?? null,
        reviewedBy: wire.reviewed_by ?? null,
        lockVersion: wire.lock_version,
        sections: mapSections(wire),
        completedSections: wire.completed_sections,
        contacts: body.contacts.map(mapContact),
        locations: body.locations.map(mapLocation),
        documents: body.documents.map(mapReviewDocument),
        missingDocumentKinds: body.missing_documents,
        duplicateApplications: body.duplicate_applications.map(mapSummary),
        informationRequest: wire.information_request ?? null,
        informationRequestedSections: wire.information_requested_sections ?? [],
        applicantMessage: wire.applicant_message ?? null,
        decisionNote: wire.decision_note ?? null,
        provisionedOrganisationId: wire.provisioned_organisation_id ?? null,
        createdAt: wire.created_at ?? null,
    };
}

function mapSellerPriceList(wire: WireSellerPriceList): SellerPriceListOption {
    return {
        id: wire.id,
        organisationId: wire.organisation_id,
        organisationName: wire.organisation_name,
        code: wire.code,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        currencyCode: wire.currency_code,
        status: wire.status,
        boundToApplicationId: wire.bound_to_application_id,
    };
}

function mapInvitation(wire: WireInvitation): PlatformInvitation {
    return {
        id: wire.id,
        email: wire.email,
        roleCode: wire.role_code,
        status: wire.status,
        expiresAt: wire.expires_at,
        acceptedAt: wire.accepted_at ?? null,
        createdAt: wire.created_at ?? null,
    };
}

/** Contract terms → wire body. An absent key is left off, so the server leaves that term alone. */
function termsBody(terms: AgreementTermsInput): UpdateB2bAgreementRequest {
    const body: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
        if (value !== undefined) body[key] = value;
    };

    set('title', terms.title);
    set('price_list_id', terms.priceListId);
    set('currency_code', terms.currencyCode);
    set('payment_terms', terms.paymentTerms);
    set('credit_limit_minor', terms.creditLimitMinor);
    set('minimum_order_minor', terms.minimumOrderMinor);
    set('delivery_lead_time_days', terms.deliveryLeadTimeDays);
    set('notice_period_days', terms.noticePeriodDays);
    set('starts_on', terms.startsOn);
    set('ends_on', terms.endsOn);
    set('auto_renews', terms.autoRenews);
    set('terms_summary', terms.termsSummary);

    return body as UpdateB2bAgreementRequest;
}

function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
    return { 'If-Match': `"${lockVersion}"` };
}

export function createApiPlatformB2bRepository(transport: Transport): PlatformB2bRepository {
    function application(applicationId: string, suffix = ''): string {
        return `${BASE}/applications/${encodeURIComponent(applicationId)}${suffix}`;
    }

    function agreement(agreementId: string, suffix = ''): string {
        return `${BASE}/agreements/${encodeURIComponent(agreementId)}${suffix}`;
    }

    async function agreementWrite(
        method: 'POST' | 'PATCH',
        path: string,
        headers: Readonly<Record<string, string>>,
        body?: unknown,
    ): Promise<B2BAgreement> {
        const payload = await transport.request<{ readonly agreement: WireAgreement }>({
            method,
            path,
            headers,
            ...(body === undefined ? {} : { body }),
        });
        return mapAgreement(payload.agreement);
    }

    return {
        async listApplications(
            filter?: PlatformApplicationFilter,
        ): Promise<CursorPage<PlatformB2bApplicationSummary>> {
            const search = new URLSearchParams();

            if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
            if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
            if (filter?.status !== undefined) search.set('status', filter.status);
            if (filter?.query !== undefined && filter.query.trim() !== '') {
                search.set('query', filter.query.trim());
            }

            const rendered = search.toString();
            const envelope = await transport.requestEnvelope<WireSummary[]>({
                method: 'GET',
                path: rendered === '' ? `${BASE}/applications` : `${BASE}/applications?${rendered}`,
            });
            const meta = envelope.meta as PaginationMeta;

            return {
                items: envelope.data.map(mapSummary),
                nextCursor: meta.next_cursor,
                hasMore: meta.has_more,
                totalCount: null,
            };
        },

        async getApplication(applicationId: string): Promise<PlatformB2bApplication> {
            const body = await transport.request<ReviewBody>({
                method: 'GET',
                path: application(applicationId),
            });
            return mapPlatformApplication(body);
        },

        async claim(request) {
            await transport.request({
                method: 'POST',
                path: application(request.applicationId, '/claim'),
                headers: ifMatch(request.lockVersion),
            });
        },

        async requestInformation(request) {
            await transport.request({
                method: 'POST',
                path: application(request.applicationId, '/request-information'),
                headers: ifMatch(request.lockVersion),
                body: { information_request: request.message, sections: request.sections },
            });
        },

        async approve(request) {
            await transport.request({
                method: 'POST',
                path: application(request.applicationId, '/approve'),
                headers: ifMatch(request.lockVersion),
                body: {
                    applicant_message: request.applicantMessage ?? null,
                    internal_note: request.internalNote ?? null,
                },
            });
        },

        async decline(request) {
            await transport.request({
                method: 'POST',
                path: application(request.applicationId, '/decline'),
                headers: ifMatch(request.lockVersion),
                body: {
                    applicant_message: request.applicantMessage,
                    internal_note: request.internalNote ?? null,
                },
            });
        },

        async reviewDocument(request) {
            await transport.request({
                method: 'POST',
                path: `${BASE}/documents/${encodeURIComponent(request.documentId)}/review`,
                body: {
                    verdict: request.verdict,
                    rejection_reason: request.rejectionReason ?? null,
                    note: request.note ?? null,
                },
            });
        },

        async getDocumentDownload(request): Promise<DocumentDownload> {
            const payload = await transport.request<{ readonly download: WireDownload }>({
                method: 'GET',
                path: application(
                    request.applicationId,
                    `/documents/${encodeURIComponent(request.documentId)}/download?purpose=platform_review`,
                ),
            });
            return {
                documentId: request.documentId,
                url: payload.download.url,
                expiresAt: payload.download.expires_at,
            };
        },

        async listAgreements(applicationId: string): Promise<readonly B2BAgreement[]> {
            const agreements = await transport.request<WireAgreement[]>({
                method: 'GET',
                path: application(applicationId, '/agreements'),
            });
            return agreements.map(mapAgreement);
        },

        draftAgreement(request) {
            const body: CreateB2bAgreementRequest = {
                ...termsBody(request.terms),
                title: request.title,
            };
            return agreementWrite(
                'POST',
                application(request.applicationId, '/agreements'),
                {},
                body,
            );
        },

        updateAgreement(request) {
            return agreementWrite(
                'PATCH',
                agreement(request.agreementId),
                ifMatch(request.lockVersion),
                termsBody(request.terms),
            );
        },

        sendAgreement(request) {
            return agreementWrite(
                'POST',
                agreement(request.agreementId, '/send'),
                ifMatch(request.lockVersion),
            );
        },

        reviseAgreement(request) {
            return agreementWrite(
                'POST',
                agreement(request.agreementId, '/revise'),
                ifMatch(request.lockVersion),
            );
        },

        async listSellerPriceLists(query?: string): Promise<readonly SellerPriceListOption[]> {
            const search =
                query === undefined || query.trim() === ''
                    ? ''
                    : `?query=${encodeURIComponent(query.trim())}`;
            const lists = await transport.request<WireSellerPriceList[]>({
                method: 'GET',
                path: `${BASE}/seller-price-lists${search}`,
            });
            return lists.map(mapSellerPriceList);
        },

        async provision(applicationId: string): Promise<ProvisionOutcome> {
            const payload = await transport.request<B2bProvisioningEnvelope['data']>({
                method: 'POST',
                path: application(applicationId, '/provision'),
                // A double click is a replay rather than a second tenant; the server also answers
                // two different keys for one application with the tenant it already made.
                headers: { 'Idempotency-Key': crypto.randomUUID() },
            });
            return {
                organisationId: payload.organisation.id,
                organisationName: payload.organisation.name,
                invitationsIssued: payload.invitations_issued,
                ownerMembershipCreated: payload.owner_membership_created,
            };
        },

        async listInvitations(applicationId: string): Promise<readonly PlatformInvitation[]> {
            const invitations = await transport.request<WireInvitation[]>({
                method: 'GET',
                path: application(applicationId, '/invitations'),
            });
            return invitations.map(mapInvitation);
        },

        async resendInvitation(request) {
            await transport.request({
                method: 'POST',
                path: application(
                    request.applicationId,
                    `/invitations/${encodeURIComponent(request.invitationId)}/resend`,
                ),
            });
        },
    };
}
