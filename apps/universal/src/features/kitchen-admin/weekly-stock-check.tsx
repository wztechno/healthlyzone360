import { Button, Callout, Text, useIssueGroup } from '@healthy360/design-system';
import type { BranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useWeeklyStockCheckQuery } from '../../data/order-desk-hooks.ts';

/** How many short items the notice names before it says "and N more". */
const NAMED = 5;

/**
 * What the weekly stock check found — the scheduler's Monday run of this buy list over the next
 * seven days (`inventory:check-stock-sufficiency`).
 *
 * A card in the page's issue tray, under Check: the check is a snapshot of what the shelf looked
 * like on Monday, the list is now, and a kitchen reads the first as "what we were warned about" and
 * the second as "where we stand". It only speaks when something was short: an all-clear says
 * nothing, and so does a branch never checked. "Show that week" points the list's window at the week
 * the check looked at. Rendered on its own, with no tray above it, it draws the callout it always did.
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
    // Nothing to warn about is nothing to say: a green strip saying so is one more thing to read.
    const short = data !== null && data.shortCount > 0 ? data : null;

    const title =
        short === null
            ? ''
            : t('kitchen:ops.requirements.weeklyShortTitle', {
                  from: formatter.formatDate(short.windowFrom, { dateStyle: 'medium' }),
                  to: formatter.formatDate(short.windowTo, { dateStyle: 'medium' }),
                  checked: formatter.formatDate(short.checkedAt, { dateStyle: 'medium' }),
                  count: short.shortCount,
              });
    const named = (short?.shortfalls ?? []).slice(0, NAMED).map((row) => ({
        key: row.code,
        text: t('kitchen:ops.requirements.weeklyShortLine', {
            name: row.name,
            short: formatter.formatNumber(Number(row.short)),
            buy: formatter.formatNumber(Number(row.suggestedBuy)),
            unit: row.unitCode ?? '',
        }),
    }));
    const more = short === null ? 0 : short.shortfalls.length - named.length;
    const moreText =
        more > 0 ? t('kitchen:ops.requirements.weeklyShortMore', { count: more }) : null;
    const showWindow = {
        label: t('kitchen:ops.requirements.weeklyShowWindow'),
        onPress: () => {
            if (short !== null) onShowWindow(short.windowFrom, short.windowTo);
        },
        testID: 'kitchen-weekly-check-show-window',
    };

    const inTray = useIssueGroup({
        key: 'check',
        title: t('kitchen:tray.groupCheck'),
        items:
            short === null
                ? []
                : [
                      {
                          key: 'weekly-check',
                          tone: 'warning',
                          label: title,
                          detail: [
                              ...named.map((line) => line.text),
                              ...(moreText === null ? [] : [moreText]),
                          ].join('\n'),
                          action: showWindow,
                          testID: 'kitchen-weekly-check',
                      },
                  ],
    });

    if (inTray || short === null) return null;

    return (
        <Callout
            testID="kitchen-weekly-check"
            tone="warning"
            icon="warning"
            role="status"
            title={title}
            actions={
                <Button
                    testID={showWindow.testID}
                    size="sm"
                    variant="secondary"
                    label={showWindow.label}
                    onPress={showWindow.onPress}
                />
            }
        >
            <View className="flex-col gap-hair">
                {named.map((line) => (
                    <Text
                        key={line.key}
                        variant="caption"
                        testID={`kitchen-weekly-check-short-${line.key}`}
                    >
                        {line.text}
                    </Text>
                ))}
                {moreText === null ? null : (
                    <Text variant="caption" tone="secondary">
                        {moreText}
                    </Text>
                )}
            </View>
        </Callout>
    );
}
