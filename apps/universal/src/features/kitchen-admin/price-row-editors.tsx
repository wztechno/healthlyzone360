import { PRICE_STATUSES } from '@healthy360/api-client/contracts';
import type { CatalogueItemRef, PriceStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Checkbox,
    GRID_CONTENT_ATTR,
    Icon,
    IconButton,
    PickerField,
    QuantityInput,
    SearchInput,
    SegmentedControl,
    Select,
    Text,
    cx,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption, TabItem } from '@healthy360/design-system';
import { minorUnitExponent } from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, ScrollView, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import {
    formatEntryDate,
    minorAmountToInput,
    parseMinorAmount,
    priceItemBaseKey,
    priceItemKey,
    priceItemKindKey,
    priceStatusCarriesAmount,
} from './format.ts';

/**
 * The price-list entry grid (K1.5), as `Price List.dc.html` draws it.
 *
 * Its own module rather than a section of `./catalogue-row-editors.tsx`, because it is the one
 * repeated-row editor in this workspace whose rows enforce a *database constraint* while they are
 * being typed, and that logic wants to be readable next to the control it governs.
 *
 * ## The rule this editor exists to make un-breakable
 *
 * `price_list_items` carries a `CHECK`: **a confirmed price has an amount, and nothing else does**.
 * The contract states it once as `isPriceEntryConsistent`, and this grid enforces it *live*: the
 * row's *How it's priced* control clears and disables the amount in the same press that makes the
 * row Pending or Daily, and the note under the field says what is there instead. A person cannot
 * compose an inconsistent row at all. Going back to Confirmed puts the saved amount back when the
 * field is empty — the figure the server holds, never one typed and abandoned.
 *
 * That matters because of what a placeholder *is* (plan §2.4): the programme's rule is that a
 * fabricated price never reaches a public surface, and `amountMinor: null` is the mechanism.
 *
 * ## One grid, grouped by what is sold
 *
 * One header row, then the rows under an uppercase label per kind of article — products, sauces,
 * frozen meals, meals, plans — with rows nobody has pointed at anything yet in their own group at
 * the top, which is where *+ Add entry* was pressed. Tracks are fixed except the item, which takes
 * the rest; below the tracks' floor the grid scrolls sideways rather than squeezing a figure.
 *
 * ## A row says how it differs from the saved list
 *
 * `baseline` is the list as it was read, keyed like the rows. A row not in it is new (a light brand
 * tint); a row that differs from it carries an amber dot, counts under *Changed*, and — when its
 * confirmed amount moved — a `was 2.50 · +10%` note that turns red at fifteen percent. The save bar
 * and *Discard changes* both read the same comparison, so what the dot says and what the bar counts
 * cannot disagree.
 *
 * ## The dates
 *
 * *In effect from* and *Until* are edited here and validated here — two entries for one item and
 * pack may not overlap — but the contract's write does not carry them yet: the server stamps the
 * day a price was saved and keeps one open row per item and pack. They are drawn as the design
 * draws them so the rest of the page is built for the day the write accepts them.
 *
 * ## Amounts are edited in major units and stored in minor ones
 *
 * The field holds `5.50`; the request carries `550`. The conversion is string arithmetic in
 * `./format.ts` — never `value * 100` — and the currency comes from the list, because one list is
 * one currency (plan §4.4).
 */

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

/**
 * An entry as the editor holds it.
 *
 * `amount` is the **major-unit string** the field shows: `5.` is a number half-typed, not the number
 * five, and a draft that parsed on every keystroke would fight the person typing.
 */
export interface PriceEntryDraft {
    /** Stable across filtering, removal and discard. Never the array index. */
    readonly key: string;
    readonly item: CatalogueItemRef | null;
    readonly priceStatus: PriceStatus;
    readonly amount: string;
    readonly effectiveFrom: string;
    readonly effectiveUntil: string | null;
    readonly note: string;
}

/** A blank entry row. `confirmed` is the default because it is the only status that sells anything. */
export function emptyPriceEntry(key: string, effectiveFrom: string): PriceEntryDraft {
    return {
        key,
        item: null,
        priceStatus: 'confirmed',
        amount: '',
        effectiveFrom,
        effectiveUntil: null,
        note: '',
    };
}

/**
 * Applies a status change to a row, clearing or keeping the amount as the constraint requires.
 *
 * Pure and exported so the rule can be asserted without rendering anything. Moving *to* Pending or
 * Daily empties the amount; moving to Confirmed keeps whatever is typed, or — when nothing is —
 * takes `restore`, the amount the row was saved with.
 */
export function withPriceStatus(
    row: PriceEntryDraft,
    priceStatus: PriceStatus,
    restore = '',
): PriceEntryDraft {
    if (!priceStatusCarriesAmount(priceStatus)) return { ...row, priceStatus, amount: '' };
    return { ...row, priceStatus, amount: row.amount.trim() === '' ? restore : row.amount };
}

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

/** One reason a row cannot be saved. A row can have several; the note under it lists them all. */
export type PriceEntryProblem =
    | { readonly kind: 'noItem' }
    | { readonly kind: 'noAmount' }
    | { readonly kind: 'badAmount' }
    | { readonly kind: 'amountNotAllowed' }
    | { readonly kind: 'reversed' }
    /** Another row prices the same item and pack over some of the same days, from `from`. */
    | { readonly kind: 'overlap'; readonly other: string; readonly from: string };

/** Which cell a problem is about — the one the issue chip focuses and the field that turns red. */
export function priceProblemField(problem: PriceEntryProblem): 'item' | 'amount' | 'dates' {
    switch (problem.kind) {
        case 'noItem':
            return 'item';
        case 'noAmount':
        case 'badAmount':
        case 'amountNotAllowed':
            return 'amount';
        case 'reversed':
        case 'overlap':
            return 'dates';
    }
}

/** An empty *Until* is open-ended: it runs past any date a person could type. */
const OPEN_END = '9999-12-31';

/**
 * Whether two rows' dates share a day. Both ends are inclusive — `31 Oct` then `1 Nov` is a
 * hand-over, not an overlap — and ISO dates sort as strings, which is what makes this a comparison.
 */
