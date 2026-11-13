import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type {
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { effectiveDayPrice } from '../catalogue/plan-balance.ts';
import { formatMoney } from '../marketplace/format.ts';
import { bandLabel, mealsLine } from './configurator-steps.tsx';
import { durationOption, estimatedTotal } from './configurator.ts';
import type { ConfiguratorState } from './configurator.ts';

/**
 * The plan setup's summary card — the accepted board's "Your plan" aside: the plan on the canopy,
 * then price a day, days, start, delivery window and meals picked with a meter, the total, and the
 * step's two buttons (Back and the one that moves on). Sticky beside the step from `lg`; below it, a
 * bar pinned to the foot of the page carrying the total and the buttons.
 *
 * ## What stands between the person and the action sits beside it
 *
 * Anything still wrong with the configuration is drawn here, directly above the buttons — not at the
 * foot of the step, which on a long step is below the fold.
 *
 * ## Which price
 *
 * Until the server has priced the configuration it is an estimate — the variant's per-day price over
 * the chosen balance of days, less that length's discount, rounded the way the server rounds
 * (`estimatedTotal`). Once the review step has the preview, the figures are the server's.
 */
export interface PlanSetupSummaryProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    readonly preview: SubscriptionPreview | undefined;
    /** "Wed 11 Nov", or null before a start is chosen. */
    readonly startLabel: string | null;
    /** The window's name, or null before one is chosen. */
    readonly windowLabel: string | null;
    readonly picked: number;
    readonly slots: number;
    readonly actionLabel: string;
    /** What the action button ends on: an arrow, or the total on the last step. */
    readonly actionTail: 'arrow' | 'total';
    readonly actionTestID: string;
    readonly actionLoading?: boolean | undefined;
    /**
     * Holds the action — Subscribe while the account still has required set-up steps or the terms
     * are unticked. `actionHint` says why to somebody who cannot see the reason.
     */
    readonly actionDisabled?: boolean | undefined;
    readonly actionHint?: string | undefined;
    readonly onAction: () => void;
    /** Back a step; absent on the first. */
    readonly onBack?: (() => void) | undefined;
    /** What still needs an answer — the issues list or a refusal — shown above the action. */
    readonly notice?: ReactNode | undefined;
    /** A quiet extra under the buttons — "Start over". */
    readonly footer?: ReactNode | undefined;
    /** False once the plan is booked: the summary stays, its buttons go. */
    readonly showActions?: boolean | undefined;
}

