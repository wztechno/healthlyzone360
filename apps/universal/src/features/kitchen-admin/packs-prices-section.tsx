import { isConflictFailure, isValidationFailure } from '@healthy360/api-client/contracts';
import type {
    CostAmount,
    IngredientAdmin,
    ItemPacks,
    LocalisedText,
    PackPlace,
    RecipePackCost,
    RecipeRollupPack,
    SetItemPacksRequest,
} from '@healthy360/api-client/contracts';
import {
    Card,
    DataList,
    FormSection,
    Icon,
    QuantityInput,
    Select,
    Stack,
    Text,
    UNDROPPABLE_PRIORITY,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import { IngredientId, minorUnitExponent } from '@healthy360/domain-types';
import type { CurrencyCode, MealId, ProductId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useItemPacksQuery,
    usePackagingWholeSetQuery,
    useSetItemPacksMutation,
} from '../../data/kitchen-admin-hooks.ts';
import { queryKeys } from '../../data/query-keys.ts';
import { useRepositories } from '../../data/repository-provider.tsx';
import { CostCard } from './cost-card.tsx';
import type { CostCardRow } from './cost-card.tsx';
import { ChoiceRow } from './desk-kit/choice-row.tsx';
import { DeskChip } from './desk-kit/desk-chip.tsx';
import { DeskIconButton } from './desk-kit/desk-button.tsx';
import { CATALOGUE_MANAGE_PERMISSION, PRICE_LIST_MANAGE_PERMISSION } from './entity-registry.ts';
import { FailureToast } from './failure-toast.tsx';
import { displayName, formatMoney, parseAmount, parseQuantity, unitShortKey } from './format.ts';
import { useHostSave } from './host-save.ts';
import type { HostSave, RegisterHostSave } from './host-save.ts';

/**
 * The recipe editor's **Packs & prices** tab — what a sold recipe is sold in, where, and for how
 * much (the owner's prototype, tab 3).
 *
 * ```
 * Where it sells     [✓] Home shop  Web shop   [ ] Business  Quotes · corporate   [✓] Counter
 * Packs                                                             ( Add a pack…      ⌄ )
 *   One batch (2.00 kg) fills 4 × Bottle 0.5 L or 2 × Bottle 1 L
 *   ┌ Bottle 0.5 L  PK-05                                        4 per batch   ✕ ┐
 *   │ Fill per pack [0.46 kg]   Packaging (Bottle 0.5 L) (Cap ✕) [+ Add ⌄]     Cost per pack │
 *   │ Home shop [ 4.50 USD ]  62% margin · $2.80 a pack   Business [ Not sold ]           │
 *   └──────────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The packs belong to the **item** that sells the recipe, not to the recipe, so the host that
 * reads the item owns this section and hands it to the editor. It holds its own draft, seeded from
 * the packs query, reports it upward (`onReport`: dirty, the roll-up input, the publish blockers,
 * the Costing tab's rows) and hands its save to the page's one Save (`host-save.ts`).
 *
 * Every figure of cost is the server's (`computed.packs`, by key). The client only reads a margin
 * off a price and a complete cost: `(price − cost) ÷ price`. A cost withheld — a pack with no
 * container yet, an unpriced bottle — shows its reason and never a margin.
 *
 * Counter carries no price of its own: it charges the Home shop's, so ticking Counter alone still
 * shows the Home shop field. On a new recipe there is no item yet, so the draft is held and written
 * once the item exists (`useWritePacksDraft`).
 */

/* ── the draft ───────────────────────────────────────────────────────────────────────────────── */

export type PricedPlace = 'home' | 'business';
const PRICED_PLACES: readonly PricedPlace[] = ['home', 'business'];
const PLACES: readonly PackPlace[] = ['home', 'business', 'counter'];

export interface PackComponentDraft {
    readonly ingredientId: string;
    readonly quantity: number;
    readonly isContainer: boolean;
}

export interface PackDraft {
    /** The pack's id, or `new-N` for one added here. Also the roll-up key. */
    readonly key: string;
    readonly id: string | null;
    readonly code: string;
    readonly name: LocalisedText | null;
    readonly fill: string;
    readonly fillUnit: MeasureUnit;
    readonly components: readonly PackComponentDraft[];
    /** Major units, as typed. Blank is not sold there. */
    readonly prices: Readonly<Record<PricedPlace, string>>;
    /** The price shown is the item's own, standing in for the pack's. Cleared once it is typed over. */
    readonly inherited: Readonly<Record<PricedPlace, boolean>>;
}

export interface PacksDraft {
    readonly places: Readonly<Record<PackPlace, boolean>>;
    readonly packs: readonly PackDraft[];
}

export const EMPTY_PACKS_DRAFT: PacksDraft = {
    places: { home: false, business: false, counter: false },
    packs: [],
};

function exponentOf(currency: CurrencyCode | null | undefined): number {
    return currency === null || currency === undefined ? 2 : minorUnitExponent(currency);
}

/** The saved packs as the draft holds them. Deterministic, so a fresh read of the same set is equal. */
export function packsDraftFrom(data: ItemPacks | undefined): PacksDraft {
    if (data === undefined) return EMPTY_PACKS_DRAFT;
    const text = (place: PricedPlace, minor: number | undefined): string => {
        if (minor === undefined) return '';
        const exponent = exponentOf(data.places[place]?.currency);
        return (minor / 10 ** exponent).toFixed(exponent);
    };
    return {
        places: {
            home: data.places.home?.offered ?? false,
            business: data.places.business?.offered ?? false,
            counter: data.places.counter?.offered ?? false,
        },
        packs: data.packs.map((pack) => ({
            key: pack.id,
            id: pack.id,
            code: pack.code,
            name: pack.name,
            fill: String(pack.fill.quantity),
            fillUnit: pack.fill.unit,
            components: pack.components.map((component) => ({
                ingredientId: String(component.ingredientId),
                quantity: component.quantity,
                isContainer: component.isContainer,
            })),
            prices: {
                home: text('home', pack.prices.home?.amountMinor),
                business: text('business', pack.prices.business?.amountMinor),
            },
            inherited: {
                home: pack.prices.home?.inherited ?? false,
                business: pack.prices.business?.inherited ?? false,
            },
        })),
    };
}

/** The fill a container suggests: its Holds, a volume read as the same weight (1 L = 1 kg). */
export function fillFromCapacity(capacity: {
    readonly quantity: number;
    readonly unit: MeasureUnit;
}): { readonly quantity: number; readonly unit: MeasureUnit } {
    const unit: MeasureUnit =
        capacity.unit === 'l' ? 'kg' : capacity.unit === 'ml' ? 'g' : capacity.unit;
    return { quantity: capacity.quantity, unit };
}

/** A fill in kilograms, or `null` for a piece (or a unit with no weight). */
function fillKg(quantity: number, unit: MeasureUnit): number | null {
    if (unit === 'kg' || unit === 'l') return quantity;
    if (unit === 'g' || unit === 'ml') return quantity / 1000;
    return null;
}

/** How many of a pack one batch fills — whole packs only. `null` when it cannot be said. */
export function packsPerBatch(
    pack: Pick<PackDraft, 'fill' | 'fillUnit'>,
    yieldKg: number | null,
    piecesPerBatch: number | null,
): number | null {
    const fill = parseQuantity(pack.fill);
    if (fill === null || fill <= 0) return null;
    if (pack.fillUnit === 'piece') {
        return piecesPerBatch === null || piecesPerBatch <= 0
            ? null
            : Math.floor(piecesPerBatch / fill + 1e-9);
    }
    const kg = fillKg(fill, pack.fillUnit);
    return kg === null || yieldKg === null || yieldKg <= 0 ? null : Math.floor(yieldKg / kg + 1e-9);
}

/** The margin a price earns over a complete cost: a percentage of the price, and the amount. */
export function packMargin(
    price: number | null | undefined,
    cost: number | null | undefined,
): { readonly percent: number; readonly amount: number } | null {
    if (typeof price !== 'number' || typeof cost !== 'number' || price <= 0) return null;
    return { percent: Math.round(((price - cost) / price) * 100), amount: price - cost };
}

function containerOf(pack: PackDraft): PackComponentDraft | undefined {
    return pack.components.find((component) => component.isContainer);
}

function fillInvalid(pack: PackDraft): boolean {
    const fill = parseQuantity(pack.fill);
    return fill === null || fill <= 0;
}

function priceInvalid(text: string): boolean {
    const amount = parseAmount(text);
    return amount === undefined || amount === 0;
}

function draftValid(draft: PacksDraft): boolean {
    return draft.packs.every(
        (pack) =>
            !fillInvalid(pack) && PRICED_PLACES.every((place) => !priceInvalid(pack.prices[place])),
    );
}

/** The packs as the roll-up preview costs them. A pack whose fill does not parse is left out. */
export function rollupPacksFrom(draft: PacksDraft): readonly RecipeRollupPack[] {
    return draft.packs.flatMap((pack) => {
        const fill = parseQuantity(pack.fill);
        if (fill === null || fill <= 0) return [];
        return [
            {
                key: pack.key,
                fillQuantity: fill,
                fillUnit: pack.fillUnit,
                components: pack.components.map((component) => ({
                    ingredientId: IngredientId.unsafe(component.ingredientId),
                    quantity: component.quantity,
                    isContainer: component.isContainer,
                })),
            },
        ];
    });
}

/** Which places need a price: Home shop for itself or for Counter, Business for itself. */
export function pricedPlacesShown(places: PacksDraft['places']): readonly PricedPlace[] {
    return PRICED_PLACES.filter((place) =>
        place === 'home' ? places.home || places.counter : places.business,
    );
}

/** The request for a draft, against what the server says the item has. */
export function packsRequestFrom(
    draft: PacksDraft,
    current: ItemPacks,
): Omit<SetItemPacksRequest, 'lockVersion'> {
    const minor = (place: PricedPlace, text: string): number | null => {
        const amount = parseAmount(text);
        const offer = current.places[place];
        if (amount === null || amount === undefined || offer === null) return null;
        return Math.round(amount * 10 ** exponentOf(offer.currency));
    };
    return {
        places: {
            home: draft.places.home && current.places.home !== null,
            business: draft.places.business && current.places.business !== null,
            counter: draft.places.counter && current.places.counter !== null,
        },
        packs: draft.packs.map((pack) => ({
            ...(pack.id === null ? {} : { id: pack.id }),
            fill: { quantity: parseQuantity(pack.fill) ?? 0, unit: pack.fillUnit },
            components: pack.components.map((component) => ({
                ingredientId: IngredientId.unsafe(component.ingredientId),
                quantity: component.quantity,
                isContainer: component.isContainer,
            })),
            prices: {
                home: minor('home', pack.prices.home),
                business: minor('business', pack.prices.business),
            },
        })),
    };
}

/* ── what the section tells the page ─────────────────────────────────────────────────────────── */

/** The server's publish reasons for a sold recipe, derived from the draft. */
export type PacksIssueCode = 'no_pack' | 'no_selling_place' | 'place_unpriced';

export interface PacksIssue {
    readonly key: string;
    readonly code: PacksIssueCode;
    readonly place?: PricedPlace | undefined;
    /** A field to focus, or — when `section` — a section to light. */
    readonly targetId: string;
    readonly section: boolean;
}

/** One Costing-table row: the pack, its fill and the prices typed for it. */
export interface PackSummary {
    readonly key: string;
    readonly name: string;
    readonly fill: string;
    readonly prices: Readonly<Record<PricedPlace, number | null>>;
}

export interface PacksReport {
    readonly dirty: boolean;
    readonly draft: PacksDraft;
    readonly rollup: readonly RecipeRollupPack[];
    readonly issues: readonly PacksIssue[];
    readonly summary: readonly PackSummary[];
    readonly shownPlaces: readonly PricedPlace[];
    readonly currency: CurrencyCode | null;
}

export const EMPTY_PACKS_REPORT: PacksReport = {
    dirty: false,
    draft: EMPTY_PACKS_DRAFT,
    rollup: [],
    issues: [],
    summary: [],
    shownPlaces: [],
    currency: null,
};

export const PACKS_TEST_ID = 'kitchen-packs';

/** The field ids the section draws, so a tray card can focus one. */
export const packsTargets = {
    places: `${PACKS_TEST_ID}-places`,
    add: `${PACKS_TEST_ID}-add`,
    price: (key: string, place: PricedPlace) => `${PACKS_TEST_ID}-${key}-price-${place}`,
};

/** The three publish blockers, with the same codes the server's `SellingReadiness` uses. */
export function packsIssuesOf(draft: PacksDraft): readonly PacksIssue[] {
    const issues: PacksIssue[] = [];
    if (draft.packs.length === 0) {
        issues.push({
            key: 'no_pack',
            code: 'no_pack',
            targetId: packsTargets.add,
            section: false,
        });
    }
    if (!PLACES.some((place) => draft.places[place])) {
        issues.push({
            key: 'no_selling_place',
            code: 'no_selling_place',
            targetId: packsTargets.places,
            section: true,
        });
    }
    for (const place of pricedPlacesShown(draft.places)) {
        const priced = draft.packs.some((pack) => {
            const amount = parseAmount(pack.prices[place]);
            return typeof amount === 'number' && amount > 0;
        });
        if (priced) continue;
        const first = draft.packs[0];
        issues.push({
            key: `place_unpriced-${place}`,
            code: 'place_unpriced',
            place,
            targetId: first === undefined ? packsTargets.add : packsTargets.price(first.key, place),
            section: false,
        });
    }
    return issues;
}

/* ── a new item's draft ──────────────────────────────────────────────────────────────────────── */

/**
 * Writes a new item's packs once it exists: reads what the item has (its places, their currency,
 * the lock the create left), then writes the draft. Answers the failure, or `null`. A draft with
 * nothing in it writes nothing.
 */
export function useWritePacksDraft(): (
    itemId: ProductId | MealId,
    draft: PacksDraft,
) => Promise<unknown> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();
    const { mutateAsync } = useSetItemPacksMutation();

    return useCallback(
        async (itemId, draft) => {
            if (draft.packs.length === 0 && !PLACES.some((place) => draft.places[place])) {
                return null;
            }
            try {
                const current = await repositories.kitchenAdmin.getItemPacks(itemId);
                queryClient.setQueryData(queryKeys.kitchenAdmin.itemPacks(itemId), current);
                await mutateAsync({ itemId, request: packsRequestFrom(draft, current) });
                return null;
            } catch (error) {
                return error;
            }
        },
        [repositories, queryClient, mutateAsync],
    );
}