export function priceEntriesOverlap(
    left: Pick<PriceEntryDraft, 'effectiveFrom' | 'effectiveUntil'>,
    right: Pick<PriceEntryDraft, 'effectiveFrom' | 'effectiveUntil'>,
): boolean {
    return (
        left.effectiveFrom <= (right.effectiveUntil ?? OPEN_END) &&
        right.effectiveFrom <= (left.effectiveUntil ?? OPEN_END)
    );
}

/**
 * What is wrong with each row, keyed by row, in the order the note reads them.
 *
 * 1. **An entry must point at something.** A row with no item is a price for nothing.
 * 2. **A confirmed row needs an amount above zero, and only a confirmed row may have one.** The
 *    `CHECK`. The live clearing makes the second half unreachable through the controls; it is
 *    checked anyway, because a draft can also arrive from the server.
 * 3. **Until may not precede From.**
 * 4. **Two rows for one item and pack may not share a day.** "The same item" is the same product
 *    *and pack*, the same meal, or the same plan *and variant* — see `priceItemKey`. Two packs of
 *    one product are two prices; one pack priced twice for the same day is ambiguous.
 */
export function priceEntryProblems(
    rows: readonly PriceEntryDraft[],
    currency: CurrencyCode,
): ReadonlyMap<string, readonly PriceEntryProblem[]> {
    const problems = new Map<string, readonly PriceEntryProblem[]>();

    for (const row of rows) {
        const found: PriceEntryProblem[] = [];

        if (row.item === null) found.push({ kind: 'noItem' });

        if (priceStatusCarriesAmount(row.priceStatus)) {
            const minor = parseMinorAmount(row.amount, currency);
            if (row.amount.trim() === '' || minor === 0) found.push({ kind: 'noAmount' });
            else if (minor === null) found.push({ kind: 'badAmount' });
        } else if (row.amount.trim() !== '') {
            found.push({ kind: 'amountNotAllowed' });
        }

        if (row.effectiveUntil !== null && row.effectiveUntil < row.effectiveFrom) {
            found.push({ kind: 'reversed' });
        }

        if (row.item !== null) {
            const identity = priceItemKey(row.item);
            for (const other of rows) {
                if (other.key === row.key || other.item === null) continue;
                if (priceItemKey(other.item) !== identity) continue;
                if (priceEntriesOverlap(row, other)) {
                    found.push({ kind: 'overlap', other: other.key, from: other.effectiveFrom });
                }
            }
        }

        if (found.length > 0) problems.set(row.key, found);
    }

    return problems;
}

/* ------------------------------------------------------------------------------------------------
 * Changes against the list as it was read
 * ---------------------------------------------------------------------------------------------- */

/** `5.5` and `5.50` are one price; a field retyped to the same figure is not a change. */
function sameAmount(left: string, right: string, currency: CurrencyCode): boolean {
    if (left.trim() === right.trim()) return true;
    const parsed = parseMinorAmount(left, currency);
    return parsed !== null && parsed === parseMinorAmount(right, currency);
}

export type PriceEntryChange = 'new' | 'changed' | null;

/** How a row differs from what was saved: not there at all, there but different, or the same. */
export function priceEntryChange(
    row: PriceEntryDraft,
    baseline: ReadonlyMap<string, PriceEntryDraft>,
    currency: CurrencyCode,
): PriceEntryChange {
    const saved = baseline.get(row.key);
    if (saved === undefined) return 'new';
    const sameItem =
        saved.item === null || row.item === null
            ? saved.item === row.item
            : priceItemKey(saved.item) === priceItemKey(row.item);
    return sameItem &&
        saved.priceStatus === row.priceStatus &&
        sameAmount(saved.amount, row.amount, currency) &&
        saved.effectiveFrom === row.effectiveFrom &&
        saved.effectiveUntil === row.effectiveUntil
        ? null
        : 'changed';
}

export interface PriceEntryChanges {
    readonly edited: number;
    readonly added: number;
    readonly removed: number;
    readonly total: number;
}

/** What the save bar counts, and what makes the page dirty. */
export function summarisePriceChanges(
    rows: readonly PriceEntryDraft[],
    baseline: ReadonlyMap<string, PriceEntryDraft>,
    currency: CurrencyCode,
): PriceEntryChanges {
    let edited = 0;
    let added = 0;
    for (const row of rows) {
        const change = priceEntryChange(row, baseline, currency);
        if (change === 'new') added += 1;
        else if (change === 'changed') edited += 1;
    }
    const kept = new Set(rows.map((row) => row.key));
    const removed = [...baseline.keys()].filter((key) => !kept.has(key)).length;
    return { edited, added, removed, total: edited + added + removed };
}

/* ------------------------------------------------------------------------------------------------
 * Changing confirmed prices by a percentage
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a percentage change rounds to, in minor units: the nearest 0.05 of a two-decimal currency,
 * 0.050 of a three-decimal one, and a whole unit of a currency with no decimals at all.
 */
export function priceRoundingStep(currency: CurrencyCode): number {
    const exponent = minorUnitExponent(currency);
    return exponent >= 2 ? 5 * 10 ** (exponent - 2) : 1;
}

/**
 * The selected rows' confirmed amounts moved by `percent`, each rounded to the step.
 *
 * Only a confirmed row with a readable amount moves: Pending and Daily carry no number to move,
 * and a half-typed one is the person's to finish. `changed` is how many did, so the caller can say
 * so — including when that is none.
 */
export function adjustConfirmedPrices(
    rows: readonly PriceEntryDraft[],
    keys: ReadonlySet<string>,
    percent: number,
    currency: CurrencyCode,
): { readonly rows: readonly PriceEntryDraft[]; readonly changed: number } {
    const step = priceRoundingStep(currency);
    let changed = 0;
    const next = rows.map((row) => {
        if (!keys.has(row.key) || !priceStatusCarriesAmount(row.priceStatus)) return row;
        const minor = parseMinorAmount(row.amount, currency);
        if (minor === null) return row;
        changed += 1;
        const scaled = Math.max(0, Math.round((minor * (1 + percent / 100)) / step) * step);
        return { ...row, amount: minorAmountToInput(scaled, currency) };
    });
    return { rows: next, changed };
}

