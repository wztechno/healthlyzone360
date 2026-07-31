import {
    Badge,
    Button,
    Card,
    Checkbox,
    Chip,
    Inline,
    Rating,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { EntityImage } from '../../media/entity-image.tsx';
import { formatMoney } from '../marketplace/format.ts';

/**
 * A subscription plan in the catalogue.
 *
 * ## Why the card is not itself pressable
 *
 * Every other card on the marketplace is one big button, and that is right for a kitchen or a meal:
 * one target, one destination. A plan card carries a *second* control — the comparison checkbox —
 * and a checkbox nested inside a button is unreachable by keyboard on the web, ambiguous to a
 * screen reader, and on touch it means the person who wanted to tick "compare" opens the plan
 * instead. So the card is a plain grouping element with two named controls inside it.
 *
 * ## The two price units
 *
 * Both the weekly figure and its daily equivalent are shown, with the weekly one primary. Doc 17,
 * SUB-09 records the reference product switching units between catalogue and detail, which makes
 * the same plan look cheaper in one place than the other; showing both everywhere removes the
 * possibility rather than relying on care.
 */
export interface PlanCardProps {
    readonly plan: SubscriptionPlan;
    readonly onOpen: () => void;
    /** Omit to render the card without a comparison control (the diet page does). */
    readonly comparison?:
        | {
              readonly selected: boolean;
              readonly onChange: (selected: boolean) => void;
              /** True once three plans are selected and this is not one of them. */
              readonly disabled: boolean;
          }
        | undefined;
    readonly testID?: string | undefined;
}

/** Days in a week — the divisor behind the "per day" figure, named rather than inline. */
const DAYS_PER_WEEK = 7;

export function PlanCard({ plan, onOpen, comparison, testID }: PlanCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const resolvedTestID = testID ?? `plan-card-${plan.slug}`;

    const cheapest = plan.variants.reduce<SubscriptionPlan['variants'][number] | null>(
        (lowest, variant) =>
            lowest === null || variant.pricePerWeek.amount < lowest.pricePerWeek.amount
                ? variant
                : lowest,
        null,
    );

    return (
        <Card testID={resolvedTestID} padding="none" tone="raised">
            <EntityImage
                testID={`${resolvedTestID}-image`}
                assetId={plan.imagePlaceholderId}
                variant="card"
                seed={plan.slug}
                label={t('catalogue:plan.imageLabel', { plan: plan.name })}
                aspect="wide"
            />

            <Stack space="sm" className="p-4">
                <Text variant="bodyStrong">{plan.name}</Text>
                <Text tone="secondary" variant="caption" numberOfLines={3}>
                    {plan.summary}
                </Text>

                {plan.rating === null ? null : (
                    <Rating
                        testID={`${resolvedTestID}-rating`}
                        label={t('catalogue:plans.ratingLabel', { plan: plan.name })}
                        value={plan.rating}
                        count={plan.ratingCount}
                        size="sm"
                    />
                )}

                <Inline space="xs" wrap testID={`${resolvedTestID}-bands`}>
                    {plan.variants.map((variant) => (
                        <Badge
                            key={variant.id}
                            tone="neutral"
                            label={t('catalogue:plans.energyBand', {
                                min: formatter.formatNumber(variant.energyRange.min),
                                max: formatter.formatNumber(variant.energyRange.max),
                            })}
                        />
                    ))}
                </Inline>

                <Inline space="xs" wrap>
                    {plan.durations.map((option) => (
                        <Chip
                            key={option.duration}
                            tone={option.discountPercent > 0 ? 'brand' : 'neutral'}
                            label={
                                option.discountPercent > 0
                                    ? t('catalogue:compare.durationOption', {
                                          duration: t(
                                              `catalogue:compare.duration.${option.duration}`,
                                          ),
                                          discount: formatter.formatNumber(option.discountPercent),
                                      })
                                    : t(`catalogue:compare.duration.${option.duration}`)
                            }
                        />
                    ))}
                </Inline>

                {cheapest === null ? null : (
                    <Stack space="none">
                        <Text testID={`${resolvedTestID}-price`} variant="bodyStrong">
                            {t('catalogue:plans.fromPrice', {
                                price: formatMoney(formatter, cheapest.pricePerWeek),
                            })}
                        </Text>
                        <Text tone="secondary" variant="caption">
                            {t('catalogue:plans.perDayPrice', {
                                price: formatMoney(formatter, {
                                    amount: Math.round(
                                        cheapest.pricePerWeek.amount / DAYS_PER_WEEK,
                                    ),
                                    currency: cheapest.pricePerWeek.currency,
                                }),
                            })}
                        </Text>
                    </Stack>
                )}

                {comparison === undefined ? null : (
                    <Checkbox
                        testID={`${resolvedTestID}-compare`}
                        id={`${resolvedTestID}-compare`}
                        label={t('catalogue:plans.compareLabel')}
                        checked={comparison.selected}
                        disabled={comparison.disabled}
                        onChange={comparison.onChange}
                    />
                )}

                <Button
                    testID={`${resolvedTestID}-open`}
                    variant="secondary"
                    label={t('catalogue:compare.openPlan', { plan: plan.name })}
                    onPress={onOpen}
                />
            </Stack>
        </Card>
    );
}
