import { cx } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { gradients } from '@healthy360/design-tokens';
import { useFormatter, useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { activeBranches, hoursToday, pickupBranches } from '../storefront-facts.ts';

import { deliveryMinutesRange, monogram } from './storefront-today.ts';

/**
 * The storefront's opening — HealthZone `§isStorefront`: one rounded canopy band, split into the
 * kitchen's panel and its photograph.
 *
 * ## Why not `StorefrontHero`
 *
 * The shared hero takes an eyebrow, a title, a body and an action slot pinned to the panel's foot,
 * and draws the panel and the photograph as two separate rounded blocks. The design's storefront
 * is one band with the photograph flush in its far half, a monogram tile beside the name, the
 * status pills *between* the name and the description, and the facts pinned to the foot. Bending
 * the shared hero to that would mean four new slots used by one caller, so it is built here.
 *
 * ## Top to bottom
 *
 * 1. **Eyebrow** — "Kitchen · {areas}", from the active branches.
 * 2. **Monogram and name** — the tile is the name's initials on the brand fill.
 * 3. **Pills** — today's published window (or "Closed today"), "Verified kitchen" for a verified
 *    kitchen, and the ways to order: delivery, pickup, plans, each only where offered. Today's
 *    window rather than "open now" — `storefront-facts.ts` says why.
 * 4. **Description** — the kitchen's own, falling back to its tagline.
 * 5. **Facts** — rating, delivery, cuisine, branches, always four, as the design draws them. A fact
 *    the contract has no value for reads "—", and the rating reads "Not rated yet" until there is
 *    one. The delivery figure is the range across the kitchen's zones.
 */
export interface StorefrontCanopyProps {
    readonly kitchen: Kitchen;
    readonly testID?: string | undefined;
}

export function StorefrontCanopy({ kitchen, testID = 'kitchen-hero' }: StorefrontCanopyProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const isRtl = useIsRtl();

    const branches = activeBranches(kitchen);
    const areas = [...new Set(branches.map((branch) => branch.area))];
    const today = hoursToday(kitchen);
    const range = deliveryMinutesRange(kitchen);
    const none = t('marketplace:storefront.facts.none');

    const ways = [
        kitchen.channels.delivery ? t('marketplace:storefront.ways.delivery') : null,
        pickupBranches(kitchen).length > 0 ? t('marketplace:storefront.ways.pickup') : null,
        kitchen.channels.subscription ? t('marketplace:storefront.ways.plans') : null,
    ].filter((way) => way !== null);

    const facts = [
        {
            key: 'rating',
            label: t('marketplace:storefront.facts.rating'),
            value:
                kitchen.rating === null
                    ? t('marketplace:storefront.facts.notRated')
                    : t('marketplace:storefront.facts.ratingValue', {
                          rating: formatter.formatNumber(kitchen.rating, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                          }),
                          count: kitchen.ratingCount,
                          formattedCount: formatter.formatNumber(kitchen.ratingCount),
                      }),
        },
        {
            key: 'delivery',
            label: t('marketplace:storefront.facts.delivery'),
            value:
                range === null
                    ? none
                    : range.min === range.max
                      ? t('marketplace:storefront.facts.minutes', {
                            minutes: formatter.formatNumber(range.min),
                        })
                      : t('marketplace:storefront.facts.minutesRange', {
                            min: formatter.formatNumber(range.min),
                            max: formatter.formatNumber(range.max),
                        }),
        },
        {
            key: 'cuisine',
            label: t('marketplace:storefront.facts.cuisine'),
            value:
                kitchen.cuisines.length === 0
                    ? none
                    : kitchen.cuisines.join(t('marketplace:storefront.separator')),
        },
        {
            key: 'branches',
            label: t('marketplace:storefront.facts.branches'),
            value:
                branches.length === 0
                    ? none
                    : t('marketplace:storefront.facts.branchCount', {
                          count: branches.length,
                          formattedCount: formatter.formatNumber(branches.length),
                      }),
        },
    ];

    const description = kitchen.description === '' ? kitchen.tagline : kitchen.description;
    const pill = 'rounded-full px-2.5 py-1';
    const pillText = 'text-xs font-medium uppercase tracking-wide text-start';

    return (
        <View
            testID={testID}
            className="flex-col overflow-hidden rounded-xl bg-surface-canopy lg:flex-row"
        >
            {/*
             * The design's 135° canopy sweep, under the whole band, then the same reading-direction
             * scrim `StorefrontHero` lays over it: the sweep runs brighter than the flat deep forest
             * the canopy text alphas are measured on, and without the scrim the body fails AA there.
             */}
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

            <View testID={`${testID}-panel`} className="flex-1 flex-col gap-4 p-6 lg:px-9 lg:py-8">
                <Eyebrow tone="canopy" testID={`${testID}-eyebrow`}>
                    {areas.length === 0
                        ? t('marketplace:storefront.eyebrow')
                        : t('marketplace:storefront.eyebrowArea', {
                              areas: areas.join(t('marketplace:storefront.separator')),
                          })}
                </Eyebrow>

                {/*
                 * One row, never wrapped: a long name breaks inside its own column beside the
                 * tile, as the design draws it, rather than dropping whole under the tile.
                 */}
                <View className="flex-row items-center gap-4">
                    {/*
                     * The design's tile: 58px, three round corners and one tight one at the
                     * bottom-leading corner — `rounded-es-xs` is the logical corner, so it stays
                     * under the text's start in both directions.
                     */}
                    <View
                        testID={`${testID}-monogram`}
                        aria-hidden
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className="h-[58px] w-[58px] shrink-0 items-center justify-center rounded-xl rounded-es-sm bg-surface-brand"
                    >
                        <RNText className="font-display text-2xl font-bold text-content-on-brand">
                            {monogram(kitchen.name)}
                        </RNText>
                    </View>
                    <RNText
                        testID={`${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        className="min-w-0 flex-1 font-display text-4xl font-bold leading-none tracking-display text-content-on-canopy text-start lg:text-5xl"
                    >
                        {kitchen.name}
                    </RNText>
                </View>

                <View className="flex-row flex-wrap gap-2" testID="kitchen-pills">
                    <View
                        testID="kitchen-hours-today"
                        className={cx(pill, 'bg-surface-brand-subtle')}
                    >
                        <RNText
                            className={cx(pillText, 'tabular-nums text-content-on-brand-subtle')}
                        >
                            {today === null
                                ? t('marketplace:storefront.closedToday')
                                : t('marketplace:storefront.openToday', {
                                      opensAt: today.opensAt,
                                      closesAt: today.closesAt,
                                  })}
                        </RNText>
                    </View>
                    {kitchen.isVerified ? (
                        <View testID="kitchen-verified" className={cx(pill, 'bg-info-subtle')}>
                            <RNText className={cx(pillText, 'text-info-on-subtle')}>
                                {t('marketplace:storefront.verified')}
                            </RNText>
                        </View>
                    ) : null}
                    {ways.length === 0 ? null : (
                        <View testID="kitchen-ways" className={cx(pill, 'bg-surface-raised')}>
                            <RNText className={cx(pillText, 'text-content-primary')}>
                                {ways.join(t('marketplace:storefront.separator'))}
                            </RNText>
                        </View>
                    )}
                </View>

                {description === '' ? null : (
                    <RNText
                        testID={`${testID}-body`}
                        className="max-w-[560px] text-base leading-relaxed text-content-on-canopy-muted text-start"
                    >
                        {description}
                    </RNText>
                )}

                {/*
                 * The design's `auto-fit, minmax(130px, 1fr)`: `basis` with a `min-w`, so a wide
                 * panel sets the four across and a phone two by two. `mt-auto` pins the row to the
                 * panel's foot when the photograph beside it is the taller column.
                 */}
                <View
                    testID="kitchen-facts"
                    className="mt-auto flex-row flex-wrap gap-4 border-t border-surface-canopy-deep pt-4"
                >
                    {facts.map((fact) => (
                        <View
                            key={fact.key}
                            testID={`kitchen-fact-${fact.key}`}
                            className="min-w-[130px] flex-1 grow basis-[20%]"
                        >
                            <Eyebrow tone="canopy">{fact.label}</Eyebrow>
                            <RNText className="mt-1 font-display text-base font-bold leading-tight tracking-display text-content-on-canopy text-start">
                                {fact.value}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>

            <View
                testID={`${testID}-media`}
                className="relative min-h-[240px] flex-1 lg:min-h-[340px]"
            >
                <View className="absolute inset-0">
                    <EntityImage
                        testID={`${testID}-image`}
                        assetId={kitchen.imagePlaceholderId}
                        variant="detail"
                        seed={kitchen.slug}
                        label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                        aspect="card"
                        decorative
                        flush
                        className="h-full"
                    />
                </View>
            </View>
        </View>
    );
}
