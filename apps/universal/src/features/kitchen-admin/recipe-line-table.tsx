import type {
    CostAmount,
    IngredientAdmin,
    LocalisedText,
} from '@healthy360/api-client/contracts';
import { PACKAGING_CATEGORY_CODE } from '@healthy360/api-client/contracts';
import {
    Icon,
    IconButton,
    Text,
    inputControlClass,
    inputFrameClassName,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, TextInput, View } from 'react-native';

import {
    ingredientsFromPages,
    useIngredientsQuery,
    usePackagingPageQuery,
} from '../../data/kitchen-admin-hooks.ts';
import { displayName, humaniseCode, parseQuantity, unitShortKey } from './format.ts';

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
 * The two tabs draw from two different tables — `ingredients` for the formulation, `packaging_items`
 * for the boxes — and the table itself does not care which. It needs an id, a name, the unit a
 * quantity is counted in, a price to multiply, and a grey run of context beside the name. Both
 * catalogues can supply those; neither can supply the other's shape.
 *
 * This is why the packaging tab was broken before. It reused the ingredient picker and simply asked
 * it for `category=packaging-disposables`, which stopped resolving the moment packaging became its
 * own table — and the panel went empty with nothing to say why. A normalised option makes the wrong
 * table a compile error rather than an empty dropdown.
 */
