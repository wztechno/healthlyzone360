import { Button, useBreakpoint } from '@healthy360/design-system';
import type {
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { effectiveDayPrice } from '../catalogue/plan-balance.ts';
import { durationWithBalance } from '../catalogue/plan-duration-label.ts';
import { formatMoney } from '../marketplace/format.ts';
import { combinationLabel, variantName, weekdayRun } from './configurator-steps.tsx';
import { durationOption, estimatedTotal } from './configurator.ts';
import type { ConfiguratorState } from './configurator.ts';

/**
 * The configurator's summary: what has been chosen so far, the price, and the one action that moves
 * the flow on. A card beside the step from `lg`; below it, a bar pinned to the foot of the page
 * carrying only the price and the action.
 *
 * ## What stands between the person and the action sits beside it
 *
 * The terms acknowledgement and anything still wrong with the configuration are drawn here,
 * directly above the button — not at the foot of the step, which on a long step is below the fold.
 * Pressing Continue and seeing nothing happen, because the reason is three screens down, is the
 * failure this placement exists to prevent.
 *
 * ## Which price
 *
 * Until the server has priced the configuration it is an estimate — the variant's per-day price
 * over the chosen balance of days, less that length's discount, rounded the way the server rounds
 * (`estimatedTotal`). Once the review step has the preview, the figures are the server's.
 */
export interface PlanSetupSummaryProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    /** Delivery choices are only summarised once the person has reached them. */
    readonly showDelivery: boolean;
    readonly preview: SubscriptionPreview | undefined;
    readonly actionLabel: string;
    readonly actionTestID: string;
    readonly actionLoading?: boolean | undefined;
    /**
     * Holds the action — Subscribe while the account still has required set-up steps, the same
     * rule the checkout's Place order follows. `actionHint` says why to somebody who cannot see the
     * steps listed above.
     */
    readonly actionDisabled?: boolean | undefined;
    readonly actionHint?: string | undefined;
    readonly onAction: () => void;
    /** What still needs an answer — the issues list or a refusal — shown above the action. */
    readonly notice?: ReactNode | undefined;
    /** The acknowledgement the action needs, shown directly above it. */
    readonly confirm?: ReactNode | undefined;
}

export function PlanSetupSummary({
    plan,
    variant,
    state,
    showDelivery,
    preview,
    actionLabel,
    actionTestID,
    actionLoading,
    actionDisabled = false,
    actionHint,
    onAction,
    notice,
    confirm,
}: PlanSetupSummaryProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();

    const option = durationOption(plan, state.duration);
    const discount = option?.discountPercent ?? 0;
    const perDay =
        preview?.perDayPrice ?? (variant === null ? null : effectiveDayPrice(variant, discount));
    const total = preview?.total ?? estimatedTotal(variant, option);
    // The total is for a balance of delivery days, so that is what it says it is for: on three
    // weekdays "4 weeks" of deliveries runs nine calendar weeks, and "$700 for 4 weeks" misled.
    const balance =
        option === undefined
            ? null
            : t('commerce:configurator.summary.balance', { count: option.days });
    const duration =
        option === undefined ? null : durationWithBalance(option.days, t, formatter.formatNumber);

    const price = (
        <View testID="configurator-summary-estimate" className="flex-col">
            {perDay === null ? null : (
                <View className="flex-row flex-wrap items-baseline gap-1">
                    <RNText className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary text-start">
                        {formatMoney(formatter, perDay)}
                    </RNText>
                    <RNText className="text-sm text-content-secondary">
                        {t('catalogue:plans.perDaySuffix')}
                    </RNText>
                </View>
            )}
            {total === null || balance === null ? null : (
                <RNText
                    testID="configurator-summary-total"
                    className="self-start text-sm tabular-nums text-content-secondary text-start"
                >
                    {t('commerce:configurator.confirm.total', {
                        total: formatMoney(formatter, total),
                        duration: balance,
                    })}
                </RNText>
            )}
        </View>
    );

    const action = (
        <Button
            testID={actionTestID}
            label={actionLabel}
            loading={actionLoading}
            disabled={actionDisabled}
            {...(actionHint === undefined ? {} : { accessibilityHint: actionHint })}
            onPress={onAction}
            {...(atLeast('lg') ? { block: true } : {})}
        />
    );

    if (!atLeast('lg')) {
        return (
            <View
                testID="configurator-summary"
                className="flex-col gap-3 rounded-panel border border-stroke bg-surface-raised px-4 py-3 shadow-elevation-2"
            >
                {notice}
                {confirm}
                <View className="flex-row items-center justify-between gap-4">
                    {price}
                    {action}
                </View>
            </View>
        );
    }

    const lines = [
        variant === null
            ? null
            : `${variantName(variant, formatter.formatNumber, t)} · ${t(
                  'commerce:configurator.plan.band',
                  {
                      min: formatter.formatNumber(variant.energyRange.min),
                      max: formatter.formatNumber(variant.energyRange.max),
                  },
              )}`,
        variant === null ? null : combinationLabel(variant, formatter.formatNumber, t),
        duration,
        showDelivery && state.deliveryWeekdays.length > 0
            ? `${weekdayRun(state.deliveryWeekdays, t)} · ${t(`commerce:slots.${state.slotCode}`)}`
            : null,
        showDelivery && state.startDate !== null
            ? t('commerce:configurator.summary.starts', {
                  date: formatter.formatDate(state.startDate, { dateStyle: 'medium' }),
              })
            : null,
    ].filter((line): line is string => line !== null);

    return (
        <View
            testID="configurator-summary"
            className="flex-col gap-4 rounded-panel border border-stroke bg-surface-raised p-5"
        >
            <View className="flex-col gap-1">
                <RNText className="self-start font-display text-lg font-bold tracking-display text-content-primary text-start">
                    {plan.name}
                </RNText>
                {lines.map((line) => (
                    <RNText
                        key={line}
                        className="self-start text-sm text-content-secondary text-start"
                    >
                        {line}
                    </RNText>
                ))}
            </View>
            <View className="border-t border-stroke-subtle pt-4">{price}</View>
            {notice}
            {confirm}
            {action}
        </View>
    );
}
