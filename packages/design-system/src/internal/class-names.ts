export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately *not* a Tailwind-merge: NativeWind resolves conflicting utilities in source order at
 * build time, and a runtime merge would need the full Tailwind config in the bundle to know which
 * utilities conflict. Components therefore compose from disjoint slots and put the caller's
 * `className` last, which is the one place a later utility must win.
 */
export function cx(...values: readonly ClassValue[]): string {
    let out = '';
    for (const value of values) {
        if (typeof value !== 'string' || value.length === 0) continue;
        out = out.length === 0 ? value : `${out} ${value}`;
    }
    return out;
}

/** Picks one entry from a variant table, falling back to the table's declared default. */
export function variant<T extends string>(
    table: Readonly<Record<T, string>>,
    key: T,
    fallback: T,
): string {
    return table[key] ?? table[fallback];
}
