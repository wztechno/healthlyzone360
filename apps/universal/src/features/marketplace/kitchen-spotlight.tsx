import { Button } from '@healthy360/design-system';
import type { DietClassification } from '@healthy360/domain-types';
import { gradients } from '@healthy360/design-tokens';
import { useFormatter, useIsRtl } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery } from '../../data/catalogue-hooks.ts';
import { EntityImage } from '../../media/entity-image.tsx';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import {
    kitchenSummary,
    kitchenTerms,
    kitchenWhy,
    todayLabel,
    todayWindow,
} from './kitchen-finder-card.tsx';
import { dishPreviewFilter, matchedDiets } from './kitchen-finder.ts';
import type { Spotlight } from './kitchen-finder.ts';

/**
 * The canopy panel the finder leads with when nothing is filtered — HealthZone's spotlight: the
 * badges row, the kitchen's name at display size, the why-line with its cuisine, the four-figure
 * row (RATING / DELIVERY / FEE / MINIMUM), two buttons, and beside it a three-photograph mosaic,
 * one large and two stacked.
 *
 * ## What its badges may say
 *
 * The design's "98% MATCH · YOUR BEST FIT" is a profile score nothing computes. The leading badge
 * states why this kitchen is here, and only that ({@link Spotlight.reason}): "YOUR BEST FIT · DIET
 * MATCH 2/3" when it cooks for the most of the shopper's declared diets, "TOP RATED" when it leads
 * on rating, nothing when it is simply first.
 *
 * ## The sweep, and the scrim under the copy
 *
 * The design sweeps canopy into canopy-deep. This is the token canopy sweep the storefront band
 * uses, with the same dark→clear scrim along the reading direction: the on-canopy inks are
 * contrast-tested against the flat canopy, and the scrim is what keeps the copy on that floor where
 * the sweep runs brighter. The mosaic covers the far end, as the design's does.
 */
export interface KitchenSpotlightProps {
    readonly spotlight: Spotlight;
    readonly profileDiets?: readonly DietClassification[] | undefined;
    readonly testID?: string | undefined;
}

