import { Icon } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useOrderDeskCalendarQuery } from '../../../data/order-desk-hooks.ts';
import { addDays } from '../../planner/format.ts';
import { DeskButton, DeskIconButton, MiniMonthPicker } from '../desk-kit/index.ts';
import { monthGrid } from './order-book.ts';
import { relativeDay, shortDay } from './order-columns.tsx';

/**
 * (‹) ( 📅 Today · Tue 10 Nov ⌄ ) (›)  Back to today │ — one day at a time, any day from the small
 * month under the pill, and a way straight back to today once the reader has stepped away from it
 * (the Orders canvas's `.dstep`). The arrows mirror in Arabic on their own: `chevronBackward` /
 * `chevronForward` are logical glyphs.
 *
 * The month marks the days that hold orders, read from the order-desk calendar for just the month
 * on show — and only while it is open.
 */
export function DayStepper({
    day,
    today,
    onChange,
    testID,
}: {
    readonly day: string;
    readonly today: string;
    readonly onChange: (day: string) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [shown, setShown] = useState<string | null>(null);

    const grid = useMemo(() => (shown === null ? null : monthGrid(shown)), [shown]);
    const calendar = useOrderDeskCalendarQuery(
        grid === null ? null : { from: grid[0] ?? '', to: grid[grid.length - 1] ?? '' },
    );
    const withOrders = useMemo(
        () =>
            new Set(
                (calendar.data?.days ?? [])
                    .filter((entry) => entry.counts.order > 0)
                    .map((entry) => entry.date),
            ),
        [calendar.data],
    );

    const relative = relativeDay(day, today, t, formatter);
    const short = shortDay(day, formatter);
    const valueLabel = relative === short ? short : `${relative} · ${short}`;

    return (
        <View testID={testID} className="z-tooltip flex-row items-center gap-1">
            <DeskIconButton
                testID={`${testID}-previous`}
                label={t('kitchen:orders.day.previous')}
                icon={<Icon name="chevronBackward" size="md" />}
                onPress={() => {
                    onChange(addDays(day, -1));
                }}
            />
            <MiniMonthPicker
                testID={`${testID}-pick`}
                label={t('kitchen:orders.day.pick')}
                value={day}
                today={today}
                valueLabel={valueLabel}
                onChange={onChange}
                marked={(candidate) => withOrders.has(candidate)}
                onMonthShown={(month) => {
                    setShown(month);
                }}
            />
            <DeskIconButton
                testID={`${testID}-next`}
                label={t('kitchen:orders.day.next')}
                icon={<Icon name="chevronForward" size="md" />}
                onPress={() => {
                    onChange(addDays(day, 1));
                }}
            />
            {day === today ? null : (
                <DeskButton
                    testID={`${testID}-today`}
                    variant="quiet"
                    label={t('kitchen:orders.day.backToToday')}
                    onPress={() => {
                        onChange(today);
                    }}
                />
            )}
            <View aria-hidden className="ms-1 h-[22px] w-px bg-stroke-subtle" />
        </View>
    );
}