/* ── the host's half ─────────────────────────────────────────────────────────────────────────── */

/** What a host hands the recipe editor as its `packs` prop. */
export interface PacksTab {
    /** The section's latest report — dirty, roll-up input, blockers, Costing rows. */
    readonly report: PacksReport;
    /** The section's save, for the page's one Save (`host-save.ts`). */
    readonly save: () => Promise<boolean>;
    /** Draws the section with what the recipe on screen knows. */
    readonly render: (facts: PacksRecipeFacts) => ReactNode;
}

/**
 * The host's side of the tab: holds what the section reports and the save it registers, the way
 * the cooked-item hosts hold the listing's. `itemId` is the sold item, `null` while it does not
 * exist yet; `key` remounts the section when the item on screen changes.
 */
export function usePacksTab(itemId: ProductId | MealId | null, key: string): PacksTab {
    const [report, setReport] = useState<PacksReport>(EMPTY_PACKS_REPORT);
    const saveRef = useRef<HostSave | null>(null);
    const register = useCallback((save: HostSave | null) => {
        saveRef.current = save;
    }, []);
    const save = useCallback(async () => (saveRef.current === null ? true : saveRef.current()), []);
    const render = useCallback(
        (facts: PacksRecipeFacts) => (
            <PacksPricesSection
                key={key}
                itemId={itemId}
                facts={facts}
                onReport={setReport}
                onRegisterSave={register}
            />
        ),
        [key, itemId, register],
    );
    return useMemo(() => ({ report, save, render }), [report, save, render]);
}