export function PlanSetupSummary({
    plan,
    variant,
    state,
    preview,
    startLabel,
    windowLabel,
    picked,
    slots,
    actionLabel,
    actionTail,
    actionTestID,
    actionLoading = false,
    actionDisabled = false,
    actionHint,
    onAction,
    onBack,
    notice,
    footer,
    showActions = true,
}: PlanSetupSummaryProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const dash = '—';

    const option = durationOption(plan, state.duration);
    const discount = option?.discountPercent ?? 0;
    const perDay =
        preview?.perDayPrice ?? (variant === null ? null : effectiveDayPrice(variant, discount));
    const total = preview?.total ?? estimatedTotal(variant, option);
    const totalText = total === null ? dash : formatMoney(formatter, total);
    const share = slots === 0 ? 0 : Math.min(100, (picked / slots) * 100);

    const actions = !showActions ? null : (
        <View className="flex-row gap-2">
            {onBack === undefined ? null : (
                <Pressable
                    testID="configurator-back"
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('commerce:configurator.back')}
                    onPress={onBack}
                    className="h-[52px] w-[52px] items-center justify-center rounded-2xl border border-stroke hover:bg-surface-sunken"
                >
                    <Icon name="chevronBackward" size="md" className="text-content-primary" />
                </Pressable>
            )}
            <Pressable
                testID={actionTestID}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                accessibilityState={{
                    disabled: actionDisabled || actionLoading,
                    busy: actionLoading,
                }}
                {...(actionHint === undefined ? {} : { accessibilityHint: actionHint })}
                disabled={actionDisabled || actionLoading}
                onPress={onAction}
                className={cx(
                    'h-[52px] min-w-0 flex-1 flex-row items-center justify-between gap-3 rounded-2xl px-5 transition duration-normal ease-standard',
                    actionDisabled
                        ? 'bg-stroke-subtle'
                        : 'bg-surface-brand hover:bg-surface-canopy',
                )}
            >
                <RNText
                    numberOfLines={1}
                    className={cx(
                        'shrink text-base font-bold',
                        actionDisabled ? 'text-content-secondary' : 'text-content-on-brand',
                    )}
                >
                    {actionLabel}
                </RNText>
                {actionLoading ? (
                    <ActivityIndicator size="small" />
                ) : (
                    <RNText
                        className={cx(
                            'font-display text-base font-bold tabular-nums',
                            actionDisabled ? 'text-content-secondary' : 'text-content-on-brand',
                        )}
                    >
                        {actionTail === 'total' ? totalText : '→'}
                    </RNText>
                )}
            </Pressable>
        </View>
    );

    if (!atLeast('lg')) {
        return (
            <View
                testID="configurator-summary"
                className="flex-col gap-3 rounded-[22px] border border-stroke-subtle bg-surface-raised px-4 py-3 shadow-elevation-2"
            >
                {notice}
                <View className="flex-row items-baseline justify-between">
                    <RNText className="text-sm text-content-secondary">
                        {t('commerce:configurator.summary.total')}
                    </RNText>
                    <RNText
                        testID="configurator-summary-total"
                        className="font-display text-xl font-bold tabular-nums text-content-primary"
                    >
                        {totalText}
                    </RNText>
                </View>
                {actions}
                {footer}
            </View>
        );
    }

    const lines: readonly { key: string; label: string; value: string }[] = [
        {
            key: 'per-day',
            label: t('commerce:configurator.summary.priceADay'),
            value: perDay === null ? dash : formatMoney(formatter, perDay),
        },
        {
            key: 'days',
            label: t('commerce:configurator.summary.daysLabel'),
            value: option === undefined ? dash : formatter.formatNumber(option.days),
        },
        {
            key: 'starts',
            label: t('commerce:configurator.summary.startsLabel'),
            value: startLabel ?? dash,
        },
        {
            key: 'delivery',
            label: t('commerce:configurator.summary.deliveryLabel'),
            value: windowLabel ?? dash,
        },
        {
            key: 'meals',
            label: t('commerce:configurator.summary.mealsPicked'),
            value: t('commerce:configurator.summary.mealsPickedValue', {
                done: formatter.formatNumber(picked),
                total: formatter.formatNumber(slots),
            }),
        },
    ];

    return (
        <View
            testID="configurator-summary"
            className="flex-col overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-3"
        >
            <View className="bg-surface-canopy px-5 py-[18px]">
                <RNText className="text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted">
                    {t('commerce:configurator.summary.eyebrow')}
                </RNText>
                <RNText className="mt-1 font-display text-2xl font-bold tracking-display text-content-on-canopy text-start">
                    {plan.name}
                </RNText>
                {variant === null ? null : (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {[
                            bandLabel(variant, formatter.formatNumber, t),
                            mealsLine(variant, formatter.formatNumber, t),
                        ].map((chip) => (
                            <View
                                key={chip}
                                className="h-6 justify-center rounded-full bg-content-on-canopy/15 px-2.5"
                            >
                                <RNText className="text-xs font-semibold text-content-on-canopy">
                                    {chip}
                                </RNText>
                            </View>
                        ))}
                    </View>
                )}
            </View>
            <View className="px-5 pb-5 pt-4">
                {lines.map((line) => (
                    <View
                        key={line.key}
                        testID={`configurator-summary-${line.key}`}
                        className="flex-row items-center justify-between py-[7px]"
                    >
                        <RNText className="text-sm text-content-secondary">{line.label}</RNText>
                        <RNText className="text-sm font-bold tabular-nums text-content-primary">
                            {line.value}
                        </RNText>
                    </View>
                ))}
                <View aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-surface-base">
                    <View
                        className="h-full rounded-full bg-surface-brand transition-all duration-normal ease-standard"
                        style={{ width: `${share.toFixed(1)}%` as DimensionValue }}
                    />
                </View>
                <View className="mt-2 flex-row items-baseline justify-between border-t border-dashed border-stroke pt-3">
                    <RNText className="text-sm text-content-secondary">
                        {t('commerce:configurator.summary.total')}
                    </RNText>
                    <RNText
                        testID="configurator-summary-total"
                        className="font-display text-3xl font-bold tabular-nums tracking-display text-content-primary"
                    >
                        {totalText}
                    </RNText>
                </View>
                {notice === null || notice === undefined ? null : (
                    <View className="mt-3">{notice}</View>
                )}
                <View className="mt-4">{actions}</View>
                {footer === undefined ? null : <View className="mt-2 items-center">{footer}</View>}
            </View>
        </View>
    );
}
