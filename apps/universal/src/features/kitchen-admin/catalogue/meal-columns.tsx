import type { MealAdmin } from '@healthy360/api-client/contracts';
import { Badge, Inline, Text } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import {
    availableChannels,
    channelKey,
    displayName,
    mealRowTestId,
    mealTypeKey,
    statusShortKey,
    statusTone,
} from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * Meals, as an array.
 *
 * This is the one Catalogue list whose rows a customer also reads. Publishing a meal puts it in the
 * marketplace listing and on its own public page; withdrawing one takes it away — the admin and
 * consumer surfaces read the same store — so Status is the most load-bearing track here, and the
 * spec spends its badge on it rather than on the derived allergen label the way an ingredient does.
 *
 * ## The tracks
 *
 * | column    | track | floor | priority | note                                       |
 * | --------- | ----: | ----: | -------: | ------------------------------------------ |
 * | Meal      |   260 |   150 |      100 | the title; thumbnail, name, AR marker      |
 * | Channels  |   150 |   110 |       75 | secondary, comma run                       |
 * | Meal type |   132 |   100 |       50 | secondary; hosts the meal-type filter      |
 * | Category  |   140 |   112 |       40 | the kitchen's own filing pair              |
 * | Allergens |   168 |   132 |       30 | secondary, comma run, frozen at publication|
 * | Status    |   110 |    78 |       80 | badge                                      |
 * | Updated   |    96 |    72 |       20 | secondary, centred, relative               |
 *
 * The tracks are the ingredient spec's, moved across a position at a time. Allergens takes 168
 * rather than that list's 160 for the reason `recipe-columns.tsx` gives: a *derived* label runs
 * longer than a declared one, because it is the union of every line's classes rather than one
 * record's own.
 *
 * ## There is no metric column, and that is the honest answer
 *
 * The ladder reserves 85 for the entity's headline number and this spec leaves it empty. A meal's
 * one number is `marginPercent`, which is CONFIDENTIAL — it is the margin against the recipe's cost
 * per serving, it is `null` whenever either side of that sum is missing, and it needs a permission
 * this list does not ask for. Promoting a nullable confidential figure into the track the narrow
 * row keeps would put a blank where a reader expects the row's point. So the narrow row carries the
 * title, the status and the meta run, and nothing pretends to be a metric.
 *
 * ## The thumbnail stays, at 20px
 *
 * A 28px Catalogue row has no track for photography, and every other list in this workspace is text
 * — but this is the only surface in the admin that shows the picture a shopper sees, because the
 * meal editor has no image field either. Twenty pixels inside the title cell is what that costs,
 * and it is decorative: the name beside it carries the meaning (WCAG H67).
 *
 * ## Allergens is a comma run and says so when it is empty
 *
 * "None declared" rather than a blank. The label is frozen from the recipe version at publication
 * and never edited on a meal, so an empty set here is a real declaration — and on the one column a
 * kitchen reads for safety, "this meal declares none" and "nothing has loaded" must not look alike.
 */

export interface MealColumnDeps {
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    /**
     * Still on the deps, unread since Updated left the row: the caller has it to hand and the
     * next figure this list draws will want it. Not destructured, because an unread binding is
     * a lint error and a silent one is worse than a stated one.
     */
    readonly formatter: Formatter;
}