/* ── the section ─────────────────────────────────────────────────────────────────────────────── */

/** What the recipe on screen knows, handed in by the editor. */
export interface PacksRecipeFacts {
    /** The batch yield in kilograms, or `null` while it does not parse. */
    readonly yieldKg: number | null;
    readonly piecesPerBatch: number | null;
    /** `computed.packs` from the roll-up, by key; `null` while there is nothing costed. */
    readonly computed: readonly RecipePackCost[] | null;
    readonly canViewCosts: boolean;
}

export interface PacksPricesSectionProps {
    /** The item that sells the recipe; `null` while it does not exist yet. */
    readonly itemId: ProductId | MealId | null;
    readonly facts: PacksRecipeFacts;
    readonly onReport: (report: PacksReport) => void;
    readonly onRegisterSave?: RegisterHostSave | undefined;
}

export function PacksPricesSection({
    itemId,
    facts,
    onReport,
    onRegisterSave,
}: PacksPricesSectionProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    // Both, as the channel prices ask: the write sizes the item's packs and prices them on the lists.
    const canManageCatalogue = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canManagePrices = useCan(PRICE_LIST_MANAGE_PERMISSION);
    const canManage = canManageCatalogue && canManagePrices;
    const testID = PACKS_TEST_ID;

    const query = useItemPacksQuery(itemId);
    const mutation = useSetItemPacksMutation();
    const packaging = usePackagingWholeSetQuery(undefined);
    const library: readonly IngredientAdmin[] = useMemo(
        () => (packaging.data ?? []).filter((entry) => entry.meta.status !== 'retired'),
        [packaging.data],
    );
    const data = query.data;

    /*
     * The draft and what it was seeded from. A fresh read replaces the draft only while it holds
     * nothing unsaved — the listing's save beside it refetches the item, and that must not throw a
     * half-typed price away. Discard redraws the whole page, which seeds it again from the cache.
     */
    const [base, setBase] = useState<PacksDraft>(() => packsDraftFrom(data));
    const [draft, setDraft] = useState<PacksDraft>(base);
    const [seededFrom, setSeededFrom] = useState<ItemPacks | undefined>(data);
    const dirty = JSON.stringify(draft) !== JSON.stringify(base);
    if (data !== seededFrom) {
        setSeededFrom(data);
        if (!dirty) {
            const next = packsDraftFrom(data);
            setBase(next);
            setDraft(next);
        }
    }

    const [attempted, setAttempted] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    const nextKey = useRef(1);

    const nameOf = useCallback(
        (ingredientId: string): string => {
            const entry = library.find((candidate) => String(candidate.id) === ingredientId);
            return entry === undefined
                ? t('kitchen:packs.unnamedItem')
                : displayName(entry.name, locale).value;
        },
        [library, locale, t],
    );
    const packName = useCallback(
        (pack: PackDraft): string => {
            if (pack.name !== null && displayName(pack.name, locale).value !== '') {
                return displayName(pack.name, locale).value;
            }
            const container = containerOf(pack);
            if (container !== undefined) return nameOf(container.ingredientId);
            return pack.code === '' ? t('kitchen:packs.unnamed') : pack.code;
        },
        [locale, nameOf, t],
    );
    const amountText = useCallback(
        (quantity: number, unit: MeasureUnit) =>
            `${formatter.formatNumber(quantity, { maximumFractionDigits: 3 })} ${t(unitShortKey(unit))}`,
        [formatter, t],
    );

    const currencyOf = (place: PricedPlace): CurrencyCode | null =>
        data?.places[place]?.currency ?? null;
    const currency = currencyOf('home') ?? currencyOf('business');

    /* ── the report ────────────────────────────────────────────────────────────────────────── */

    const report = useMemo<PacksReport>(
        () => ({
            dirty,
            draft,
            rollup: rollupPacksFrom(draft),
            issues: packsIssuesOf(draft),
            summary: draft.packs.map((pack) => {
                const fill = parseQuantity(pack.fill);
                const price = (place: PricedPlace): number | null => {
                    const amount = parseAmount(pack.prices[place]);
                    return typeof amount === 'number' ? amount : null;
                };
                return {
                    key: pack.key,
                    name: packName(pack),
                    fill: fill === null ? '' : amountText(fill, pack.fillUnit),
                    prices: { home: price('home'), business: price('business') },
                };
            }),
            shownPlaces: pricedPlacesShown(draft.places),
            currency,
        }),
        [dirty, draft, packName, amountText, currency],
    );
    // Sent only when it says something new: the host re-renders this section on every report, and
    // a report rebuilt from equal parts must not send it round again.
    const reported = useRef<string | null>(null);
    useEffect(() => {
        const said = JSON.stringify(report);
        if (said === reported.current) return;
        reported.current = said;
        onReport(report);
    }, [report, onReport]);

    /* ── saving ────────────────────────────────────────────────────────────────────────────── */

    useHostSave(onRegisterSave, async () => {
        if (itemId === null || !dirty) return true;
        setAttempted(true);
        if (data === undefined || !draftValid(draft)) return false;
        setFailure(null);
        try {
            const saved = await mutation.mutateAsync({
                itemId,
                request: packsRequestFrom(draft, data),
            });
            const next = packsDraftFrom(saved);
            setSeededFrom(saved);
            setBase(next);
            setDraft(next);
            setAttempted(false);
            return true;
        } catch (error) {
            setFailure(error);
            // Someone else moved the item: read it again under the draft, which stays as typed.
            const refused = toFailure(error);
            if (refused !== null && isConflictFailure(refused)) void query.refetch();
            return false;
        }
    });

    const refusal = toFailure(failure);
    const conflict = refusal !== null && isConflictFailure(refusal);
    const fields = refusal !== null && isValidationFailure(refusal) ? refusal.fields : {};
    const serverError = (prefix: string): string | undefined => {
        const messages = Object.entries(fields)
            .filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
            .flatMap(([, list]) => list);
        return messages.length === 0 ? undefined : messages.join(' ');
    };

    /* ── edits ─────────────────────────────────────────────────────────────────────────────── */

    const patchPack = (key: string, next: Partial<PackDraft>) => {
        setDraft((current) => ({
            ...current,
            packs: current.packs.map((pack) => (pack.key === key ? { ...pack, ...next } : pack)),
        }));
    };

    const usedContainers = new Set(
        draft.packs.flatMap((pack) => {
            const container = containerOf(pack);
            return container === undefined ? [] : [container.ingredientId];
        }),
    );
    const piecesKnown = facts.piecesPerBatch !== null && facts.piecesPerBatch > 0;
    const containers = library.filter(
        (entry) =>
            entry.capacity !== null &&
            !usedContainers.has(String(entry.id)) &&
            (entry.capacity.unit !== 'piece' || piecesKnown),
    );

    /** What a packaging item costs per item, from its pack price. */
    const pricePerItem = (entry: IngredientAdmin): CostAmount | null => {
        if (entry.purchasePrice === null) return null;
        const items = entry.itemsPerUnit;
        return items === null || items <= 0
            ? entry.purchasePrice
            : { ...entry.purchasePrice, amount: entry.purchasePrice.amount / items };
    };
    const money = (amount: CostAmount, digits = 2) =>
        formatMoney(formatter, amount.amount, amount.currency, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });

    const containerOption = (entry: IngredientAdmin): SelectOption => {
        const price = pricePerItem(entry);
        const parts = [
            entry.capacity === null
                ? null
                : t('kitchen:packs.optionHolds', {
                      amount: amountText(entry.capacity.quantity, entry.capacity.unit),
                  }),
            price === null ? null : t('kitchen:packs.optionPrice', { price: money(price, 3) }),
            entry.wastePercent === null
                ? null
                : t('kitchen:packs.optionWaste', {
                      percent: formatter.formatNumber(entry.wastePercent),
                  }),
        ].filter((part): part is string => part !== null);
        return {
            value: String(entry.id),
            label: displayName(entry.name, locale).value,
            description: parts.join(t('kitchen:packs.optionSeparator')),
            ...(entry.reference === null ? {} : { keywords: entry.reference }),
        };
    };

    const addPack = (ingredientId: string) => {
        const entry = library.find((candidate) => String(candidate.id) === ingredientId);
        if (entry === undefined || entry.capacity === null) return;
        const fill = fillFromCapacity(entry.capacity);
        const key = `new-${String(nextKey.current)}`;
        nextKey.current += 1;
        setDraft((current) => ({
            ...current,
            packs: [
                ...current.packs,
                {
                    key,
                    id: null,
                    code: '',
                    name: entry.name,
                    fill: String(fill.quantity),
                    fillUnit: fill.unit,
                    components: [{ ingredientId, quantity: 1, isContainer: true }],
                    prices: { home: '', business: '' },
                    inherited: { home: false, business: false },
                },
            ],
        }));
    };

    /* ── drawing ───────────────────────────────────────────────────────────────────────────── */

    const placeLabel = (place: PackPlace) =>
        t(
            place === 'home'
                ? 'kitchen:packs.placeHome'
                : place === 'business'
                  ? 'kitchen:packs.placeBusiness'
                  : 'kitchen:packs.placeCounter',
        );
    const placeCaption = (place: PackPlace) =>
        t(
            place === 'home'
                ? 'kitchen:packs.placeHomeCaption'
                : place === 'business'
                  ? 'kitchen:packs.placeBusinessCaption'
                  : 'kitchen:packs.placeCounterCaption',
        );
    /** A place the kitchen has nowhere to sell on is not offered — except on a new item, unread. */
    const offered = (place: PackPlace): boolean => itemId === null || data?.places[place] != null;
    const counter = data?.places.counter ?? null;
    const counterLocked = counter !== null && !counter.followsHome;

    const fills = draft.packs
        .map((pack) => ({ pack, count: packsPerBatch(pack, facts.yieldKg, facts.piecesPerBatch) }))
        .filter(
            (entry): entry is { pack: PackDraft; count: number } =>
                entry.count !== null && entry.count > 0,
        );
    const batchAmount =
        facts.yieldKg !== null
            ? `${formatter.formatNumber(facts.yieldKg, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t(unitShortKey('kg'))}`
            : facts.piecesPerBatch !== null
              ? amountText(facts.piecesPerBatch, 'piece')
              : null;

    return (
        <Stack space="md" testID={testID}>
            <FailureToast
                testID={`${testID}-failed-toast`}
                failure={failure}
                title={t('kitchen:packs.saveFailed')}
                body={conflict ? t('kitchen:packs.conflict') : (refusal?.message ?? null)}
            />

            <FormSection
                first
                variant="card"
                testID={packsTargets.places}
                nativeID={packsTargets.places}
                title={t('kitchen:packs.placesTitle')}
            >
                <Stack space="xs">
                    {PLACES.filter(offered).map((place) => (
                        <ChoiceRow
                            key={place}
                            testID={`${testID}-place-${place}`}
                            mark="check"
                            label={placeLabel(place)}
                            meta={placeCaption(place)}
                            selected={draft.places[place]}
                            disabled={!canManage || (place === 'counter' && counterLocked)}
                            onPress={() => {
                                setDraft((current) => ({
                                    ...current,
                                    places: { ...current.places, [place]: !current.places[place] },
                                }));
                            }}
                        />
                    ))}
                    {counterLocked && counter !== null ? (
                        <Text
                            testID={`${testID}-counter-locked`}
                            variant="caption"
                            tone="secondary"
                        >
                            {counter.priceListName === null
                                ? t('kitchen:packs.counterNoList')
                                : t('kitchen:packs.counterOtherList', {
                                      list: counter.priceListName,
                                  })}
                        </Text>
                    ) : null}
                    {serverError('places') === undefined ? null : (
                        <Text testID={`${testID}-places-error`} variant="caption" tone="danger">
                            {serverError('places')}
                        </Text>
                    )}
                </Stack>
            </FormSection>

            <FormSection
                variant="card"
                testID={`${testID}-packs`}
                nativeID={`${testID}-packs`}
                title={t('kitchen:packs.packsTitle')}
                description={t('kitchen:packs.packsHint')}
                actions={
                    canManage ? (
                        <View className="z-auto w-64">
                            <Select
                                testID={packsTargets.add}
                                id={packsTargets.add}
                                label={t('kitchen:packs.addPackLabel')}
                                labelHidden
                                placeholder={t('kitchen:packs.addPack')}
                                searchable
                                loading={packaging.isPending}
                                options={containers.map(containerOption)}
                                value={null}
                                onChange={addPack}
                            />
                        </View>
                    ) : undefined
                }
            >
                <Stack space="sm">
                    {fills.length === 0 || batchAmount === null ? null : (
                        <Text testID={`${testID}-batch-fills`} variant="label">
                            {t('kitchen:packs.batchFills', {
                                amount: batchAmount,
                                fills: fills
                                    .map((entry) =>
                                        t('kitchen:packs.batchFillsPack', {
                                            count: entry.count,
                                            name: packName(entry.pack),
                                        }),
                                    )
                                    .join(t('kitchen:packs.or')),
                            })}
                        </Text>
                    )}
                    {draft.packs.length === 0 ? (
                        <Text testID={`${testID}-empty`} tone="secondary">
                            {t('kitchen:packs.empty')}
                        </Text>
                    ) : null}
                    {draft.packs.map((pack, index) => (
                        <PackCard
                            key={pack.key}
                            testID={`${testID}-${pack.key}`}
                            pack={pack}
                            name={packName(pack)}
                            perBatch={packsPerBatch(pack, facts.yieldKg, facts.piecesPerBatch)}
                            container={(() => {
                                const component = containerOf(pack);
                                return component === undefined
                                    ? undefined
                                    : library.find(
                                          (entry) => String(entry.id) === component.ingredientId,
                                      );
                            })()}
                            nameOf={nameOf}
                            amountText={amountText}
                            library={library}
                            containerOptions={containers.map(containerOption)}
                            places={draft.places}
                            currencyOf={currencyOf}
                            cost={
                                facts.canViewCosts
                                    ? (facts.computed?.find((entry) => entry.key === pack.key) ??
                                      null)
                                    : undefined
                            }
                            canManage={canManage}
                            attempted={attempted}
                            serverError={(field) => serverError(`packs.${String(index)}.${field}`)}
                            onChange={(next) => {
                                patchPack(pack.key, next);
                            }}
                            onRemove={() => {
                                setDraft((current) => ({
                                    ...current,
                                    packs: current.packs.filter((entry) => entry.key !== pack.key),
                                }));
                            }}
                        />
                    ))}
                </Stack>
            </FormSection>
        </Stack>
    );
}

