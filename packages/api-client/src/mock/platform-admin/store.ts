import type { IsoDateTime, MembershipId, OrganisationId } from '@healthy360/domain-types';

import { conflictFailure, throwFailure, validationFailure } from '../../contracts/failure.ts';
import type { CursorPage } from '../../contracts/pagination.ts';
import type {
    CreateKitchenRequest,
    InviteOwnerRequest,
    KitchenTenantFilter,
    LockedPlatformRequest,
    OwnerInvitation,
    OwnerRevocation,
    PlatformKitchen,
    PlatformKitchenOwner,
    PlatformKitchenSummary,
    SuspendKitchenRequest,
} from '../../contracts/platform-admin.ts';
import {
    PLATFORM_ADMIN_RUNTIME_ORDINAL_START,
    branchIdAt,
    invitationIdAt,
    kitchenIdAt,
    membershipIdAt,
    ownerUserIdAt,
} from './ids.ts';

/**
 * The platform administration fixture world (PA1).
 *
 * Deliberately small: three kitchens, because three is the smallest number that can show all the
 * states a console has to draw and still be readable in a snapshot.
 *
 * - **Verdant Kitchen** — active, two owners, a real catalogue. The ordinary case.
 * - **Cedar Table** — *suspended*, with a reason and a moment. The whole reason the console exists,
 *   and the row whose absence would let a suspension banner ship untested.
 * - **Northline Provisions** — active, **no owner at all** and an empty catalogue. The
 *   just-created-never-handed-over case, which is what the invite form is for and what
 *   `remainingOwners: 0` looks like after a revocation.
 *
 * ## The store enforces the rules the API enforces
 *
 * Not because a mock has to, but because a mock that did not would let a screen ship against
 * behaviour the server refuses. So: `lockVersion` is checked and incremented on both lifecycle
 * writes, suspending a non-active kitchen conflicts, reactivating a `closed` one conflicts, a
 * duplicate slug is a validation failure, and revoking the last owner **succeeds** and reports
 * `remainingOwners: 0`. Every one of those is a branch the console draws.
 */

interface MutableKitchen {
    kitchen: PlatformKitchen;
}

const NOW = '2026-08-06T09:00:00+00:00' as IsoDateTime;

function isoDaysFromNow(days: number): IsoDateTime {
    const base = Date.parse(NOW);
    return new Date(base + days * 86_400_000).toISOString() as IsoDateTime;
}

function seed(): PlatformKitchen[] {
    return [
        {
            id: kitchenIdAt(1),
            slug: 'verdant-kitchen',
            name: 'Verdant Kitchen',
            status: 'active',
            countryCode: 'AE',
            currencyCode: 'USD',
            languageCode: 'ar',
            branchCount: 2,
            activeBranchCount: 2,
            ownerCount: 2,
            catalogue: { meals: 24, products: 9, plans: 3, published: 36, draft: 7 },
            suspendedAt: null,
            lockVersion: 3,
            createdAt: '2026-02-11T08:15:00+00:00' as IsoDateTime,
            suspensionReason: null,
            suspendedBy: null,
            owners: [
                {
                    membershipId: membershipIdAt(1),
                    userId: ownerUserIdAt(1),
                    name: 'Layla Mansour',
                    email: 'owner@verdant.test',
                    status: 'active',
                },
                {
                    membershipId: membershipIdAt(2),
                    userId: ownerUserIdAt(2),
                    name: 'Omar Saleh',
                    email: 'omar@verdant.test',
                    status: 'active',
                },
            ],
            branches: [
                {
                    id: branchIdAt(1),
                    name: 'Al Quoz',
                    city: 'Dubai',
                    countryCode: 'AE',
                    timezone: 'Asia/Dubai',
                    status: 'active',
                },
                {
                    id: branchIdAt(2),
                    name: 'Business Bay',
                    city: 'Dubai',
                    countryCode: 'AE',
                    timezone: 'Asia/Dubai',
                    status: 'active',
                },
            ],
        },
        {
            id: kitchenIdAt(2),
            slug: 'cedar-table',
            name: 'Cedar Table',
            status: 'suspended',
            countryCode: 'LB',
            currencyCode: 'USD',
            languageCode: 'ar',
            branchCount: 1,
            activeBranchCount: 1,
            ownerCount: 1,
            catalogue: { meals: 11, products: 0, plans: 1, published: 12, draft: 2 },
            suspendedAt: '2026-07-28T14:30:00+00:00' as IsoDateTime,
            lockVersion: 5,
            createdAt: '2026-01-04T10:00:00+00:00' as IsoDateTime,
            suspensionReason:
                'Food safety inspection outstanding since June; two escalations unanswered.',
            suspendedBy: ownerUserIdAt(9),
            owners: [
                {
                    membershipId: membershipIdAt(3),
                    userId: ownerUserIdAt(3),
                    name: 'Nadia Haddad',
                    email: 'owner@cedartable.test',
                    status: 'active',
                },
            ],
            branches: [
                {
                    id: branchIdAt(3),
                    name: 'Hamra',
                    city: 'Beirut',
                    countryCode: 'LB',
                    timezone: 'Asia/Beirut',
                    status: 'active',
                },
            ],
        },
        {
            id: kitchenIdAt(3),
            slug: 'northline-provisions',
            name: 'Northline Provisions',
            status: 'active',
            countryCode: 'LB',
            currencyCode: 'USD',
            languageCode: 'en',
            branchCount: 1,
            activeBranchCount: 1,
            ownerCount: 0,
            catalogue: { meals: 0, products: 0, plans: 0, published: 0, draft: 0 },
            suspendedAt: null,
            lockVersion: 0,
            createdAt: '2026-08-01T07:45:00+00:00' as IsoDateTime,
            suspensionReason: null,
            suspendedBy: null,
            owners: [],
            branches: [
                {
                    id: branchIdAt(4),
                    name: 'Main kitchen',
                    city: 'Jounieh',
                    countryCode: 'LB',
                    timezone: 'Asia/Beirut',
                    status: 'active',
                },
            ],
        },
    ];
}

