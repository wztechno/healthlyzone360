import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export interface CalendarDay {
    readonly key: string;
    /** Full name for assistive technology, e.g. "Monday 3 August". */
    readonly label: string;
    /** Short visible heading, e.g. "Mon". Falls back to `label`. */
    readonly shortLabel?: string | undefined;
    readonly sublabel?: string | undefined;
    readonly today?: boolean | undefined;
}

export interface CalendarSlot {
    readonly key: string;
    readonly label: string;
}

export interface CalendarCell {
    readonly day: CalendarDay;
    /** `null` in the day-header row of a slotless grid. */
    readonly slot: CalendarSlot | null;
}

export interface CalendarGridProps {
    /** Accessible name for the grid, e.g. "Week of 3 August". */
    readonly label: string;
    /**
     * Ordered by the caller. The grid never sorts, never picks a week start and never reverses:
     * which day comes first is a calendar decision (and, in Arabic, a regional one), and a component
     * that guessed would be wrong in exactly the places nobody tests.
     */
    readonly days: readonly CalendarDay[];
    /** Rows within each day column — meal slots, time bands. Omit for a single-row grid. */
    readonly slots?: readonly CalendarSlot[] | undefined;
    readonly renderCell: (cell: CalendarCell) => ReactNode;
    readonly renderDayHeader?: ((day: CalendarDay) => ReactNode) | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A headless week / day grid.
 *
 * Three constraints shape it, and they are all direction constraints.
 *
 * **Day columns are flex children in source order.** Not absolutely positioned, not offset by a
 * percentage of the container width. A `flex-row` lays its children out right-to-left in Arabic on
 * both platforms for free, so Sunday sits on the right with no mirrored geometry anywhere — and no
 * `left`, `right`, `start` or `end` inset appears in this file at all.
 *
 * **Nothing is absolutely positioned.** A calendar that positions entries by computed offsets
 * inherits every rounding error in the layout and cannot reflow; here each cell simply sits in its
 * column and the column grows.
 *
 * **Weekday order comes from the caller.** See `days` above.
 *
 * The grid claims no table semantics. Its DOM order is column-major — every cell of Monday, then
 * every cell of Tuesday — and asserting `role="grid"` over that would promise a screen reader a
 * row-by-row reading it cannot deliver. Each column is an honest labelled `group` instead, and the
 * application announces planner changes through its own live region.
 */
export function CalendarGrid({
    label,
    days,
    slots,
    renderCell,
    renderDayHeader,
    className,
    testID,
}: CalendarGridProps) {
    const rows: readonly (CalendarSlot | null)[] = slots === undefined ? [null] : slots;

    return (
        <View
            testID={testID}
            aria-label={label}
            accessibilityLabel={label}
            className={cx('flex-col gap-2', className)}
        >
            {slots === undefined ? null : (
                <View
                    testID={testID === undefined ? undefined : `${testID}-slot-legend`}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="flex-row flex-wrap gap-2"
                >
                    {slots.map((slot) => (
                        <RNText
                            key={slot.key}
                            className="text-xs text-content-secondary text-start"
                        >
                            {slot.label}
                        </RNText>
                    ))}
                </View>
            )}

            <View className="flex-row items-stretch gap-2">
                {days.map((day) => (
                    <View
                        key={day.key}
                        testID={testID === undefined ? undefined : `${testID}-day-${day.key}`}
                        role="group"
                        aria-label={day.label}
                        accessibilityLabel={day.label}
                        className="flex-1 flex-col gap-2"
                    >
                        {renderDayHeader === undefined ? (
                            <View
                                className={cx(
                                    'flex-col gap-0.5 rounded-md px-2 py-1',
                                    day.today === true ? 'bg-surface-brand-subtle' : null,
                                )}
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        'text-xs font-semibold text-center',
                                        day.today === true
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-primary',
                                    )}
                                >
                                    {day.shortLabel ?? day.label}
                                </RNText>
                                {day.sublabel === undefined ? null : (
                                    <RNText
                                        numberOfLines={1}
                                        className="text-xs text-content-secondary text-center"
                                    >
                                        {day.sublabel}
                                    </RNText>
                                )}
                            </View>
                        ) : (
                            renderDayHeader(day)
                        )}

                        {rows.map((slot, index) => (
                            <View
                                key={slot === null ? `row-${String(index)}` : slot.key}
                                testID={
                                    testID === undefined
                                        ? undefined
                                        : `${testID}-cell-${day.key}-${slot === null ? String(index) : slot.key}`
                                }
                                className="flex-col"
                            >
                                {renderCell({ day, slot })}
                            </View>
                        ))}
                    </View>
                ))}
            </View>
        </View>
    );
}