/* ------------------------------------------------------------------------------------------------
 * What can be priced
 * ---------------------------------------------------------------------------------------------- */

/** The grid's groups, in the order they are drawn. `unchosen` holds rows with no item yet. */
export const PRICE_GROUPS = [
    'unchosen',
    'product',
    'sauce',
    'dressing',
    'frozen_meal',
    'meal',
    'plan',
] as const;
export type PriceGroup = (typeof PRICE_GROUPS)[number];

const GROUP_TITLE_KEYS: Readonly<Record<PriceGroup, string>> = {
    unchosen: 'kitchen:priceLists.groupUnchosen',
    product: 'kitchen:priceLists.groupProduct',
    sauce: 'kitchen:priceLists.groupSauce',
    dressing: 'kitchen:priceLists.groupDressing',
    frozen_meal: 'kitchen:priceLists.groupFrozenMeal',
    meal: 'kitchen:priceLists.groupMeal',
    plan: 'kitchen:priceLists.groupPlan',
};

/** One priceable *article* — a product, a meal or a plan — and the variants of it a price can name. */
export interface PriceItemOption {
    /** {@link priceItemBaseKey} of the article, ignoring its variant. */
    readonly key: string;
    readonly kind: CatalogueItemRef['kind'];
    /** Where its rows are drawn. A sauce is a product on the wire and a sauce in the grid. */
    readonly group: Exclude<PriceGroup, 'unchosen'>;
    readonly label: string;
    /** The article's own reference — a product's `PRD-0101` — when it has one. */
    readonly code: string | null;
    /** What a row points at when the article has no variants of its own. */
    readonly defaultItem: CatalogueItemRef;
    /**
     * The narrower things a price can name: a product's packs, a plan's variants plus the plan
     * itself. **Empty for a meal**, which has nothing below it.
     */
    readonly variants: readonly PriceItemVariantOption[];
    /**
     * Published and available on one of this list's channels — what the missing-items bar counts.
     * An article that is not on sale needs no price, however long the catalogue has held it.
     */
    readonly onSale: boolean;
}

export interface PriceItemVariantOption {
    /** {@link priceItemKey} of `item`. */
    readonly key: string;
    /** The pack's size (`250 g`), the variant's name, or `Plan` for the plan as a whole. */
    readonly label: string;
    readonly item: CatalogueItemRef;
    /**
     * Stands for the whole article — the plan itself beside its variants. A price on it covers
     * every variant, so it is offered, but it is not a separate thing on sale.
     */
    readonly whole?: boolean | undefined;
}

/** One thing a row can price, in words: the article, its pack, its reference and its group. */
export interface PricedThing {
    /** {@link priceItemKey}. */
    readonly key: string;
    readonly item: CatalogueItemRef;
    readonly name: string;
    readonly pack: string | null;
    readonly code: string | null;
    readonly kind: CatalogueItemRef['kind'];
    readonly group: Exclude<PriceGroup, 'unchosen'>;
}

function pricedThing(
    option: PriceItemOption,
    item: CatalogueItemRef,
    pack: string | null,
): PricedThing {
    return {
        key: priceItemKey(item),
        item,
        name: option.label,
        pack,
        code: option.code,
        kind: option.kind,
        group: option.group,
    };
}

/** Every exact thing a new row may price — one per pack, per plan variant, or the article. */
export function priceableUnits(options: readonly PriceItemOption[]): readonly PricedThing[] {
    return options.flatMap((option) =>
        option.variants.length === 0
            ? [pricedThing(option, option.defaultItem, null)]
            : option.variants.map((variant) => pricedThing(option, variant.item, variant.label)),
    );
}

/** A row that prices an article as a whole — a product with no pack, a plan with no variant. */
function pricesWholeArticle(item: CatalogueItemRef): boolean {
    if (item.kind === 'product') return item.packCode === null;
    if (item.kind === 'plan') return item.variantId === null;
    return true;
}

/**
 * What is on sale on this list's channels and has no row on it — the missing-items bar.
 *
 * Counted the way a price is resolved: a pack is covered by a row for that pack or by one for the
 * product as a whole, a plan variant by its own row or the plan's. An article with variants counts
 * each variant it sells; one without counts itself.
 */
export function uncoveredUnits(
    options: readonly PriceItemOption[],
    rows: readonly PriceEntryDraft[],
): readonly PricedThing[] {
    const priced = new Set<string>();
    const pricedWhole = new Set<string>();
    for (const row of rows) {
        if (row.item === null) continue;
        priced.add(priceItemKey(row.item));
        if (pricesWholeArticle(row.item)) pricedWhole.add(priceItemBaseKey(row.item));
    }

    return options.flatMap((option) => {
        if (!option.onSale || pricedWhole.has(option.key)) return [];
        const sold = option.variants.filter((variant) => variant.whole !== true);
        const units =
            sold.length === 0
                ? [pricedThing(option, option.defaultItem, null)]
                : sold.map((variant) => pricedThing(option, variant.item, variant.label));
        return units.filter((unit) => !priced.has(unit.key));
    });
}

/** What a row prices, in words, or `null` while the article is not among the options. */
export function describePriceItem(
    item: CatalogueItemRef,
    byKey: ReadonlyMap<string, PriceItemOption>,
): PricedThing | null {
    const option = byKey.get(priceItemBaseKey(item));
    if (option === undefined) return null;
    const key = priceItemKey(item);
    const variant = option.variants.find((candidate) => candidate.key === key);
    const pack = variant?.label ?? (item.kind === 'product' ? item.packCode : null);
    return pricedThing(option, item, pack);
}

/** The name a person reads for a thing: the article, then its pack. */
export function pricedThingName(thing: PricedThing): string {
    return thing.pack === null ? thing.name : `${thing.name} · ${thing.pack}`;
}

/**
 * What a row is called wherever it is named — its checkbox, its remove button, its issue chip.
 * `words` are the two things a row can be before it has a name: pointed at nothing yet, or at an
 * article the options do not hold.
 */
