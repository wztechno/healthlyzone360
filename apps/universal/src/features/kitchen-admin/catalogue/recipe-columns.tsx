import type { RecipeAdmin, RecipeAdminSummary } from '@healthy360/api-client/contracts';
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
 * | Id            |    96 |    84 |       88 | mono; the `RC-` handle                      |
 * | Production It.|   200 |   150 |      100 | the title; never dropped                    |
 * | Kitchen       |   140 |   120 |       40 | secondary; hosts the kitchen filter         |
 * | Allergens     |   168 |   132 |       30 | secondary, comma run, derived per row       |
 * | Status        |   110 |    78 |       80 | badge                                       |
 *
 * Version, Version state and Updated were all drawn here and are not any more — the first two by
 * request, the third across every Catalogue list at once. What a version is doing is a question
 * about one recipe, which is what the View panel and the editor are for; what a list is scanned for
 * is which recipes exist and which are live.
 *
 * The tracks are the ingredient spec's, moved across one position at a time rather than re-derived:
 * a kitchen that has learnt to read one Catalogue list down its reference column should not have to
 * relearn the geometry on the next one. Two differ, and both are the entity talking. Version state
 * takes 118 rather than the ingredient Unit price's 104 because it holds a badge, not a figure, and
 * a badge carries its own inset. Allergens takes 168 rather than 160 because a *derived* label runs
 * longer than a declared one — it is the union of every line's classes, not one record's own.
 *
 * ## This list has no headline metric
 *
 * The priority ladder reserves 85 for "the entity's headline metric", and on the ingredient list
 * that is the unit price. `RecipeAdminSummary` carries no money at all — cost lives on
 * `RecipeVersionAdmin.estimatedCost`, is CONFIDENTIAL, and needs a permission this list does not
 * ask for. The version pair used to hold that slot; with it gone the 85 is simply unspent here,
 * which is a better answer than promoting a column to a rank it does not earn.
 *
 * ## Allergens is derived, and says so while it waits
 *
 * It lives on `RecipeAdmin.currentVersion`, which the summary does not carry — the N+1
 * `useRecipeDetails` documents. It is fed a lookup rather than calling a query of its own: a column
 * spec is an array, and an array cannot call a hook.
 *
 * While a row's detail is in flight it renders a `Skeleton` at its own width rather than a dash.
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
    /**
     * Still on the deps, unread since Updated left the row: the caller has it to hand and the
     * next figure this list draws will want it. Not destructured, because an unread binding is
     * a lint error and a silent one is worse than a stated one.
     */
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
    detailOf,
}: RecipeColumnDeps): readonly CatalogueColumn<RecipeAdminSummary>[] {
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
            width: 96,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            // The record's own `RC-0001`, not its slug.
            //
            // The slug reads `tabbouleh-v2` and is derived from the name, so it changes when the
            // name is edited and sorts alphabetically rather than by age — which is not what a
            // column of identifiers is for. The reference is the handle the kitchen writes on a
            // sheet, it sits in the same series the recipe editor's own Id field has been showing
            // all along, and it is the one the `ING-` / `PKG-` columns next door are a series of.
            //
            // The prefix is `RC-`, set by `referenceSeries` on the editor and by the server that
            // issues the number. Renaming the series to `REC-` is a backend change and a migration
            // of every existing handle, not a display decision this file can make.
            //
            // `?? row.slug` because `reference` is null on rows that predate the series — a blank
            // identifier column is worse than the old handle for the rows that only have one.
            value: (row) => row.reference ?? row.slug,
            render: (row) => (
                <Text testID={`${recipeRowTestId(String(row.id))}-reference`} variant="mono">
                    {row.reference ?? row.slug}
                </Text>
            ),
        },
        {
            key: 'name',
            label: t('kitchen:recipes.columnName'),
            width: 200,
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
                        <Text variant="label" testID={`${recipeRowTestId(String(row.id))}-name`}>
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
                <Text testID={`${recipeRowTestId(String(row.id))}-kitchen`} tone="secondary">
                    {String(row.kitchenId)}
                </Text>
            ),
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
                        testID={
                            derived.length === 0
                                ? `${testID}-allergens-none`
                                : `${testID}-allergens`
                        }
                        tone="secondary"
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
                    // No mark on Published — see the note in `ingredient-columns.tsx`.
                    icon={row.meta.status === 'published' ? null : undefined}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
    ];
}
