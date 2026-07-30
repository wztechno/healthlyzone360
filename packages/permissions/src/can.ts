import type { AccessState } from './state.ts';

export type PermissionMatch = 'all' | 'any';

function toKeys(keys: string | readonly string[]): readonly string[] {
    return typeof keys === 'string' ? [keys] : keys;
}

/**
 * Permission check against the hydrated permission set (plan §10: allow-based, no deny rules).
 *
 * Empty-set semantics follow the mathematical convention and are relied upon by the gate kernel:
 * `all` over no keys is **true** (nothing was demanded), `any` over no keys is **false**
 * (something was demanded and nothing satisfied it).
 */
export function can(
    state: AccessState,
    keys: string | readonly string[],
    match: PermissionMatch = 'all',
): boolean {
    const required = toKeys(keys);
    if (match === 'all') {
        return required.every((key) => state.permissions.has(key));
    }
    return required.some((key) => state.permissions.has(key));
}

/** Feature entitlement check (plan §10 keeps this separate from permissions on purpose). */
export function hasEntitlements(state: AccessState, keys: string | readonly string[]): boolean {
    return toKeys(keys).every((key) => state.entitlements.has(key));
}

/** The subset of `keys` the state is missing — used to build actionable denial messages. */
export function missingPermissions(state: AccessState, keys: readonly string[]): readonly string[] {
    return keys.filter((key) => !state.permissions.has(key));
}

export function missingEntitlements(
    state: AccessState,
    keys: readonly string[],
): readonly string[] {
    return keys.filter((key) => !state.entitlements.has(key));
}
