import type { KitchenTenantStatus } from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';

/**
 * Presentation helpers for the platform console.
 *
 * Small on purpose. The kitchen workspace's `format.ts` grew large because that workspace draws
 * eight entity families; this one draws one, and the only thing it genuinely has to keep consistent
 * across three screens is how a tenant status looks.
 */

/**
 * The colour a status wears.
 *
 * `pending` is neutral rather than warning, and the distinction matters: a pending kitchen has not
 * failed at anything, it simply has not been switched on, and painting it amber next to a genuinely
 * suspended one would train an operator to ignore amber.
 */
export function tenantStatusTone(status: KitchenTenantStatus): BadgeTone {
    switch (status) {
        case 'active':
            return 'success';
        case 'suspended':
            return 'danger';
        case 'closed':
            return 'neutral';
        default:
            return 'neutral';
    }
}

export function tenantStatusKey(status: KitchenTenantStatus): string {
    return `platformAdmin:status.${status}`;
}

/** Stable per-row test identifiers, so a Playwright failure names the kitchen it was looking at. */
export function kitchenRowTestId(id: string): string {
    return `platform-admin-kitchen-${id}`;
}

export function ownerRowTestId(membershipId: string): string {
    return `platform-admin-owner-${membershipId}`;
}