/* ── one pack ────────────────────────────────────────────────────────────────────────────────── */

export interface PackCardProps {
    readonly pack: PackDraft;
    readonly name: string;
    readonly perBatch: number | null;
    /** The container's packaging record, when it has one and it resolved. */
    readonly container: IngredientAdmin | undefined;
    readonly nameOf: (ingredientId: string) => string;
    readonly amountText: (quantity: number, unit: MeasureUnit) => string;
    /** Every packaging item, for the "+ Add" picker. */
    readonly library: readonly IngredientAdmin[];
    /** The containers no other pack uses, for "Choose container". */
    readonly containerOptions: readonly SelectOption[];
    readonly places: PacksDraft['places'];
    readonly currencyOf: (place: PricedPlace) => CurrencyCode | null;
    /** The server's cost; `null` while nothing is costed, `undefined` when costs are not shown. */
    readonly cost: RecipePackCost | null | undefined;
    readonly canManage: boolean;
    readonly attempted: boolean;
    readonly serverError: (field: string) => string | undefined;
    readonly onChange: (next: Partial<PackDraft>) => void;
    readonly onRemove: () => void;
    readonly testID: string;
}

/**
 * One pack: its name, code and how many a batch fills; the fill; the packaging it is made of; what
 * one costs; and a price for each place it sells.
 */
