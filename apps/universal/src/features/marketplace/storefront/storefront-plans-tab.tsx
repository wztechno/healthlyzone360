import { Button, Icon, cx } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { cheapestVariant } from '../../catalogue/plan-catalogue.ts';
import { formatMoney } from '../format.ts';

/**
 * The storefront's Plans tab — HealthZone `§isStorefront` `storeIsPlans`: one card, a heading row
 * with "How plans work", then a row per plan with its name and summary, its price and Choose.
 *
 * ## The price is per week, from the cheapest size
 *
 * The design states a price "per delivery day". A plan variant publishes a weekly price and nothing
 * that says how many deliveries a week buys, so a per-delivery figure would be arithmetic over a
 * number the contract does not have. The row states the weekly price of the cheapest variant,
 * prefixed "from" — the same figure, and the same refusal to advertise from one size and show
 * another, as the `/plans` catalogue (`plan-catalogue.ts`, `cheapestVariant`).
 *
 * ## No plans
 *
 * A kitchen that sells none keeps the card and its heading, and its one row says so — the tab is
 * always there, as designed, and an empty card is the honest answer to it.
 */
export interface StorefrontPlansTabProps {
    readonly kitchenName: string;
    readonly plans: readonly SubscriptionPlan[];
    readonly onChoose: (plan: SubscriptionPlan) => void;
    readonly onHowPlansWork: () => void;
}

export function StorefrontPlansTab({
    kitchenName,
    plans,
    onChoose,
    onHowPlansWork,
}: StorefrontPlansTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID="kitchen-plans-tab"
            className="overflow-hidden rounded-xl border border-stroke bg-surface-raised"
        >
            <View className="flex-row flex-wrap items-baseline justify-between gap-3 border-b border-stroke-subtle px-5 py-5">
                <View className="min-w-0 shrink flex-col gap-1">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-xl font-bold leading-tight tracking-display text-content-primary text-start"
                    >
                        {t('marketplace:storefront.plans.title', { kitchen: kitchenName })}
                    </RNText>
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('marketplace:storefront.plans.subtitle')}
                    </RNText>
                </View>
                <Pressable
                    testID="kitchen-plans-how"
                    role="link"
                    accessibilityRole="link"
                    onPress={onHowPlansWork}
                    className="min-h-touch flex-row items-center gap-1"
                >
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle hover:underline">
                        {t('marketplace:storefront.plans.howItWorks')}
                    </RNText>
                    <Icon name="chevronEnd" size="sm" className="text-content-on-brand-subtle" />
                </Pressable>
            </View>

            {plans.length === 0 ? (
                <View testID="kitchen-plans-empty" className="px-5 py-5">
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('marketplace:storefront.plans.empty')}
                    </RNText>
                </View>
            ) : null}

            {plans.map((plan, index) => {
                const cheapest = cheapestVariant(plan);
                return (
                    <View
                        key={plan.id}
                        testID={`kitchen-plan-${plan.slug}`}
                        className={cx(
                            'flex-row flex-wrap items-center gap-4 px-5 py-4',
                            index === plans.length - 1 ? null : 'border-b border-stroke-subtle',
                        )}
                    >
                        <View className="min-w-[200px] flex-1 flex-col gap-0.5">
                            <RNText className="font-display text-base font-bold leading-tight tracking-display text-content-primary text-start">
                                {plan.name}
                            </RNText>
                            {plan.summary === '' ? null : (
                                <RNText
                                    numberOfLines={2}
                                    className="text-sm text-content-secondary text-start"
                                >
                                    {plan.summary}
                                </RNText>
                            )}
                        </View>

                        <View className="flex-row items-center gap-4">
                            {cheapest === null ? null : (
                                <View className="items-end">
                                    <RNText
                                        testID={`kitchen-plan-${plan.slug}-price`}
                                        className="font-display text-lg font-bold tabular-nums text-content-primary text-end"
                                    >
                                        {t('marketplace:storefront.order.fromAmount', {
                                            amount: formatMoney(formatter, cheapest.pricePerWeek),
                                        })}
                                    </RNText>
                                    <Eyebrow className="text-end">
                                        {t('marketplace:storefront.plans.perWeek')}
                                    </Eyebrow>
                                </View>
                            )}
                            <Button
                                testID={`kitchen-plan-${plan.slug}-choose`}
                                size="sm"
                                variant="primary"
                                label={t('marketplace:storefront.plans.choose')}
                                accessibilityLabel={t('marketplace:storefront.plans.chooseLabel', {
                                    plan: plan.name,
                                })}
                                onPress={() => {
                                    onChoose(plan);
                                }}
                            />
                        </View>
                    </View>
                );
            })}
        </View>
    );
}
