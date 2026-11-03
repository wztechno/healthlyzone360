/**
 * The colour each shelf wears across the shop, as the accepted design gives it: meals green, frozen
 * blue, sauces orange, dressings yellow, beverages teal. "All" and any other shelf are neutral.
 *
 * The classes are written out whole, never assembled, so Tailwind finds every one of them.
 */
export type ShelfTint =
    'neutral' | 'green' | 'blue' | 'orange' | 'yellow' | 'teal' | 'pink' | 'violet';

const SHELF_TINTS: Readonly<Record<string, ShelfTint>> = {
    meal: 'green',
    frozen: 'blue',
    sauce: 'orange',
    dressing: 'yellow',
    beverage: 'teal',
};

export function shelfTint(code: string | null | undefined): ShelfTint {
    return code === null || code === undefined ? 'neutral' : (SHELF_TINTS[code] ?? 'neutral');
}

/** The fill. */
export const TINT_FILL: Readonly<Record<ShelfTint, string>> = {
    neutral: 'bg-surface-sunken',
    green: 'bg-tint-green',
    blue: 'bg-tint-blue',
    orange: 'bg-tint-orange',
    yellow: 'bg-tint-yellow',
    teal: 'bg-tint-teal',
    pink: 'bg-tint-pink',
    violet: 'bg-tint-violet',
};

/** The ink that reads on the fill. */
export const TINT_INK: Readonly<Record<ShelfTint, string>> = {
    neutral: 'text-content-primary',
    green: 'text-tint-green-on',
    blue: 'text-tint-blue-on',
    orange: 'text-tint-orange-on',
    yellow: 'text-tint-yellow-on',
    teal: 'text-tint-teal-on',
    pink: 'text-tint-pink-on',
    violet: 'text-tint-violet-on',
};

/** The ink as a border — a chosen tile or pill is ringed in its own ink. */
export const TINT_BORDER: Readonly<Record<ShelfTint, string>> = {
    neutral: 'border-content-primary',
    green: 'border-tint-green-on',
    blue: 'border-tint-blue-on',
    orange: 'border-tint-orange-on',
    yellow: 'border-tint-yellow-on',
    teal: 'border-tint-teal-on',
    pink: 'border-tint-pink-on',
    violet: 'border-tint-violet-on',
};

/** The ink as a fill — the small accent bars and check marks. */
export const TINT_INK_FILL: Readonly<Record<ShelfTint, string>> = {
    neutral: 'bg-content-primary',
    green: 'bg-tint-green-on',
    blue: 'bg-tint-blue-on',
    orange: 'bg-tint-orange-on',
    yellow: 'bg-tint-yellow-on',
    teal: 'bg-tint-teal-on',
    pink: 'bg-tint-pink-on',
    violet: 'bg-tint-violet-on',
};
