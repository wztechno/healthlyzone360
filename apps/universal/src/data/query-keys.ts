/**
 * Query keys, in one place.
 *
 * Every key starts with a *root* that says what kind of data it is, because the offline persistence
 * allow-list (§21) is expressed in terms of those roots. A key invented at a call site would bypass
 * that classification, so keys are never written inline.
 */
export const QUERY_ROOTS = ['session', 'devices', 'reference'] as const;
export type QueryRoot = (typeof QUERY_ROOTS)[number];

export const queryKeys = {
    /** `GET /api/v1/me` — user, profile, memberships, active context, pending consents. */
    me: () => ['session', 'me'] as const,
    /** `GET /api/v1/auth/email/status`. */
    emailVerification: () => ['session', 'email-verification'] as const,
    /** `GET /api/v1/me/devices`. */
    devices: () => ['devices', 'list'] as const,
    /** Static, non-personal lookup data — the only family the cache may persist. */
    locales: () => ['reference', 'locales'] as const,
} as const;

/**
 * Roots whose cached data may survive a restart.
 *
 * Deliberately minimal (plan §21). `session` and `devices` are absent and must stay absent: they
 * are authentication responses and personal data, and neither may touch disk. Adding a root here is
 * a privacy decision, which is why it is a single reviewable list rather than a per-query flag.
 */
export const PERSISTABLE_QUERY_ROOTS: readonly QueryRoot[] = ['reference'];

export function isPersistableQueryKey(key: readonly unknown[]): boolean {
    const root = key[0];
    return (
        typeof root === 'string' && (PERSISTABLE_QUERY_ROOTS as readonly string[]).includes(root)
    );
}
