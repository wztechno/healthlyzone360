import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { DimensionValue } from 'react-native';
import { useFormatter } from '@healthy360/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { MEDICAL_DISCLAIMER_TEST_ID } from '../../../safety/medical-disclaimer.tsx';
import { useMyAllergenCodes } from '../../commerce/my-allergens.tsx';
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
 * tiles keep what the page has always answered: how many allergens are declared, how much of the
 * menu publishes nutrition, and whether the kitchen is verified. An allergen on the person's own
 * list is tinted red and tagged. Under them, every diet the
 * kitchen cooks for, uncapped — the directory card shows three, and this is where the rest are.
 *
 * The note is `MedicalDisclaimer`'s fixed copy and test id, as a quiet foot line.
 */
export interface StorefrontSafetyTabProps {
    readonly kitchen: Kitchen;
    /** The whole menu — every page. */
    readonly meals: readonly MarketplaceMeal[];
}

export function StorefrontSafetyTab({ kitchen, meals }: StorefrontSafetyTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const mine = useMyAllergenCodes();

    const tally = useMemo(() => allergenTally(meals), [meals]);
    const published = useMemo(() => withNutrition(meals), [meals]);

    /*
     * Shop · Kitchens + storefront, pin 2: three figures as tiles — an icon, the figure, what it
     * counts — and no comma list: the allergen tiles below already name every allergen.
     */
    const figure = (
        key: string,
        icon: IconName,
        tone: 'warning' | 'brand' | 'info',
        value: string,
        title: string,
    ) => (
        <View
            key={key}
            testID={`kitchen-safety-${key}`}
            className="min-w-[200px] flex-1 basis-[30%] flex-row items-center gap-3.5 rounded-[20px] border border-stroke-subtle bg-surface-raised p-4"
        >
            <View
                className={cx(
                    'h-[46px] w-[46px] items-center justify-center rounded-[15px]',
                    tone === 'warning'
                        ? 'bg-warning-subtle'
                        : tone === 'brand'
                          ? 'bg-surface-brand-subtle'
                          : 'bg-tint-blue',
                )}
            >
                <Icon
                    name={icon}
                    size="lg"
                    className={
                        tone === 'warning'
                            ? 'text-warning-on-subtle'
                            : tone === 'brand'
                              ? 'text-content-on-brand-subtle'
                              : 'text-tint-blue-on'
                    }
                />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary text-start">
                    {value}
                </RNText>
                <RNText
                    testID={`kitchen-safety-${key}-body`}
                    className="mt-0.5 text-sm font-semibold text-content-secondary text-start"
                >
                    {title}
                </RNText>
            </View>
        </View>
    );

    return (
        <View className="flex-col gap-4" testID="kitchen-safety-tab">
            <View className="flex-row flex-wrap gap-3">
                {figure(
                    'allergens',
                    'alert',
                    'warning',
                    formatter.formatNumber(tally.length),
                    t('marketplace:storefront.safety.allergensTitle'),
                )}
                {figure(
                    'nutrition',
                    'leaf',
                    'brand',
                    t('marketplace:storefront.safety.nutritionFigure', {
                        count: formatter.formatNumber(published),
                        total: formatter.formatNumber(meals.length),
                    }),
                    t('marketplace:storefront.safety.nutritionTitle'),
                )}
                {figure(
                    'verified',
                    'badgeCheck',
                    'info',
                    kitchen.isVerified
                        ? t('marketplace:storefront.safety.verifiedFigure')
                        : t('marketplace:storefront.facts.none'),
                    kitchen.isVerified
                        ? t('marketplace:storefront.safety.verifiedTitle')
                        : t('marketplace:storefront.safety.unverifiedBody'),
                )}
            </View>

            {tally.length === 0 ? (
                <RNText
                    testID="kitchen-safety-none"
                    className="text-sm text-content-secondary text-start"
                >
                    {t('marketplace:storefront.safety.noAllergens')}
                </RNText>
            ) : (
                <View className="flex-col gap-2.5">
                    <RNText className="text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                        {t('marketplace:storefront.safety.eachEyebrow')}
                    </RNText>
                    <View testID="kitchen-safety-grid" className="flex-row flex-wrap gap-3">
                        {tally.map((entry) => {
                            // Shop · Kitchens + storefront, pin 3: the person's own allergens stand out.
                            const yours = mine.includes(entry.code);
                            return (
                                <View
                                    key={entry.code}
                                    testID={`kitchen-safety-allergen-${entry.code}`}
                                    className={cx(
                                        'min-w-[240px] flex-1 basis-[45%] flex-row items-center gap-3 rounded-[18px] border p-3.5',
                                        yours
                                            ? 'border-danger-border bg-danger-subtle'
                                            : 'border-stroke-subtle bg-surface-raised',
                                    )}
                                >
                                    <RNText className="min-w-[44px] font-display text-2xl font-bold tabular-nums text-content-primary">
                                        {formatter.formatNumber(entry.count)}
                                    </RNText>
                                    <View className="min-w-0 flex-1 flex-col">
                                        <View className="flex-row flex-wrap items-center gap-2">
                                            <RNText className="text-sm font-bold text-content-primary text-start">
                                                {t(allergenKey(entry.code))}
                                            </RNText>
                                            {yours ? (
                                                <View
                                                    testID={`kitchen-safety-allergen-${entry.code}-yours`}
                                                    className="h-[22px] flex-row items-center gap-1 rounded-full bg-danger-strong px-2"
                                                >
                                                    <Icon
                                                        name="shield"
                                                        size="sm"
                                                        className="text-danger-on-strong"
                                                    />
                                                    <RNText className="text-xs font-bold text-danger-on-strong">
                                                        {t('commerce:myAllergens.dialogTitle')}
                                                    </RNText>
                                                </View>
                                            ) : null}
                                        </View>
                                        <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-base">
                                            <View
                                                className={cx(
                                                    'h-full rounded-full',
                                                    yours
                                                        ? 'bg-danger-strong'
                                                        : 'bg-warning-border',
                                                )}
                                                style={{
                                                    width: `${String(
                                                        meals.length === 0
                                                            ? 0
                                                            : Math.round(
                                                                  (entry.count / meals.length) *
                                                                      100,
                                                              ),
                                                    )}%` as DimensionValue,
                                                }}
                                            />
                                        </View>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
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

            {/* The standing disclaimer, as a quiet foot line rather than a box of its own. */}
            <View
                testID={MEDICAL_DISCLAIMER_TEST_ID}
                role="note"
                className="flex-row items-start gap-2"
            >
                <Icon name="infoCircle" size="md" className="mt-0.5 text-content-on-brand-subtle" />
                <RNText className="min-w-0 flex-1 text-sm leading-normal text-content-secondary text-start">
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
