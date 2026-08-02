import type {
    AllergenContainment,
    AllergenVerification,
    LocalisedText,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';
import type { MeasureUnit } from '@healthy360/nutrition';

/**
 * Display helpers for the kitchen workspace.
 *
 * Pure functions in their own module for the same reason every other feature here has a `format.ts`:
 * the interesting decisions — which language an admin name renders in, what a missing translation
 * looks like, which unit belongs to which dimension — are the ones a test should be able to make
 * assertions about without rendering a tree.
 */

/* ── bilingual names ─────────────────────────────────────────────────────────────────────────── */

export interface DisplayName {
    /** What to render. Never empty when either side has text. */
    readonly value: string;
    /**
     * True when the reader's own language is missing and the other side is standing in for it.
     *
     * The screens render a marker beside it rather than silently substituting: an Arabic reader
     * shown an English ingredient name has been told something true only if they are also told
     * *why*, and the readiness evaluator will refuse to publish the row for exactly this reason
     * (plan §4.7).
     */
    readonly isFallback: boolean;
}

/** `true` for a locale whose entity names come out of `LocalisedText.ar`. */
export function prefersArabic(locale: string): boolean {
    return locale.toLowerCase().startsWith('ar');
}

/**
 * The name to show, and whether it is a fallback.
 *
 * A blank string counts as absent: the mock seeds `ar` by mirroring `en` (which is what an
 * untranslated record looks like) but a person who clears the Arabic field leaves `''` behind, and
 * treating that as "translated" would hide the very state the marker exists to show.
 */
export function displayName(text: LocalisedText, locale: string): DisplayName {
    const preferred = prefersArabic(locale) ? text.ar : text.en;
    const other = prefersArabic(locale) ? text.en : text.ar;

    if (preferred.trim() !== '') return { value: preferred, isFallback: false };
    return { value: other, isFallback: true };
}

/** True when the record cannot be published because one language is still empty. */
export function isTranslationIncomplete(text: LocalisedText): boolean {
    return text.en.trim() === '' || text.ar.trim() === '';
}

/* ── statuses ────────────────────────────────────────────────────────────────────────────────── */

const STATUS_KEYS: Readonly<Record<PublishableStatus, string>> = {
    draft: 'kitchen:status.draft',
    review_required: 'kitchen:status.reviewRequired',
    published: 'kitchen:status.published',
    retired: 'kitchen:status.retired',
};

export function statusKey(status: PublishableStatus): string {
    return STATUS_KEYS[status];
}

/**
 * The tone a status badge carries.
 *
 * `review_required` is a warning rather than an informational tone on purpose: it is a quarantine,
 * not a queue position, and it blocks publication structurally (plan §4.7). Colour never carries it
 * alone — `Badge` pairs every tone with its own icon.
 */
const STATUS_TONES: Readonly<Record<PublishableStatus, BadgeTone>> = {
    draft: 'neutral',
    review_required: 'warning',
    published: 'success',
    retired: 'neutral',
};

export function statusTone(status: PublishableStatus): BadgeTone {
    return STATUS_TONES[status];
}

/** Statuses the list filter offers, in lifecycle order. Archived rows are included deliberately. */
export const INGREDIENT_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

/* ── allergen vocabulary ─────────────────────────────────────────────────────────────────────── */

export function containmentKey(containment: AllergenContainment): string {
    return containment === 'contains'
        ? 'kitchen:containment.contains'
        : 'kitchen:containment.mayContain';
}

const VERIFICATION_KEYS: Readonly<Record<AllergenVerification, string>> = {
    unverified: 'kitchen:verification.unverified',
    supplier_declared: 'kitchen:verification.supplierDeclared',
    laboratory_tested: 'kitchen:verification.laboratoryTested',
    operator_confirmed: 'kitchen:verification.operatorConfirmed',
};

export function verificationKey(verification: AllergenVerification): string {
    return VERIFICATION_KEYS[verification];
}

/* ── measurement units ───────────────────────────────────────────────────────────────────────── */

/**
 * The dimension each measure unit belongs to (plan §4.5).
 *
 * Grouping the unit picker by dimension is not decoration: automatic conversion only ever happens
 * *within* a dimension, so a picker that mixed grams and millilitres into one flat list would invite
 * exactly the choice the schema constraint exists to prevent. `package` is absent because the
 * nutrition package's `MeasureUnit` union has no member for it — pack equivalences are product data
 * (K1.4), not an issuing unit.
 */
export const UNIT_DIMENSIONS = ['mass', 'volume', 'count', 'serving'] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

const UNIT_DIMENSION: Readonly<Record<MeasureUnit, UnitDimension>> = {
    g: 'mass',
    kg: 'mass',
    ml: 'volume',
    l: 'volume',
    tbsp: 'volume',
    tsp: 'volume',
    cup: 'volume',
    piece: 'count',
    slice: 'count',
    portion: 'serving',
};

export function unitDimension(unit: MeasureUnit): UnitDimension {
    return UNIT_DIMENSION[unit];
}

const UNIT_DIMENSION_KEYS: Readonly<Record<UnitDimension, string>> = {
    mass: 'kitchen:units.dimensionMass',
    volume: 'kitchen:units.dimensionVolume',
    count: 'kitchen:units.dimensionCount',
    serving: 'kitchen:units.dimensionServing',
};

export function unitDimensionKey(dimension: UnitDimension): string {
    return UNIT_DIMENSION_KEYS[dimension];
}

export function unitKey(unit: MeasureUnit): string {
    return `kitchen:units.${unit}`;
}

/* ── category codes ──────────────────────────────────────────────────────────────────────────── */

/**
 * A category code, made readable.
 *
 * Deliberately *not* translated: there is no category resource on the contract, so no localised
 * label exists to look up (see `data/kitchen-admin-hooks.ts`). Rendering `fresh-produce` as
 * "Fresh produce" is a presentation of the code itself, and inventing an i18n key per code would
 * claim a vocabulary the server has never published.
 */
export function humaniseCode(code: string): string {
    if (code.trim() === '') return '';
    const spaced = code.replace(/[-_]+/g, ' ').trim();
    return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1);
}

/* ── identifiers used by tests and Playwright ────────────────────────────────────────────────── */

/** The test id of one ingredient row's open control, so a spec need not rebuild the string. */
export function ingredientRowTestId(ingredientId: string): string {
    return `kitchen-ingredient-${ingredientId}`;
}
