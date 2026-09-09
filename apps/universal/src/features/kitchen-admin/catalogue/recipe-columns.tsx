import type { PublishableStatus, RecipeAdmin, RecipeAdminSummary } from '@healthy360/api-client/contracts';
import { Badge, Inline, Skeleton, Text } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import { displayName, recipeRowTestId, statusShortKey, statusTone } from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * Recipes, as an array — the same eight tracks the ingredient list draws, answering this entity's
 * questions instead of that one's.
 *
 * This file *is* the recipe list. The screen beside it holds the Catalogue's shell parts in order
 * and knows nothing about slugs, versions or derived allergen labels, exactly as
 * `ingredient-columns.tsx` claims for its own entity. The ninth track — the row's controls —
 * belongs to `CatalogueList` and is appended there.
 *
 * ## The tracks, and where the numbers come from
 *
 * | column        | track | floor | priority | note                                        |
 * | ------------- | ----: | ----: | -------: | ------------------------------------------- |
 * | Ref.          |   112 |    84 |       88 | mono; the slug                              |
 * | Recipe        |   260 |   150 |      100 | the title; never dropped                    |
 * | Kitchen       |   140 |   120 |       40 | secondary; hosts the kitchen filter         |
 * | Version       |    96 |    76 |       85 | mono, centred — "2 of 3"                    |
 * | Version state |   118 |    86 |       75 | badge, derived per row                      |
 * | Allergens     |   168 |   132 |       30 | secondary, comma run, derived per row       |
 * | Status        |   110 |    78 |       80 | badge                                       |
 * | Updated       |    96 |    72 |       20 | secondary, centred, relative                |
 *
 * The tracks are the ingredient spec's, moved across one position at a time rather than re-derived:
 * a kitchen that has learnt to read one Catalogue list down its reference column should not have to
 * relearn the geometry on the next one. Two differ, and both are the entity talking. Version state
 * takes 118 rather than the ingredient Unit price's 104 because it holds a badge, not a figure, and
 * a badge carries its own inset. Allergens takes 168 rather than 160 because a *derived* label runs
 * longer than a declared one — it is the union of every line's classes, not one record's own.
 *
 * ## Version is the metric, because a recipe has no price
 *
 * The priority ladder reserves 85 for "the entity's headline metric", and on the ingredient list
 * that is the unit price. `RecipeAdminSummary` carries no money at all — cost lives on
 * `RecipeVersionAdmin.estimatedCost`, is CONFIDENTIAL, and needs a permission this list does not
 * ask for. What a recipe row is actually scanned for after its name is *which version is live and
 * how many there have been*, so that pair is the 85 and it renders as one mono figure, "2 of 3".
 *
 * Both numbers are on the summary, so this cell never waits and never blanks.
 *
 * ## Two columns are derived, and say so while they wait
 *
 * Version state and Allergens both live on `RecipeAdmin.currentVersion`, which the summary does not
 * carry — the N+1 `useRecipeDetails` documents. They are fed a lookup rather than calling a query
 * of their own: a column spec is an array, and an array cannot call a hook.
 *
 * While a row's detail is in flight each renders a `Skeleton` at its own width rather than a dash.
 * A dash is a *fact* on this list — the Allergens column uses it to say "this version derived
 * none" — so spending it on "not known yet" would make the one column a kitchen reads for safety
 * ambiguous between "nothing to declare" and "nothing has loaded".
 *
 * ## The allergen cell is a comma run, not a row of chips
 *
 * Same call the ingredient spec records, for the same reason: eight rows of coloured pills turn the
 * column that is usually empty into the loudest thing on the page, and the tone was carrying a
 * contains / may-contain distinction no reader decodes from colour. The View drawer draws the chips
 * and states the distinction in words.
 */

export interface RecipeColumnDeps {
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    readonly formatter: Formatter;
    /**
     * The detail behind one row, or `undefined` while it is in flight. Supplied by the list state,
     * which owns the batched read — see `useRecipeDetails`.
     */
    readonly detailOf: (row: RecipeAdminSummary) => RecipeAdmin | undefined;
}