export function priceEntryName(
    row: PriceEntryDraft,
    byKey: ReadonlyMap<string, PriceItemOption>,
    words: { readonly unchosen: string; readonly unknown: string },
): string {
    if (row.item === null) return words.unchosen;
    const thing = describePriceItem(row.item, byKey);
    return thing === null ? words.unknown : pricedThingName(thing);
}

/* ------------------------------------------------------------------------------------------------
 * Problems in words
 * ---------------------------------------------------------------------------------------------- */

const PROBLEM_KEYS: Readonly<Record<PriceEntryProblem['kind'], string>> = {
    noItem: 'kitchen:priceLists.problemNoItem',
    noAmount: 'kitchen:priceLists.problemNoAmount',
    badAmount: 'kitchen:priceLists.problemBadAmount',
    amountNotAllowed: 'kitchen:priceLists.problemAmountNotAllowed',
    reversed: 'kitchen:priceLists.problemReversed',
    overlap: 'kitchen:priceLists.problemOverlap',
};

/**
 * A problem as the note and the issue chip say it. A hook because the overlap names the other
 * entry's start date, which needs the reader's calendar.
 */
export function usePriceProblemText(
    currency: CurrencyCode,
): (problem: PriceEntryProblem, name: string) => string {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (problem, name) =>
        t(PROBLEM_KEYS[problem.kind], {
            name,
            currency,
            date: problem.kind === 'overlap' ? formatEntryDate(formatter, problem.from) : '',
        });
}

/* ------------------------------------------------------------------------------------------------
 * The card
 * ---------------------------------------------------------------------------------------------- */

/** The toolbar's filter. `changed` is every row the save bar would count as edited or added. */
export type PriceEntryFilter = 'all' | PriceStatus | 'changed';

const BASIS_KEYS: Readonly<Record<PriceStatus, string>> = {
    confirmed: 'kitchen:priceLists.basisConfirmed',
    placeholder: 'kitchen:priceLists.basisPending',
    market_priced: 'kitchen:priceLists.basisDaily',
};

/**
 * The tracks, in dp. The item takes whatever the row has left over its floor; every other track is
 * its figure's width. *How it's priced* is the design's 232 plus what the segments' 8px inset needs
 * for a bold *Confirmed*. *Until* is the date field plus the button that makes it open-ended again.
 */
const TRACK = {
    select: 20,
    item: 180,
    pack: 88,
    basis: 248,
    amount: 118,
    from: 124,
    until: 152,
    remove: 28,
} as const;
/*
 * 10 rather than the design's 12, and the item's floor 180 rather than 200: with the wider basis
 * track, that is what keeps the whole row inside a 1440 window with the page panel open — the width
 * the design is drawn at — instead of scrolling it by a few pixels.
 */
const COLUMN_GAP = 10;
const ROW_INSET = 16;
const TRACK_COUNT = Object.keys(TRACK).length;

/** Below this the grid scrolls sideways rather than squeezing a figure. */
export const PRICE_GRID_FLOOR =
    Object.values(TRACK).reduce((sum, width) => sum + width, 0) +
    COLUMN_GAP * (TRACK_COUNT - 1) +
    ROW_INSET * 2;

function fixedTrack(width: number) {
    return { width, flexShrink: 0 } as const;
}

const ITEM_TRACK = { flexBasis: TRACK.item, flexGrow: 1, flexShrink: 0, minWidth: 0 } as const;

export interface PriceEntriesCardProps {
    readonly rows: readonly PriceEntryDraft[];
    readonly onChange: (rows: readonly PriceEntryDraft[]) => void;
    /** Appends an empty row. The card clears its filter and search first, so the row is seen. */
    readonly onAdd: () => void;
    /** The list as it was read, keyed like the rows. */
    readonly baseline: ReadonlyMap<string, PriceEntryDraft>;
    /** Shown once a save has been tried. Keyed by row. */
    readonly problems: ReadonlyMap<string, readonly PriceEntryProblem[]>;
    readonly options: readonly PriceItemOption[];
    readonly currency: CurrencyCode;
    readonly canManage: boolean;
    /** The catalogue is still being read, so an unresolved name is not yet a missing one. */
    readonly resolving: boolean;
    /** Page id. Parts: `-entries-card`, `-entries`, `-entries-row-{key}`, `-add-entry`, `-filter`… */
    readonly testID: string;
}

