import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { gradients } from '@healthy360/design-tokens';
import { useFormatter, useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { BackPill } from '../../../ui/back-pill.tsx';
import { weekdayKey } from '../format.ts';
import { kitchenAreas, kitchenWhere, useKitchenTallies } from '../kitchen-card-facts.ts';
import { hoursToday, nextOpenWeekday } from '../storefront-facts.ts';

/**
 * The storefront's opening, as the accepted shop board draws it: one rounded cover — the kitchen's
 * photograph under a green wash that deepens towards the start — with "All kitchens" at its top
 * corner, and along its foot the kitchen's badge, today's hours, its name, a row of facts and "See
 * weekly plans".
 *
 * - **Today's hours, not "open now"** — `storefront-facts.ts` says why. A closed day names the next
 *   day it opens.
 * - **The facts are counted or published** — where it cooks, the areas it delivers to, its rating,
 *   and its items and plans (`kitchen-card-facts.ts`). A rating not yet given reads so.
 * - **Save** is not drawn: favourites have no backend.
 */
export interface StorefrontCanopyProps {
    readonly kitchen: Kitchen;
    readonly onBack: () => void;
    /** Opens the Plans tab, which says so when the kitchen sells none. */
    readonly onSeePlans: () => void;
    readonly testID?: string | undefined;
}

export function StorefrontCanopy({
    kitchen,
    onBack,
    onSeePlans,
    testID = 'kitchen-hero',
}: StorefrontCanopyProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const isRtl = useIsRtl();
    const tallies = useKitchenTallies(kitchen);

    const today = hoursToday(kitchen);
    // Add stays live on a closed day, because a basket can name another: so the pill says which.
    const nextOpen = today === null ? nextOpenWeekday(kitchen) : null;
    const paused = kitchen.pausedUntil !== null && kitchen.pausedUntil !== undefined;
    const where = kitchenWhere(kitchen, t);
    const areas = kitchenAreas(kitchen);
    const dash = t('marketplace:kitchens.noCount');

    const facts: readonly {
        readonly key: string;
        readonly icon: IconName | null;
        readonly text: string;
    }[] = [
        ...(where === '' ? [] : [{ key: 'where', icon: 'mapPin' as const, text: where }]),
        ...(areas === 0
            ? []
            : [
                  {
                      key: 'areas',
                      icon: 'truck' as const,
                      text: t('marketplace:storefront.facts.areasValue', {
                          count: areas,
                          formattedCount: formatter.formatNumber(areas),
                      }),
                  },
              ]),
        {
            key: 'rating',
            icon: 'star',
            text:
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
            key: 'counts',
            icon: null,
            text: t('marketplace:storefront.facts.countsValue', {
                items: tallies.items ?? dash,
                plans: tallies.plans ?? dash,
            }),
        },
    ];

    return (
        <View
            testID={testID}
            className="relative mt-1 overflow-hidden rounded-[30px] bg-surface-canopy lg:h-[300px]"
        >
            <View testID={`${testID}-media`} className="absolute bottom-0 end-0 start-0 top-0">
                <View className="h-full w-full scale-[1.03] opacity-55">
                    <EntityImage
                        testID={`${testID}-image`}
                        assetId={kitchen.imagePlaceholderId}
                        variant="detail"
                        seed={kitchen.slug}
                        label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>
            </View>
            {/*
             * The board's green wash, deepest at the start, where the text is: it keeps the cover's
             * foreground at AA on any photograph.
             */}
            <LinearGradient
                colors={gradients.canopyScrim.colours}
                start={isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                end={isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
            />

            <View className="z-10 p-[18px]">
                <BackPill
                    testID="kitchen-crumb-kitchens"
                    label={t('marketplace:storefront.allKitchens')}
                    onPress={onBack}
                    className="shadow-elevation-3"
                />
            </View>

            <View
                testID={`${testID}-panel`}
                className="z-10 mt-auto flex-col gap-5 px-6 pb-7 pt-10 lg:absolute lg:bottom-0 lg:end-0 lg:start-0 lg:flex-row lg:items-end lg:gap-6 lg:px-10 lg:pb-8"
            >
                <View
                    testID={`${testID}-badge`}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="h-[96px] w-[96px] shrink-0 overflow-hidden rounded-[28px] border-[5px] border-surface-raised shadow-elevation-4 lg:h-[120px] lg:w-[120px] lg:rounded-[32px]"
                >
                    <EntityImage
                        assetId={kitchen.imagePlaceholderId}
                        seed={`${kitchen.slug}-logo`}
                        label={kitchen.name}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>

                <View className="min-w-0 flex-1 flex-col items-start">
                    <View
                        testID="kitchen-hours-today"
                        className={cx(
                            'h-[30px] flex-row items-center gap-2 rounded-full px-3',
                            paused ? 'bg-warning-subtle' : 'bg-stage-green/20',
                        )}
                    >
                        <View
                            className={cx(
                                'h-2 w-2 rounded-full',
                                paused
                                    ? 'bg-warning-strong'
                                    : today === null
                                      ? 'bg-content-on-canopy-muted'
                                      : 'bg-stage-green',
                            )}
                        />
                        <RNText
                            className={cx(
                                'text-xs font-bold uppercase tracking-wider tabular-nums',
                                paused ? 'text-warning-on-subtle' : 'text-content-on-canopy',
                            )}
                        >
                            {/* Shop · Kitchens + storefront, pin 4: paused shows on the cover. */}
                            {paused
                                ? t('marketplace:storefront.pausedPill', {
                                      time: formatter.formatDate(kitchen.pausedUntil ?? '', {
                                          timeStyle: 'short',
                                      }),
                                  })
                                : today === null
                                  ? nextOpen === null
                                      ? t('marketplace:storefront.closedToday')
                                      : t('marketplace:storefront.nextOpen', {
                                            day: t(weekdayKey(nextOpen)),
                                        })
                                  : t('marketplace:storefront.openToday', {
                                        opensAt: today.opensAt,
                                        closesAt: today.closesAt,
                                    })}
                        </RNText>
                    </View>

                    <RNText
                        testID={`${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        className="mt-2.5 font-display text-4xl font-bold leading-tight tracking-display text-content-on-canopy text-start lg:text-5xl"
                    >
                        {kitchen.name}
                    </RNText>

                    <View testID="kitchen-facts" className="mt-3 flex-row flex-wrap gap-2">
                        {kitchen.isVerified ? (
                            <FactPill testID="kitchen-verified" icon="badgeCheck">
                                {t('marketplace:storefront.verified')}
                            </FactPill>
                        ) : null}
                        {facts.map((fact) => (
                            <FactPill
                                key={fact.key}
                                testID={`kitchen-fact-${fact.key}`}
                                icon={fact.icon}
                            >
                                {fact.text}
                            </FactPill>
                        ))}
                    </View>
                </View>

                <Pressable
                    testID="kitchen-see-plans"
                    role="button"
                    accessibilityRole="button"
                    onPress={onSeePlans}
                    className="h-12 flex-row items-center gap-2 self-start rounded-2xl bg-surface-raised px-[18px] hover:bg-surface-brand-subtle lg:self-end"
                >
                    <Icon name="calendarDays" size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="text-sm font-bold text-content-on-brand-subtle">
                        {t('marketplace:storefront.seePlans')}
                    </RNText>
                </Pressable>
            </View>
        </View>
    );
}

/** One fact on the cover: a soft translucent pill, an icon and the line. */
function FactPill({
    testID,
    icon,
    children,
}: {
    readonly testID: string;
    readonly icon: IconName | null;
    readonly children: string;
}) {
    return (
        <View
            testID={testID}
            className="h-[34px] flex-row items-center gap-1.5 rounded-full bg-content-on-canopy/10 px-3"
        >
            {icon === null ? null : (
                <Icon name={icon} size="sm" className="text-content-on-canopy" />
            )}
            <RNText className="text-sm font-semibold tabular-nums text-content-on-canopy">
                {children}
            </RNText>
        </View>
    );
}
