import { Inline, Stack, Text } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../marketplace/format.ts';
import { DAYS_PER_WEEK, cheapestVariant } from './plan-catalogue.ts';

/**
 * A plan's advertised price.
 *
 * ## Both units, always, with the weekly one primary
 *
 * Doc 17, SUB-09 records the reference product switching units between catalogue and detail, which
 * makes the same plan look cheaper in one place than the other. Showing the weekly figure large and
 * the daily figure beneath it — everywhere the price appears — removes the possibility rather than
 * relying on care. The number is the cheapest variant's, and the "from" says so out loud: a plan has
 * three bands at three prices, and the smallest is what the headline figure is.
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

    const perDay = {
        amount: Math.round(cheapest.pricePerWeek.amount / DAYS_PER_WEEK),
        currency: cheapest.pricePerWeek.currency,
    };

    return (
        <Stack space="none" testID={testID}>
            <Text tone="secondary" variant="caption">
                {t('catalogue:plans.priceFrom')}
            </Text>
            <Inline space="xs" align="baseline" wrap>
                <Text variant="bodyStrong" className="font-display text-2xl leading-tight">
                    {formatMoney(formatter, cheapest.pricePerWeek)}
                </Text>
                <Text tone="secondary" variant="caption">
                    {t('catalogue:plans.perWeekSuffix')}
                </Text>
            </Inline>
            <Text tone="secondary" variant="caption">
                {t('catalogue:plans.perDayPrice', { price: formatMoney(formatter, perDay) })}
            </Text>
        </Stack>
    );
}
