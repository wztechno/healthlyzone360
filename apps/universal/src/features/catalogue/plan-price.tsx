import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { formatMoney } from '../marketplace/format.ts';
import { balanceDaysFor, balanceTotal, listDayPrice } from './plan-balance.ts';
import { cheapestVariant } from './plan-catalogue.ts';

/**
 * A plan's advertised price, drawn as HealthZone's plan card draws it: the big figure with its unit
 * beside it on one baseline, and one quiet line under it pricing a whole balance.
 *
 * ## Per delivery day, because that is what a plan is
 *
 * The design says "/ meal". A plan here is a balance of delivery days (S1 semantics §1), and a day
 * can carry two or three meals, so the true unit in the same place is "/ day" — the per-day price
 * captured at purchase (§5), the figure a cancellation credit multiplies. The line under it is a
 * real balance at a real total, priced with the server's rounding, so the card cannot look cheaper
 * than checkout.
 *
 * The figure is the cheapest configuration's. When a plan has more than one calorie band the line
 * under it says "From", so the headline is never a mid band dressed as a floor.
 */
export interface PlanPriceProps {
    readonly plan: SubscriptionPlan;
    readonly testID?: string | undefined;
}

export function PlanPrice({ plan, testID }: PlanPriceProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const cheapest = cheapestVariant(plan);
    if (cheapest === null) return null;

    // The configurator opens on the plan's first duration, so that is the balance quoted here.
    const firstOption = plan.durations[0];
    const balanceKey =
        plan.variants.length > 1
            ? 'catalogue:plans.balancePriceFrom'
            : 'catalogue:plans.balancePrice';

    return (
        <View testID={testID} className="flex-col">
            <View className="flex-row flex-wrap items-baseline gap-2">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-amount`}
                    className="font-display text-4xl font-bold tabular-nums tracking-display text-content-primary text-start"
                >
                    {formatMoney(formatter, listDayPrice(cheapest))}
                </RNText>
                <RNText className="text-sm text-content-secondary">
                    {t('catalogue:plans.perDaySuffix')}
                </RNText>
            </View>
            {firstOption === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-balance`}
                    className="mt-0.5 text-xs tabular-nums text-content-secondary text-start"
                >
                    {t(balanceKey, {
                        price: formatMoney(formatter, balanceTotal(cheapest, firstOption)),
                        count: balanceDaysFor(firstOption.duration),
                    })}
                </RNText>
            )}
        </View>
    );
}
