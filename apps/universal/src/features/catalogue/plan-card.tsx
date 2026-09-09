import { Button, Card, Checkbox, Rating, Stack, TagRow, Text } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { EntityImage } from '../../media/entity-image.tsx';
import { PlanDurationSelector } from './plan-duration-selector.tsx';
import { PlanPrice } from './plan-price.tsx';

/**
 * A subscription plan in the catalogue.
 *
 * ## Why the card is not itself pressable
 *
 * Every other card on the marketplace is one big button, and that is right for a kitchen or a meal:
 * one target, one destination. A plan card carries *three* controls — the comparison checkbox, the
 * commitment picker and the open action — and a checkbox nested inside a button is unreachable by
 * keyboard on the web, ambiguous to a screen reader, and on touch it opens the plan when the person
 * meant to tick "compare". So the card is a plain grouping element with named controls inside it.
 *
 * ## The reading order
 *
 * Who cooked it, what it is called, what it is for, how well it is rated — then the two things a
 * person actually decides between, kept visually apart: the *calorie bands* it is built around, and
 * the *commitment* and its discount. The price closes the card because it is the last question, and
 * it is shown in both units at once so the same plan can never look cheaper here than on its page.
 */
export interface PlanCardProps {
    readonly plan: SubscriptionPlan;
    readonly onOpen: () => void;
    /** The kitchen's name, resolved by the screen — plans carry only a `kitchenId`. */
    readonly kitchenName?: string | undefined;
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

export function PlanCard({ plan, onOpen, kitchenName, comparison, testID }: PlanCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const resolvedTestID = testID ?? `plan-card-${plan.slug}`;

    return (
        <Card
            testID={resolvedTestID}
            padding="none"
            tone="raised"
            /*
             * `grow` is what makes the card fill its grid cell, and it is the reason the price
             * closes every card in a row at the same height. `self-stretch` beside it only ever
             * governed the *width*: `CardGridItem` is a column, so stretch is its cross axis. Left
             * at that, a plan with a longer name or a fourth band stood taller than its neighbour
             * and the `mt-auto` price block below had nothing to pin against. See the same note in
             * `meal-card.tsx`.
             */
            className="grow self-stretch overflow-hidden hover:shadow-elevation-2"
        >
            <EntityImage
                testID={`${resolvedTestID}-image`}
                assetId={plan.imagePlaceholderId}
                variant="card"
                seed={plan.slug}
                label={t('catalogue:plan.imageLabel', { plan: plan.name })}
                aspect="wide"
            />

            <Stack space="md" className="flex-1 p-4">
                <Stack space="xs">
                    {kitchenName === undefined ? null : (
                        <Text tone="secondary" variant="caption">
                            {t('catalogue:plans.byKitchen', { kitchen: kitchenName })}
                        </Text>
                    )}
                    <Text variant="bodyStrong" className="text-lg leading-snug">
                        {plan.name}
                    </Text>
                    <Text tone="secondary" variant="caption" numberOfLines={2}>
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
                </Stack>

                <Stack space="xs" className="border-t border-stroke-subtle pt-3">
                    <Text variant="label" tone="secondary">
                        {t('catalogue:plans.bandsLabel')}
                    </Text>
                    {/*
                     * `TagRow`, not a row of `Badge`s. A band is a label — "1,400–1,600 kcal" — and
                     * `Badge` is the component that carries a *status*, with a tone and a mark to
                     * say what the status means. Using it here made the bands look like four
                     * warnings, and it is the shared tag row the cards elsewhere draw.
                     */}
                    <TagRow
                        testID={`${resolvedTestID}-bands`}
                        items={plan.variants.map((variant) => ({
                            key: String(variant.id),
                            label: t('catalogue:plans.energyBand', {
                                min: formatter.formatNumber(variant.energyRange.min),
                                max: formatter.formatNumber(variant.energyRange.max),
                            }),
                        }))}
                    />
                </Stack>

                <PlanDurationSelector plan={plan} testID={`${resolvedTestID}-duration`} />

                {/* The commercial block sits apart from the nutrition above it, and grows to the
                    bottom so every card's price and actions line up on a shared baseline. */}
                <Stack space="sm" className="mt-auto border-t border-stroke-subtle pt-3">
                    <PlanPrice plan={plan} testID={`${resolvedTestID}-price`} />

                    <Stack space="sm">
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
                            variant="primary"
                            block
                            label={t('catalogue:plans.viewPlan')}
                            accessibilityLabel={t('catalogue:plans.viewPlanNamed', {
                                plan: plan.name,
                            })}
                            onPress={onOpen}
                        />
                    </Stack>
                </Stack>
            </Stack>
        </Card>
    );
}
