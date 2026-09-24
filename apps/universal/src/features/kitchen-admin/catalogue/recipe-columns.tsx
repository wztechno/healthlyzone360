import type {
    PublishableStatus,
    RecipeAdminSummary,
    RecipeKind,
    RecipeSoldAs,
    RecipeSoldAsPack,
} from '@healthy360/api-client/contracts';
import { Badge, Icon, IconButton, Inline, Text } from '@healthy360/design-system';
import { SALES_CHANNELS } from '@healthy360/domain-types';
import type { KitchenId, SalesChannel } from '@healthy360/domain-types';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import {
    channelKey,
    displayName,
    humaniseCode,
    recipeRowTestId,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * The recipe book, as an array — every track the merged page can draw, answering this entity's
 * questions: what the recipe is, what it is sold as, and whether that is on sale.
 *
 * This file *is* the recipe list. The screen beside it holds the Catalogue's shell parts in order
 * and knows nothing about slugs, versions, sellers or derived allergen labels, exactly as
 * `ingredient-columns.tsx` claims for its own entity. The row's controls belong to `CatalogueList`
 * and are appended there.
 *
 * ## One book, and what sells each recipe
 *
 * A meal, a sauce, a dressing and a frozen meal are each a recipe underneath — a `recipes` row for
 * the formulation and a catalogue item for what sells it — so the four pages that listed the items
 * are this list read by kind. Everything those pages drew from the item arrives with the row as
 * `soldAs`, so Kind, On sale, Channels, Packs and Flags cost no request of their own. A recipe
 * nothing sells is a *preparation*: a marination, a patty, a component another recipe uses.
 *
 * `soldAs` is absent, not empty, for a reader without `catalogue.view_organisation`, and the five
 * seller tracks are then absent from the spec rather than drawn as dashes: a dash would say the
 * recipe sells nothing, which that reader has no way to know. `sells` on the deps is that
 * permission. The seller cells read the *first* seller, in slug order — the one the handle and the
 * photograph come from — except Kind, On sale and Channels, which answer for every seller.
 *
 * ## The thumbnail is 20px, and decorative
 *
 * Same bargain as the ingredient and product lists: `thumbnail` names the picture and
 * `CatalogueList` draws it — in the title cell of the wide table, on the leading edge of the narrow
 * row — and it is `decorative`, because the designation beside it already carries the meaning (WCAG
 * H67). A sold recipe shows its seller's photograph, the one the menu shows; anything else is keyed
 * `recipe-<slug>`, the server's own, because that is what a recipe photograph is filed under.
 *
 * Recipes share the `dishes/` family with the prototype's meals, which is why a recipe photograph
 * is a plated dish rather than a mid-preparation shot where one exists — a sauce, a marinade and a
 * patty are all photographed as themselves, and where no honest photograph of a preparation exists
 * the row keeps the generated pattern rather than borrowing a picture of something else.
 *
 * ## The tracks, and where the numbers come from
 *
 * | column          | track | floor | priority | note                                              |
 * | --------------- | ----: | ----: | -------: | ------------------------------------------------- |
 * | Id              |    96 |    84 |       88 | mono; the seller's `SAC-` handle, else the `RC-`  |
 * | Production item |   200 |   150 |      100 | the title; never dropped; Not formulated mark     |
 * | Kind            |   120 |    96 |       75 | every kind it is sold as; no sort, no filter      |
 * | Category        |   150 |   112 |       40 | the recipe's filing word, else the seller's pair  |
 * | Allergens       |   168 |   132 |       30 | secondary, comma run, derived per row             |
 * | On sale         |   110 |    78 |       74 | badge; Published when any seller is               |
 * | Status          |   110 |    78 |       80 | badge; the recipe's own version state             |
 * | Channels        |   150 |   110 |       50 | the sellers' channels, one comma run              |
 * | Packs           |   160 |   118 |       49 | the lead pack and how many; No pack flagged       |
 * | Flags           |   132 |    96 |       29 | market-priced, assorted, import findings          |
 * | Kitchen         |   140 |   120 |       20 | sorts; the lowest rung, so it drops first         |
 *
 * Six are drawn until the reader chooses — Id, Production item, Kind, Allergens, On sale and Status
 * (the screen states them) — and the rest are a tick in the column picker away. Kind and On sale sit
 * just under Status on the ladder, because on the All tab they are what tells one row from the next.
 *
 * Version, Version state and Updated were all drawn here and are not any more — the first two by
 * request, the third across every Catalogue list at once. What a version is doing is a question
 * about one recipe, which is what the View panel and the editor are for; what a list is scanned for
 * is which recipes exist and which are live.
 *
 * The recipe tracks are the ingredient spec's and the seller tracks the product spec's, moved across
 * rather than re-derived: a kitchen that has learnt to read one Catalogue list should not have to
 * relearn the geometry on the next. Allergens takes 168 rather than the ingredient list's 160 because
 * a *derived* label runs longer than a declared one — it is the union of every line's classes.
 *
 * Kitchen used to host a header filter on `RecipeAdminFilter.kitchenId`. That parameter never
 * reached the server — the recipe index has no such constraint — so the filter narrowed nothing, and
 * it is gone. Every recipe on the list belongs to the kitchen in context, so the column sits on the
 * lowest rung and is hidden until chosen.
 *
 * ## This list has no headline metric
 *
 * The priority ladder reserves 85 for "the entity's headline metric", and on the ingredient list
 * that is the unit price. `RecipeAdminSummary` carries no money at all — cost lives on
 * `RecipeVersionAdmin.estimatedCost`, is CONFIDENTIAL, and needs a permission this list does not
 * ask for. Packs is the product list's metric, but most of this book is meals and preparations,
 * which have none, so it is an ordinary track here and the 85 is simply unspent.
 *
 * ## Allergens is derived, and arrives with the row
 *
 * It belongs to the current *version*, and the summary carries it: `current_version_allergen_codes`
 * on the wire. A dash is a *fact* on this list — it means "this version derived none" — so the
 * column never spends it on "not known yet".
 *
 * ## The allergen cell is a comma run, not a row of chips
 *
 * Same call the ingredient spec records, for the same reason: eight rows of coloured pills turn the
 * column that is usually empty into the loudest thing on the page, and the tone was carrying a
 * contains / may-contain distinction no reader decodes from colour. The View drawer draws the chips
 * and states the distinction in words. Channels is a comma run for the same reason.
 */

export interface RecipeColumnDeps {
    /**
     * Opens a row's editor. The Not-formulated glyph on the name cell presses through to it: a
     * placeholder's one next step is to write the formulation, so the mark that names the state
     * is also the shortest way to fix it.
     */
    readonly onOpen?: ((row: RecipeAdminSummary) => void) | undefined;
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    /** The pack summary's quantity is a number in the reader's numbering system. */
    readonly formatter: Formatter;
    /**
     * The kitchen's name for a `KitchenId`, which is that organisation's id. The screen resolves it
     * off the session's memberships; a kitchen the reader is not a member of falls back to the id.
     */
    readonly kitchenName: (kitchenId: KitchenId) => string;
    /**
     * Whether the reader may see the catalogue — `catalogue.view_organisation`. Without it the
     * server leaves `soldAs` and `kinds` off every row, and the seller tracks leave the spec.
     */
    readonly sells: boolean;
}

/** The heading each kind is read under, singular — "Sauce", "Preparation". */
export const RECIPE_KIND_LABEL_KEYS: Readonly<Record<RecipeKind, string>> = {
    meal: 'kitchen:meals.viewKind',
    sauce: 'kitchen:sauces.viewKind',
    dressing: 'kitchen:dressings.viewKind',
    frozen_meal: 'kitchen:frozenMeals.viewKind',
    preparation: 'kitchen:recipes.kindPreparation',
};

/**
 * The four filing words the sauces sheet uses, which have copy of their own. The keys are the
 * `recipe_category` values the editor writes; a Map, so a word like `constructor` finds nothing.
 */
const SAUCE_CATEGORY_KEYS: ReadonlyMap<string, string> = new Map([
    ['cold_sauce_dip', 'kitchen:sauces.kindColdSauce'],
    ['cooking_sauce', 'kitchen:sauces.kindCookingSauce'],
    ['dessert_sauce', 'kitchen:sauces.kindDessertSauce'],
    ['marinade_prep', 'kitchen:sauces.kindMarinadePrep'],
]);

/**
 * The part of an identifier after the last `#`: `v6-recipes.json#bbq-sauce-dip` → `bbq-sauce-dip`.
 *
 * Rows that predate the `RC-` series fall through to `source_ref`, which is an import locator —
 * the file the sheet arrived in, then the sheet within it. Every row from one import carries the
 * same file half, so the column reads as a run of identical prefixes and pushes the only half that
 * tells two recipes apart out of an 84px track. The fragment is the identifier; the file half is
 * provenance about one import run, which is not what a column of identifiers answers.
 *
 * A handle with no `#` in it — every `RC-0001`, every `SAC-016` — comes back untouched.
 */
export function identifierFragment(identifier: string): string {
    const hash = identifier.lastIndexOf('#');
    return hash === -1 ? identifier : identifier.slice(hash + 1);
}

/**
 * The handle a row is read by: the first seller's (`SAC-016`) when something sells the recipe and
 * carries one, else the recipe's own `RC-0007`, else its slug for a row that predates the series.
 *
 * The seller's first because that is the number a cook quotes off the sauces sheet and the one the
 * old sauce and dressing lists led with. A meal has no series of its own, so a meal's row keeps its
 * recipe's.
 */
export function recipeHandle(row: RecipeAdminSummary): string {
    return identifierFragment(row.soldAs?.[0]?.reference ?? row.reference ?? row.slug);
}

/** The photograph a row, a card and the View panel all show — the seller's, else the recipe's. */
export function recipePhotoId(row: RecipeAdminSummary): string {
    return row.soldAs?.[0]?.imagePlaceholderId ?? `recipe-${row.slug}`;
}

/**
 * `cold_sauce_dip` → "Cold sauce / dip".
 *
 * The four words the sauces sheet files by have copy of their own; anything else is the kitchen's
 * free-text filing word, which is a code rather than a vocabulary with translations, so it is only
 * humanised. `null` for a recipe filed under nothing.
 */
export function recipeCategoryLabel(category: string | null, t: TFunction): string | null {
    if (category === null) return null;
    const key = SAUCE_CATEGORY_KEYS.get(category);
    if (key !== undefined) return t(key);
    const words = humaniseCode(category);
    return words === '' ? null : words;
}

/**
 * Every kind the recipe is sold as, "Meal · Sauce" when mixed — the same list the kind filter
 * matches, so a row and the tab it appears under never disagree. `null` when the reader cannot see
 * what sells it.
 */
export function kindsLabel(row: RecipeAdminSummary, t: TFunction): string | null {
    const kinds = row.kinds ?? [];
    return kinds.length === 0
        ? null
        : kinds.map((kind) => t(RECIPE_KIND_LABEL_KEYS[kind])).join(' · ');
}

/**
 * Whether the recipe is on sale: `published` when any seller is, otherwise the first seller's own
 * state, and `null` when nothing sells it (or the reader cannot see what does).
 */
export function onSaleStatus(row: RecipeAdminSummary): PublishableStatus | null {
    const sellers = row.soldAs ?? [];
    if (sellers.some((seller) => seller.status === 'published')) return 'published';
    return sellers[0]?.status ?? null;
}

/** The channels any seller is available on, once each, in the platform's own order. */
export function sellerChannels(sellers: readonly RecipeSoldAs[]): readonly SalesChannel[] {
    return SALES_CHANNELS.filter((channel) =>
        sellers.some((seller) => seller.channels.includes(channel)),
    );
}

/**
 * A packaged seller — a sauce, a dressing, a frozen meal — with no pack to sell in. A meal is sold
 * by the portion, so it never counts: its missing pack is not a thing to go and fix.
 */
export function missingPack(seller: RecipeSoldAs): boolean {
    return seller.itemType !== 'meal' && seller.packCount === 0;
}

/** The kitchen's own filing pair on the item — "Sauces / Cold sauce / dip" — or `null`. */
export function kitchenCategoryPair(seller: RecipeSoldAs | undefined): string | null {
    if (seller === undefined || seller.kitchenCategory === null) return null;
    return seller.kitchenSubcategory === null
        ? seller.kitchenCategory
        : `${seller.kitchenCategory} / ${seller.kitchenSubcategory}`;
}

/** "Tub · 500 G" — the lead pack, as the product list's Packs column says it. */
export function packSummary(
    pack: RecipeSoldAsPack,
    t: TFunction,
    locale: string,
    formatter: Formatter,
): string {
    return t('kitchen:products.packSummary', {
        pack: displayName(pack.label, locale).value,
        quantity: formatter.formatNumber(pack.netQuantity),
        unit: t(unitShortKey(pack.netUnit)),
    });
}

export function recipeColumns({
    t,
    locale,
    formatter,
    kitchenName,
    sells,
    onOpen,
}: RecipeColumnDeps): readonly CatalogueColumn<RecipeAdminSummary>[] {
    const dash = t('kitchen:list.noValue');
    const rowID = (row: RecipeAdminSummary): string => recipeRowTestId(String(row.id));

    /*
     * Read off the row, which the listing already answered — the codes, the sellers, the line
     * count. Nothing on this list costs a request per row, so no cell has an in-flight state.
     */
    const allergenLabel = (row: RecipeAdminSummary): string =>
        row.allergenCodes.length === 0
            ? t('kitchen:recipes.noAllergens')
            : row.allergenCodes.join(', ');

    const categoryLabel = (row: RecipeAdminSummary): string =>
        recipeCategoryLabel(row.recipeCategory, t) ?? kitchenCategoryPair(row.soldAs?.[0]) ?? dash;

    const onSaleLabel = (row: RecipeAdminSummary): string => {
        const state = onSaleStatus(row);
        return state === null ? dash : t(statusShortKey(state));
    };

    const channelLabel = (row: RecipeAdminSummary): string => {
        const channels = sellerChannels(row.soldAs ?? []);
        return channels.length === 0
            ? t('kitchen:products.noChannels')
            : channels.map((channel) => t(channelKey(channel))).join(', ');
    };

    const packLabel = (row: RecipeAdminSummary): string => {
        const lead = row.soldAs?.[0]?.defaultPack ?? null;
        if (lead !== null) return packSummary(lead, t, locale, formatter);
        return (row.soldAs ?? []).some(missingPack) ? t('kitchen:products.noPacks') : dash;
    };

    const flagNotes = (seller: RecipeSoldAs | undefined): readonly string[] =>
        seller === undefined
            ? []
            : [
                  ...(seller.isMarketPriced ? [t('kitchen:products.marketPricedShort')] : []),
                  ...(seller.isAssorted ? [t('kitchen:products.assortedShort')] : []),
                  ...(seller.dataQualityFlags.length === 0
                      ? []
                      : [
                            t('kitchen:products.dataQualityCount', {
                                count: seller.dataQualityFlags.length,
                            }),
                        ]),
              ];

    const reference: CatalogueColumn<RecipeAdminSummary> = {
        key: 'reference',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:list.columnReference'),
        width: 96,
        min: 84,
        priority: CATALOGUE_PRIORITY.reference,
        role: 'meta',
        mono: true,
        sortable: true,
        sortType: 'text',
        // A handle, not the slug.
        //
        // The slug reads `tabbouleh-v2` and is derived from the name, so it changes when the name
        // is edited and sorts alphabetically rather than by age — which is not what a column of
        // identifiers is for. The handle is what the kitchen writes on a sheet: the seller's
        // `SAC-016` when something sells the recipe, the recipe's own `RC-` otherwise, which is
        // the series the recipe editor's Id field shows. See `recipeHandle`.
        //
        // The prefix is `RC-`, set by `referenceSeries` on the editor and by the server that
        // issues the number. Renaming the series to `REC-` is a backend change and a migration
        // of every existing handle, not a display decision this file can make.
        value: recipeHandle,
        render: (row) => (
            <Text testID={`${rowID(row)}-reference`} variant="mono">
                {recipeHandle(row)}
            </Text>
        ),
    };

    const name: CatalogueColumn<RecipeAdminSummary> = {
        key: 'name',
        label: t('kitchen:recipes.columnName'),
        width: 200,
        min: 150,
        priority: CATALOGUE_PRIORITY.designation,
        role: 'title',
        sortable: true,
        sortType: 'text',
        value: (row) => displayName(row.name, locale).value,
        thumbnail: recipePhotoId,
        render: (row) => {
            const title = displayName(row.name, locale);
            return (
                <Inline space="xs" align="center">
                    <Text variant="label" testID={`${rowID(row)}-name`}>
                        {title.value}
                    </Text>
                    {title.isFallback ? (
                        <Badge
                            testID={`${rowID(row)}-missing-arabic`}
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:list.missingArabic')}
                        />
                    ) : null}
                    {/*
                     * A recipe with no raw-material lines — a placeholder written so a sold item
                     * has a place in the book, waiting for somebody to write its formulation.
                     * Allergens reads "None derived" on such a row, and this is the reason why.
                     *
                     * A glyph, not a badge: a 28px row has one line, and the words ran over the
                     * Kind column beside them. The label is the button's own, drawn on hover the
                     * way every icon button in the workspace draws it, and pressing the mark opens
                     * the recipe — which is where the formulation gets written.
                     */}
                    {row.lineCount === 0 ? (
                        <IconButton
                            testID={`${rowID(row)}-not-formulated`}
                            // `ghost`: no box at rest. A boxed glyph read as a second button on
                            // every placeholder row; the mark should read as a mark.
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:recipes.notFormulated')}
                            icon={<Icon name="warning" size="sm" className="text-warning-strong" />}
                            onPress={() => {
                                onOpen?.(row);
                            }}
                        />
                    ) : null}
                </Inline>
            );
        },
    };

    // No sort and no filter. The kind strip above the cards is the kind control, and a header
    // filter here would be reset by hiding the column — which must never move the reader's tab.
    const kind: CatalogueColumn<RecipeAdminSummary> = {
        key: 'kind',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:recipes.columnKind'),
        width: 120,
        min: 96,
        priority: CATALOGUE_PRIORITY.unitPrice,
        role: 'meta',
        value: (row) => kindsLabel(row, t) ?? dash,
        render: (row) => <Text testID={`${rowID(row)}-kind`}>{kindsLabel(row, t) ?? dash}</Text>,
    };

    // The recipe's own filing word, and the server's `category` filter matches exactly that; a
    // recipe filed under nothing borrows its seller's pair so the cell says where the menu files it.
    const category: CatalogueColumn<RecipeAdminSummary> = {
        key: 'category',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:list.columnCategory'),
        width: 150,
        min: 112,
        priority: CATALOGUE_PRIORITY.category,
        role: 'meta',
        value: categoryLabel,
        render: (row) => {
            const label = categoryLabel(row);
            return (
                <Text
                    testID={`${rowID(row)}-category`}
                    tone={label === dash ? 'secondary' : 'primary'}
                >
                    {label}
                </Text>
            );
        },
    };

    const allergens: CatalogueColumn<RecipeAdminSummary> = {
        key: 'allergens',
        label: t('kitchen:recipes.columnAllergens'),
        width: 168,
        min: 132,
        priority: CATALOGUE_PRIORITY.allergens,
        role: 'meta',
        value: allergenLabel,
        render: (row) => {
            const derived = row.allergenCodes;
            return (
                <Text
                    // Two ids, because "this version declares nothing" and "this version declares
                    // Sesame" are different answers and a suite has to be able to tell them apart
                    // without reading the copy.
                    testID={
                        derived.length === 0
                            ? `${rowID(row)}-allergens-none`
                            : `${rowID(row)}-allergens`
                    }
                    tone={derived.length === 0 ? 'secondary' : 'primary'}
                >
                    {allergenLabel(row)}
                </Text>
            );
        },
    };

    // The item's publication, not the recipe's: what a shopper can buy. `meta`, not `status` — a
    // spec states one status role, and the recipe's own state holds it.
    const onSale: CatalogueColumn<RecipeAdminSummary> = {
        key: 'onSale',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:recipes.columnOnSale'),
        width: 110,
        min: 78,
        priority: CATALOGUE_PRIORITY.unitPrice - 1,
        role: 'meta',
        badge: true,
        value: onSaleLabel,
        render: (row) => {
            const state = onSaleStatus(row);
            return state === null ? (
                <Text testID={`${rowID(row)}-on-sale-none`} tone="secondary">
                    {dash}
                </Text>
            ) : (
                <Badge
                    testID={`${rowID(row)}-on-sale`}
                    tone={statusTone(state)}
                    icon={state === 'published' ? null : undefined}
                    label={t(statusShortKey(state))}
                />
            );
        },
    };

    const status: CatalogueColumn<RecipeAdminSummary> = {
        key: 'status',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:list.columnStatus'),
        width: 110,
        min: 78,
        priority: CATALOGUE_PRIORITY.status,
        role: 'status',
        badge: true,
        sortable: true,
        sortType: 'text',
        value: (row) => t(statusShortKey(row.meta.status)),
        render: (row) => (
            <Badge
                testID={`${rowID(row)}-status`}
                tone={statusTone(row.meta.status)}
                // No mark on Published — see the note in `ingredient-columns.tsx`.
                icon={row.meta.status === 'published' ? null : undefined}
                label={t(statusShortKey(row.meta.status))}
            />
        ),
    };

    const channels: CatalogueColumn<RecipeAdminSummary> = {
        key: 'channels',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:products.columnChannels'),
        width: 150,
        min: 110,
        priority: CATALOGUE_PRIORITY.unit,
        role: 'meta',
        value: channelLabel,
        render: (row) =>
            sellerChannels(row.soldAs ?? []).length === 0 ? (
                <Text testID={`${rowID(row)}-channels-none`} tone="secondary">
                    {t('kitchen:products.noChannels')}
                </Text>
            ) : (
                <Text testID={`${rowID(row)}-channels`}>{channelLabel(row)}</Text>
            ),
    };

    const packs: CatalogueColumn<RecipeAdminSummary> = {
        key: 'packs',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        align: 'center',
        label: t('kitchen:products.columnPacks'),
        width: 160,
        min: 118,
        priority: CATALOGUE_PRIORITY.unit - 1,
        role: 'meta',
        value: packLabel,
        render: (row) => {
            const seller = row.soldAs?.[0];
            const lead = seller?.defaultPack ?? null;
            if (seller !== undefined && lead !== null) {
                return (
                    <Inline space="xs" align="center" testID={`${rowID(row)}-packs`}>
                        <Text variant="mono">{packSummary(lead, t, locale, formatter)}</Text>
                        {/* The count only past one, as the product list draws it. */}
                        {seller.packCount > 1 ? (
                            <Text variant="caption" testID={`${rowID(row)}-packs-count`}>
                                {t('kitchen:products.packCount', { count: seller.packCount })}
                            </Text>
                        ) : null}
                    </Inline>
                );
            }
            // A packaged seller with no pack has nothing to price against, so it is flagged; a
            // meal or a preparation has no pack by nature and gets the plain dash.
            return (row.soldAs ?? []).some(missingPack) ? (
                <Badge
                    testID={`${rowID(row)}-packs-none`}
                    tone="warning"
                    label={t('kitchen:products.noPacks')}
                />
            ) : (
                <Text testID={`${rowID(row)}-packs-none`} tone="secondary">
                    {dash}
                </Text>
            );
        },
    };

    // One column for three caveats, as the product list has it; ids unchanged from there.
    const flags: CatalogueColumn<RecipeAdminSummary> = {
        key: 'flags',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:products.columnFlags'),
        width: 132,
        min: 96,
        priority: CATALOGUE_PRIORITY.allergens - 1,
        value: (row) => {
            const notes = flagNotes(row.soldAs?.[0]);
            return notes.length === 0 ? dash : notes.join(', ');
        },
        render: (row) => {
            const seller = row.soldAs?.[0];
            if (seller === undefined || flagNotes(seller).length === 0) {
                return <Text tone="secondary">{dash}</Text>;
            }
            return (
                <Inline space="xs" align="center">
                    {seller.isMarketPriced ? (
                        <Badge
                            testID={`${rowID(row)}-market-priced`}
                            tone="warning"
                            label={t('kitchen:products.marketPricedShort')}
                        />
                    ) : null}
                    {seller.isAssorted ? (
                        <Badge
                            testID={`${rowID(row)}-assorted`}
                            tone="neutral"
                            label={t('kitchen:products.assortedShort')}
                        />
                    ) : null}
                    {seller.dataQualityFlags.length === 0 ? null : (
                        <Badge
                            testID={`${rowID(row)}-data-quality`}
                            tone="warning"
                            icon="warning"
                            label={String(seller.dataQualityFlags.length)}
                        />
                    )}
                </Inline>
            );
        },
    };

    const kitchen: CatalogueColumn<RecipeAdminSummary> = {
        key: 'kitchen',
        // Fixed at its declared track: the title and the allergens spend the row's spare width.
        grow: false,
        label: t('kitchen:recipes.columnKitchen'),
        width: 140,
        min: 120,
        priority: CATALOGUE_PRIORITY.updated,
        role: 'meta',
        sortable: true,
        sortType: 'text',
        value: (row) => kitchenName(row.kitchenId),
        render: (row) => <Text testID={`${rowID(row)}-kitchen`}>{kitchenName(row.kitchenId)}</Text>,
    };

    return [
        reference,
        name,
        ...(sells ? [kind] : []),
        category,
        allergens,
        ...(sells ? [onSale] : []),
        status,
        ...(sells ? [channels, packs, flags] : []),
        kitchen,
    ];
}
