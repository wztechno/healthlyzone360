import type { BranchId, MembershipId, OrganisationId, UserId } from '@healthy360/domain-types';

import type { IsoDateTime } from '@healthy360/domain-types';

import type { CursorPage } from '../contracts/pagination.ts';
import type {
    CreateKitchenRequest,
    InviteOwnerRequest,
    KitchenCatalogueCounts,
    KitchenTenantFilter,
    KitchenTenantStatus,
    LockedPlatformRequest,
    OwnerInvitation,
    OwnerRevocation,
    PlatformAdminRepository,
    PlatformKitchen,
    PlatformKitchenBranch,
    PlatformKitchenOwner,
    PlatformKitchenSummary,
    SuspendKitchenRequest,
} from '../contracts/platform-admin.ts';
import type {
    PaginationMeta,
    PlatformKitchen as WirePlatformKitchen,
    PlatformKitchenBranch as WireBranch,
    PlatformKitchenCatalogueCounts as WireCatalogueCounts,
    PlatformKitchenOwner as WireOwner,
    PlatformKitchenSummary as WireSummary,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * The platform administration repository, over the real API (PA1).
 *
 * **Born real.** There is no `PROTOTYPE_ENDPOINTS` entry for anything here and no
 * `notImplemented()` stub, because every route this file calls shipped in the same phase as the
 * file. That is the difference between this family and the nine prototype ones, and it is why the
 * mock world beside it exists only so `mock` mode still boots rather than as the only working
 * implementation.
 *
 * ## The wire is snake_case and the domain is not
 *
 * Mapped here, once per shape, exactly as `kitchen-admin-repository.ts` does it. The types come
 * from `../generated/types.ts` — generated from the OpenAPI document — so a backend field that
 * disappears fails the typecheck here rather than producing `undefined` on a screen.
 *
 * ## `If-Match` is sent from the `lockVersion` the caller read
 *
 * Not from a value this module remembers. A client-held version is the wrong one by the second
 * call; the version that matters is the one the editor currently has on screen, which is why it is
 * a field on the request rather than state here.
 */

/* ── mappers ──────────────────────────────────────────────────────────────────────────────────── */

function mapCatalogueCounts(wire: WireCatalogueCounts): KitchenCatalogueCounts {
    return {
        meals: wire.meals,
        products: wire.products,
        plans: wire.plans,
        published: wire.published,
        draft: wire.draft,
    };
}

function mapSummary(wire: WireSummary): PlatformKitchenSummary {
    return {
        id: wire.id as OrganisationId,
        slug: wire.slug,
        name: wire.name,
        status: wire.status as KitchenTenantStatus,
        countryCode: wire.country_code,
        currencyCode: wire.default_currency_code,
        languageCode: wire.default_language_code,
        branchCount: wire.branch_count,
        activeBranchCount: wire.active_branch_count,
        ownerCount: wire.owner_count,
        catalogue: mapCatalogueCounts(wire.catalogue),
        suspendedAt: (wire.suspended_at ?? null) as IsoDateTime | null,
        lockVersion: wire.lock_version,
        createdAt: (wire.created_at ?? null) as IsoDateTime | null,
    };
}

function mapOwner(wire: WireOwner): PlatformKitchenOwner {
    return {
        membershipId: wire.membership_id as MembershipId,
        userId: wire.user_id as UserId,
        name: wire.name ?? null,
        email: wire.email,
        status: wire.status,
    };
}

function mapBranch(wire: WireBranch): PlatformKitchenBranch {
    return {
        id: wire.id as BranchId,
        name: wire.name,
        city: wire.city ?? null,
        countryCode: wire.country_code,
        timezone: wire.timezone,
        status: wire.status === 'closed' ? 'closed' : 'active',
    };
}

function mapKitchen(wire: WirePlatformKitchen): PlatformKitchen {
    return {
        ...mapSummary(wire),
        suspensionReason: wire.suspension_reason ?? null,
        suspendedBy: (wire.suspended_by ?? null) as UserId | null,
        owners: (wire.owners ?? []).map(mapOwner),
        branches: (wire.branches ?? []).map(mapBranch),
    };
}

/* ── the repository ───────────────────────────────────────────────────────────────────────────── */

const BASE = '/platform/organisations/kitchens';

export function createApiPlatformAdminRepository(transport: Transport): PlatformAdminRepository {
    return {
        async listKitchens(
            filter?: KitchenTenantFilter,
        ): Promise<CursorPage<PlatformKitchenSummary>> {
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
                path: rendered === '' ? BASE : `${BASE}?${rendered}`,
            });

            const meta = envelope.meta as PaginationMeta;

            return {
                items: envelope.data.map(mapSummary),
                nextCursor: meta.next_cursor,
                hasMore: meta.has_more,
                totalCount: null,
            };
        },

        async getKitchen(kitchen: OrganisationId | string): Promise<PlatformKitchen> {
            const payload = await transport.request<{ readonly kitchen: WirePlatformKitchen }>({
                method: 'GET',
                path: `${BASE}/${encodeURIComponent(kitchen)}`,
            });

            return mapKitchen(payload.kitchen);
        },

        async createKitchen(request: CreateKitchenRequest): Promise<PlatformKitchen> {
            const payload = await transport.request<{ readonly kitchen: WirePlatformKitchen }>({
                method: 'POST',
                path: BASE,
                // The console generates the key so a double submission is a replay rather than a
                // second tenant. `crypto.randomUUID` is available on every runtime this client
                // targets — web, Hermes on iOS and Android, and Node in the test environment.
                headers: { 'Idempotency-Key': crypto.randomUUID() },
                body: {
                    name_en: request.nameEn,
                    name_ar: request.nameAr,
                    slug: request.slug,
                    country_code: request.countryCode,
                    default_currency_code: request.currencyCode,
                    default_language_code: request.languageCode,
                    timezone: request.timezone,
                    branch_name: request.branchName,
                    city: request.city ?? null,
                },
            });

            return mapKitchen(payload.kitchen);
        },

        async suspendKitchen(
            kitchen: OrganisationId | string,
            request: SuspendKitchenRequest,
        ): Promise<PlatformKitchenSummary> {
            const payload = await transport.request<{ readonly kitchen: WireSummary }>({
                method: 'POST',
                path: `${BASE}/${encodeURIComponent(kitchen)}/suspend`,
                headers: { 'If-Match': `"${request.lockVersion}"` },
                body: { reason: request.reason ?? null },
            });

            return mapSummary(payload.kitchen);
        },

        async reactivateKitchen(
            kitchen: OrganisationId | string,
            request: LockedPlatformRequest,
        ): Promise<PlatformKitchenSummary> {
            const payload = await transport.request<{ readonly kitchen: WireSummary }>({
                method: 'POST',
                path: `${BASE}/${encodeURIComponent(kitchen)}/reactivate`,
                headers: { 'If-Match': `"${request.lockVersion}"` },
            });

            return mapSummary(payload.kitchen);
        },

        async inviteOwner(
            kitchen: OrganisationId | string,
            request: InviteOwnerRequest,
        ): Promise<OwnerInvitation> {
            const payload = await transport.request<{
                readonly invitation: {
                    readonly id: string;
                    readonly organisation_id: string;
                    readonly email: string;
                    readonly status: string;
                    readonly expires_at: string;
                };
                readonly mailed: boolean;
            }>({
                method: 'POST',
                path: `${BASE}/${encodeURIComponent(kitchen)}/owners/invitations`,
                body: {
                    email: request.email,
                    name: request.name ?? null,
                    message: request.message ?? null,
                },
            });

            return {
                id: payload.invitation.id,
                organisationId: payload.invitation.organisation_id as OrganisationId,
                email: payload.invitation.email,
                status: payload.invitation.status as OwnerInvitation['status'],
                expiresAt: payload.invitation.expires_at as IsoDateTime,
                mailed: payload.mailed,
            };
        },

        async revokeOwner(
            kitchen: OrganisationId | string,
            membership: MembershipId | string,
        ): Promise<OwnerRevocation> {
            const payload = await transport.request<{
                readonly membership: {
                    readonly id: string;
                    readonly user_id: string;
                    readonly status: string;
                };
                readonly remaining_owners: number;
            }>({
                method: 'POST',
                path: `${BASE}/${encodeURIComponent(kitchen)}/owners/${encodeURIComponent(membership)}/revoke`,
            });

            return {
                membershipId: payload.membership.id as MembershipId,
                userId: payload.membership.user_id as UserId,
                status: payload.membership.status,
                remainingOwners: payload.remaining_owners,
            };
        },
    };
}