export function recipeColumns({
    t,
    locale,
    formatter,
    detailOf,
}: RecipeColumnDeps): readonly CatalogueColumn<RecipeAdminSummary>[] {
    const versionState = (row: RecipeAdminSummary): PublishableStatus | undefined =>
        detailOf(row)?.currentVersion.status;

    const allergenLabel = (row: RecipeAdminSummary): string | undefined => {
        const detail = detailOf(row);
        if (detail === undefined) return undefined;
        const declarations = detail.currentVersion.allergens;
        return declarations.length === 0
            ? t('kitchen:recipes.noAllergens')
            : declarations.map((declaration) => declaration.allergenCode).join(', ');
    };

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            width: 112,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            // The slug is a recipe's reference: it is what an address, a print-out and a support
            // conversation name it by, and it is the one identifier that does not change with a
            // translation.
            value: (row) => row.slug,
            render: (row) => (
                <Text
                    testID={`${recipeRowTestId(String(row.id))}-slug`}
                    variant="mono"
                    numberOfLines={1}
                >
                    {row.slug}
                </Text>
            ),
        },
        {
            key: 'name',
            label: t('kitchen:recipes.columnName'),
            width: 260,
            min: 150,
            priority: CATALOGUE_PRIORITY.designation,
            role: 'title',
            sortable: true,
            sortType: 'text',
            value: (row) => displayName(row.name, locale).value,
            render: (row) => {
                const name = displayName(row.name, locale);
                return (
                    <Inline space="xs" align="center">
                        <Text
                            variant="label"
                            numberOfLines={1}
                            testID={`${recipeRowTestId(String(row.id))}-name`}
                        >
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${recipeRowTestId(String(row.id))}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'kitchen',
            label: t('kitchen:recipes.columnKitchen'),
            width: 140,
            min: 120,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            // A recipe has no category on this contract, so the kitchen is the second axis — and
            // unlike the ingredient categories it is a real `RecipeAdminFilter` parameter, which is
            // what makes this header's Filter honest across every page rather than only this one.
            value: (row) => String(row.kitchenId),
            render: (row) => (
                <Text
                    testID={`${recipeRowTestId(String(row.id))}-kitchen`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {String(row.kitchenId)}
                </Text>
            ),
        },
        {
            key: 'version',
            label: t('kitchen:recipes.columnVersionShort'),
            width: 96,
            min: 76,
            priority: CATALOGUE_PRIORITY.metric,
            role: 'metric',
            align: 'center',
            mono: true,
            sortable: true,
            sortType: 'number',
            value: (row) =>
                t('kitchen:recipes.versionOfCount', {
                    number: row.currentVersionNumber,
                    count: row.versionCount,
                }),
            render: (row) => (
                <Text
                    testID={`${recipeRowTestId(String(row.id))}-version`}
                    variant="mono"
                    numberOfLines={1}
                >
                    {t('kitchen:recipes.versionOfCount', {
                        number: row.currentVersionNumber,
                        count: row.versionCount,
                    })}
                </Text>
            ),
        },
        {
            key: 'versionState',
            label: t('kitchen:recipes.columnVersionState'),
            width: 118,
            min: 86,
            priority: CATALOGUE_PRIORITY.unitPrice,
            badge: true,
            // No `role`, so this column belongs to the wide row alone. The narrow row already leads
            // with the *recipe's* status badge, and two badges on one two-line row is a reader
            // deciding which of them the row is in — a question the desk surface has the width to
            // answer with two labelled tracks and the phone does not.
            //
            // Not sortable: the value arrives per row and out of order, so a sort would order the
            // rows that had answered and shuffle the rest in underneath as they landed.
            value: (row) => {
                const status = versionState(row);
                return status === undefined ? '' : t(statusShortKey(status));
            },
            render: (row) => {
                const status = versionState(row);
                if (status === undefined) {
                    return (
                        <Skeleton
                            testID={`${recipeRowTestId(String(row.id))}-version-loading`}
                            heightClassName="h-4"
                            widthClassName="w-16"
                        />
                    );
                }
                return (
                    <Badge
                        testID={`${recipeRowTestId(String(row.id))}-version-status`}
                        tone={statusTone(status)}
                        label={t(statusShortKey(status))}
                    />
                );
            },
        },
        {
            key: 'allergens',
            label: t('kitchen:recipes.columnAllergens'),
            width: 168,
            min: 132,
            priority: CATALOGUE_PRIORITY.allergens,
            role: 'meta',
            value: (row) => allergenLabel(row) ?? '',
            render: (row) => {
                const label = allergenLabel(row);
                if (label === undefined) {
                    return (
                        <Skeleton
                            testID={`${recipeRowTestId(String(row.id))}-allergens-loading`}
                            heightClassName="h-4"
                            widthClassName="w-24"
                        />
                    );
                }
                const testID = recipeRowTestId(String(row.id));
                const derived = detailOf(row)?.currentVersion.allergens ?? [];
                return (
                    <Text
                        // Two ids, because "this version declares nothing" and "this version
                        // declares Sesame" are different answers and a suite has to be able to tell
                        // them apart without reading the copy.
                        testID={derived.length === 0 ? `${testID}-allergens-none` : `${testID}-allergens`}
                        tone="secondary"
                        numberOfLines={1}
                    >
                        {label}
                    </Text>
                );
            },
        },
        {
            key: 'status',
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
                    testID={`${recipeRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            label: t('kitchen:catalogue.columnUpdated'),
            width: 96,
            min: 72,
            priority: CATALOGUE_PRIORITY.updated,
            align: 'center',
            sortable: true,
            sortType: 'text',
            // One line, relative. The author's name went with the second line for the reason the
            // ingredient spec records: it is a fact about a record, not about a list. The View
            // drawer and the editor both still state it.
            value: (row) => formatter.formatRelativeTime(row.meta.updatedAt),
            render: (row) => (
                <Text
                    testID={`${recipeRowTestId(String(row.id))}-updated`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {formatter.formatRelativeTime(row.meta.updatedAt)}
                </Text>
            ),
        },
    ];
}