export function PriceEntriesCard({
    rows,
    onChange,
    onAdd,
    baseline,
    problems,
    options,
    currency,
    canManage,
    resolving,
    testID,
}: PriceEntriesCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const problemText = usePriceProblemText(currency);

    const [filter, setFilter] = useState<PriceEntryFilter>('all');
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
    const [percent, setPercent] = useState('5');
    const [port, setPort] = useState(0);

    const gridID = `${testID}-entries`;

    const byKey = useMemo(() => new Map(options.map((option) => [option.key, option])), [options]);
    const units = useMemo(() => priceableUnits(options), [options]);
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            units.map((unit) => ({
                value: unit.key,
                label: pricedThingName(unit),
                description: unit.code ?? t(priceItemKindKey(unit.kind)),
            })),
        [units, t],
    );

    const describe = (row: PriceEntryDraft): PricedThing | null =>
        row.item === null ? null : describePriceItem(row.item, byKey);

    const nameOf = (row: PriceEntryDraft): string =>
        priceEntryName(row, byKey, {
            unchosen: t('kitchen:priceLists.newEntry'),
            unknown: t('kitchen:priceLists.unknownItem'),
        });

    const groupOf = (row: PriceEntryDraft): PriceGroup => {
        if (row.item === null) return 'unchosen';
        const thing = describe(row);
        if (thing !== null) return thing.group;
        return row.item.kind;
    };

    const changeOf = new Map(
        rows.map((row) => [row.key, priceEntryChange(row, baseline, currency)] as const),
    );

    // A removed row takes its selection with it; so does a reload that drops it.
    const rowKeys = new Set(rows.map((row) => row.key));
    const selected = new Set([...picked].filter((key) => rowKeys.has(key)));

    /* ── filter and search ─────────────────────────────────────────────────────────────────── */

    const counts: Readonly<Record<PriceEntryFilter, number>> = {
        all: rows.length,
        confirmed: rows.filter((row) => row.priceStatus === 'confirmed').length,
        placeholder: rows.filter((row) => row.priceStatus === 'placeholder').length,
        market_priced: rows.filter((row) => row.priceStatus === 'market_priced').length,
        changed: rows.filter((row) => changeOf.get(row.key) !== null).length,
    };

    const needle = query.trim().toLocaleLowerCase();
    const visible = rows.filter((row) => {
        if (filter === 'changed' && changeOf.get(row.key) === null) return false;
        if (filter !== 'all' && filter !== 'changed' && row.priceStatus !== filter) return false;
        if (needle === '') return true;
        const thing = describe(row);
        // A row pointing at nothing yet stays in view: it is the one being written.
        if (thing === null) return row.item === null;
        return [thing.name, thing.pack ?? '', thing.code ?? '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle);
    });

    const groups = PRICE_GROUPS.map((group) => ({
        group,
        rows: visible.filter((row) => groupOf(row) === group),
    })).filter((entry) => entry.rows.length > 0);

    const filterItems: readonly TabItem<PriceEntryFilter>[] = (
        [
            ['all', 'kitchen:priceLists.filterAll'],
            ['confirmed', 'kitchen:priceLists.filterConfirmed'],
            ['placeholder', 'kitchen:priceLists.filterPending'],
            ['market_priced', 'kitchen:priceLists.filterDaily'],
            ['changed', 'kitchen:priceLists.filterChanged'],
        ] as const
    ).map(([value, key]) => ({
        value,
        label: t(key),
        count: counts[value],
        ...(value === 'changed' ? { countTone: 'warning' as const } : {}),
        testID: `${testID}-filter-${value}`,
    }));

    /* ── selection ─────────────────────────────────────────────────────────────────────────── */

    const visibleKeys = visible.map((row) => row.key);
    const allVisibleSelected =
        visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

    const toggleAll = () => {
        setPicked(allVisibleSelected ? new Set() : new Set(visibleKeys));
    };

    const toggleRow = (key: string, on: boolean) => {
        const next = new Set(selected);
        if (on) next.add(key);
        else next.delete(key);
        setPicked(next);
    };

    const applyPercent = () => {
        const value = Number(percent.trim().replace(',', '.'));
        if (percent.trim() === '' || !Number.isFinite(value) || value === 0) return;
        const result = adjustConfirmedPrices(rows, selected, value, currency);
        if (result.changed === 0) {
            toast.show({
                testID: `${testID}-bulk-toast`,
                tone: 'info',
                message: t('kitchen:priceLists.bulkNothingToast'),
            });
            return;
        }
        onChange(result.rows);
        setPicked(new Set());
        toast.show({
            testID: `${testID}-bulk-toast`,
            tone: 'success',
            message: t('kitchen:priceLists.bulkAppliedToast', {
                change: `${value > 0 ? '+' : ''}${String(value)}%`,
                step: minorAmountToInput(priceRoundingStep(currency), currency),
            }),
        });
    };

    const removeSelected = () => {
        onChange(rows.filter((row) => !selected.has(row.key)));
        setPicked(new Set());
    };

    /* ── rows ──────────────────────────────────────────────────────────────────────────────── */

    const patchRow = (key: string, next: Partial<PriceEntryDraft>) => {
        onChange(rows.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)));
    };

    const renderRow = (row: PriceEntryDraft) => {
        const base = `${gridID}-row-${row.key}`;
        const thing = describe(row);
        const name = nameOf(row);
        const saved = baseline.get(row.key);
        const change = changeOf.get(row.key) ?? null;
        const isNew = saved === undefined;
        const rowProblems = problems.get(row.key);
        const confirmed = priceStatusCarriesAmount(row.priceStatus);
        const isSelected = selected.has(row.key);

        /*
         * The chip at the top names each row by its first problem and focuses that field, which
         * then shows its red edge and drops its message in favour of the chip's. Only that field
         * takes `error`: a second field saying the same thing under itself would be the row's note
         * said three times.
         */
        const firstField =
            rowProblems?.[0] === undefined ? null : priceProblemField(rowProblems[0]);
        const firstText =
            rowProblems?.[0] === undefined ? undefined : problemText(rowProblems[0], name);

        const was = (() => {
            if (!confirmed || saved === undefined || saved.priceStatus !== 'confirmed') return null;
            if (sameAmount(saved.amount, row.amount, currency)) return null;
            const before = parseMinorAmount(saved.amount, currency);
            const after = parseMinorAmount(row.amount, currency);
            if (before === null || after === null || before === 0) return null;
            const ratio = (after - before) / before;
            const rounded = Math.round(ratio * 100);
            return {
                text: t('kitchen:priceLists.wasAmount', {
                    amount: saved.amount,
                    change: `${rounded > 0 ? '+' : ''}${String(rounded)}%`,
                }),
                large: Math.abs(ratio) >= 0.15,
            };
        })();

        const itemCell = isNew ? (
            <View className="min-w-0 flex-col gap-0.5">
                <Select
                    testID={`${base}-item`}
                    id={`${base}-item`}
                    label={t('kitchen:priceLists.itemLabel')}
                    labelHidden
                    searchable
                    required
                    size="sm"
                    disabled={!canManage}
                    options={unitOptions}
                    value={row.item === null ? null : priceItemKey(row.item)}
                    placeholder={t('kitchen:priceLists.itemPlaceholder')}
                    {...(firstField === 'item' && firstText !== undefined
                        ? { error: firstText }
                        : {})}
                    onChange={(next) => {
                        const chosen = units.find((unit) => unit.key === next);
                        if (chosen !== undefined) patchRow(row.key, { item: chosen.item });
                    }}
                />
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {thing === null
                        ? t('kitchen:priceLists.newEntry')
                        : (thing.code ?? t(priceItemKindKey(thing.kind)))}
                </Text>
            </View>
        ) : (
            <View className="min-w-0 flex-col gap-0.5 pt-1">
                <View className="min-w-0 flex-row items-center gap-1.5">
                    <View
                        testID={change === null ? undefined : `${base}-changed`}
                        role={change === null ? undefined : 'img'}
                        aria-label={
                            change === null ? undefined : t('kitchen:priceLists.filterChanged')
                        }
                        className={cx(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            change === null ? null : 'bg-warning-border',
                        )}
                    />
                    <Text testID={`${base}-name`} variant="strong" numberOfLines={1}>
                        {thing === null
                            ? resolving
                                ? t('kitchen:priceLists.resolvingItem')
                                : t('kitchen:priceLists.unknownItem')
                            : thing.name}
                    </Text>
                </View>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {thing === null
                        ? row.item === null
                            ? ''
                            : t(priceItemKindKey(row.item.kind))
                        : (thing.code ?? t(priceItemKindKey(thing.kind)))}
                </Text>
            </View>
        );

        const pack = thing?.pack ?? null;

        return (
            <View
                key={row.key}
                role="row"
                testID={base}
                nativeID={base}
                className={cx(
                    'border-b border-stroke-subtle px-base py-1.5',
                    rowProblems !== undefined
                        ? 'bg-danger-subtle/50'
                        : isSelected
                          ? 'bg-surface-sunken'
                          : isNew
                            ? 'bg-surface-brand-subtle/40'
                            : null,
                )}
            >
                <View className="flex-row items-start gap-2.5">
                    <View role="cell" style={fixedTrack(TRACK.select)} className="pt-1.5">
                        {canManage ? (
                            <Checkbox
                                testID={`${base}-select`}
                                checked={isSelected}
                                onChange={(on) => {
                                    toggleRow(row.key, on);
                                }}
                                label={t('kitchen:priceLists.selectEntry', { name })}
                                labelHidden
                            />
                        ) : null}
                    </View>

                    <View role="cell" style={ITEM_TRACK}>
                        {itemCell}
                    </View>

                    <View role="cell" style={fixedTrack(TRACK.pack)} className="items-start pt-1">
                        {pack === null ? (
                            <Text tone="secondary" testID={`${base}-pack-none`}>
                                {t('kitchen:list.noValue')}
                            </Text>
                        ) : (
                            <Badge
                                testID={`${base}-pack`}
                                variant="label"
                                tone="neutral"
                                label={pack}
                            />
                        )}
                    </View>

                    <View role="cell" style={fixedTrack(TRACK.basis)}>
                        <SegmentedControl<PriceStatus>
                            testID={`${base}-basis`}
                            label={t('kitchen:priceLists.basisFieldLabel', { name })}
                            block
                            value={row.priceStatus}
                            onChange={(next) => {
                                onChange(
                                    rows.map((entry) =>
                                        entry.key === row.key
                                            ? withPriceStatus(
                                                  entry,
                                                  next,
                                                  saved?.priceStatus === 'confirmed'
                                                      ? saved.amount
                                                      : '',
                                              )
                                            : entry,
                                    ),
                                );
                            }}
                            items={PRICE_STATUSES.map((status) => ({
                                value: status,
                                label: t(BASIS_KEYS[status]),
                                disabled: !canManage,
                                testID: `${base}-basis-${status}`,
                            }))}
                        />
                    </View>

                    <View role="cell" style={fixedTrack(TRACK.amount)} className="gap-0.5">
                        <QuantityInput
                            testID={`${base}-amount`}
                            id={`${base}-amount`}
                            label={t('kitchen:priceLists.amountFieldLabel', { name, currency })}
                            labelHidden
                            size="sm"
                            value={row.amount}
                            placeholder={confirmed ? minorAmountToInput(0, currency) : '—'}
                            required={confirmed}
                            disabled={!confirmed || !canManage}
                            {...(firstField === 'amount' && firstText !== undefined
                                ? { error: firstText }
                                : {})}
                            onChangeText={(next) => {
                                patchRow(row.key, { amount: next });
                            }}
                        />
                        {!confirmed ? (
                            <Text
                                testID={`${base}-no-amount`}
                                variant="micro"
                                tone="secondary"
                                align="end"
                            >
                                {row.priceStatus === 'placeholder'
                                    ? t('kitchen:priceLists.notOnSale')
                                    : t('kitchen:priceLists.setAtCounter')}
                            </Text>
                        ) : was === null ? null : (
                            <Text
                                testID={`${base}-was`}
                                variant="micro"
                                tone={was.large ? 'danger' : 'warning'}
                                align="end"
                            >
                                {was.text}
                            </Text>
                        )}
                    </View>

                    <View role="cell" style={fixedTrack(TRACK.from)}>
                        <PickerField
                            kind="date"
                            testID={`${base}-effective-from`}
                            label={t('kitchen:priceLists.fromFieldLabel', { name })}
                            labelHidden
                            fullWidth
                            disabled={!canManage}
                            value={row.effectiveFrom}
                            displayValue={formatEntryDate(formatter, row.effectiveFrom)}
                            onChange={(next) => {
                                if (next !== '') patchRow(row.key, { effectiveFrom: next });
                            }}
                        />
                    </View>

                    <View
                        role="cell"
                        style={fixedTrack(TRACK.until)}
                        className="flex-row items-center gap-hair"
                    >
                        <View className="min-w-0 flex-1">
                            <PickerField
                                kind="date"
                                testID={`${base}-effective-until`}
                                label={t('kitchen:priceLists.untilFieldLabel', { name })}
                                labelHidden
                                fullWidth
                                disabled={!canManage}
                                value={row.effectiveUntil ?? ''}
                                displayValue={
                                    row.effectiveUntil === null
                                        ? t('kitchen:priceLists.openEnded')
                                        : formatEntryDate(formatter, row.effectiveUntil)
                                }
                                onChange={(next) => {
                                    patchRow(row.key, {
                                        effectiveUntil: next === '' ? null : next,
                                    });
                                }}
                            />
                        </View>
                        {row.effectiveUntil === null || !canManage ? (
                            <View style={fixedTrack(TRACK.remove)} />
                        ) : (
                            <IconButton
                                testID={`${base}-effective-until-clear`}
                                label={t('kitchen:priceLists.clearUntil', { name })}
                                variant="ghost"
                                size="sm"
                                icon={<Icon name="close" size="sm" />}
                                onPress={() => {
                                    patchRow(row.key, { effectiveUntil: null });
                                }}
                            />
                        )}
                    </View>

                    <View role="cell" style={fixedTrack(TRACK.remove)}>
                        {canManage ? (
                            <IconButton
                                testID={`${base}-remove`}
                                label={t('kitchen:priceLists.removeEntry', { name })}
                                variant="ghost"
                                tone="danger"
                                size="sm"
                                icon={<Icon name="close" size="sm" />}
                                onPress={() => {
                                    onChange(rows.filter((entry) => entry.key !== row.key));
                                }}
                            />
                        ) : null}
                    </View>
                </View>

                {rowProblems === undefined ? null : (
                    <View className="mt-1.5 ps-8">
                        <Text testID={`${base}-problems`} variant="caption" tone="danger">
                            {t('kitchen:priceLists.problemsNote', {
                                problems: sentenceCase(
                                    rowProblems
                                        .map((problem) => problemText(problem, name))
                                        .join(' · '),
                                ),
                            })}
                        </Text>
                    </View>
                )}
            </View>
        );
    };

    /* ── the grid ──────────────────────────────────────────────────────────────────────────── */

    const headerCell = (label: string, align: 'start' | 'end' = 'start') => (
        <RNText
            className={cx(
                'text-role-label font-semibold text-content-on-brand-subtle',
                align === 'end' ? 'text-end' : 'text-start',
            )}
        >
            {label}
        </RNText>
    );

    const grid = (
        <View
            testID={gridID}
            role="table"
            aria-label={t('kitchen:priceLists.entriesTitle')}
            // Spread rather than declared: `data-*` is a web attribute React Native does not type.
            // It marks the box whose width the item picker's panel keeps inside, as `DataList` does.
            {...{ [GRID_CONTENT_ATTR]: 'true' }}
            style={{ minWidth: PRICE_GRID_FLOOR }}
            className="flex-col"
        >
            <View
                role="row"
                className="min-h-row-md flex-row items-center gap-2.5 border-b border-stroke-subtle bg-surface-brand-subtle px-base"
            >
                <View role="columnheader" style={fixedTrack(TRACK.select)}>
                    {canManage && visibleKeys.length > 0 ? (
                        <Checkbox
                            testID={`${gridID}-select-all`}
                            checked={allVisibleSelected}
                            mixed={!allVisibleSelected && selected.size > 0}
                            onChange={toggleAll}
                            label={t('kitchen:priceLists.selectAll')}
                            labelHidden
                        />
                    ) : null}
                </View>
                <View role="columnheader" style={ITEM_TRACK}>
                    {headerCell(t('kitchen:priceLists.itemLabel'))}
                </View>
                <View role="columnheader" style={fixedTrack(TRACK.pack)}>
                    {headerCell(t('kitchen:priceLists.packLabel'))}
                </View>
                <View role="columnheader" style={fixedTrack(TRACK.basis)}>
                    {headerCell(t('kitchen:priceLists.basisLabel'))}
                </View>
                <View role="columnheader" style={fixedTrack(TRACK.amount)}>
                    {headerCell(t('kitchen:priceLists.amountLabel', { currency }), 'end')}
                </View>
                <View role="columnheader" style={fixedTrack(TRACK.from)}>
                    {headerCell(t('kitchen:priceLists.effectiveFromLabel'))}
                </View>
                <View role="columnheader" style={fixedTrack(TRACK.until)}>
                    {headerCell(t('kitchen:priceLists.effectiveUntilLabel'))}
                </View>
                <View
                    role="columnheader"
                    aria-label={t('kitchen:priceLists.removeColumn')}
                    style={fixedTrack(TRACK.remove)}
                />
            </View>

            {groups.map(({ group, rows: groupRows }) => (
                <View
                    key={group}
                    role="rowgroup"
                    aria-label={t(GROUP_TITLE_KEYS[group])}
                    testID={`${gridID}-group-${group}`}
                >
                    <View
                        role="row"
                        className="flex-row items-baseline gap-tight border-b border-stroke-subtle px-base pb-1.5 pt-snug"
                    >
                        <View role="rowheader" className="flex-row items-baseline gap-tight">
                            <RNText className="text-role-caption font-semibold uppercase tracking-wider text-content-secondary">
                                {t(GROUP_TITLE_KEYS[group])}
                            </RNText>
                            <RNText
                                testID={`${gridID}-group-${group}-count`}
                                className="text-role-caption tabular-nums text-content-secondary"
                            >
                                {String(groupRows.length)}
                            </RNText>
                        </View>
                    </View>
                    {groupRows.map(renderRow)}
                </View>
            ))}
        </View>
    );

    const scrolls = port > 0 && port < PRICE_GRID_FLOOR;

    /* ── the card ──────────────────────────────────────────────────────────────────────────── */

    return (
        <View
            testID={`${testID}-entries-card`}
            className="rounded border border-stroke-subtle bg-surface-raised shadow-elevation-card"
        >
            <View
                testID={`${testID}-entries-toolbar`}
                className="min-h-control-lg flex-row flex-wrap items-center gap-snug border-b border-stroke-subtle px-base py-snug"
            >
                {selected.size === 0 ? (
                    <>
                        <View className="me-1.5 flex-row items-baseline gap-tight">
                            <Text variant="section" accessibilityRole="header">
                                {t('kitchen:priceLists.entriesTitle')}
                            </Text>
                            <Text
                                testID={`${testID}-entry-count`}
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:priceLists.entryCount', { count: rows.length })}
                            </Text>
                        </View>
                        <SegmentedControl<PriceEntryFilter>
                            testID={`${testID}-filter`}
                            label={t('kitchen:priceLists.filterLabel')}
                            items={filterItems}
                            value={filter}
                            onChange={setFilter}
                        />
                        <View className="flex-1" />
                        <View style={{ width: 220 }}>
                            <SearchInput
                                testID={`${testID}-search`}
                                label={t('kitchen:priceLists.searchLabel')}
                                placeholder={t('kitchen:priceLists.searchLabel')}
                                value={query}
                                onChangeText={setQuery}
                            />
                        </View>
                        {canManage ? (
                            <Button
                                testID={`${testID}-add-entry`}
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:priceLists.addEntry')}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={() => {
                                    setFilter('all');
                                    setQuery('');
                                    onAdd();
                                }}
                            />
                        ) : null}
                    </>
                ) : (
                    <>
                        <Text testID={`${testID}-selected-count`} variant="strong">
                            {t('kitchen:priceLists.selectedCount', { count: selected.size })}
                        </Text>
                        <ToolbarRule />
                        <Text tone="secondary">{t('kitchen:priceLists.bulkLabel')}</Text>
                        <View style={{ width: 84 }}>
                            <QuantityInput
                                testID={`${testID}-bulk-percent`}
                                id={`${testID}-bulk-percent`}
                                label={t('kitchen:priceLists.bulkPercentLabel')}
                                labelHidden
                                size="sm"
                                unit="%"
                                value={percent}
                                onChangeText={setPercent}
                            />
                        </View>
                        <Button
                            testID={`${testID}-bulk-apply`}
                            size="sm"
                            label={t('kitchen:priceLists.bulkApply')}
                            onPress={applyPercent}
                        />
                        <ToolbarRule />
                        <Button
                            testID={`${testID}-bulk-remove`}
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:priceLists.bulkRemove')}
                            onPress={removeSelected}
                        />
                        <View className="flex-1" />
                        <Button
                            testID={`${testID}-bulk-clear`}
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:priceLists.bulkClear')}
                            onPress={() => {
                                setPicked(new Set());
                            }}
                        />
                    </>
                )}
            </View>

            <View
                onLayout={(event: LayoutChangeEvent) => {
                    setPort(event.nativeEvent.layout.width);
                }}
            >
                {/*
                 * Sideways scrolling only below the floor. A scroller clips what hangs out of it,
                 * and the item picker's panel hangs below its row; at desk widths there is nothing
                 * to scroll, so there is no scroller to clip it.
                 */}
                {scrolls ? (
                    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
                        {grid}
                    </ScrollView>
                ) : (
                    grid
                )}
            </View>

            {groups.length > 0 ? null : (
                <View testID={`${gridID}-empty`} className="items-center gap-tight px-base py-10">
                    <Text variant="strong">
                        {rows.length === 0
                            ? t('kitchen:priceLists.noEntriesTitle')
                            : t('kitchen:priceLists.noMatchTitle')}
                    </Text>
                    <View className="max-w-[420px]">
                        <Text tone="secondary" align="center">
                            {rows.length === 0
                                ? t('kitchen:priceLists.noEntriesBody')
                                : t('kitchen:priceLists.noMatchBody')}
                        </Text>
                    </View>
                </View>
            )}

            <View
                testID={`${testID}-legend`}
                className="flex-row flex-wrap items-center gap-base border-t border-stroke-subtle px-base py-2.5"
            >
                <LegendTerm
                    term={t('kitchen:priceLists.basisConfirmed')}
                    body={t('kitchen:priceLists.legendConfirmed')}
                />
                <LegendTerm
                    term={t('kitchen:priceLists.basisPending')}
                    body={t('kitchen:priceLists.legendPending')}
                />
                <LegendTerm
                    term={t('kitchen:priceLists.basisDaily')}
                    body={t('kitchen:priceLists.legendDaily')}
                />
                <View className="flex-1" />
                <Text variant="caption" tone="secondary">
                    {t('kitchen:priceLists.legendReplaces')}
                </Text>
            </View>
        </View>
    );
}