export function PackCard({
    pack,
    name,
    perBatch,
    container,
    nameOf,
    amountText,
    library,
    containerOptions,
    places,
    currencyOf,
    cost,
    canManage,
    attempted,
    serverError,
    onChange,
    onRemove,
    testID,
}: PackCardProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const containerPart = containerOf(pack);
    const extras = pack.components.filter((component) => !component.isContainer);
    const used = new Set(pack.components.map((component) => component.ingredientId));
    const partOptions: readonly SelectOption[] = library
        .filter((entry) => !used.has(String(entry.id)))
        .map((entry) => ({
            value: String(entry.id),
            label: displayName(entry.name, locale).value,
            ...(entry.reference === null ? {} : { keywords: entry.reference }),
        }));

    const capacity = container?.capacity == null ? null : fillFromCapacity(container.capacity);
    const fillChanged =
        container?.capacity != null &&
        capacity !== null &&
        parseQuantity(pack.fill) !== capacity.quantity;
    const fillError =
        serverError('fill') ??
        (attempted && fillInvalid(pack) ? t('kitchen:packs.fillInvalid') : undefined);

    // A margin is read only off a complete cost; a withheld one has none to read.
    const completeCost = cost != null && cost.withheldReason === null ? cost.cost : null;
    const shown = pricedPlacesShown(places);

    return (
        <Card testID={testID} padding="sm">
            <Stack space="sm">
                <View className="z-auto flex-row flex-wrap items-center gap-tight">
                    <Text testID={`${testID}-name`} variant="bodyStrong">
                        {name}
                    </Text>
                    {pack.code === '' ? null : (
                        <DeskChip testID={`${testID}-code`} tone="neutral" label={pack.code} />
                    )}
                    <View className="flex-1" />
                    {perBatch === null ? null : (
                        <Text testID={`${testID}-per-batch`} variant="caption" tone="secondary">
                            {t('kitchen:packs.perBatch', { count: perBatch })}
                        </Text>
                    )}
                    {canManage ? (
                        <DeskIconButton
                            testID={`${testID}-remove`}
                            label={t('kitchen:packs.remove', { name })}
                            icon={<Icon name="close" size="sm" />}
                            onPress={onRemove}
                        />
                    ) : null}
                </View>

                <View className="z-auto flex-row flex-wrap items-start gap-base">
                    <View className="w-40">
                        <QuantityInput
                            testID={`${testID}-fill`}
                            id={`${testID}-fill`}
                            label={t('kitchen:packs.fill')}
                            value={pack.fill}
                            unit={t(unitShortKey(pack.fillUnit))}
                            placeholder={capacity === null ? undefined : String(capacity.quantity)}
                            disabled={!canManage}
                            {...(fillError !== undefined
                                ? { error: fillError }
                                : fillChanged && container?.capacity != null
                                  ? {
                                        hint: t('kitchen:packs.containerHolds', {
                                            amount: amountText(
                                                container.capacity.quantity,
                                                container.capacity.unit,
                                            ),
                                        }),
                                    }
                                  : {})}
                            onChangeText={(next) => {
                                onChange({ fill: next });
                            }}
                        />
                    </View>

                    <View className="z-auto min-w-0 flex-1 flex-col gap-hair">
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:packs.packaging')}
                        </Text>
                        <View className="z-auto flex-row flex-wrap items-center gap-tight">
                            {containerPart === undefined ? (
                                canManage ? (
                                    <View className="z-auto w-56">
                                        <Select
                                            testID={`${testID}-choose-container`}
                                            id={`${testID}-choose-container`}
                                            label={t('kitchen:packs.chooseContainer')}
                                            labelHidden
                                            placeholder={t('kitchen:packs.chooseContainer')}
                                            searchable
                                            options={containerOptions}
                                            value={null}
                                            onChange={(ingredientId) => {
                                                onChange({
                                                    components: [
                                                        {
                                                            ingredientId,
                                                            quantity: 1,
                                                            isContainer: true,
                                                        },
                                                        ...pack.components,
                                                    ],
                                                });
                                            }}
                                        />
                                    </View>
                                ) : null
                            ) : (
                                <DeskChip
                                    testID={`${testID}-container`}
                                    tone="brand"
                                    label={nameOf(containerPart.ingredientId)}
                                />
                            )}
                            {extras.map((part) => (
                                <View
                                    key={part.ingredientId}
                                    className="flex-row items-center gap-hair"
                                >
                                    <DeskChip
                                        testID={`${testID}-part-${part.ingredientId}`}
                                        tone="neutral"
                                        label={nameOf(part.ingredientId)}
                                    />
                                    {canManage ? (
                                        <DeskIconButton
                                            flat
                                            testID={`${testID}-part-${part.ingredientId}-remove`}
                                            label={t('kitchen:packs.removePart', {
                                                name: nameOf(part.ingredientId),
                                            })}
                                            icon={<Icon name="close" size="sm" />}
                                            onPress={() => {
                                                onChange({
                                                    components: pack.components.filter(
                                                        (component) =>
                                                            component.ingredientId !==
                                                            part.ingredientId,
                                                    ),
                                                });
                                            }}
                                        />
                                    ) : null}
                                </View>
                            ))}
                            {canManage ? (
                                <View className="z-auto w-40">
                                    <Select
                                        testID={`${testID}-add-part`}
                                        id={`${testID}-add-part`}
                                        label={t('kitchen:packs.addPartLabel')}
                                        labelHidden
                                        placeholder={t('kitchen:packs.addPart')}
                                        searchable
                                        options={partOptions}
                                        value={null}
                                        onChange={(ingredientId) => {
                                            onChange({
                                                components: [
                                                    ...pack.components,
                                                    {
                                                        ingredientId,
                                                        quantity: 1,
                                                        isContainer: false,
                                                    },
                                                ],
                                            });
                                        }}
                                    />
                                </View>
                            ) : null}
                        </View>
                        {containerPart === undefined ? (
                            <Text
                                testID={`${testID}-no-container`}
                                variant="caption"
                                tone="warning"
                            >
                                {t('kitchen:packs.noContainer')}
                            </Text>
                        ) : null}
                        {serverError('components') === undefined ? null : (
                            <Text
                                testID={`${testID}-components-error`}
                                variant="caption"
                                tone="danger"
                            >
                                {serverError('components')}
                            </Text>
                        )}
                    </View>

                    {cost === undefined ? null : (
                        <View className="w-56">
                            <CostCard
                                testID={`${testID}-cost`}
                                title={t('kitchen:packs.costTitle')}
                                tone="raised"
                                rows={packCostRows(cost, t, formatter)}
                            />
                        </View>
                    )}
                </View>

                {shown.length === 0 ? null : (
                    <View className="z-auto flex-row flex-wrap items-start gap-base border-t border-stroke-subtle pt-tight">
                        {shown.map((place) => {
                            const fieldId = packsTargets.price(pack.key, place);
                            const typed = pack.prices[place];
                            const amount = parseAmount(typed);
                            const margin =
                                completeCost === null
                                    ? null
                                    : packMargin(
                                          typeof amount === 'number' ? amount : null,
                                          completeCost.amount,
                                      );
                            const error =
                                serverError(`prices.${place}`) ??
                                (attempted && priceInvalid(typed)
                                    ? t('kitchen:packs.priceInvalid')
                                    : undefined);
                            const currency = currencyOf(place);
                            return (
                                <View key={place} className="w-56 flex-col gap-hair">
                                    <QuantityInput
                                        testID={fieldId}
                                        id={fieldId}
                                        label={t(
                                            place === 'home'
                                                ? 'kitchen:packs.placeHome'
                                                : 'kitchen:packs.placeBusiness',
                                        )}
                                        placeholder={t('kitchen:packs.notSold')}
                                        value={typed}
                                        disabled={!canManage}
                                        {...(currency === null ? {} : { unit: currency })}
                                        {...(error === undefined ? {} : { error })}
                                        onChangeText={(next) => {
                                            onChange({
                                                prices: { ...pack.prices, [place]: next },
                                                inherited: { ...pack.inherited, [place]: false },
                                            });
                                        }}
                                    />
                                    {margin === null || completeCost === null ? null : (
                                        <Text
                                            testID={`${fieldId}-margin`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t('kitchen:packs.margin', {
                                                percent: margin.percent,
                                                amount: formatMoney(
                                                    formatter,
                                                    margin.amount,
                                                    completeCost.currency,
                                                    {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    },
                                                ),
                                            })}
                                        </Text>
                                    )}
                                    {pack.inherited[place] ? (
                                        <Text
                                            testID={`${fieldId}-inherited`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t('kitchen:packs.inherited')}
                                        </Text>
                                    ) : null}
                                    {place === 'home' && places.counter ? (
                                        <Text
                                            testID={`${fieldId}-counter`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t('kitchen:packs.counterCharges')}
                                        </Text>
                                    ) : null}
                                </View>
                            );
                        })}
                    </View>
                )}
            </Stack>
        </Card>
    );
}

