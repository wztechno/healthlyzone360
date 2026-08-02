import type {
    AllergenContainment,
    AllergenVerification,
    CostAmount,
    LocalisedText,
    ProductPackVariant,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';
import type { DietClassification, MealType, SalesChannel } from '@healthy360/domain-types';
import { MEASURE_UNITS } from '@healthy360/nutrition';
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

/**
 * Every unit that shares a dimension with `unit` — the ones a quantity in it can be converted to.
 *
 * Conversion only ever happens *within* a dimension (plan §4.5), so a line whose ingredient is
 * issued in kilograms may be written in grams or kilograms and in nothing else. The picker narrows
 * to this set rather than validating afterwards, because a unit that cannot be converted produces a
 * roll-up warning and a missing figure, and a control that let somebody choose it was the defect.
 */
export function unitsInDimension(unit: MeasureUnit): readonly MeasureUnit[] {
    const dimension = unitDimension(unit);
    return MEASURE_UNITS.filter((candidate) => unitDimension(candidate) === dimension);
}

/* ── recipes ─────────────────────────────────────────────────────────────────────────────────── */

/** Statuses the recipe list filter offers, in lifecycle order. Quarantine and retired included. */
export const RECIPE_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

/**
 * Roll-up warning codes this UI has its own copy for.
 *
 * `RollupWarning` carries a stable `code` *and* a server-authored `message`, in that order of
 * preference: a code the interface knows is rendered in the reader's language, and one it does not
 * falls back to the sentence the server wrote rather than to a generic apology. Neither is ever
 * dropped — a roll-up that quietly omitted a line is the failure mode the whole shape exists to
 * prevent.
 */
const ROLLUP_WARNING_KEYS: Readonly<Record<string, string>> = {
    'rollup.unknown_ingredient': 'kitchen:rollup.warningUnknownIngredient',
    'rollup.unconvertible_unit': 'kitchen:rollup.warningUnconvertibleUnit',
    'rollup.missing_cost': 'kitchen:rollup.warningMissingCost',
    'rollup.missing_facts': 'kitchen:rollup.warningMissingFacts',
};

/** The i18n key for a warning code, or `null` when only the server's sentence is available. */
export function rollupWarningKey(code: string): string | null {
    return ROLLUP_WARNING_KEYS[code] ?? null;
}

/**
 * A cost divided across servings.
 *
 * `null` in, `null` out, and never a division by zero: a cost per serving computed from a yield of
 * nothing is not a large number, it is an unanswerable question.
 */
export function costPerServing(cost: CostAmount | null, servings: number): CostAmount | null {
    if (cost === null || !Number.isFinite(servings) || servings <= 0) return null;
    return { amount: cost.amount / servings, currency: cost.currency };
}

/**
 * Moves one row of an ordered list, returning a new list.
 *
 * The three row editors (lines, outputs, steps) all order by array position, so this is the single
 * definition of "move" they share — pure, so the reordering rule can be asserted without rendering
 * anything, and total, so an out-of-range index returns the list unchanged rather than corrupting
 * it. There is no drag and drop anywhere in this workspace: the design system has no accessible
 * implementation of one, and Move up / Move down buttons with a live-region announcement work for
 * every input device.
 */
export function moveInList<T>(rows: readonly T[], from: number, to: number): readonly T[] {
    if (from === to) return rows;
    if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return rows;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return rows;
    next.splice(to, 0, moved);
    return next;
}

/**
 * Parses a quantity typed into a line editor.
 *
 * Latin digits only, deliberately. The *display* of a number follows the reader's locale — Arabic
 * renders `١٢٣` — but the value being edited is data on its way to a decimal column, and an input
 * that localised it would make round-tripping a figure through the form depend on the interface
 * language. `null` for anything that is not a finite, non-negative number, so a half-typed `1.` is
 * "not yet a quantity" rather than `1`.
 */
export function parseQuantity(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d*\.?\d*$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/* ── products and meals (K1.4) ───────────────────────────────────────────────────────────────── */

/** Statuses the product list filter offers, in lifecycle order. */
export const PRODUCT_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

/** Statuses the meal list filter offers, in lifecycle order. */
export const MEAL_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

/**
 * The three shared vocabularies, translated where they were first translated.
 *
 * Sales channels, meal types and diet classifications are **not** kitchen words — they are the
 * platform's enums (`@healthy360/domain-types`), already rendered on the marketplace, and a second
 * set of keys under `kitchen:` would be two translations of one vocabulary that drift the first time
 * somebody edits only one of them. The kitchen workspace therefore borrows `marketplace:` for these
 * three and owns none of them. Everything genuinely administrative — pack labels, availability
 * wording, publication consequences — stays in `kitchen:`.
 */
export function channelKey(channel: SalesChannel): string {
    return `marketplace:channels.${channel}`;
}

export function mealTypeKey(mealType: MealType): string {
    return `marketplace:mealTypes.${mealType}`;
}

export function dietClassificationKey(diet: DietClassification): string {
    return `marketplace:diets.${diet}`;
}

/** The channels a record is *currently* available on, in the platform's enum order. */
export function availableChannels(
    availability: readonly { readonly channel: SalesChannel; readonly isAvailable: boolean }[],
): readonly SalesChannel[] {
    return availability.filter((entry) => entry.isAvailable).map((entry) => entry.channel);
}

/**
 * The default pack of a product — the first one.
 *
 * `ProductPackVariant` carries no `isDefault` flag, so array position is the only ordering the
 * contract publishes, and "the first pack" is what a list column can honestly call the default. The
 * editor's move controls are what a person uses to change which one that is; inventing a flag the
 * server would ignore would make the control a lie.
 */
export function defaultPackVariant(
    packVariants: readonly ProductPackVariant[],
): ProductPackVariant | null {
    return packVariants[0] ?? null;
}

/**
 * `HH:mm` on a 24-hour clock, or `null`.
 *
 * The contract's cut-off is branch-local wall-clock time, not an instant: a kitchen that stops taking
 * Tuesday's orders at 18:00 means 18:00 wherever it is, and turning that into a timestamp here would
 * bake this browser's offset into the kitchen's own rule.
 */
export function parseClockTime(value: string): string | null {
    const trimmed = value.trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (match === null) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * A whole, non-negative count typed into a field.
 *
 * Separate from {@link parseQuantity} because the things it parses are counts rather than measures:
 * units per pack, portions remaining. `2.5` bottles in a tray is not a smaller tray, it is a typo,
 * and accepting it would put a fraction into an integer column.
 */
export function parseWholeNumber(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/* ── identifiers used by tests and Playwright ────────────────────────────────────────────────── */

/** The test id of one ingredient row's open control, so a spec need not rebuild the string. */
export function ingredientRowTestId(ingredientId: string): string {
    return `kitchen-ingredient-${ingredientId}`;
}

/** The test id prefix of one recipe row. Same contract as the ingredient one. */
export function recipeRowTestId(recipeId: string): string {
    return `kitchen-recipe-${recipeId}`;
}

/** The test id prefix of one product row. */
export function productRowTestId(productId: string): string {
    return `kitchen-product-${productId}`;
}

/** The test id prefix of one meal row. */
export function mealRowTestId(mealId: string): string {
    return `kitchen-meal-${mealId}`;
}