export interface PickerEntry {
    readonly id: string;
    readonly name: LocalisedText;
    /** The unit a new line starts in. */
    readonly unit: MeasureUnit;
    /** What one unit costs, for the row's own arithmetic. `null` where nothing is recorded. */
    readonly unitPrice: CostAmount | null;
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
 * RAW MATERIALS  Type to add — the picker stays inline, no modal
 * [ Add an ingredient…            320px ]
 * DESIGNATION            UNIT  QTY   UNIT PRICE  TOTAL   COMMENTS          ⋯
 * Mayonnaise   IG-019    kg    [ 1 ] [ 3.50   ]  3.500   Fine dice         ✕
 * …
 * Total                        3.553             10.636
 * ```
 *
 * One component for Production and Packaging, because the design draws one table twice and varies
 * only its title, its hint and its picker placeholder. Two copies would be two chances for the Qty
 * column to drift by a pixel.
 *
 * ## The picker is inline, and that is the design's whole point about it
 *
 * "Type to add — the picker stays inline, no modal" is written on the section itself. A modal to add
 * a line to a nine-line sheet is nine modals, and the row a person is about to add is the one thing
 * they must be able to see the table while choosing. So: a 320px field that filters as you type, a
 * panel hanging under it, arrow keys and Enter to commit, Escape to close.
 *
 * `Select searchable` was the alternative and is the wrong shape here. It is a *field* — labelled,
 * on the 280px grid track, holding one value — and this control holds none: it is an action that
 * happens to be spelled by typing. Picking from it adds a row and clears itself.
 *
 * ## What each column can actually do
 *
 * | column     | source                                    | editable |
 * | ---------- | ----------------------------------------- | -------- |
 * | Designation| the resolved ingredient                   | picker   |
 * | Unit       | `RecipeLine.unit`                         | no       |
 * | Qty        | `RecipeLine.quantity`                     | yes      |
 * | Unit price | the *ingredient's* `unitPrice`            | no       |
 * | Total      | qty × unit price                          | derived  |
 * | Comments   | `RecipeLine.sourceDesignation`            | yes      |
 *
 * **Unit price is read, not typed**, and that is a contract fact rather than a design deviation.
 * `RecipeLineInput` carries an ingredient, a quantity, a unit, a source designation and an optional
 * flag — and no money. A line costs what the ingredient costs; the design draws the figure in a box
 * because its prototype holds its own array, and typing into it here would edit a number that has
 * nowhere to be saved and would silently disagree with the ingredient record on the next reload.
 * So it renders as a figure on the sunken fill: same track, same alignment, no false affordance.
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
     * Which catalogue the picker searches.
     *
     * `ingredients` reads the ingredient library; `packaging` reads `packaging_items`. They are
     * different tables with different endpoints, which is the whole reason this is a source rather
     * than a category filter — the version that filtered one table by category silently returned
     * nothing once packaging moved out of it.
     */
    readonly source?: 'ingredients' | 'packaging' | undefined;
    readonly canManage: boolean;
    /** Mints a stable row key. The editor owns the counter so keys never collide across tables. */
    readonly nextKey: () => string;
    readonly onChange: (rows: readonly LineDraft[]) => void;
    /** Translated placeholder for the picker — "Add an ingredient…" / "Add packaging…". */
    readonly pickerPlaceholder: string;
    readonly testID: string;
}

/** How many matches the panel offers at once. The design's 226px panel holds eight 28px rows. */
const MAX_RESULTS = 8;

/** Long enough that typing "mayo" is one request, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 250;

/** Settles a fast-changing value, so a request follows a word rather than a keystroke. */
function useDebounced<T>(value: T, delay: number): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setSettled(value);
        }, delay);
        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return settled;
}

/**
 * An ingredient as the picker sees it.
 *
 * The grey run is `Condiments · kg` — what kind of thing this is and what a quantity of it will be
 * counted in. Two facts rather than one, because "Mayonnaise" appears twice in a library of three
 * hundred and the unit is what decides whether `1` means a kilo or a bottle.
 */
function ingredientEntry(entry: IngredientAdmin): PickerEntry {
    return {
        id: String(entry.id),
        name: entry.name,
        unit: entry.measurementUnit,
        unitPrice: entry.unitPrice,
        meta: entry.categoryCode === '' ? '' : humaniseCode(entry.categoryCode),
        reference: entry.reference,
    };
}

/**
 * A packaging item as the picker sees it.
 *
 * The price is the **pack** price, and the unit here is the purchase unit to match it — a sleeve at
 * $6.50, not a bag at $0.065. Quoting a per-piece price against a pack figure is the one arithmetic
 * error this row can make, so the two travel together or not at all.
 *
 * The grey run leads with the leaf — `Bags`, `Containers` — because on this tab every row shares
 * one top-level category and the leaf is the only thing that distinguishes them.
 */
function packagingEntry(entry: IngredientAdmin): PickerEntry {
    return {
        id: String(entry.id),
        name: entry.name,
        unit: entry.purchaseUnit ?? entry.measurementUnit,
        unitPrice: entry.purchasePrice,
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
    canManage,
    nextKey,
    onChange,
    pickerPlaceholder,
    testID,
}: RecipeLineTableProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);

    const byId = useMemo(() => {
        const map = new Map<string, PickerEntry>();
        for (const entry of ingredients) map.set(String(entry.id), entry);
        return map;
    }, [ingredients]);

    /*
     * The panel searches the *catalogue*, not the page in hand.
     *
     * This used to filter `ingredients` client-side, which meant it searched whichever hundred rows
     * the listing happened to return first — `CursorPage::MAX_LIMIT` is 100 and the library is
     * several hundred, so most of it could not be found by typing its name. The server has had a
     * real search all along (`IngredientIndexController::applySearch`, over `name_en`, `name_ar` and
     * the alias table), so the field asks it.
     *
     * The request is debounced and the term is sent only once it is worth sending; an empty field
     * still lists the first page, which is what makes the panel useful before anything is typed.
     */
    const term = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
    /*
     * No status filter.
     *
     * It used to ask for `published` only, which is `status=active` on the wire — and that quietly
     * excluded every row the mapper calls anything else: the two inactive library rows, and any row
     * a kitchen has flagged for review. A picker that cannot offer an ingredient the kitchen has
     * marked "check this" is a picker that hides exactly the rows somebody is most likely to be
     * looking for. Archived rows are already excluded by the endpoint's own default.
     */
    const wantsIngredients = source === 'ingredients';

    /*
     * Both hooks are called every render and one of them is disabled, because hooks cannot be
     * called conditionally. The disabled one costs a cache lookup and no request.
     */
    const ingredientSearch = useIngredientsQuery(
        {
            limit: 100,
            // Food only. The two families share a table, so the raw-material picker has to say so:
            // without this it offers bin liners beside chickpeas, which is the complaint that got
            // packaging moved out in the first place. The repository *refuses* an exclusion it
            // cannot resolve rather than dropping it, so this cannot quietly stop working.
            excludeCategoryCode: PACKAGING_CATEGORY_CODE,
            ...(term === '' ? {} : { query: term }),
        },
        wantsIngredients,
    );
    const packagingSearch = usePackagingPageQuery(
        term === '' ? {} : { query: term },
        1,
        !wantsIngredients,
    );

    const search = wantsIngredients ? ingredientSearch : packagingSearch;

    const results = useMemo((): readonly PickerEntry[] => {
        const entries = wantsIngredients
            ? ingredientsFromPages(ingredientSearch.data?.pages).map(ingredientEntry)
            : (packagingSearch.data?.items ?? []).map(packagingEntry);

        return entries.slice(0, MAX_RESULTS);
    }, [wantsIngredients, ingredientSearch.data?.pages, packagingSearch.data?.items]);

    const unitPriceOf = (row: LineDraft): number | null => {
        if (row.ingredientId === null) return null;
        return byId.get(String(row.ingredientId))?.unitPrice?.amount ?? null;
    };

    const lineTotal = (row: LineDraft): number | null => {
        const quantity = parseQuantity(row.quantity);
        const price = unitPriceOf(row);
        if (quantity === null || price === null) return null;
        return quantity * price;
    };

    const totalQuantity = rows.reduce((sum, row) => sum + (parseQuantity(row.quantity) ?? 0), 0);
    const totalCost = rows.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0);

    const add = (entry: PickerEntry) => {
        onChange([
            ...rows,
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
        setQuery('');
        setHighlighted(0);
        setOpen(false);
    };

    const patch = (key: string, next: Partial<LineDraft>) => {
        onChange(rows.map((row) => (row.key === key ? { ...row, ...next } : row)));
    };

    const remove = (key: string) => {
        onChange(rows.filter((row) => row.key !== key));
    };

    return (
        <View testID={testID} className="flex-col gap-tight">
            {canManage ? (
                <Picker
                    testID={`${testID}-picker`}
                    placeholder={pickerPlaceholder}
                    query={query}
                    loading={search.isFetching && term !== ''}
                    onQueryChange={(next) => {
                        setQuery(next);
                        setHighlighted(0);
                        setOpen(true);
                    }}
                    open={open}
                    onOpen={() => {
                        setOpen(true);
                    }}
                    onClose={() => {
                        setOpen(false);
                    }}
                    results={results}
                    highlighted={highlighted}
                    onHighlight={setHighlighted}
                    onPick={add}
                />
            ) : null}

            <View>
                <LineHeaderRow t={t} />

                {rows.map((row) => {
                    const entry =
                        row.ingredientId === null ? undefined : byId.get(String(row.ingredientId));
                    const price = unitPriceOf(row);
                    const total = lineTotal(row);
                    const rowTestId = `${testID}-row-${row.key}`;

                    return (
                        <View
                            key={row.key}
                            testID={rowTestId}
                            className="min-h-row-md flex-row items-center gap-tight border-b border-stroke-subtle px-tight py-hair"
                        >
                            <View
                                style={DESIGNATION_TRACK}
                                className="flex-row items-baseline gap-hair"
                            >
                                <Text
                                    variant="label"
                                    numberOfLines={1}
                                    testID={`${rowTestId}-name`}
                                >
                                    {entry === undefined
                                        ? t('kitchen:recipes.unnamedLine')
                                        : displayName(entry.name, locale).value}
                                </Text>
                                {entry?.reference == null ? null : (
                                    <Text variant="micro" tone="secondary">
                                        {entry.reference}
                                    </Text>
                                )}
                            </View>

                            <View style={{ width: TRACK.unit }}>
                                <Text tone="secondary" numberOfLines={1}>
                                    {t(unitShortKey(row.unit))}
                                </Text>
                            </View>

                            <View style={{ width: TRACK.qty }}>
                                <CellInput
                                    testID={`${rowTestId}-qty`}
                                    value={row.quantity}
                                    disabled={!canManage}
                                    align="start"
                                    mono
                                    label={t('kitchen:recipes.lineQuantity')}
                                    onChangeText={(next) => {
                                        patch(row.key, { quantity: next });
                                    }}
                                />
                            </View>

                            {/*
                             * A figure, not a field. See the note above: a line carries no price of
                             * its own on this contract, so a box here would be a control with
                             * nowhere to write.
                             */}
                            <View style={{ width: TRACK.unitPrice }}>
                                <Text
                                    variant="mono"
                                    align="start"
                                    tone={price === null ? 'secondary' : 'primary'}
                                    numberOfLines={1}
                                    testID={`${rowTestId}-unit-price`}
                                >
                                    {price === null
                                        ? t('kitchen:list.noValue')
                                        : formatter.formatNumber(price, MONEY)}
                                </Text>
                            </View>

                            <View style={{ width: TRACK.total }}>
                                <Text
                                    variant="mono"
                                    align="start"
                                    numberOfLines={1}
                                    testID={`${rowTestId}-total`}
                                >
                                    {total === null
                                        ? t('kitchen:list.noValue')
                                        : formatter.formatNumber(total, LINE_TOTAL)}
                                </Text>
                            </View>

                            <View style={COMMENTS_TRACK}>
                                <CellInput
                                    testID={`${rowTestId}-comment`}
                                    value={row.note}
                                    disabled={!canManage}
                                    quiet
                                    placeholder={t('kitchen:list.noValue')}
                                    label={t('kitchen:recipes.lineNote')}
                                    onChangeText={(next) => {
                                        patch(row.key, { note: next });
                                    }}
                                />
                            </View>

                            <View style={{ width: TRACK.action }}>
                                {canManage ? (
                                    <IconButton
                                        testID={`${rowTestId}-remove`}
                                        label={t('kitchen:recipes.removeLine')}
                                        variant="ghost"
                                        tone="danger"
                                        size="sm"
                                        icon={<Icon name="close" size="sm" />}
                                        onPress={() => {
                                            remove(row.key);
                                        }}
                                    />
                                ) : null}
                            </View>
                        </View>
                    );
                })}

                {rows.length === 0 ? (
                    <View
                        testID={`${testID}-empty`}
                        className="border-b border-stroke-subtle px-tight py-snug"
                    >
                        <Text tone="secondary" variant="caption">
                            {t('kitchen:recipes.linesEmpty')}
                        </Text>
                    </View>
                ) : (
                    <TotalsRow
                        testID={`${testID}-totals`}
                        label={t('kitchen:recipes.sheetTotalRow')}
                        quantity={formatter.formatNumber(totalQuantity, LINE_TOTAL)}
                        cost={formatter.formatNumber(totalCost, LINE_TOTAL)}
                    />
                )}
            </View>
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------------------------------- */

/**
 * The design's tracks, in dp.
 *
 * Designation and Comments are the two that flex (`1.7fr` / `1.3fr` in the design, `flex-[1.7]` /
 * `flex-[1.3]` here); everything between them is fixed, because a Qty box that changed width with
 * the window is a column the eye cannot run down. The action track is one `sm` icon button.
 */
const TRACK = { unit: 52, qty: 68, unitPrice: 80, total: 80, action: 28 } as const;

/**
 * The two flexible tracks, as inline styles rather than classes.
 *
 * `flex-[1.7]` is an arbitrary Tailwind value and NativeWind does not emit a fractional `flexGrow`
 * for it, so both columns silently collapsed to their content width and every fixed track bunched
 * against the inline start. A fraction of the leftover space is geometry rather than theme, and
 * `style` is the one route to it that both platforms honour.
 *
 * `flexBasis: 0` with `minWidth: 0` is what makes the ratio hold: without a zero basis the tracks
 * divide only the space *left over* after their content, so a long designation would win a share it
 * was never given, and without `minWidth: 0` a long one refuses to truncate at all.
 */
const DESIGNATION_TRACK = { flexGrow: 1.7, flexShrink: 1, flexBasis: 0, minWidth: 0 } as const;
const COMMENTS_TRACK = { flexGrow: 1.3, flexShrink: 1, flexBasis: 0, minWidth: 0 } as const;

/** Unit prices read at two decimals; a line total at three — the source sheets' own precision. */
const MONEY: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const LINE_TOTAL: Intl.NumberFormatOptions = {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
};

function LineHeaderRow({ t }: { readonly t: (key: string) => string }) {
    return (
        <View className="h-control-xs flex-row items-center gap-tight border-b border-stroke px-tight">
            <View style={DESIGNATION_TRACK}>
                <HeaderCell label={t('kitchen:list.columnName')} />
            </View>
            <View style={{ width: TRACK.unit }}>
                <HeaderCell label={t('kitchen:list.columnUnit')} />
            </View>
            <View style={{ width: TRACK.qty }}>
                <HeaderCell label={t('kitchen:recipes.sheetColQuantityShort')} align="center" />
            </View>
            <View style={{ width: TRACK.unitPrice }}>
                <HeaderCell label={t('kitchen:list.columnUnitPrice')} align="center" />
            </View>
            <View style={{ width: TRACK.total }}>
                <HeaderCell label={t('kitchen:recipes.sheetColLineTotalLong')} align="center" />
            </View>
            <View style={COMMENTS_TRACK}>
                <HeaderCell label={t('kitchen:recipes.sheetColComments')} />
            </View>
            <View style={{ width: TRACK.action }} />
        </View>
    );
}

function HeaderCell({
    label,
    align,
}: {
    readonly label: string;
    /** `end` for a figure, `center` for a short code. Numbers read against the end edge. */
    readonly align?: 'start' | 'end' | 'center' | undefined;
}) {
    return (
        <Text variant="micro" tone="secondary" numberOfLines={1} align={align}>
            {label}
        </Text>
    );
}

function TotalsRow({
    label,
    quantity,
    cost,
    testID,
}: {
    readonly label: string;
    readonly quantity: string;
    readonly cost: string;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            // The design's 2px rule under the totals: the one place in the table where a border
            // carries emphasis rather than separation.
            className="h-control-md flex-row items-center gap-tight border-b-2 border-stroke px-tight"
        >
            <View style={DESIGNATION_TRACK}>
                <Text variant="bodyStrong">{label}</Text>
            </View>
            <View style={{ width: TRACK.unit }} />
            <View style={{ width: TRACK.qty }}>
                <Text variant="mono" align="center" testID={`${testID}-quantity`}>
                    {quantity}
                </Text>
            </View>
            <View style={{ width: TRACK.unitPrice }} />
            <View style={{ width: TRACK.total }}>
                <Text variant="mono" align="center" testID={`${testID}-cost`}>
                    {cost}
                </Text>
            </View>
            <View style={COMMENTS_TRACK} />
            <View style={{ width: TRACK.action }} />
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The cell input
 * ---------------------------------------------------------------------------------------------- */

interface CellInputProps {
    readonly value: string;
    /** Accessible name. The column header is 10px caps and is not associated with the control. */
    readonly label: string;
    readonly onChangeText: (next: string) => void;
    readonly disabled: boolean;
    readonly placeholder?: string | undefined;
    /** `end` for a figure, `center` for a short code. Numbers read against the end edge. */
    readonly align?: 'start' | 'end' | 'center' | undefined;
    readonly mono?: boolean | undefined;
    /** The Comments column: no frame until it is hovered or focused. */
    readonly quiet?: boolean | undefined;
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
    testID,
}: CellInputProps) {
    const [focused, setFocused] = useState(false);

    return (
        <View
            className={
                quiet === true && !focused
                    ? // Transparent until it is touched, and the same box underneath — so the row
                      // does not reflow by a pixel when the frame appears.
                      'h-control-xs flex-row items-center gap-control-xs rounded-sm border border-transparent px-control-xs'
                    : inputFrameClassName({
                          invalid: false,
                          focused,
                          disabled,
                          density: 'compact',
                          size: 'xs',
                      })
            }
        >
            <TextInput
                testID={testID}
                value={value}
                editable={!disabled}
                placeholder={placeholder}
                accessibilityLabel={label}
                aria-label={label}
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
 * `inputControlClass('compact')` already carries `font-admin`, and appending `font-mono` to it
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
            ? `${width} border-0 bg-transparent font-mono text-role-body text-content-primary outline-none`
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

/* ------------------------------------------------------------------------------------------------
 * The inline picker
 * ---------------------------------------------------------------------------------------------- */

interface PickerProps {
    readonly placeholder: string;
    readonly query: string;
    readonly onQueryChange: (next: string) => void;
    readonly open: boolean;
    readonly onOpen: () => void;
    readonly onClose: () => void;
    readonly results: readonly PickerEntry[];
    /** A request is in flight, so the panel says so instead of claiming there is no match. */
    readonly loading: boolean;
    readonly highlighted: number;
    readonly onHighlight: (index: number) => void;
    readonly onPick: (entry: PickerEntry) => void;
    readonly testID: string;
}

/** The design's 320px field. Stated as a style: there is no 320px width token. */
const PICKER_WIDTH = 320;
/** The panel is wider than its field, as drawn — a designation plus a price needs the room. */
const PANEL_WIDTH = 360;

function Picker({
    placeholder,
    query,
    onQueryChange,
    open,
    onOpen,
    onClose,
    results,
    loading,
    highlighted,
    onHighlight,
    onPick,
    testID,
}: PickerProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const [focused, setFocused] = useState(false);

    const commit = (index: number) => {
        const entry = results[index];
        if (entry !== undefined) onPick(entry);
    };

    /*
     * On the web a press inside the panel blurs the input first, and the blur handler below closes
     * the panel — so the row unmounts under the pointer and the press never lands. The design's own
     * prototype solves it the same way (`onPointerDown="{{ stopEvent }}"`): the panel swallows the
     * pointer-down, the input keeps focus, and the press completes.
     *
     * `preventDefault` rather than `stopPropagation`: it is the *default* action of pointer-down —
     * moving focus — that has to not happen. Stopping propagation would leave the blur intact.
     */
    const panelProps =
        Platform.OS === 'web'
            ? {
                  onPointerDown: (event: { preventDefault: () => void }) => {
                      event.preventDefault();
                  },
              }
            : {};

    // Arrow keys and Enter, web only: `onKeyPress` on native carries no key identity worth
    // branching on, and a phone has no cursor to walk a list with anyway — it taps the row.
    const keyProps =
        Platform.OS === 'web'
            ? {
                  onKeyDown: (event: {
                      key: string;
                      preventDefault: () => void;
                  }) => {
                      if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          onHighlight(Math.min(highlighted + 1, Math.max(results.length - 1, 0)));
                          onOpen();
                      } else if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          onHighlight(Math.max(highlighted - 1, 0));
                      } else if (event.key === 'Enter') {
                          event.preventDefault();
                          commit(highlighted);
                      } else if (event.key === 'Escape') {
                          onClose();
                      }
                  },
              }
            : {};

    /*
     * The raised layer is on the *wrapper*, not only on the panel inside it.
     *
     * React Native Web gives every `View` its own stacking context, so a `z-index` on the panel
     * competes only with its siblings inside this box — and the table is a sibling of the box,
     * later in source order, which is why the panel rendered underneath nine rows of text. The
     * whole picker has to out-rank the table; the panel's own z-index then orders what is inside it.
     *
     * Raised only while the panel is open: a permanently raised 320px box would sit over anything a
     * later section ever put near it, for no reason the rest of the time.
     */
    return (
        <View
            style={{ width: PICKER_WIDTH }}
            className={open ? 'relative z-sticky' : 'relative'}
        >
            <View
                className={inputFrameClassName({
                    invalid: false,
                    focused,
                    disabled: false,
                    density: 'compact',
                    size: 'sm',
                })}
            >
                <TextInput
                    testID={`${testID}-input`}
                    value={query}
                    placeholder={placeholder}
                    accessibilityLabel={placeholder}
                    aria-label={placeholder}
                    role="combobox"
                    aria-expanded={open}
                    onChangeText={onQueryChange}
                    onFocus={() => {
                        setFocused(true);
                        onOpen();
                    }}
                    onBlur={() => {
                        setFocused(false);
                        onClose();
                    }}
                    className={inputControlClass('compact')}
                    {...keyProps}
                />
            </View>

            {!open ? null : (
                <View
                    testID={`${testID}-panel`}
                    {...panelProps}
                    // React Native's `Role` union has no `listbox`, and an invalid role is worse
                    // than none: `list` is in the union, means the same thing to a reader walking
                    // the panel, and the options below still carry their own selected state.
                    role="list"
                    // Above the rows beneath it: the table paints after this in source order, so
                    // without the raised layer the panel lands under the first line.
                    className="absolute top-full z-sticky mt-hair max-h-64 overflow-hidden rounded-md border border-stroke bg-surface-raised p-hair shadow-elevation-3"
                    style={{ width: PANEL_WIDTH }}
                >
                    {loading ? (
                        /*
                         * "Searching…" rather than "no match", while a request is in flight.
                         *
                         * The panel used to draw the empty state during every fetch, so typing a
                         * fourth letter flashed *No match for "mayo"* before the answer arrived —
                         * which reads as a definitive "this ingredient does not exist" rather than
                         * as a pause, and is why a search that worked looked like one that did not.
                         */
                        <View testID={`${testID}-loading`} className="px-tight py-snug">
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:recipes.pickerSearching')}
                            </Text>
                        </View>
                    ) : results.length === 0 ? (
                        <View testID={`${testID}-empty`} className="px-tight py-snug">
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:recipes.pickerNoMatch', { query })}
                            </Text>
                        </View>
                    ) : (
                        results.map((entry, index) => (
                            <Pressable
                                key={String(entry.id)}
                                testID={`${testID}-option-${String(entry.id)}`}
                                role="option"
                                aria-selected={index === highlighted}
                                accessibilityRole="menuitem"
                                accessibilityLabel={displayName(entry.name, locale).value}
                                onHoverIn={() => {
                                    onHighlight(index);
                                }}
                                onPress={() => {
                                    onPick(entry);
                                }}
                                className={[
                                    'h-control-sm flex-row items-center justify-between gap-tight rounded-sm px-tight',
                                    index === highlighted ? 'bg-surface-sunken' : null,
                                ]
                                    .filter((entryClass) => entryClass !== null)
                                    .join(' ')}
                            >
                                <View className="min-w-0 flex-1 flex-row items-baseline gap-hair">
                                    <Text variant="label" numberOfLines={1}>
                                        {displayName(entry.name, locale).value}
                                    </Text>
                                    {/*
                                      * `Condiments · kg`, as the design draws it: what kind of
                                      * thing this is and what a quantity of it will be counted in.
                                      * Two facts rather than one, because "Mayonnaise" appears
                                      * twice in a library of three hundred and the unit is what
                                      * decides whether `1` means a kilo or a bottle.
                                      */}
                                    <Text variant="micro" tone="secondary" numberOfLines={1}>
                                        {entry.meta}
                                    </Text>
                                </View>
                                <Text variant="mono" tone="secondary" numberOfLines={1}>
                                    {entry.unitPrice === null
                                        ? t('kitchen:list.noValue')
                                        : formatter.formatNumber(entry.unitPrice.amount, MONEY)}
                                </Text>
                            </Pressable>
                        ))
                    )}
                </View>
            )}
        </View>
    );
}