/** The cost tile's rows: the three figures, or what is known and why the rest is not. */
function packCostRows(
    cost: RecipePackCost | null,
    t: TFunction,
    formatter: Formatter,
): readonly CostCardRow[] {
    const money = (amount: CostAmount | null) =>
        amount === null
            ? t('kitchen:list.noValue')
            : formatMoney(formatter, amount.amount, amount.currency, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              });
    if (cost === null) {
        return [
            { label: t('kitchen:packs.costPerPack'), value: t('kitchen:list.noValue'), lead: true },
        ];
    }
    if (cost.withheldReason === null) {
        return [
            { label: t('kitchen:packs.costContents'), value: money(cost.contents), lead: false },
            { label: t('kitchen:packs.costPackaging'), value: money(cost.packaging), lead: false },
            { label: t('kitchen:packs.costPerPack'), value: money(cost.cost), lead: true },
        ];
    }
    return [
        ...(cost.contents === null
            ? []
            : [
                  {
                      label: t('kitchen:packs.costContents'),
                      value: money(cost.contents),
                      lead: false,
                  },
              ]),
        { label: t(`kitchen:packs.withheld.${cost.withheldReason}`), value: '', lead: true },
    ];
}

/* ── the Costing tab's table ─────────────────────────────────────────────────────────────────── */

