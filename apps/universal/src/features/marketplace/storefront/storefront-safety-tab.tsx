import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { DimensionValue } from 'react-native';
import { useFormatter } from '@healthy360/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { MEDICAL_DISCLAIMER_TEST_ID } from '../../../safety/medical-disclaimer.tsx';
import { allergenKey } from '../format.ts';

import { allergenTally, withNutrition } from './storefront-menu.ts';

/**
 * The storefront's Safety tab, as the accepted shop board draws it: each allergen the menu
 * declares as a card — how many dishes declare it, and a bar for its share of the menu — then the
 * standing disclaimer on the board's warm card.
 *
 * ## The figures are the menu's
 *
 * Counted over the whole menu (the screen loads it in full first). Above the allergen cards, three
 * small figures keep what the page has always answered: how many allergens are declared, how much
 * of the menu publishes nutrition, and whether the kitchen is verified. Under them, every diet the
 * kitchen cooks for, uncapped — the directory card shows three, and this is where the rest are.
 *
 * The note is `MedicalDisclaimer`'s fixed copy and test id, drawn in the board's warm box.
 */
export interface StorefrontSafetyTabProps {
    readonly kitchen: Kitchen;
    /** The whole menu — every page. */
    readonly meals: readonly MarketplaceMeal[];
}

export function StorefrontSafetyTab({ kitchen, meals }: StorefrontSafetyTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const tally = useMemo(() => allergenTally(meals), [meals]);
    const published = useMemo(() => withNutrition(meals), [meals]);

    const figure = (key: string, value: string, title: string, body: string) => (
        <View
            key={key}
            testID={`kitchen-safety-${key}`}
            className="min-w-[200px] flex-1 basis-[30%] flex-col gap-1 rounded-2xl border border-stroke-subtle bg-surface-raised p-4"
        >
            <RNText className="font-display text-2xl font-bold tabular-nums text-content-primary text-start">
                {value}
            </RNText>
            <RNText className="text-sm font-bold text-content-primary text-start">{title}</RNText>
            <RNText
                testID={`kitchen-safety-${key}-body`}
                className="text-xs leading-normal text-content-secondary text-start"
            >
                {body}
            </RNText>
        </View>
    );

    return (
        <View className="flex-col gap-4" testID="kitchen-safety-tab">
            <View className="flex-row flex-wrap gap-3">
                {figure(
                    'allergens',
                    formatter.formatNumber(tally.length),
                    t('marketplace:storefront.safety.allergensTitle'),
                    tally.length === 0
                        ? t('marketplace:storefront.safety.noAllergens')
                        : t('marketplace:storefront.safety.allergensBody', {
                              list: tally
                                  .map((entry) =>
                                      t('marketplace:storefront.safety.allergenCount', {
                                          allergen: t(allergenKey(entry.code)),
                                          count: formatter.formatNumber(entry.count),
                                      }),
                                  )
                                  .join(t('marketplace:common.listSeparator')),
                          }),
                )}
                {figure(
                    'nutrition',
                    t('marketplace:storefront.safety.nutritionFigure', {
                        count: formatter.formatNumber(published),
                        total: formatter.formatNumber(meals.length),
                    }),
                    t('marketplace:storefront.safety.nutritionTitle'),
                    t('marketplace:storefront.safety.nutritionBody'),
                )}
                {figure(
                    'verified',
                    kitchen.isVerified
                        ? t('marketplace:storefront.safety.verifiedFigure')
                        : t('marketplace:storefront.facts.none'),
                    t('marketplace:storefront.safety.verifiedTitle'),
                    kitchen.isVerified
                        ? t('marketplace:storefront.safety.verifiedBody')
                        : t('marketplace:storefront.safety.unverifiedBody'),
                )}
            </View>

            {tally.length === 0 ? null : (
                <View testID="kitchen-safety-grid" className="flex-row flex-wrap gap-3">
                    {tally.map((entry) => (
                        <View
                            key={entry.code}
                            testID={`kitchen-safety-allergen-${entry.code}`}
                            className="min-w-[240px] flex-1 basis-[45%] flex-row items-center gap-3 rounded-[18px] border border-stroke-subtle bg-surface-raised p-3.5"
                        >
                            <RNText className="min-w-[44px] font-display text-2xl font-bold tabular-nums text-content-primary">
                                {formatter.formatNumber(entry.count)}
                            </RNText>
                            <View className="min-w-0 flex-1 flex-col">
                                <RNText className="text-sm font-bold text-content-primary text-start">
                                    {t(allergenKey(entry.code))}
                                </RNText>
                                <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-base">
                                    <View
                                        className="h-full rounded-full bg-warning-border"
                                        style={{
                                            width: `${String(
                                                meals.length === 0
                                                    ? 0
                                                    : Math.round(
                                                          (entry.count / meals.length) * 100,
                                                      ),
                                            )}%` as DimensionValue,
                                        }}
                                    />
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            )}

            {/*
             * Every diet the kitchen cooks for, in full and uncapped. The directory card shows three;
             * this is where the rest are.
             */}
            <View
                testID="kitchen-diets"
                className="flex-col gap-3 rounded-3xl border border-stroke-subtle bg-surface-raised p-5"
            >
                <RNText className="text-xs font-bold uppercase tracking-widest text-content-secondary text-start">
                    {t('marketplace:storefront.safety.dietsEyebrow')}
                </RNText>
                {kitchen.dietClassifications.length === 0 ? (
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('marketplace:storefront.safety.noDiets')}
                    </RNText>
                ) : (
                    <View className="flex-row flex-wrap gap-2" testID="kitchen-diets-tags">
                        {kitchen.dietClassifications.map((diet) => (
                            <View
                                key={diet}
                                testID={`kitchen-diets-tags-${diet}`}
                                className="rounded-full bg-tint-green px-3 py-1.5"
                            >
                                <RNText className="text-sm font-semibold text-tint-green-on text-start">
                                    {t(`marketplace:diets.${diet}`)}
                                </RNText>
                            </View>
                        ))}
                    </View>
                )}
            </View>

            <View
                testID={MEDICAL_DISCLAIMER_TEST_ID}
                role="note"
                className="rounded-3xl bg-warning-subtle px-5 py-4"
            >
                <RNText className="text-sm leading-normal text-warning-on-subtle text-start">
                    <RNText className="font-semibold">
                        {t('marketplace:medicalDisclaimer.title')}
                    </RNText>
                    {t('marketplace:storefront.safety.noteJoin')}
                    {t('marketplace:medicalDisclaimer.body')}
                </RNText>
            </View>
        </View>
    );
}