/** A problem list is a sentence: its first letter up, where the script has letters that go up. */
function sentenceCase(text: string): string {
    return text.length === 0 ? text : `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}

/** The hairline between the bulk bar's groups of controls. */
function ToolbarRule() {
    return <View aria-hidden className="h-5 w-px bg-stroke-subtle" />;
}

/** One term of the legend: the basis in the primary ink, what it means in the secondary. */
function LegendTerm({ term, body }: { readonly term: string; readonly body: string }): ReactNode {
    return (
        <RNText className="text-role-caption text-content-secondary">
            <RNText className="font-semibold text-content-primary">{term}</RNText> {body}
        </RNText>
    );
}

/* ------------------------------------------------------------------------------------------------
 * To and from the contract
 * ---------------------------------------------------------------------------------------------- */

/**
 * The editor's rows as the contract's payload.
 *
 * Called only once {@link priceEntryProblems} is empty, so the `item` narrowing and the amount
 * parse cannot fail — but neither is asserted away: a row that somehow arrives here without an item
 * is dropped rather than sent as a price for nothing, and `amountMinor` falls to `null`, which is
 * the only value the `CHECK` accepts for a status that carries no amount.
 */
export function priceEntryRequest(
    rows: readonly PriceEntryDraft[],
    currency: CurrencyCode,
): readonly {
    item: CatalogueItemRef;
    priceStatus: PriceStatus;
    amountMinor: number | null;
    effectiveFrom: string;
    effectiveUntil: string | null;
    note: string | null;
}[] {
    return rows.flatMap((row) => {
        if (row.item === null) return [];
        const amountMinor = priceStatusCarriesAmount(row.priceStatus)
            ? parseMinorAmount(row.amount, currency)
            : null;
        return [
            {
                item: row.item,
                priceStatus: row.priceStatus,
                amountMinor,
                effectiveFrom: row.effectiveFrom,
                effectiveUntil: row.effectiveUntil,
                note: row.note.trim() === '' ? null : row.note.trim(),
            },
        ];
    });
}

/** A server entry as the editor holds it. The inverse of {@link priceEntryRequest}. */
export function priceEntryDraft(
    entry: {
        readonly item: CatalogueItemRef;
        readonly priceStatus: PriceStatus;
        readonly amountMinor: number | null;
        readonly effectiveFrom: string;
        readonly effectiveUntil: string | null;
        readonly note: string | null;
    },
    currency: CurrencyCode,
    index: number,
): PriceEntryDraft {
    return {
        key: `seed-${String(index)}-${priceItemKey(entry.item)}`,
        item: entry.item,
        priceStatus: entry.priceStatus,
        amount: entry.amountMinor === null ? '' : minorAmountToInput(entry.amountMinor, currency),
        effectiveFrom: entry.effectiveFrom,
        effectiveUntil: entry.effectiveUntil,
        note: entry.note ?? '',
    };
}
