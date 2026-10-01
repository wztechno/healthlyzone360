import { Icon } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

/**
 * The storefront's Reviews tab — HealthZone `§isStorefront` `storeIsReviews`: a summary card (the
 * average, its stars, the count, a bar per star) beside the list of written reviews.
 *
 * ## What the contract carries
 *
 * `Kitchen.rating` and `ratingCount` — the average and how many ratings make it, `null` until there
 * are enough. Nothing serves the per-star distribution or a single written review: no public
 * endpoint lists one. So:
 *
 * * the average and its stars are the kitchen's own, or "—" and "Not rated yet";
 * * the five bars are drawn empty with "—" for their share, because a distribution nobody published
 *   is not a zero distribution;
 * * the list holds one card saying there are no written reviews — never the design's samples.
 */
export interface StorefrontReviewsTabProps {
    readonly kitchen: Kitchen;
}

const STARS = [5, 4, 3, 2, 1] as const;

export function StorefrontReviewsTab({ kitchen }: StorefrontReviewsTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const rating = kitchen.rating;
    const filled = rating === null ? 0 : Math.round(rating);
    const none = t('marketplace:storefront.facts.none');

    return (
        <View testID="kitchen-reviews-tab" className="flex-row flex-wrap items-start gap-4">
            <View
                testID="kitchen-reviews-summary"
                className="min-w-[260px] flex-1 grow basis-[40%] rounded-xl border border-stroke bg-surface-raised p-5"
            >
                <View
                    className="flex-row items-baseline gap-2.5"
                    accessible
                    accessibilityLabel={
                        rating === null
                            ? t('marketplace:storefront.reviews.notRated')
                            : t('marketplace:storefront.reviews.outOfFive', {
                                  rating: formatter.formatNumber(rating),
                              })
                    }
                >
                    <RNText
                        testID="kitchen-reviews-average"
                        className="font-display text-5xl font-bold tracking-display tabular-nums text-content-primary text-start"
                    >
                        {rating === null
                            ? none
                            : formatter.formatNumber(rating, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                              })}
                    </RNText>
                    <View className="flex-row gap-0.5" aria-hidden>
                        {STARS.map((star) => (
                            <Icon
                                key={star}
                                name={6 - star <= filled ? 'star' : 'starOutline'}
                                size="sm"
                                className="text-rating"
                            />
                        ))}
                    </View>
                </View>
                <RNText
                    testID="kitchen-reviews-count"
                    className="text-sm text-content-secondary text-start"
                >
                    {rating === null
                        ? t('marketplace:storefront.reviews.notRated')
                        : t('marketplace:storefront.reviews.count', {
                              count: kitchen.ratingCount,
                              formattedCount: formatter.formatNumber(kitchen.ratingCount),
                          })}
                </RNText>

                <View className="mt-4 flex-col gap-2" testID="kitchen-reviews-bars">
                    {STARS.map((star) => (
                        <View
                            key={star}
                            className="flex-row items-center gap-2.5"
                            accessible
                            accessibilityLabel={t('marketplace:storefront.reviews.barLabel', {
                                star: formatter.formatNumber(star),
                            })}
                        >
                            <RNText className="w-[18px] text-xs font-medium tabular-nums text-content-secondary text-start">
                                {formatter.formatNumber(star)}
                            </RNText>
                            <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken" />
                            <RNText className="w-9 text-xs font-medium tabular-nums text-content-secondary text-end">
                                {none}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>

            <View className="min-w-[260px] flex-1 grow basis-[40%] flex-col gap-3">
                <View
                    testID="kitchen-reviews-empty"
                    className="flex-col gap-2 rounded-xl border border-stroke bg-surface-raised px-5 py-4"
                >
                    <RNText className="font-display text-base font-bold text-content-primary text-start">
                        {t('marketplace:storefront.reviews.emptyTitle')}
                    </RNText>
                    <RNText className="text-sm leading-normal text-content-secondary text-start">
                        {t('marketplace:storefront.reviews.emptyBody')}
                    </RNText>
                </View>
            </View>
        </View>
    );
}