export function mealColumns({ t, locale }: MealColumnDeps): readonly CatalogueColumn<MealAdmin>[] {
    const channelLabel = (row: MealAdmin): string => {
        const channels = availableChannels(row.channelAvailability);
        return channels.length === 0
            ? t('kitchen:meals.noChannels')
            : channels.map((channel) => t(channelKey(channel))).join(', ');
    };

    const categoryLabel = (row: MealAdmin): string => {
        if (row.kitchenCategory === null) return t('kitchen:list.noCategory');
        return row.kitchenSubcategory === null
            ? row.kitchenCategory
            : `${row.kitchenCategory} / ${row.kitchenSubcategory}`;
    };

    const allergenLabel = (row: MealAdmin): string =>
        row.allergens.length === 0
            ? t('kitchen:list.noAllergens')
            : row.allergens.map((code) => String(code)).join(', ');

    return [
        {
            key: 'name',
            label: t('kitchen:meals.columnName'),
            width: 200,
            min: 150,
            priority: CATALOGUE_PRIORITY.designation,
            role: 'title',
            sortable: true,
            sortType: 'text',
            value: (row) => displayName(row.name, locale).value,
            render: (row) => {
                const name = displayName(row.name, locale);
                const testID = mealRowTestId(String(row.id));
                return (
                    <Inline space="xs" align="center">
                        <View className="w-5">
                            <EntityImage
                                assetId={row.imagePlaceholderId}
                                seed={String(row.id)}
                                label={name.value}
                                aspect="square"
                                variant="card"
                                decorative
                            />
                        </View>
                        <Text variant="label" testID={`${testID}-name`}>
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${testID}-missing-arabic`}
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
            key: 'channels',
            label: t('kitchen:meals.columnChannels'),
            width: 150,
            min: 110,
            priority: CATALOGUE_PRIORITY.unitPrice,
            role: 'meta',
            value: channelLabel,
            render: (row) => {
                const testID = mealRowTestId(String(row.id));
                const channels = availableChannels(row.channelAvailability);

                return channels.length === 0 ? (
                    <Text testID={`${testID}-channels-none`} tone="secondary">
                        {t('kitchen:meals.noChannels')}
                    </Text>
                ) : (
                    <Text testID={`${testID}-channels`} tone="secondary">
                        {channelLabel(row)}
                    </Text>
                );
            },
        },
        {
            key: 'mealTypes',
            label: t('kitchen:meals.typeFilterLabel'),
            width: 132,
            min: 100,
            priority: CATALOGUE_PRIORITY.unit,
            role: 'meta',
            value: (row) =>
                row.mealTypes.length === 0
                    ? t('kitchen:list.noValue')
                    : row.mealTypes.map((type) => t(mealTypeKey(type))).join(', '),
            render: (row) => (
                <Text testID={`${mealRowTestId(String(row.id))}-meal-types`} tone="secondary">
                    {row.mealTypes.length === 0
                        ? t('kitchen:list.noValue')
                        : row.mealTypes.map((type) => t(mealTypeKey(type))).join(', ')}
                </Text>
            ),
        },
        {
            key: 'category',
            label: t('kitchen:list.columnCategory'),
            width: 160,
            min: 112,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            value: categoryLabel,
            render: (row) =>
                row.kitchenCategory === null ? (
                    <Text
                        testID={`${mealRowTestId(String(row.id))}-kitchen-category-none`}
                        tone="secondary"
                    >
                        {t('kitchen:list.noCategory')}
                    </Text>
                ) : (
                    <Text
                        testID={`${mealRowTestId(String(row.id))}-kitchen-category`}
                        tone="secondary"
                    >
                        {categoryLabel(row)}
                    </Text>
                ),
        },
        {
            key: 'allergens',
            label: t('kitchen:meals.columnAllergens'),
            width: 168,
            min: 132,
            priority: CATALOGUE_PRIORITY.allergens,
            value: allergenLabel,
            render: (row) => {
                const testID = mealRowTestId(String(row.id));
                return row.allergens.length === 0 ? (
                    <Text testID={`${testID}-allergens-none`} tone="secondary">
                        {t('kitchen:list.noAllergens')}
                    </Text>
                ) : (
                    <Text testID={`${testID}-allergens`} tone="secondary">
                        {allergenLabel(row)}
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
                    testID={`${mealRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    // No mark on Published. The tone's default `✓` is `Badge`'s way of keeping
                    // meaning off colour alone, and "Published" is a word that needs no help —
                    // §prop docs allow `null` for exactly that case. Draft and Review keep theirs,
                    // because those two are the states a reader is scanning *for*.
                    icon={row.meta.status === 'published' ? null : undefined}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
    ];
}
