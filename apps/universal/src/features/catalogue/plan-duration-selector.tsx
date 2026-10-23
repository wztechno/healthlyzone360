import { Badge, Inline, SegmentedControl, Stack, Text } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import type { PlanDuration } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../marketplace/format.ts';
import { balanceTotal } from './plan-balance.ts';
import { cheapestVariant } from './plan-catalogue.ts';
import { durationShortLabel } from './plan-duration-label.ts';

/**
 * The commitment picker on a plan card.
 *
 * ## Why it changes the total, not the per-day price
 *
 * The per-day list price is identical in every duration — the longer commitment does not buy a
 * cheaper day, it earns a discount on the total (the plan detail says so in as many words). So this
 * control leaves {@link PlanPrice}'s headline alone and reveals the one thing that actually moves:
 * what the whole commitment costs, and what it saves. Showing a shrinking *daily* figure here would
 * be the false-precision the catalogue exists to avoid.
 *
 * It is a segmented control rather than a `radiogroup` because that is the pattern this design system
 * already uses for an inline single choice (the calculators' unit switch), and reusing it keeps one
 * keyboard and screen-reader behaviour across the app instead of inventing a second.
 */
export interface PlanDurationSelectorProps {
    readonly plan: SubscriptionPlan;
    readonly testID?: string | undefined;
}

export function PlanDurationSelector({ plan, testID }: PlanDurationSelectorProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const durations = plan.durations;
    const [selected, setSelected] = useState<PlanDuration | null>(durations[0]?.duration ?? null);

    const active = durations.find((option) => option.duration === selected) ?? durations[0];
    if (active === undefined) return null;

    // A multi-configuration plan carries no plan-level total, so the figure shown is derived from
    // the same variant the card's headline advertises — the cheapest — never a dressed-up middle.
    const advertised = cheapestVariant(plan);
    const total =
        active.totalPrice ?? (advertised === null ? null : balanceTotal(advertised, active));
    if (total === null) return null;

    return (
        <Stack space="xs" testID={testID}>
            <Text variant="label" tone="secondary">
                {t('catalogue:plans.durationsLabel')}
            </Text>
            <SegmentedControl<PlanDuration>
                label={t('catalogue:plans.durationsFor', { plan: plan.name })}
                value={active.duration}
                onChange={setSelected}
                block
                items={durations.map((option) => ({
                    value: option.duration,
                    // The compact label ("4 wk", "5 d") rather than "4 weeks": four equal segments
                    // in a grid-narrow card, so the longest option has to fit without being clipped.
                    label: durationShortLabel(option.days, t, formatter.formatNumber),
                    testID: testID === undefined ? undefined : `${testID}-${option.duration}`,
                }))}
            />
            <Inline space="xs" align="center" wrap>
                <Text variant="caption">
                    {t('catalogue:plans.durationTotal', {
                        price: formatMoney(formatter, total),
                    })}
                </Text>
                {active.discountPercent > 0 ? (
                    <Badge
                        testID={testID === undefined ? undefined : `${testID}-saving`}
                        tone="success"
                        icon={null}
                        label={t('catalogue:plans.durationSaves', {
                            discount: formatter.formatNumber(active.discountPercent),
                        })}
                    />
                ) : (
                    <Text variant="caption" tone="secondary">
                        {t('catalogue:plans.durationNoDiscount')}
                    </Text>
                )}
            </Inline>
        </Stack>
    );
}
