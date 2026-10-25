import type {
    CostAmount,
    IngredientAdmin,
    LocalisedText,
    RecipeCostHalf,
    RecipeLineCost,
} from '@healthy360/api-client/contracts';
import { PACKAGING_CATEGORY_CODE } from '@healthy360/api-client/contracts';
import {
    Button,
    DataList,
    Icon,
    IconButton,
    Select,
    Text,
    UNDROPPABLE_PRIORITY,
    growWeights,
    inputControlClass,
    inputFrameClassName,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

import { useIngredientWholeSetQuery } from '../../data/kitchen-admin-hooks.ts';
import { displayName, formatMoney, humaniseCode, parseQuantity, unitShortKey } from './format.ts';
import { useIngredientQuickAdd } from './ingredient-quick-add.tsx';

/**
 * One row of a recipe's line table, as typed.
 *
 * Declared here rather than shared: this table replaced the three per-row editors that used to own
 * this shape, and it is now the only thing that types a recipe line.
 *
 * `quantity` is text rather than a number for the reason `parseQuantity` documents — a half-typed
 * `0.` is a legal thing to be in the middle of writing and is not a number yet.
 */
/**
 * What the table needs from a catalogue row, and nothing more.
 *
 * The two tabs draw from one table read two ways — `ingredients` excluding the packaging branch for
 * the formulation, that branch alone for the boxes — and the table itself does not care which. It
 * needs an id, a name, the unit a quantity is counted in, **a price quoted against that same unit**,
 * and a grey run of context beside the name.
 *
 * The normalisation is where the two families are reconciled, and the unit/price pairing is the whole
 * reason it exists: food records a list price per issued unit, packaging records a price per purchase
 * pack. {@link packagingEntry} divides one into the other so both arms of this type mean the same
 * thing, and a row's arithmetic never has to ask which family it came from.
 */
export interface PickerEntry {
    readonly id: string;
    readonly name: LocalisedText;
    /** The unit a new line starts in, and the one {@link unitPrice} is quoted against. */
    readonly unit: MeasureUnit;
    /**
     * What one {@link unit} is listed at, drawn beside each option while picking. `null` where
     * nothing is recorded. A drawn row never reads it: its figures are the server's (see
     * {@link RecipeLineTableProps.costs}).
     */
    readonly unitPrice: CostAmount | null;
    /**
     * How much product one item holds, in the recipe's own unit. `null` on everything but packaging
     * that holds something measurable — the Costing tab's per-package figure is built on it.
     */
    readonly capacity: { readonly quantity: number; readonly unit: MeasureUnit } | null;
    /** The grey run beside the name — `Condiments · kg`, `Bags · piece`. */
    readonly meta: string;
    /** The catalogue reference — `ING-002`, `PKG-014` — drawn beside the designation on a row. */
    readonly reference: string | null;
}

export interface LineDraft {
    /** Stable within the session. Never the array index, never random. */
    readonly key: string;
    /**
     * The catalogue row this line names — an ingredient id on the formulation table, a packaging
     * item id on the packaging one. A plain string because the table serves both, and the screen
     * brands it back at the boundary where it knows which it is holding.
     */
    readonly ingredientId: string | null;
    readonly quantity: string;
    readonly unit: MeasureUnit;
    /** `sourceDesignation` — the Comments column: what the kitchen's own sheet wrote here. */
    readonly note: string;
    readonly isOptional: boolean;
}

/**
 * The recipe editor's line table — `Catalogue.dc.html`'s `tabLines`, both of its uses.
 *
 * ```
 * Raw materials  Type to add — the picker stays inline, no modal
 * [ Add an ingredient…            320px ]
 * Designation            Unit  Qty   Unit price  Total   Comments          ⋯
 * Mayonnaise   IG-019    kg    [ 1 ] [ 3.50   ]  3.500   Fine dice         ✕
 * …
 * Total                        3.553             10.636
 * ```
 *
 * Sentence case throughout — the Catalogue's `micro` role dropped its uppercasing, so the header row
 * reads as the words the catalogue itself uses rather than as a shout.
 *
 * One component for Production and Packaging, because the design draws one table twice and varies
 * only its title, its hint and its picker placeholder. Two copies would be two chances for the Qty
 * column to drift by a pixel.
 *
 * ## The picker is the admin's `Select searchable`
 *
 * "Type to add — the picker stays inline, no modal" is written on the section itself, and the web
 * `Select` is that: a 320px field with a panel hanging under it and the filter box inside the panel —
 * the control every other line editor in the admin adds rows with. It holds no value and always reads
 * as its placeholder, because picking from it is an action: it adds a row.
 *
 * It filters the catalogue half in hand (`useIngredientWholeSetQuery`) instead of asking the server
 * per keystroke. The bespoke picker it replaced debounced a request per word and re-rendered a
 * hundred rows per answer, which is what made typing in it lag.
 *
 * ## What each column can actually do
 *
 * | column     | source                                    | editable |
 * | ---------- | ----------------------------------------- | -------- |
 * | Designation| the resolved ingredient                   | picker   |
 * | Unit       | `RecipeLine.unit`                         | no       |
 * | Qty        | `RecipeLine.quantity`                     | yes      |
 * | Unit price | the server's unit cost, per the line's unit | no       |
 * | Total      | the server's line cost                     | derived  |
 * | Comments   | `RecipeLine.sourceDesignation`            | yes      |
 *
 * **Unit price is read, not typed**, and that is a contract fact rather than a design deviation.
 * `RecipeLineInput` carries an ingredient, a quantity, a unit, a source designation and an optional
 * flag — and no money. A line costs what the ingredient costs; the design draws the figure in a box
 * because its prototype holds its own array, and typing into it here would edit a number that has
 * nowhere to be saved and would silently disagree with the ingredient record on the next reload.
 * So it renders as a figure on the sunken fill: same track, same alignment, no false affordance.
 *
 * **Both money columns are the server's figures, never this table's arithmetic.** They were computed
 * here from the ingredient's list price while the Costing tab's totals came from its purchase price,
 * so a row and the total it rolled into could disagree about what an ingredient costs. The server
 * prices the draft once (`RecipeCostingService::lineCostsOf`) and this draws what it said.
 *
 * **The unit follows the ingredient.** A line's unit has to be convertible to the ingredient's own
 * dimension or the roll-up cannot resolve it, so picking an ingredient sets the unit from its
 * record. Editing it is the per-row control the previous editor carried and this table does not:
 * `Catalogue.dc.html` draws Unit as text, and every line in the source sheets is in the
 * ingredient's own unit.
 *
 * ## Comments is `sourceDesignation`
 *
 * The design's Comments column and the contract's `sourceDesignation` are the same column: "as
 * written on the sheet". The spreadsheet the kitchen works from puts *Fine dice*, *Juice only*,
 * *Dried* there — a note about this line's use of the ingredient, kept verbatim beside the resolved
 * record. It is the field the import fills and the one thing on a row that cannot be re-derived.
 */

/**
 * Whether a row is complete enough to send: something picked, and a quantity that parses.
 *
 * One definition for the editor and this table, because the server numbers the lines it is sent from
 * 1 in the order they arrive. A table matching those numbers back to rows has to skip exactly the
 * rows the editor left out of the request, or every figure after an unfinished row lands one row low.
 */
export function isSendableLine(
    row: LineDraft,
): row is LineDraft & { readonly ingredientId: string } {
    return row.ingredientId !== null && parseQuantity(row.quantity) !== null;
}

export interface RecipeLineTableProps {
    readonly rows: readonly LineDraft[];
    /**
     * The pool a *drawn row* resolves its designation and unit price from.
     *
     * Not what the picker offers — the picker runs its own search (see below). This is the set the
     * screen has already resolved: the first page of the catalogue plus the specific rows its lines
     * name.
     */
    readonly ingredients: readonly PickerEntry[];
    /**
     * Which half of the catalogue the picker searches.
     *
     * One table, read from opposite ends: `ingredients` excludes the packaging branch, `packaging`
     * asks for it. Still a named source rather than a raw category filter, because the two also
     * differ in how a row is *priced* — see {@link ingredientEntry} and {@link packagingEntry}.
     */
    readonly source?: 'ingredients' | 'packaging' | undefined;
    /**
     * Ingredients the roll-up could not finish with — no reference facts, or nothing to weigh them
     * by. The rows naming one get a mark, so the warning list above and the row at fault are the
     * same piece of information rather than two lists a reader has to cross-reference.
     */
    readonly flaggedIngredientIds?: readonly string[] | undefined;
    /**
     * Mark a line whose quantity is zero — the Catalogue Forms packaging warning. The row takes the
     * warning fill, its Qty cell the warning border, and the designation a mark whose accessible
     * name says why. Packaging only in practice: a sleeve label at `0` is a line that costs nothing
     * and ships nothing, which is almost always a count somebody meant to type. A zero raw material
     * is refused outright on save, so it needs no second signal here.
     */
    readonly warnZeroQuantity?: boolean | undefined;
    /**
     * The server's figures for these rows — the half of the draft's `computedCost` this table lists.
     *
     * `null` draws a dash in every money cell: nothing costed yet, nothing to divide by, or costs this
     * member may not see. A dash and not a zero, because a zero is a measurement.
     */
    readonly costs: RecipeCostHalf | null;
    /**
     * A server refusal of one row (BUG-06): `line` for the row as a whole (its ingredient or unit),
     * or the cell it names. A 24px cell has no room for a sentence, so the cell turns red and the
     * message is listed under the table beside the row's designation.
     */
    readonly fieldError?: ((row: LineDraft, column: LineColumn) => string | undefined) | undefined;
    /**
     * What is wrong with a row's quantity before anything is sent — a blank the save stopped on, or
     * the line a stock gap is about. Drawn under the row's Qty cell, which turns red with it: the
     * reader is taken to that cell, so the reason has to be standing there too.
     */
    readonly quantityMessage?: ((row: LineDraft) => string | undefined) | undefined;
    /**
     * What the row's ingredient still owes the recipe — no allergens recorded, no price — said
     * under its designation in one short line. Fixed on the ingredient, not here, so the line is a
     * link to it (see {@link onOpenIngredient}).
     */
    readonly ingredientIssue?: ((row: LineDraft) => string | undefined) | undefined;
    /**
     * Opens the row's ingredient. With it, every designation is a link — the row's name is where a
     * reader looks for "what is this, and why is it flagged".
     */
    readonly onOpenIngredient?: ((row: LineDraft) => void) | undefined;
    readonly canManage: boolean;
    /** Mints a stable row key. The editor owns the counter so keys never collide across tables. */
    readonly nextKey: () => string;
    readonly onChange: (rows: readonly LineDraft[]) => void;
    /** Translated placeholder for the picker — "Add an ingredient…" / "Add packaging…". */
    readonly pickerPlaceholder: string;
    /**
     * Offers **Add** beside the picker when a typed name matches nothing (food only — see
     * {@link useIngredientQuickAdd}). Called once the new row exists and its line is on the table,
     * so the screen can say what was created and where to verify it.
     */
    readonly onIngredientCreated?:
        ((ingredient: IngredientAdmin, needsDetails: boolean) => void) | undefined;
    readonly testID: string;
}

/** What a server refusal of one row can be about. */
export type LineColumn = 'line' | 'quantity' | 'comment';

/**
 * The element id of one row's cell input — its testID, which the cell also carries as `nativeID`,
 * so `focusField` can take the reader to it.
 */
export function lineCellId(tableTestID: string, rowKey: string, cell: 'qty' | 'comment'): string {
    return `${tableTestID}-row-${rowKey}-${cell}`;
}

/**
 * An ingredient as the picker sees it.
 *
 * The grey run is `Condiments · kg` — what kind of thing this is and what a quantity of it will be
 * counted in. Two facts rather than one, because "Mayonnaise" appears twice in a library of three
 * hundred and the unit is what decides whether `1` means a kilo or a bottle.
 */
export function ingredientEntry(entry: IngredientAdmin): PickerEntry {
    return {
        id: String(entry.id),
        name: entry.name,
        unit: entry.measurementUnit,
        unitPrice: entry.unitPrice,
        capacity: entry.capacity,
        meta: entry.categoryCode === '' ? '' : humaniseCode(entry.categoryCode),
        reference: entry.reference,
    };
}

/**
 * A packaging item as the picker sees it — priced **per issued item**, not per pack.
 *
 * `purchasePrice` is what a *pack* costs (a sleeve at $6.50) and `itemsPerUnit` is how many items are
 * in it, so one bag is the quotient. That is the side the server takes:
 * `RecipeVersionService::packagingCostOf` prices a packaging line at pack price ÷ items per unit and
 * stores the line in the item's **default** unit, which is `measurementUnit`. This used to carry the
 * pack price against the purchase unit and argue for it in a docblock; against a line counted in
 * pieces that overstates a packaging cost by `itemsPerUnit` — fifty-fold on a sleeve of fifty.
 *
 * `null` where no pack price is recorded, so the row reads as uncosted rather than free. The
 * quotient stays in the pack's own currency.
 *
 * The grey run leads with the leaf — `Bags`, `Containers` — because on this tab every row shares
 * one top-level category and the leaf is the only thing that distinguishes them.
 */
export function packagingEntry(entry: IngredientAdmin): PickerEntry {
    const perPack = entry.purchasePrice;
    const perItem = entry.itemsPerUnit !== null && entry.itemsPerUnit > 0 ? entry.itemsPerUnit : 1;

    return {
        id: String(entry.id),
        name: entry.name,
        unit: entry.measurementUnit,
        unitPrice:
            perPack === null
                ? null
                : { amount: perPack.amount / perItem, currency: perPack.currency },
        capacity: entry.capacity,
        // The leaf's code, humanised. The packaging table used to denormalise a resolved name onto
        // every row; the ingredient wire carries codes, and this picker's grey run is one line of
        // context rather than a field anybody reads back.
        meta: humaniseCode(entry.subcategoryCode ?? entry.categoryCode),
        reference: entry.reference,
    };
}

export function RecipeLineTable({
    rows,
    ingredients,
    source = 'ingredients',
    flaggedIngredientIds = [],
    warnZeroQuantity = false,
    costs,
    fieldError,
    quantityMessage,
    ingredientIssue,
    onOpenIngredient,
    canManage,
    nextKey,
    onChange,
    pickerPlaceholder,
    onIngredientCreated,
    testID,
}: RecipeLineTableProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const byId = useMemo(() => {
        const map = new Map<string, PickerEntry>();
        for (const entry of ingredients) map.set(String(entry.id), entry);
        return map;
    }, [ingredients]);

    const wantsIngredients = source === 'ingredients';

    /*
     * The whole half of the catalogue the picker offers — every page, not the first hundred, so
     * every row can be found by typing its name.
     *
     * No status filter: a picker that cannot offer a row the kitchen has flagged for review hides
     * exactly the row somebody is most likely to be looking for. Archived rows are already excluded
     * by the endpoint's own default. Food excludes the packaging branch, packaging asks for it, and
     * the repository refuses an exclusion it cannot resolve, so neither list can widen by accident.
     */
    const catalogue = useIngredientWholeSetQuery(
        wantsIngredients
            ? { excludeCategoryCode: PACKAGING_CATEGORY_CODE }
            : { categoryCode: PACKAGING_CATEGORY_CODE },
        canManage,
    );

    const offered = useMemo(() => {
        const byOption = new Map<string, PickerEntry>();
        const options: SelectOption[] = [];
        for (const row of catalogue.data ?? []) {
            const entry = wantsIngredients ? ingredientEntry(row) : packagingEntry(row);
            byOption.set(entry.id, entry);
            const price =
                entry.unitPrice === null
                    ? ''
                    : formatMoney(
                          formatter,
                          entry.unitPrice.amount,
                          entry.unitPrice.currency,
                          MONEY,
                      );
            options.push({
                value: entry.id,
                label: displayName(entry.name, locale).value,
                // `Condiments · kg · 3.50`: what kind of thing it is, and what one unit costs.
                description: [entry.meta, price].filter((part) => part !== '').join(' · '),
                // What the server's search matched on: both names, the reference and the aliases.
                keywords: [row.name.en, row.name.ar, row.reference ?? '', ...row.aliases].join(' '),
            });
        }
        return { options, byOption };
    }, [catalogue.data, wantsIngredients, formatter, locale]);

    /*
     * Each row's figures, matched by line number *and* ingredient.
     *
     * The n-th sendable row is line n (see {@link isSendableLine}). The ingredient check covers the
     * moment between an edit and its answer: remove row 2 and, until the refetch lands, line 2 is
     * still the ingredient that was removed. A dash for that moment beats a neighbour's price.
     */
    const figures = useMemo(() => {
        const byKey = new Map<string, RecipeLineCost>();
        if (costs === null) return byKey;
        let lineNumber = 0;
        for (const row of rows) {
            if (!isSendableLine(row)) continue;
            lineNumber += 1;
            const figure = costs.lines.find((line) => line.lineNumber === lineNumber);
            if (figure !== undefined && String(figure.ingredientId) === row.ingredientId) {
                byKey.set(row.key, figure);
            }
        }
        return byKey;
    }, [rows, costs]);

    const totalQuantity = rows.reduce((sum, row) => sum + (parseQuantity(row.quantity) ?? 0), 0);

    const money = (amount: CostAmount | null, digits: Intl.NumberFormatOptions): string =>
        amount === null
            ? t('kitchen:list.noValue')
            : // Each figure in its own currency: the server states one per amount.
              formatMoney(formatter, amount.amount, amount.currency, digits);

    /*
     * The rows as of the latest render. A quick add lands seconds after its press, and appending to
     * the rows its callback closed over would drop every edit made while it ran.
     */
    const latestRows = useRef(rows);
    useEffect(() => {
        latestRows.current = rows;
    });

    const add = (entry: PickerEntry) => {
        onChange([
            ...latestRows.current,
            {
                key: nextKey(),
                ingredientId: entry.id,
                quantity: '1',
                // The ingredient's own unit: a line in a dimension the ingredient cannot convert to
                // is a roll-up warning, and defaulting to one is how a table fills with them.
                unit: entry.unit,
                note: '',
                isOptional: false,
            },
        ]);
    };

    const patch = (key: string, next: Partial<LineDraft>) => {
        onChange(rows.map((row) => (row.key === key ? { ...row, ...next } : row)));
    };

    const remove = (key: string) => {
        onChange(rows.filter((row) => row.key !== key));
    };

    const rowTestId = (row: LineDraft) => `${testID}-row-${row.key}`;
    const nameOf = (row: LineDraft): string => {
        const entry = row.ingredientId === null ? undefined : byId.get(String(row.ingredientId));
        return entry === undefined
            ? t('kitchen:recipes.unnamedLine')
            : displayName(entry.name, locale).value;
    };
    const refusals = rows.flatMap((row) => {
        const messages = (['line', 'quantity', 'comment'] as const)
            .map((column) => fieldError?.(row, column))
            .filter((message): message is string => message !== undefined);
        return messages.length === 0 ? [] : [{ row, message: [...new Set(messages)].join(' ') }];
    });
    const isZero = (row: LineDraft) => warnZeroQuantity && parseQuantity(row.quantity) === 0;
    const removeLabel = t('kitchen:recipes.removeLine');

    /*
     * Every column is pinned (priority >= `UNDROPPABLE_PRIORITY`): a recipe line with its unit or
     * its total dropped is a line that can no longer be checked against the sheet it came from, so
     * a narrow port scrolls the table rather than thinning it.
     *
     * The two cell inputs are padded off the row's edges, as every DataList control is: a cell has
     * no vertical padding of its own, so a 24px box in the 28px `sm` row sat on both hairlines.
     * `py-hair` makes it the 32px row the design draws.
     */
    const columns: readonly DataListColumn<LineDraft>[] = [
        {
            key: 'name',
            label: t('kitchen:list.columnName'),
            width: COLUMN_WIDTH.name,
            priority: 100,
            render: (row) => {
                const entry =
                    row.ingredientId === null ? undefined : byId.get(String(row.ingredientId));
                const name =
                    entry === undefined
                        ? t('kitchen:recipes.unnamedLine')
                        : displayName(entry.name, locale).value;
                const issue = ingredientIssue?.(row);
                const opens = onOpenIngredient !== undefined && row.ingredientId !== null;
                const open = () => {
                    onOpenIngredient?.(row);
                };
                return (
                    <View className="min-w-0 flex-1 flex-col py-hair">
                        <View className="min-w-0 flex-row items-baseline gap-hair">
                            {opens ? (
                                <Pressable
                                    testID={`${rowTestId(row)}-open`}
                                    role="link"
                                    accessibilityRole="link"
                                    accessibilityLabel={t('kitchen:recipes.openIngredient', {
                                        name,
                                    })}
                                    onPress={open}
                                    className="min-w-0 shrink"
                                >
                                    <RNText
                                        testID={`${rowTestId(row)}-name`}
                                        numberOfLines={1}
                                        className="text-role-body font-medium text-content-primary underline decoration-stroke-strong hover:decoration-current"
                                    >
                                        {name}
                                    </RNText>
                                </Pressable>
                            ) : (
                                <Text
                                    variant="label"
                                    numberOfLines={1}
                                    testID={`${rowTestId(row)}-name`}
                                >
                                    {name}
                                </Text>
                            )}
                            {entry?.reference == null ? null : (
                                <Text variant="micro" tone="secondary">
                                    {entry.reference}
                                </Text>
                            )}
                            {row.ingredientId !== null &&
                            flaggedIngredientIds.includes(String(row.ingredientId)) ? (
                                <Icon
                                    testID={`${rowTestId(row)}-flag`}
                                    name="warning"
                                    size="sm"
                                    className="text-warning-strong"
                                />
                            ) : null}
                            {isZero(row) ? (
                                <Icon
                                    testID={`${rowTestId(row)}-zero`}
                                    name="warning"
                                    size="sm"
                                    label={t('kitchen:forms.zeroQuantity')}
                                    className="text-warning-strong"
                                />
                            ) : null}
                        </View>
                        {/*
                         * What the ingredient still owes, and the way to it in the same line: the
                         * reader is told what is wrong and where it is fixed without having to know
                         * that an ingredient has a page of its own.
                         */}
                        {issue === undefined ? null : (
                            <Pressable
                                testID={`${rowTestId(row)}-issue`}
                                role="link"
                                accessibilityRole="link"
                                accessibilityLabel={t('kitchen:recipes.fixIngredient', {
                                    name,
                                    issue,
                                })}
                                disabled={!opens}
                                onPress={open}
                                className="min-w-0 flex-row items-center gap-hair"
                            >
                                <Icon name="warning" size="sm" className="text-warning-strong" />
                                <RNText
                                    numberOfLines={1}
                                    className="min-w-0 shrink text-role-caption text-warning-strong hover:underline"
                                >
                                    {opens
                                        ? t('kitchen:recipes.ingredientIssueFix', { issue })
                                        : issue}
                                </RNText>
                            </Pressable>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'unit',
            label: t('kitchen:list.columnUnit'),
            width: COLUMN_WIDTH.unit,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            render: (row) => (
                <Text tone="secondary" numberOfLines={1}>
                    {t(unitShortKey(row.unit))}
                </Text>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:recipes.sheetColQuantityShort'),
            width: COLUMN_WIDTH.quantity,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            mono: true,
            render: (row) => {
                const message = quantityMessage?.(row);
                return (
                    <View className="w-full flex-col gap-hair py-hair">
                        <CellInput
                            testID={lineCellId(testID, row.key, 'qty')}
                            value={row.quantity}
                            disabled={!canManage}
                            error={fieldError?.(row, 'quantity') ?? message}
                            align="center"
                            mono
                            // The zero warning lives here and on the designation's mark: `DataList`
                            // draws its own row, so the old row-wide fill has nowhere to go.
                            caution={isZero(row)}
                            label={t('kitchen:recipes.lineQuantity')}
                            placeholder={t('kitchen:fields.quantityPlaceholder')}
                            onChangeText={(next) => {
                                patch(row.key, { quantity: next });
                            }}
                        />
                        {/* `DataList` rows are a height floor, so the row grows to hold it. */}
                        {message === undefined ? null : (
                            <Text
                                testID={`${lineCellId(testID, row.key, 'qty')}-error`}
                                variant="caption"
                                tone="danger"
                            >
                                {message}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            /*
             * A figure, not a field. See the note above: a line carries no price of its own on this
             * contract, so a box here would be a control with nowhere to write.
             */
            key: 'unitPrice',
            label: t('kitchen:list.columnUnitPrice'),
            width: COLUMN_WIDTH.unitPrice,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            mono: true,
            render: (row) => (
                <Text variant="mono" numberOfLines={1} testID={`${rowTestId(row)}-unit-price`}>
                    {money(figures.get(row.key)?.unitCost ?? null, UNIT_COST)}
                </Text>
            ),
        },
        {
            key: 'total',
            label: t('kitchen:recipes.sheetColLineTotalLong'),
            width: COLUMN_WIDTH.total,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            mono: true,
            render: (row) => (
                <Text variant="mono" numberOfLines={1} testID={`${rowTestId(row)}-total`}>
                    {money(figures.get(row.key)?.lineCost ?? null, LINE_TOTAL)}
                </Text>
            ),
        },
        {
            key: 'comments',
            label: t('kitchen:recipes.sheetColComments'),
            width: COLUMN_WIDTH.comments,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => (
                <View className="w-full py-hair">
                    <CellInput
                        testID={lineCellId(testID, row.key, 'comment')}
                        value={row.note}
                        disabled={!canManage}
                        error={fieldError?.(row, 'comment')}
                        quiet
                        placeholder={t('kitchen:list.noValue')}
                        label={t('kitchen:recipes.lineNote')}
                        onChangeText={(next) => {
                            patch(row.key, { note: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'remove',
            label: removeLabel,
            width: COLUMN_WIDTH.remove,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            align: 'end',
            // No visible header: the ✕ says what it does, and "Remove" in a 44px track clips to a
            // letter. The column is still named for a screen reader.
            renderHeader: () => <View accessibilityLabel={removeLabel} />,
            render: (row) =>
                canManage ? (
                    <IconButton
                        testID={`${rowTestId(row)}-remove`}
                        label={removeLabel}
                        variant="ghost"
                        tone="danger"
                        size="sm"
                        icon={<Icon name="close" size="sm" />}
                        onPress={() => {
                            remove(row.key);
                        }}
                    />
                ) : null,
        },
    ];

    const quickAdd = useIngredientQuickAdd({
        testID: `${testID}-quick-add`,
        onPick: (ingredient) => {
            add(ingredientEntry(ingredient));
        },
        onCreated: (ingredient, needsDetails) => {
            add(ingredientEntry(ingredient));
            onIngredientCreated?.(ingredient, needsDetails);
        },
        onRefresh: () => {
            void catalogue.refetch();
        },
    });
    const offersQuickAdd = onIngredientCreated !== undefined && wantsIngredients;

    return (
        <View className="flex-col gap-tight">
            {canManage ? (
                // It wraps, so the quick add's answer sits beneath the picker.
                <View className="flex-row flex-wrap items-center gap-tight">
                    <View style={{ width: PICKER_WIDTH }}>
                        <Select
                            testID={`${testID}-picker`}
                            label={pickerPlaceholder}
                            labelHidden
                            placeholder={pickerPlaceholder}
                            searchable
                            loading={catalogue.isPending}
                            options={offered.options}
                            value={null}
                            onChange={(id) => {
                                const entry = offered.byOption.get(id);
                                if (entry !== undefined) add(entry);
                            }}
                            // A typed name the library does not have: create it from the panel.
                            {...(offersQuickAdd
                                ? {
                                      noResultsAction: (typed: string, close: () => void) => (
                                          <Button
                                              testID={`${testID}-quick-add`}
                                              size="sm"
                                              variant="secondary"
                                              label={t('kitchen:recipes.quickAddNamed', {
                                                  name: typed,
                                              })}
                                              hint={t('kitchen:recipes.quickAddHint', {
                                                  name: typed,
                                              })}
                                              iconStart={<Icon name="plus" size="sm" />}
                                              disabled={quickAdd.busy}
                                              onPress={() => {
                                                  close();
                                                  quickAdd.start(typed);
                                              }}
                                          />
                                      ),
                                  }
                                : {})}
                        />
                    </View>
                    {offersQuickAdd ? quickAdd.view : null}
                </View>
            ) : null}

            <View>
                {/*
                 * `testID` goes on the list itself rather than on a wrapper, so a row is still
                 * `${testID}-row-${key}` — the id `DataList` mints from its own id and the row key.
                 */}
                <DataList<LineDraft>
                    testID={testID}
                    label={t(
                        wantsIngredients
                            ? 'kitchen:recipes.sectionRawMaterials'
                            : 'kitchen:recipes.sectionPackaging',
                    )}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    density="sm"
                    emptyState={
                        <View
                            testID={`${testID}-empty`}
                            className="border-b border-stroke-subtle px-control-sm py-snug"
                        >
                            <Text tone="secondary" variant="caption">
                                {t('kitchen:recipes.linesEmpty')}
                            </Text>
                        </View>
                    }
                />

                {rows.length === 0 ? null : (
                    <TotalsRow
                        testID={`${testID}-totals`}
                        columns={columns}
                        label={t('kitchen:recipes.sheetTotalRow')}
                        quantity={formatter.formatNumber(totalQuantity, LINE_TOTAL)}
                        cost={money(costs?.total ?? null, LINE_TOTAL)}
                    />
                )}
            </View>

            {/* `nativeID`: a refused save with no cell to land on scrolls here. */}
            {refusals.length === 0 ? null : (
                <View nativeID={`${testID}-refusals`} className="flex-col gap-hair">
                    {refusals.map(({ row, message }) => (
                        <View
                            key={row.key}
                            testID={`${rowTestId(row)}-error`}
                            className="flex-row flex-wrap gap-tight"
                        >
                            <Text variant="caption" tone="danger">
                                {nameOf(row)}
                            </Text>
                            <Text variant="caption" tone="danger">
                                {message}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------------------------------- */

/**
 * The design's tracks, in dp, as `DataList` widths — each the design's content width plus the
 * cell's `px-control-sm` either side (16), which stands in for the 8px gap the hand-drawn row put
 * between tracks.
 *
 * Designation and Comments are the two that flex, `1.7fr` / `1.3fr` in the design: they are the
 * only growable columns, and `DataList` shares a row's slack between growable columns in proportion
 * to their widths, so 170 : 130 is that ratio. Everything between them is `grow: false`, because a
 * Qty box that changed width with the window is a column the eye cannot run down. The action track
 * is one `sm` icon button.
 */
const COLUMN_WIDTH = {
    name: 170,
    unit: 68,
    quantity: 84,
    unitPrice: 96,
    total: 96,
    comments: 130,
    remove: 44,
} as const;

/** A picker's list price reads at two decimals; a line total at three — the source sheets' own. */
const MONEY: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
/**
 * A row's unit cost, to four. It is per the *line's* unit, so a line written in grams against a
 * per-kilogram price costs 0.0079 a gram — which two decimals would print as 0.01.
 */
const UNIT_COST: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 4 };
const LINE_TOTAL: Intl.NumberFormatOptions = {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
};

/**
 * The totals line under the list — the one row `DataList` has no slot for.
 *
 * Drawn on the list's own tracks so each total sits under its column: every cell is based on the
 * column's width and grows by the weight `growWeights` gives it, with the same `px-control-sm`
 * inset — the arithmetic `DataList` runs on its header and rows, over the same content width. All
 * columns are pinned, so none is ever dropped there and missing here.
 */
function TotalsRow({
    columns,
    label,
    quantity,
    cost,
    testID,
}: {
    readonly columns: readonly DataListColumn<LineDraft>[];
    readonly label: string;
    readonly quantity: string;
    readonly cost: string;
    readonly testID: string;
}) {
    const weights = growWeights(columns);
    const trackSum = columns.reduce((sum, column) => sum + column.width, 0);
    const content: Readonly<Record<string, ReactNode>> = {
        name: <Text variant="bodyStrong">{label}</Text>,
        quantity: (
            <Text variant="mono" testID={`${testID}-quantity`}>
                {quantity}
            </Text>
        ),
        total: (
            <Text variant="mono" testID={`${testID}-cost`}>
                {cost}
            </Text>
        ),
    };

    return (
        <View
            testID={testID}
            style={{ minWidth: trackSum }}
            // The design's 2px rule under the totals: the one place in the table where a border
            // carries emphasis rather than separation.
            className="h-control-md flex-row items-center border-b-2 border-stroke"
        >
            {columns.map((column) => (
                <View
                    key={column.key}
                    style={{
                        flexBasis: column.width,
                        flexGrow: weights.get(column.key) ?? 0,
                        flexShrink: 0,
                        minWidth: 0,
                    }}
                    className="px-control-sm"
                >
                    {content[column.key] ?? null}
                </View>
            ))}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The cell input
 * ---------------------------------------------------------------------------------------------- */

interface CellInputProps {
    readonly value: string;
    /** Accessible name. The column header is a 10px `micro` label, associated with no control. */
    readonly label: string;
    readonly onChangeText: (next: string) => void;
    readonly disabled: boolean;
    readonly placeholder?: string | undefined;
    /** `end` for a figure, `center` for a short code. Numbers read against the end edge. */
    readonly align?: 'start' | 'end' | 'center' | undefined;
    readonly mono?: boolean | undefined;
    /** The Comments column: no frame until it is hovered or focused. */
    readonly quiet?: boolean | undefined;
    /** The warning border — a quantity that is legal and almost certainly wrong. */
    readonly caution?: boolean | undefined;
    /** A server refusal: the danger border, and the message as the control's description. */
    readonly error?: string | undefined;
    readonly testID: string;
}

/**
 * One 24px box inside a 32px row.
 *
 * `inputFrameClassName` at the `xs` step rather than a `TextInputField`: a field carries a visible
 * label and a hint slot, and this table's labels are its column headers. What it must not lose is
 * the *accessible* name, so each cell states one — a screen reader reading down this table gets
 * "Quantity, edit text, 1" rather than "edit text, 1" nine times.
 */
function CellInput({
    value,
    label,
    onChangeText,
    disabled,
    placeholder,
    align,
    mono,
    quiet,
    caution = false,
    error,
    testID,
}: CellInputProps) {
    const [focused, setFocused] = useState(false);
    const invalid = error !== undefined;

    return (
        <View
            className={
                quiet === true && !focused && !invalid
                    ? // Transparent until it is touched, and the same box underneath — so the row
                      // does not reflow by a pixel when the frame appears.
                      'h-control-xs flex-row items-center gap-control-xs rounded-sm border border-transparent px-control-xs'
                    : inputFrameClassName({
                          invalid,
                          caution,
                          focused,
                          disabled,
                          density: 'compact',
                          size: 'xs',
                      })
            }
        >
            <TextInput
                testID={testID}
                // The same id, so a save that stops on this cell can take the reader to it.
                nativeID={testID}
                value={value}
                editable={!disabled}
                placeholder={placeholder}
                accessibilityLabel={label}
                aria-label={label}
                aria-invalid={invalid}
                {...(error === undefined ? {} : { accessibilityHint: error })}
                onChangeText={onChangeText}
                onFocus={() => {
                    setFocused(true);
                }}
                onBlur={() => {
                    setFocused(false);
                }}
                className={cellControlClass(align, mono)}
            />
        </View>
    );
}

/**
 * The classes for the control inside a cell's frame, stated once rather than layered.
 *
 * `inputControlClass('compact')` used to carry `font-admin`, and appending a second family class to it
 * leaves two competing font utilities to be resolved by stylesheet order rather than by attribute
 * order — the hazard that function's own docblock names, and the reason it takes a density instead
 * of being `cx`-ed over. So the mono variant is written out in full instead of patched on top.
 *
 * The alignment is safe to append either way: nothing in the base sets `text-align`.
 */
function cellControlClass(
    align: 'start' | 'end' | 'center' | undefined,
    mono: boolean | undefined,
): string {
    /*
     * `w-full min-w-0` is load-bearing, not decoration.
     *
     * On the web these render as a real `<input>`, and an input carries an *intrinsic* width — the
     * browser's ~20-character default — which flexbox honours as its basis. `flex-1` alone does not
     * override it, so inside a 68px QTY track the input laid itself out at its natural width,
     * overflowed the visible frame, and drew its centred value to the right of the box it belonged
     * to. That is the stray `1` sitting outside the qty field: not a second cell, the same one,
     * painted past its own border.
     *
     * `w-full` fixes the basis to the track and `min-w-0` lets it shrink below the intrinsic size,
     * which is the pair that actually holds. Both are needed; either alone leaves the overflow on
     * one of the two platforms.
     */
    const width = 'w-full min-w-0';
    const base =
        mono === true
            ? `${width} border-0 bg-transparent tabular-nums text-role-body text-content-primary outline-none`
            : `${inputControlClass('compact')} ${width}`;
    /*
     * `text-end`, not `text-right`: the logical utility follows the writing direction, so an
     * Arabic reader gets the figure against the same edge of the box a Latin reader does.
     * The physical pair is banned by the root ESLint config for exactly this.
     */
    if (align === 'start') return `${base} text-start`;
    if (align === 'end') return `${base} text-end`;
    return align === 'center' ? `${base} text-center` : base;
}

/** The design's 320px field. Stated as a style: there is no 320px width token. */
const PICKER_WIDTH = 320;