function summarise(kitchen: PlatformKitchen): PlatformKitchenSummary {
    const {
        suspensionReason: _reason,
        suspendedBy: _by,
        owners: _owners,
        branches: _branches,
        ...summary
    } = kitchen;

    return summary;
}

export class PlatformAdminMockStore {
    private rows: MutableKitchen[] = seed().map((kitchen) => ({ kitchen }));

    private nextOrdinal = PLATFORM_ADMIN_RUNTIME_ORDINAL_START;

    /** Newest first, the order the API answers in. */
    listKitchens(filter?: KitchenTenantFilter): CursorPage<PlatformKitchenSummary> {
        const needle = filter?.query?.trim().toLowerCase() ?? '';

        const matched = this.rows
            .map((row) => row.kitchen)
            .filter((kitchen) => filter?.status === undefined || kitchen.status === filter.status)
            .filter(
                (kitchen) =>
                    needle === '' ||
                    kitchen.name.toLowerCase().includes(needle) ||
                    kitchen.slug.includes(needle),
            )
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

        // The cursor is the index of the first row of the next page, base64'd so nothing at a call
        // site is tempted to read it. Opaque in the contract means opaque in the mock too.
        const limit = filter?.limit ?? 25;
        const offset = decodeCursor(filter?.cursor);
        const page = matched.slice(offset, offset + limit);
        const hasMore = offset + limit < matched.length;

        return {
            items: page.map(summarise),
            nextCursor: hasMore ? encodeCursor(offset + limit) : null,
            hasMore,
            totalCount: matched.length,
        };
    }

    getKitchen(identifier: OrganisationId | string): PlatformKitchen {
        return this.require(identifier).kitchen;
    }

    createKitchen(request: CreateKitchenRequest): PlatformKitchen {
        const slug = request.slug.trim().toLowerCase();

        if (this.rows.some((row) => row.kitchen.slug === slug)) {
            throwFailure(validationFailure({ slug: ['That slug is already taken.'] }));
        }

        const ordinal = this.nextOrdinal++;

        const kitchen: PlatformKitchen = {
            id: kitchenIdAt(ordinal),
            slug,
            name: request.nameEn.trim(),
            status: 'active',
            countryCode: request.countryCode.toUpperCase(),
            currencyCode: request.currencyCode.toUpperCase(),
            languageCode: request.languageCode.toLowerCase(),
            branchCount: 1,
            activeBranchCount: 1,
            ownerCount: 0,
            catalogue: { meals: 0, products: 0, plans: 0, published: 0, draft: 0 },
            suspendedAt: null,
            lockVersion: 0,
            createdAt: NOW,
            suspensionReason: null,
            suspendedBy: null,
            owners: [],
            branches: [
                {
                    id: branchIdAt(ordinal),
                    name: request.branchName.trim(),
                    city: request.city?.trim() === '' ? null : (request.city ?? null),
                    countryCode: request.countryCode.toUpperCase(),
                    timezone: request.timezone.trim(),
                    status: 'active',
                },
            ],
        };

        this.rows = [{ kitchen }, ...this.rows];

        return kitchen;
    }