/**
 * Costing's "Each pack": Pack (name and fill) · Cost · Home shop · Business, each price with its
 * margin. No Counter column — it charges the Home shop's price.
 */
export function PackCostTable({
    report,
    computed,
    testID,
}: {
    readonly report: PacksReport;
    readonly computed: readonly RecipePackCost[] | null;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const dash = t('kitchen:list.noValue');
    const costOf = (key: string) => computed?.find((entry) => entry.key === key) ?? null;
    const money = (amount: number, currency: CurrencyCode | null) =>
        formatMoney(formatter, amount, currency, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });

    const priceCell = (row: PackSummary, place: PricedPlace) => {
        const price = row.prices[place];
        if (!report.shownPlaces.includes(place) || price === null) return dash;
        const cost = costOf(row.key);
        const margin =
            cost?.cost != null && cost.withheldReason === null
                ? packMargin(price, cost.cost.amount)
                : null;
        return margin === null
            ? money(price, report.currency)
            : t('kitchen:packs.priceWithMargin', {
                  price: money(price, report.currency),
                  percent: margin.percent,
              });
    };

    const columns: readonly DataListColumn<PackSummary>[] = [
        {
            key: 'pack',
            label: t('kitchen:packs.columnPack'),
            width: 200,
            fill: true,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => (
                <Text testID={`${testID}-${row.key}-pack`} numberOfLines={1}>
                    {row.fill === ''
                        ? row.name
                        : t('kitchen:packs.packWithFill', { name: row.name, fill: row.fill })}
                </Text>
            ),
        },
        {
            key: 'cost',
            label: t('kitchen:packs.columnCost'),
            width: 120,
            mono: true,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => {
                const cost = costOf(row.key);
                return (
                    <Text testID={`${testID}-${row.key}-cost`} variant="mono">
                        {cost?.cost == null ? dash : money(cost.cost.amount, cost.cost.currency)}
                    </Text>
                );
            },
        },
        ...PRICED_PLACES.map((place) => ({
            key: place,
            label: t(place === 'home' ? 'kitchen:packs.placeHome' : 'kitchen:packs.placeBusiness'),
            width: 150,
            mono: true,
            priority: UNDROPPABLE_PRIORITY,
            render: (row: PackSummary) => (
                <Text testID={`${testID}-${row.key}-${place}`} variant="mono">
                    {priceCell(row, place)}
                </Text>
            ),
        })),
    ];

    if (report.summary.length === 0) {
        return (
            <Text testID={`${testID}-empty`} variant="caption" tone="secondary">
                {t('kitchen:packs.empty')}
            </Text>
        );
    }
    return (
        <DataList<PackSummary>
            testID={testID}
            label={t('kitchen:packs.costingTitle')}
            columns={columns}
            rows={report.summary}
            rowKey={(row) => row.key}
            density="sm"
        />
    );
}