export function KitchenSpotlight({
    spotlight,
    profileDiets = [],
    testID = 'kitchens-spotlight',
}: KitchenSpotlightProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const isRtl = useIsRtl();
    const { kitchen, reason } = spotlight;
    const kitchenId = String(kitchen.id);

    // The same filter the card below asks with, so the two share one cache entry.
    const dishes = mealsFromPages(useMealsQuery(dishPreviewFilter(kitchen.id)).data?.pages);

    const today = todayWindow(kitchen);
    // The design's paragraph: the why-line, then the cuisine and where it cooks.
    const reasonLine = kitchenWhy(kitchen, profileDiets, t) ?? kitchen.description.trim();
    const summary = kitchenSummary(kitchen, t);
    const why =
        reasonLine === '' || summary === ''
            ? reasonLine + summary
            : t('marketplace:kitchens.finder.whyWithSummary', { why: reasonLine, summary });

    const facts = [
        {
            key: 'rating',
            value:
                kitchen.rating === null
                    ? t('marketplace:kitchens.notRatedYet')
                    : t('marketplace:kitchens.finder.ratingValue', {
                          rating: formatter.formatNumber(kitchen.rating, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                          }),
                      }),
        },
        ...kitchenTerms(kitchen, formatter, t).map((term) => ({
            key: term.key,
            value: term.value ?? t('marketplace:kitchens.finder.noFigure'),
        })),
    ];

    const lead =
        reason === 'match'
            ? t('marketplace:kitchens.finder.bestFit', {
                  diets: matchedDiets(kitchen, profileDiets)
                      .map((diet) => t(`marketplace:diets.${diet}`).toLocaleLowerCase())
                      .join(t('marketplace:kitchens.areaSeparator')),
              })
            : reason === 'rating'
              ? t('marketplace:kitchens.finder.topRated')
              : null;

    // Three slots, always: a dish the kitchen has not photographed — or not published — shows the
    // app's generated placeholder in its place rather than collapsing the mosaic.
    const tiles = [0, 1].map((index) => {
        const meal = dishes[index];
        return meal === undefined
            ? {
                  key: `slot-${String(index)}`,
                  assetId: undefined,
                  seed: `${kitchen.slug}-${String(index)}`,
                  label: kitchen.name,
              }
            : {
                  key: String(meal.id),
                  assetId: meal.imagePlaceholderId,
                  seed: meal.slug,
                  label: meal.name,
              };
    });

    return (
        <View
            testID={testID}
            className="mt-6 flex-col overflow-hidden rounded-xl bg-surface-canopy lg:flex-row"
        >
            <View className="flex-col gap-4 p-6 md:px-8 md:py-8 lg:flex-1">
                <LinearGradient
                    colors={gradients.canopy.colours}
                    locations={gradients.canopy.locations}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                    colors={gradients.canopyScrim.colours}
                    start={isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                    end={isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                />

                <View className="flex-row flex-wrap gap-2">
                    {lead === null ? null : (
                        <View
                            testID={`${testID}-lead`}
                            className="rounded-full bg-surface-brand px-3 py-1"
                        >
                            <RNText className="text-xs font-medium uppercase tracking-wider tabular-nums text-content-on-brand">
                                {lead}
                            </RNText>
                        </View>
                    )}
                    {today === undefined ? null : (
                        <View
                            testID={`${testID}-today`}
                            className="rounded-full bg-surface-raised px-3 py-1"
                        >
                            <RNText className="text-xs font-medium uppercase tracking-wider tabular-nums text-content-primary">
                                {todayLabel(today, t)}
                            </RNText>
                        </View>
                    )}
                </View>

                <RNText
                    testID={`${testID}-name`}
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-3xl font-bold leading-none tracking-display text-content-on-canopy text-start md:text-4xl"
                >
                    {kitchen.name}
                </RNText>

                {why === '' ? null : (
                    <RNText
                        testID={`${testID}-why`}
                        className="max-w-[480px] text-base leading-relaxed text-content-on-canopy-muted text-start"
                    >
                        {why}
                    </RNText>
                )}

                <View
                    testID={`${testID}-facts`}
                    className="mt-1 flex-row flex-wrap gap-x-6 gap-y-3 border-t border-surface-canopy-deep pt-4"
                >
                    {facts.map((fact) => (
                        <View key={fact.key} className="flex-col gap-1">
                            <Eyebrow tone="canopy">
                                {t(`marketplace:kitchens.finder.fact.${fact.key}`)}
                            </Eyebrow>
                            <RNText
                                testID={`${testID}-fact-${fact.key}`}
                                numberOfLines={1}
                                className="font-display text-base font-bold tabular-nums text-content-on-canopy text-start"
                            >
                                {fact.value}
                            </RNText>
                        </View>
                    ))}
                </View>

                <View className="mt-auto flex-row flex-wrap gap-3 pt-2">
                    <Button
                        testID={`${testID}-open`}
                        label={t('marketplace:kitchens.finder.openKitchen')}
                        onPress={() => {
                            router.push(`/kitchens/${kitchenId}` as never);
                        }}
                    />
                    {kitchen.channels.subscription ? (
                        <Button
                            testID={`${testID}-plans`}
                            variant="secondary"
                            label={t('marketplace:kitchens.finder.seePlans')}
                            onPress={() => {
                                router.push(`/plans?kitchen=${kitchenId}` as never);
                            }}
                        />
                    ) : null}
                </View>
            </View>

            {/*
             * The mosaic: the kitchen large, two of its dishes stacked beside it — the design's
             * 1.4fr / 1fr, carried as flex weights. A fixed height below `lg`, where it stacks
             * under the copy; beside the copy it takes the panel's height, never less than 320px.
             */}
            <View
                testID={`${testID}-media`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-[240px] flex-row gap-1 lg:h-auto lg:min-h-[320px] lg:flex-1"
            >
                <View className="flex-[1.4] overflow-hidden">
                    <EntityImage
                        assetId={kitchen.imagePlaceholderId}
                        variant="card"
                        seed={kitchen.slug}
                        label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                        decorative
                        flush
                        className="h-full"
                    />
                </View>
                <View className="flex-1 flex-col gap-1">
                    {tiles.map((tile) => (
                        <View key={tile.key} className="flex-1 overflow-hidden">
                            <EntityImage
                                assetId={tile.assetId}
                                variant="card"
                                seed={tile.seed}
                                label={tile.label}
                                decorative
                                flush
                                className="h-full"
                            />
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}
