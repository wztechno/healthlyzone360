import { Badge, Button, PickerField, Select, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { weekdayKey } from '../../marketplace/format.ts';
import { withDayClosed } from '../delivery-model.ts';
import type { OperatingDayDraft } from '../delivery-model.ts';

/**
 * One day of a branch's trading week, as `Commercial.dc.html` draws it (§2.2, §3.5).
 *
 * ```
 * DAY           TRADING     OPENS        CLOSES       LAST SAME-DAY ORDER   WHAT THAT DAY SAYS
 * Monday        [Open ▾]    [08:00 ◷]    [22:00 ◷]    [20:30 ◷]             Open 08:00–22:00, last same-day order 20:30.  Copy to every open day
 * Sunday CLOSED [Closed ▾]  [--:-- ◷]    [--:-- ◷]    [--:-- ◷]             Closed all day. No hours are recorded …
 * ```
 *
 * One grid row. The tracks are the design's (`120 · 108 · 116 · 116 · 150 · 1fr`) and are exported
 * so the header row in `OperatingWeekRows` lines up with every day beneath it.
 *
 * **Choosing `Closed` clears all three times in one action** (`withDayClosed`) and the fields stay
 * drawn, empty and disabled — the column is still there, it has nothing in it. The sentence at the
 * end says what the day means in words, including a day with no cut-off (`cutOffNone`), and the
 * copy action appears only on an open day.
 */
export const TRADING_TRACKS = {
    day: 120,
    trading: 108,
    opens: 116,
    closes: 116,
    cutOff: 150,
} as const;

export interface TradingDayRowProps {
    readonly day: OperatingDayDraft;
    readonly onChange: (next: OperatingDayDraft) => void;
    readonly onCopyToOpenDays: () => void;
    readonly canManage: boolean;
    readonly error?: string | undefined;
    readonly testID: string;
}

type Trading = 'open' | 'closed';

export function TradingDayRow({
    day,
    onChange,
    onCopyToOpenDays,
    canManage,
    error,
    testID,
}: TradingDayRowProps) {
    const { t } = useTranslation();
    const dayName = t(weekdayKey(day.weekday));
    const timesDisabled = !canManage || day.isClosed;

    const note = day.isClosed
        ? t('kitchen:branchHours.closedNote')
        : day.orderCutOffAt.trim() === ''
          ? t('kitchen:branchHours.cutOffNone')
          : t('kitchen:branchHours.dayOpenNote', {
                opens: day.opensAt,
                closes: day.closesAt,
                cutOff: day.orderCutOffAt,
            });

    return (
        <View
            testID={testID}
            className="z-auto flex-col gap-hair border-b border-stroke-subtle px-tight py-1.5"
        >
            <View className="z-auto min-h-control-md flex-row items-center gap-3.5">
                <View
                    style={{ width: TRADING_TRACKS.day }}
                    className="flex-row items-center gap-1.5"
                >
                    <Text variant="strong" testID={`${testID}-name`}>
                        {dayName}
                    </Text>
                    {day.isClosed ? (
                        <Badge
                            testID={`${testID}-closed-badge`}
                            tone="neutral"
                            label={t('kitchen:branchHours.closedBadge')}
                        />
                    ) : null}
                </View>

                <View style={{ width: TRADING_TRACKS.trading }} className="z-auto">
                    <Select<Trading>
                        testID={`${testID}-trading`}
                        id={`${testID}-trading`}
                        label={t('kitchen:branchHours.tradingLabel', { day: dayName })}
                        labelHidden
                        disabled={!canManage}
                        value={day.isClosed ? 'closed' : 'open'}
                        options={[
                            { value: 'open', label: t('kitchen:branchHours.tradingOpen') },
                            { value: 'closed', label: t('kitchen:branchHours.closedLabel') },
                        ]}
                        onChange={(next) => {
                            onChange(withDayClosed(day, next === 'closed'));
                        }}
                    />
                </View>

                <View style={{ width: TRADING_TRACKS.opens }}>
                    <PickerField
                        kind="time"
                        testID={`${testID}-opens`}
                        label={`${dayName} — ${t('kitchen:branchHours.opensLabel')}`}
                        labelHidden
                        value={day.opensAt}
                        disabled={timesDisabled}
                        onChange={(next) => {
                            onChange({ ...day, opensAt: next });
                        }}
                    />
                </View>
                <View style={{ width: TRADING_TRACKS.closes }}>
                    <PickerField
                        kind="time"
                        testID={`${testID}-closes`}
                        label={`${dayName} — ${t('kitchen:branchHours.closesLabel')}`}
                        labelHidden
                        value={day.closesAt}
                        disabled={timesDisabled}
                        onChange={(next) => {
                            onChange({ ...day, closesAt: next });
                        }}
                    />
                </View>
                <View style={{ width: TRADING_TRACKS.cutOff }}>
                    <PickerField
                        kind="time"
                        testID={`${testID}-cut-off`}
                        label={`${dayName} — ${t('kitchen:branchHours.cutOffLabel')}`}
                        labelHidden
                        value={day.orderCutOffAt}
                        disabled={timesDisabled}
                        onChange={(next) => {
                            onChange({ ...day, orderCutOffAt: next });
                        }}
                    />
                </View>

                <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-tight">
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID={day.isClosed ? `${testID}-closed-note` : `${testID}-cut-off-state`}
                    >
                        {note}
                    </Text>
                    {day.isClosed || !canManage ? null : (
                        <Button
                            testID={`${testID}-copy`}
                            size="sm"
                            variant="ghost"
                            label={t('kitchen:branchHours.copyShort')}
                            onPress={onCopyToOpenDays}
                        />
                    )}
                </View>
            </View>

            {error === undefined ? null : (
                <Text testID={`${testID}-error`} tone="danger" variant="caption">
                    {error}
                </Text>
            )}
        </View>
    );
}
