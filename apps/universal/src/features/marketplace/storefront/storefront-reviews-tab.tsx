import { Icon } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

/**
 * The storefront's Reviews tab, as the accepted shop board draws it: no public endpoint lists a
 * written review, so the tab is the board's dashed empty card — "No reviews yet" — with the
 * kitchen's own average and count above it once it has them. Never the board's sample reviews, and
 * never a per-star breakdown nobody published.
 */
export interface StorefrontReviewsTabProps {
    readonly kitchen: Kitchen;
}

const STARS = [1, 2, 3, 4, 5] as const;

export function StorefrontReviewsTab({ kitchen }: StorefrontReviewsTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const rating = kitchen.rating;
    const filled = rating === null ? 0 : Math.round(rating);

    return (
        <View testID="kitchen-reviews-tab" className="flex-col gap-4">
            {rating === null ? null : (
                <View
                    testID="kitchen-reviews-summary"
                    className="flex-row flex-wrap items-center gap-4 rounded-3xl border border-stroke-subtle bg-surface-raised p-5"
                    accessible
                    accessibilityLabel={t('marketplace:storefront.reviews.outOfFive', {
                        rating: formatter.formatNumber(rating),
                    })}
                >
                    <RNText
                        testID="kitchen-reviews-average"
                        className="font-display text-5xl font-bold tabular-nums text-content-primary"
                    >
                        {formatter.formatNumber(rating, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                        })}
                    </RNText>
                    <View className="flex-col gap-1">
                        <View className="flex-row gap-0.5" aria-hidden>
                            {STARS.map((star) => (
                                <Icon
                                    key={star}
                                    name={star <= filled ? 'star' : 'starOutline'}
                                    size="sm"
                                    className="text-rating"
                                />
                            ))}
                        </View>
                        <RNText
                            testID="kitchen-reviews-count"
                            className="text-sm text-content-secondary text-start"
                        >
                            {t('marketplace:storefront.reviews.count', {
                                count: kitchen.ratingCount,
                                formattedCount: formatter.formatNumber(kitchen.ratingCount),
                            })}
                        </RNText>
                    </View>
                </View>
            )}

            <View
                testID="kitchen-reviews-empty"
                className="items-center gap-2 rounded-3xl border-2 border-dashed border-stroke px-6 py-12"
            >
                <Icon name="starOutline" size="lg" className="text-content-secondary" />
                <RNText className="mt-2 font-display text-xl font-bold text-content-primary">
                    {t('marketplace:storefront.reviews.emptyTitle')}
                </RNText>
                <RNText className="max-w-[420px] text-center text-sm text-content-secondary">
                    {t('marketplace:storefront.reviews.emptyBody')}
                </RNText>
            </View>
        </View>
    );
}
