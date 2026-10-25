import { Button, Callout, Text } from '@healthy360/design-system';
import type { BranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useWeeklyStockCheckQuery } from '../../data/order-desk-hooks.ts';

/** How many short items the banner names before it says "and N more". */
const NAMED = 5;

/**
 * What the weekly stock check found — the scheduler's Monday run of this buy list over the next
 * seven days (`inventory:check-stock-sufficiency`).
 *
 * Just above the live list rather than instead of it: the check is a snapshot of what the shelf
 * looked like on Monday, the list is now, and a kitchen reads the first as "what we were warned
 * about" and the second as "where we stand". It only speaks when something was short: an all-clear
 * draws nothing, and so does a branch never checked. "Show that week" points the list's window at
 * the week the check looked at.
 */
export function WeeklyStockCheckBanner({
    branchId,
    onShowWindow,
}: {
    readonly branchId: BranchId | null;
    readonly onShowWindow: (from: string, to: string) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const check = useWeeklyStockCheckQuery(branchId);
    const data = check.data ?? null;

    // Nothing to warn about is nothing to draw: a green strip saying so is one more thing to read.
    if (data === null || data.shortCount === 0) return null;

    const window = {
        from: formatter.formatDate(data.windowFrom, { dateStyle: 'medium' }),
        to: formatter.formatDate(data.windowTo, { dateStyle: 'medium' }),
        checked: formatter.formatDate(data.checkedAt, { dateStyle: 'medium' }),
    };
    const show = (
        <Button
            testID="kitchen-weekly-check-show-window"
            size="sm"
            variant="secondary"
            label={t('kitchen:ops.requirements.weeklyShowWindow')}
            onPress={() => {
                onShowWindow(data.windowFrom, data.windowTo);
            }}
        />
    );

    const named = data.shortfalls.slice(0, NAMED);
    const more = data.shortfalls.length - named.length;

    return (
        <Callout
            testID="kitchen-weekly-check"
            tone="warning"
            icon="warning"
            role="status"
            title={t('kitchen:ops.requirements.weeklyShortTitle', {
                ...window,
                count: data.shortCount,
            })}
            actions={show}
        >
            <View className="flex-col gap-hair">
                {named.map((row) => (
                    <Text
                        key={row.stockItemId}
                        variant="caption"
                        testID={`kitchen-weekly-check-short-${row.code}`}
                    >
                        {t('kitchen:ops.requirements.weeklyShortLine', {
                            name: row.name,
                            short: formatter.formatNumber(Number(row.short)),
                            buy: formatter.formatNumber(Number(row.suggestedBuy)),
                            unit: row.unitCode ?? '',
                        })}
                    </Text>
                ))}
                {more > 0 ? (
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.requirements.weeklyShortMore', { count: more })}
                    </Text>
                ) : null}
            </View>
        </Callout>
    );
}
