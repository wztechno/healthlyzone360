import { isPlanDurationConsistent, isPriceEntryConsistent } from '@healthy360/api-client/contracts';
import type {
    AllergenContainment,
    AllergenVerification,
    CatalogueItemRef,
    CostAmount,
    LocalisedText,
    PlanDurationAdmin,
    PlanDurationKind,
    PlanVariantAdmin,
    PriceListEntry,
    PriceStatus,
    ProductPackVariant,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';
import { hasPrivatePricing, minorUnitExponent } from '@healthy360/domain-types';
import type {
    CurrencyCode,
    DietClassification,
    MealType,
    SalesChannel,
} from '@healthy360/domain-types';
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

/**
 * The **short** status vocabulary — Live · Draft · Review · Archived.
 *
 * A second vocabulary rather than a rewrite of {@link statusKey}, because the two say the same
 * thing at two densities and both are needed. `kitchen:status.*` is the sentence-length name every
 * other kitchen screen shows in a form field, a filter panel and a confirmation dialog
 * ("Awaiting review"); this is the one-word chip the Catalogue's 78px Status track and its
 * four-segment toolbar can actually hold, and it is the wording the design draws.
 *
 * Renaming the long vocabulary to fit the chip would have changed the word on a dozen screens that
 * have room for it; deriving the chip by truncation would have produced "Awaiting…".
 */
const STATUS_SHORT_KEYS: Readonly<Record<PublishableStatus, string>> = {
    draft: 'kitchen:statusShort.draft',
    review_required: 'kitchen:statusShort.reviewRequired',
    published: 'kitchen:statusShort.published',
    retired: 'kitchen:statusShort.retired',
};

export function statusShortKey(status: PublishableStatus): string {
    return STATUS_SHORT_KEYS[status];
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
 * exactly the choice the schema constraint exists to prevent. The `package` dimension arrived with
 * the v6 purchase packs (pack, bag, can, bottle, gallon) — units that never cross-convert; each is
 * an honest identity of one.
 */
export const UNIT_DIMENSIONS = ['mass', 'volume', 'count', 'serving', 'package'] as const;
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
    pack: 'package',
    bag: 'package',
    can: 'package',
    bottle: 'package',
    gallon: 'package',
};

export function unitDimension(unit: MeasureUnit): UnitDimension {
    return UNIT_DIMENSION[unit];
}

const UNIT_DIMENSION_KEYS: Readonly<Record<UnitDimension, string>> = {
    mass: 'kitchen:units.dimensionMass',
    volume: 'kitchen:units.dimensionVolume',
    count: 'kitchen:units.dimensionCount',
    serving: 'kitchen:units.dimensionServing',
    package: 'kitchen:units.dimensionPackage',
};

export function unitDimensionKey(dimension: UnitDimension): string {
    return UNIT_DIMENSION_KEYS[dimension];
}

export function unitKey(unit: MeasureUnit): string {
    return `kitchen:units.${unit}`;
}

/**
 * The **abbreviated** unit — `kg`, `L`, `pc` — for a column, not a picker.
 *
 * {@link unitKey} resolves to "Kilograms (kg)", which is the right label on a select where the
 * reader is choosing between dimensions and needs the word. It is the wrong label in a 56px track,
 * where the abbreviation is what the kitchen writes on the sheet anyway. Two keys, one per job,
 * for the same reason the status vocabulary is two.
 *
 * Still translated. `kg` and `L` are the same in Arabic script contexts that use Latin unit marks,
 * but `pc`, `pack` and `bag` are not, and a symbol table welded into the presentation layer is how
 * a catalogue ends up half-translated.
 */
export function unitShortKey(unit: MeasureUnit): string {
    return `kitchen:unitsShort.${unit}`;
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

/* ── list prices ─────────────────────────────────────────────────────────────────────────────── */

/**
 * A stored price as an input string.
 *
 * Two decimals is what a price is *typed* at, but `CostAmount` is stored at six
 * (`decimal(18, 6)`, because a cost comes from dividing a purchase price by a yield). Padding to
 * two would round a six-decimal figure into the box and then save the rounded value back on the
 * next edit, which is a silent write nobody asked for. So only a figure that already fits two
 * decimals is padded; one that carries more is shown in full.
 */
export function amountToInput(cost: CostAmount | null): string {
    if (cost === null) return '';
    const padded = cost.amount.toFixed(2);
    return Number(padded) === cost.amount ? padded : String(cost.amount);
}

/**
 * A typed amount, or the two kinds of absence.
 *
 * `null` is "the field is empty", which clears the price. `undefined` is "that is not a number",
 * which is a validation error rather than a clear — the difference between deleting a price on
 * purpose and losing one to a typo.
 *
 * Looser than {@link parseQuantity}, which refuses anything but digits and a point. A price is
 * pasted at least as often as it is typed, and `Number` accepts the shapes a paste arrives in.
 */
export function parseAmount(value: string): number | null | undefined {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Gross margin of a list price over what the thing cost, as a percentage.
 *
 * A percentage rather than a ratio, because `%` is the field's *unit suffix* and not part of the
 * value — `QuantityInput`'s own rule: a unit inside the value is a string no cost cascade can
 * multiply. So the number is scaled here, and `Intl`'s `percent` style, which would scale it a
 * second time, is deliberately not used.
 *
 * `null` whenever the sum cannot be stated — no price, no cost, or a cost of zero, which is a
 * division rather than an infinite margin.
 *
 * Shared by the ingredient and recipe editors rather than written twice. The two read the same
 * figure against different bases — an ingredient's unit price against its unit cost, a recipe
 * version's price per yield unit against its cost per yield unit with waste — and the arithmetic
 * being literally the same function is what keeps the two readouts comparable.
 */
export function marginPercent(
    price: number | null | undefined,
    cost: number | null | undefined,
): number | null {
    if (typeof price !== 'number' || typeof cost !== 'number' || cost === 0) return null;
    return ((price - cost) / cost) * 100;
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

/* ── price lists (K1.5) ──────────────────────────────────────────────────────────────────────── */

/** Statuses the price-list filter offers, in lifecycle order. */
export const PRICE_LIST_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

const PRICE_STATUS_KEYS: Readonly<Record<PriceStatus, string>> = {
    confirmed: 'kitchen:priceStatus.confirmed',
    placeholder: 'kitchen:priceStatus.placeholder',
    market_priced: 'kitchen:priceStatus.marketPriced',
};

export function priceStatusKey(status: PriceStatus): string {
    return PRICE_STATUS_KEYS[status];
}

/**
 * The badge a row without an amount wears.
 *
 * `placeholder` and `market_priced` are both "no number here", and the interface refuses to render
 * them as the same thing, because the *reasons* differ and only one of them is a task: a placeholder
 * is a price nobody has decided yet, and a market-priced row is a price that is decided every
 * morning. A single grey "no price" badge would hide which of those a person is looking at.
 */
const PRICE_STATUS_BADGE_KEYS: Readonly<Record<PriceStatus, string>> = {
    confirmed: 'kitchen:priceLists.badgeConfirmed',
    placeholder: 'kitchen:priceLists.badgePending',
    market_priced: 'kitchen:priceLists.badgeDaily',
};

export function priceStatusBadgeKey(status: PriceStatus): string {
    return PRICE_STATUS_BADGE_KEYS[status];
}

const PRICE_STATUS_TONES: Readonly<Record<PriceStatus, BadgeTone>> = {
    confirmed: 'success',
    // Warning rather than neutral: a placeholder is unfinished work, and the plan's rule is that it
    // never reaches a customer (plan §2.4). Neutral would read as a settled state.
    placeholder: 'warning',
    market_priced: 'info',
};

export function priceStatusTone(status: PriceStatus): BadgeTone {
    return PRICE_STATUS_TONES[status];
}

/** True only for the status that carries an amount. The one place the rule is spelled as a word. */
export function priceStatusCarriesAmount(status: PriceStatus): boolean {
    return status === 'confirmed';
}

/**
 * A price list whose prices are negotiated rather than advertised.
 *
 * `PriceListAdmin` publishes no `customerScope` — see the note in `screens/price-lists-screen.tsx`
 * — so the only thing the contract lets this be read off is the channel set, and
 * `hasPrivatePricing` is the platform's own answer to "which channels are contract-private?"
 * (`@healthy360/domain-types`). Borrowing it rather than restating `['b2b', 'corporate']` here means
 * a channel added to that set becomes confidential everywhere at once.
 */
export function isAgreementPriced(channels: readonly SalesChannel[]): boolean {
    return channels.some((channel) => hasPrivatePricing(channel));
}

/** How a price list's entries break down. Rendered on the list row and inside the publish dialog. */
export interface PriceEntrySummary {
    readonly total: number;
    readonly confirmed: number;
    readonly placeholder: number;
    readonly marketPriced: number;
    /** Rows breaking `isPriceEntryConsistent` — a confirmed row with no amount, or the reverse. */
    readonly inconsistent: number;
}

export function summarisePriceEntries(entries: readonly PriceListEntry[]): PriceEntrySummary {
    let confirmed = 0;
    let placeholder = 0;
    let marketPriced = 0;
    let inconsistent = 0;

    for (const entry of entries) {
        if (entry.priceStatus === 'confirmed') confirmed += 1;
        else if (entry.priceStatus === 'placeholder') placeholder += 1;
        else marketPriced += 1;
        if (!isPriceEntryConsistent(entry)) inconsistent += 1;
    }

    return { total: entries.length, confirmed, placeholder, marketPriced, inconsistent };
}

/**
 * A stable identity for the thing an entry prices.
 *
 * `CatalogueItemRef` is a discriminated union with no identifier of its own, and two entries
 * pointing at the same product *and* the same pack are a duplicate price rather than two prices. The
 * key is what the duplicate check compares and what a row's test id is built from; it is
 * deliberately not shown to anybody.
 */
export function priceItemKey(item: CatalogueItemRef): string {
    if (item.kind === 'product') return `product:${String(item.productId)}:${item.packCode ?? ''}`;
    if (item.kind === 'meal') return `meal:${String(item.mealId)}`;
    return `plan:${String(item.planId)}:${item.variantId === null ? '' : String(item.variantId)}`;
}

/**
 * The same identity with the pack or variant dropped — "which catalogue row is this?".
 *
 * The entry editor picks an item and then a variant *of* that item, so the two pickers need two
 * keys: this one addresses the row the first picker chose, and {@link priceItemKey} addresses the
 * exact thing being priced. Only the second is ever compared for duplicates — two packs of one
 * product are two legitimate prices.
 */
export function priceItemBaseKey(item: CatalogueItemRef): string {
    if (item.kind === 'product') return `product:${String(item.productId)}`;
    if (item.kind === 'meal') return `meal:${String(item.mealId)}`;
    return `plan:${String(item.planId)}`;
}

const ITEM_KIND_KEYS: Readonly<Record<CatalogueItemRef['kind'], string>> = {
    product: 'kitchen:priceLists.kindProduct',
    meal: 'kitchen:priceLists.kindMeal',
    plan: 'kitchen:priceLists.kindPlan',
};

export function priceItemKindKey(kind: CatalogueItemRef['kind']): string {
    return ITEM_KIND_KEYS[kind];
}

/**
 * Minor units as the string a **major-unit** input field holds.
 *
 * String arithmetic, not `amountMinor / 100`. `555 / 100` is `5.55` today and
 * `5.550000000000001` for the next value somebody tries, and a form that re-renders a figure
 * differently from the one it was given is a form people stop trusting. The exponent comes from the
 * currency, because the Kuwaiti, Bahraini and Omani minor units are thousandths (D-030).
 */
export function minorAmountToInput(amountMinor: number, currency: CurrencyCode): string {
    const exponent = minorUnitExponent(currency);
    const sign = amountMinor < 0 ? '-' : '';
    const digits = String(Math.abs(Math.trunc(amountMinor))).padStart(exponent + 1, '0');
    const whole = digits.slice(0, digits.length - exponent);
    const fraction = digits.slice(digits.length - exponent);
    return exponent === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * A major-unit amount typed into a field, as integer minor units.
 *
 * The inverse of {@link minorAmountToInput}, and string-based for the same reason: `Number('5.50') *
 * 100` is not reliably `550`, and this value goes into a `bigint` column. `null` for anything that
 * is not a plain non-negative decimal, **including** one with more decimal places than the currency
 * has — `5.505` in dollars is not half a cent, it is a typo, and silently rounding it would put a
 * figure in the database that nobody typed.
 *
 * Latin digits only, exactly as {@link parseQuantity}: the display of a price follows the reader's
 * locale, but the value being edited is on its way to an integer column and an input that localised
 * it would make round-tripping a figure depend on the interface language.
 */
export function parseMinorAmount(value: string, currency: CurrencyCode): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null;

    const exponent = minorUnitExponent(currency);
    const [whole = '', fraction = ''] = trimmed.split('.');
    if (fraction.length > exponent) return null;

    const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(exponent, '0')}`;
    const parsed = Number(digits);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/* ── subscription plans (K1.6) ───────────────────────────────────────────────────────────────── */

/** Statuses the plan list filter offers, in lifecycle order. */
export const PLAN_STATUS_FILTERS: readonly PublishableStatus[] = [
    'draft',
    'review_required',
    'published',
    'retired',
];

const DURATION_KIND_KEYS: Readonly<Record<PlanDurationKind, string>> = {
    one_off: 'kitchen:plans.kindOneOff',
    fixed_days: 'kitchen:plans.kindFixedDays',
};

export function durationKindKey(kind: PlanDurationKind): string {
    return DURATION_KIND_KEYS[kind];
}

/** How a plan's duration set breaks down. Rendered on the list row and inside the publish dialog. */
export interface PlanDurationSummary {
    readonly total: number;
    readonly oneOff: number;
    readonly fixedDays: number;
    /** The distinct day counts offered, ascending. `one_off` contributes none. */
    readonly dayCounts: readonly number[];
    /** Rows whose discount is still `null` — undecided, which is not the same as zero. */
    readonly undecidedDiscounts: number;
    /** Rows breaking {@link isPlanDurationConsistent} — the migration's `CHECK`, on screen. */
    readonly inconsistent: number;
}

export function summarisePlanDurations(
    durations: readonly PlanDurationAdmin[],
): PlanDurationSummary {
    let oneOff = 0;
    let fixedDays = 0;
    let undecidedDiscounts = 0;
    let inconsistent = 0;
    const days = new Set<number>();

    for (const duration of durations) {
        if (duration.kind === 'one_off') oneOff += 1;
        else {
            fixedDays += 1;
            if (duration.days !== null) days.add(duration.days);
        }
        if (duration.discountPercent === null) undecidedDiscounts += 1;
        if (!isPlanDurationConsistent(duration)) inconsistent += 1;
    }

    return {
        total: durations.length,
        oneOff,
        fixedDays,
        dayCounts: [...days].sort((left, right) => left - right),
        undecidedDiscounts,
        inconsistent,
    };
}

/**
 * How much of a plan's combination × energy-band matrix actually exists.
 *
 * `cells` is the size of the grid the editor draws and `filled` the number of cells with at least
 * one variant in them, because **variant existence *is* the availability matrix** (appendix D): a
 * combination a plan does not sell at a band is not a row with a flag, it is a variant that is not
 * there. A plan with three combinations and three bands has nine cells; the seeded prototype plans
 * fill three of them, and saying "3 variants" without saying "of 9 cells" would hide that.
 */
export interface PlanMatrixSummary {
    readonly variants: number;
    readonly activeVariants: number;
    readonly combinations: number;
    readonly bands: number;
    readonly cells: number;
    readonly filled: number;
}

/** A stable identity for an energy band. Two variants share a column exactly when this matches. */
export function energyBandKey(band: { readonly min: number; readonly max: number }): string {
    return `${String(band.min)}-${String(band.max)}`;
}

/**
 * A stable identity for the meals/snacks pair a combination and a variant are joined by.
 *
 * The contract gives `PlanCombination` a kitchen-set `code` and gives `PlanVariantAdmin` no
 * reference to one at all — a variant carries `mealsPerDay` and `snacksPerDay` directly. So this
 * pair, and nothing else, is what says which row of the matrix a variant sits in. Inventing a
 * `combinationCode` on the variant would be a field the server has never published.
 */
export function combinationKey(shape: {
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
}): string {
    return `${String(shape.mealsPerDay)}m${String(shape.snacksPerDay)}s`;
}

/** The least a variant has to be for the grid to place it — see {@link summarisePlanMatrix}. */
export interface MatrixPlacement {
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly energyBand: { readonly min: number; readonly max: number };
    /** Absent counts as active: `PlanVariantInput` leaves it optional and the server defaults it. */
    readonly isActive?: boolean | undefined;
}

/**
 * Structurally typed rather than taking a `PlanAdmin`, so the *editor* can summarise what it is
 * about to save (`PlanVariantInput`, whose `id` is nullable and whose `isActive` is optional) with
 * the same function the list summarises what the server holds. Two summaries that could disagree
 * would be two answers to "how much of this plan exists".
 */
export function summarisePlanMatrix(plan: {
    readonly variants: readonly MatrixPlacement[];
    readonly combinations: readonly {
        readonly mealsPerDay: number;
        readonly snacksPerDay: number;
    }[];
}): PlanMatrixSummary {
    const bands = new Set(plan.variants.map((variant) => energyBandKey(variant.energyBand)));
    const rows = new Set(plan.combinations.map((combination) => combinationKey(combination)));
    // A variant whose shape matches no declared combination still occupies a row of the grid — the
    // editor draws it as an extra row rather than hiding a variant that exists.
    for (const variant of plan.variants) rows.add(combinationKey(variant));

    const filled = new Set(
        plan.variants.map(
            (variant) => `${combinationKey(variant)}|${energyBandKey(variant.energyBand)}`,
        ),
    );

    return {
        variants: plan.variants.length,
        activeVariants: plan.variants.filter((variant) => variant.isActive !== false).length,
        combinations: plan.combinations.length,
        bands: bands.size,
        cells: rows.size * bands.size,
        filled: filled.size,
    };
}

/**
 * How much of a plan carries a price, derived from the kitchen's price lists.
 *
 * **`PlanAdmin` carries no price at all**, and that is deliberate: a price belongs to a price list,
 * effective-dated, in one currency, and duplicating it onto the plan would create a second answer to
 * "what does this cost?". So this reads the lists — the same place `publishPlan` reads them — and
 * counts the plan's own priceable references: the plan itself (`variantId: null`) plus one per
 * variant, exactly the arms `CatalogueItemRef` publishes.
 *
 * A reference is `confirmed` only when some entry both says `confirmed` and carries an amount, which
 * is the single condition the store's publish gate applies. Everything else is honest about *why*
 * there is no number: a placeholder is undecided, a market-priced row is decided every morning, and
 * an unpriced reference is one no list mentions at all.
 */
export interface PlanPriceCoverage {
    readonly references: number;
    readonly confirmed: number;
    readonly placeholder: number;
    readonly marketPriced: number;
    readonly unpriced: number;
}

export function summarisePlanPrices(
    plan: { readonly id: string; readonly variants: readonly PlanVariantAdmin[] },
    priceLists: readonly { readonly entries: readonly PriceListEntry[] }[],
): PlanPriceCoverage {
    const references: string[] = ['', ...plan.variants.map((variant) => String(variant.id))];
    const found = new Map<string, Set<PriceStatus>>(
        references.map((reference) => [reference, new Set<PriceStatus>()]),
    );

    for (const list of priceLists) {
        for (const entry of list.entries) {
            if (entry.item.kind !== 'plan') continue;
            if (String(entry.item.planId) !== plan.id) continue;
            const reference = entry.item.variantId === null ? '' : String(entry.item.variantId);
            const statuses = found.get(reference);
            if (statuses === undefined) continue;
            // A confirmed entry with no amount is inconsistent, and the publish gate ignores it.
            if (entry.priceStatus === 'confirmed' && entry.amountMinor === null) continue;
            statuses.add(entry.priceStatus);
        }
    }

    let confirmed = 0;
    let placeholder = 0;
    let marketPriced = 0;
    let unpriced = 0;

    for (const statuses of found.values()) {
        if (statuses.has('confirmed')) confirmed += 1;
        else if (statuses.has('placeholder')) placeholder += 1;
        else if (statuses.has('market_priced')) marketPriced += 1;
        else unpriced += 1;
    }

    return { references: references.length, confirmed, placeholder, marketPriced, unpriced };
}

/*
 * There is no `parseDurationDays` or `parseDiscountPercent` here, deliberately.
 *
 * Every numeric field in the plan editor is a `NumberStepper`, which hands back `number | null`
 * rather than a string — so the "half-typed value" problem the recipe and price editors solve with
 * string drafts and a parser does not arise, and the `null` the stepper already means is exactly the
 * `null` a duration's discount has to preserve. Adding parsers nothing calls would be a second,
 * divergent definition of the same rules.
 */

/* ── delivery zones (K1.7) ───────────────────────────────────────────────────────────────────── */

/**
 * ISO 8601 weekdays, 1 Monday … 7 Sunday.
 *
 * One definition for the whole workspace: a plan's delivery weekdays, a zone's delivery windows and
 * a branch's trading week all count in the same numbers, and three copies of `[1, 2, 3, 4, 5, 6, 7]`
 * is three chances for one of them to start on Sunday. The array is **never reversed for Arabic** —
 * `Inline` and `Stack` follow the document's direction, so a right-to-left interface mirrors the
 * layout on its own, and a hand-mirrored week is a left-to-right week inside an RTL page exactly
 * once: on the day somebody "fixes" the order.
 */
export const ISO_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Statuses the zone list filter offers.
 *
 * Three rather than four: `archiveZone` is the only lifecycle method the contract publishes for this
 * family, so nothing can put a zone into `review_required` and a chip that could never match
 * anything would be furniture. `retired` stays, because archiving is exactly what does happen.
 */
export const ZONE_STATUS_FILTERS: readonly PublishableStatus[] = ['draft', 'published', 'retired'];

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

/** The test id prefix of one price-list row. */
export function priceListRowTestId(priceListId: string): string {
    return `kitchen-price-list-${priceListId}`;
}

/** The test id prefix of one plan row. */
export function planRowTestId(planId: string): string {
    return `kitchen-plan-${planId}`;
}

/** The test id prefix of one delivery-zone row. */
export function zoneRowTestId(zoneId: string): string {
    return `kitchen-zone-${zoneId}`;
}