    suspendKitchen(
        identifier: OrganisationId | string,
        request: SuspendKitchenRequest,
    ): PlatformKitchenSummary {
        const row = this.require(identifier);
        this.assertVersion(row, request.lockVersion);

        if (row.kitchen.status !== 'active') {
            throwFailure(
                conflictFailure({
                    message: 'Only an active kitchen can be suspended.',
                    currentLockVersion: row.kitchen.lockVersion,
                }),
            );
        }

        row.kitchen = {
            ...row.kitchen,
            status: 'suspended',
            suspendedAt: NOW,
            suspensionReason: request.reason?.trim() === '' ? null : (request.reason ?? null),
            suspendedBy: ownerUserIdAt(9),
            lockVersion: row.kitchen.lockVersion + 1,
        };

        return summarise(row.kitchen);
    }

    reactivateKitchen(
        identifier: OrganisationId | string,
        request: LockedPlatformRequest,
    ): PlatformKitchenSummary {
        const row = this.require(identifier);
        this.assertVersion(row, request.lockVersion);

        if (row.kitchen.status === 'active') {
            throwFailure(
                conflictFailure({
                    message: 'This kitchen is already trading.',
                    currentLockVersion: row.kitchen.lockVersion,
                }),
            );
        }

        if (row.kitchen.status === 'closed') {
            throwFailure(
                conflictFailure({
                    message: 'A closed organisation cannot be reactivated.',
                    currentLockVersion: row.kitchen.lockVersion,
                }),
            );
        }

        row.kitchen = {
            ...row.kitchen,
            status: 'active',
            suspendedAt: null,
            suspensionReason: null,
            suspendedBy: null,
            lockVersion: row.kitchen.lockVersion + 1,
        };

        return summarise(row.kitchen);
    }

    inviteOwner(identifier: OrganisationId | string, request: InviteOwnerRequest): OwnerInvitation {
        const row = this.require(identifier);

        return {
            id: invitationIdAt(this.nextOrdinal++),
            organisationId: row.kitchen.id,
            email: request.email.trim(),
            status: 'live',
            expiresAt: isoDaysFromNow(7),
            // Always true in the mock world: there is no mail transport to fail. The field is on
            // the shape because the API can answer `false`, and a screen that only ever saw `true`
            // would not have been written to handle it.
            mailed: true,
        };
    }

    revokeOwner(
        identifier: OrganisationId | string,
        membership: MembershipId | string,
    ): OwnerRevocation {
        const row = this.require(identifier);

        const owner: PlatformKitchenOwner | undefined = row.kitchen.owners.find(
            (candidate) => candidate.membershipId === membership,
        );

        if (owner === undefined) {
            throwFailure(
                conflictFailure({
                    message: 'No membership with that identifier belongs to this kitchen.',
                }),
            );
        }

        const remaining = row.kitchen.owners.filter(
            (candidate) => candidate.membershipId !== membership,
        );

        row.kitchen = {
            ...row.kitchen,
            owners: remaining,
            ownerCount: remaining.length,
        };

        return {
            membershipId: owner.membershipId,
            userId: owner.userId,
            status: 'ended',
            remainingOwners: remaining.length,
        };
    }

    private require(identifier: OrganisationId | string): MutableKitchen {
        const row = this.rows.find(
            (candidate) =>
                candidate.kitchen.id === identifier || candidate.kitchen.slug === identifier,
        );

        if (row === undefined) {
            throwFailure(
                conflictFailure({
                    message: 'No kitchen organisation with that identifier exists.',
                }),
            );
        }

        return row;
    }

    private assertVersion(row: MutableKitchen, expected: number): void {
        if (row.kitchen.lockVersion !== expected) {
            throwFailure(conflictFailure({ currentLockVersion: row.kitchen.lockVersion }));
        }
    }
}

/**
 * The cursor is an offset behind a prefix, and it is deliberately not base64.
 *
 * `btoa`/`atob` are not universally present on Hermes, and a mock world that crashed on Android
 * while passing on web would be worse than no mock world at all. Opaque means "the caller does not
 * parse it", not "the encoding is clever".
 */
const CURSOR_PREFIX = 'platform-admin:';

function encodeCursor(offset: number): string {
    return `${CURSOR_PREFIX}${String(offset)}`;
}

function decodeCursor(cursor: string | undefined): number {
    if (cursor === undefined || !cursor.startsWith(CURSOR_PREFIX)) return 0;

    const parsed = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 10);

    // An unusable cursor is the first page, not an error — the same forgiveness the prototype
    // world's pagination shows, and for the same reason: a stale deep link should show something.
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}
