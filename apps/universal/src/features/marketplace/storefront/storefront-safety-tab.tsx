import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { MEDICAL_DISCLAIMER_TEST_ID } from '../../../safety/medical-disclaimer.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { allergenKey } from '../format.ts';

import { allergenTally, withNutrition } from './storefront-menu.ts';

/**
 * The storefront's "Safety & allergens" tab — HealthZone `§isStorefront` `storeIsSafety`: three
 * figure cards, the diets card, then the info note.
 *
 * ## The figures are the menu's, not the design's
 *
 * The design's three cards — "2 separate boards", "14 allergens declared", "verified Aug 14" — are
 * kitchen practices and an inspection date. Nothing records how a kitchen preps, and `isVerified`
 * carries no date. What *is* recorded is every listing's allergen declaration and whether it
 * publishes nutrition, so the cards state those, counted over the whole menu (the screen loads it
 * in full first), and the third states whether the kitchen is verified.
 *
 * The allergen card's body names each declared allergen with the number of dishes declaring it —
 * the tally a separate card used to carry, folded into the design's three so someone avoiding
 * sesame still learns at a glance how much of the menu is closed to them.
 *
 * ## The note is the standing disclaimer
 *
 * The design closes on an info note that the figures are estimates and not medical advice. That is
 * `MedicalDisclaimer`'s fixed copy, drawn here in the design's plain info box rather than as a
 * titled callout — the copy and the `medical-disclaimer` test id are the same.
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
            className="min-w-[220px] flex-1 grow basis-[30%] flex-col gap-2 rounded-xl border border-stroke bg-surface-raised p-5"
        >
            <RNText className="font-display text-3xl font-bold leading-tight tracking-display tabular-nums text-content-on-brand-subtle text-start">
                {value}
            </RNText>
            <RNText className="font-display text-base font-bold leading-tight text-content-primary text-start">
                {title}
            </RNText>
            <RNText
                testID={`kitchen-safety-${key}-body`}
                className="text-sm leading-normal text-content-secondary text-start"
            >
                {body}
            </RNText>
        </View>
    );

    return (
        <View className="flex-col gap-4" testID="kitchen-safety-tab">
            <View className="flex-row flex-wrap gap-4">
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

            {/*
             * Every diet the kitchen cooks for, in full and uncapped. The directory card shows three
             * and collapses the rest into a `+N`; the card is one press target, so the pill cannot
             * resolve itself — this is where that press lands, so this is where they all have to be.
             */}
            <View
                testID="kitchen-diets"
                className="flex-col gap-3 rounded-xl border border-stroke bg-surface-raised p-5"
            >
                <Eyebrow>{t('marketplace:storefront.safety.dietsEyebrow')}</Eyebrow>
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
                                className="rounded-full bg-surface-sunken px-3 py-1.5"
                            >
                                <RNText className="text-sm font-medium text-content-primary text-start">
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
                className="rounded-lg border border-info-border bg-info-subtle px-4 py-3"
            >
                <RNText className="text-sm leading-normal text-info-on-subtle text-start">
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
