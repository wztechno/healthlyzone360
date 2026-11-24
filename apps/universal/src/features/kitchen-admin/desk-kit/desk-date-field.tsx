import {
    Dropdown,
    FormField,
    Icon,
    SlideIn,
    cx,
    inputFrameClassName,
    useDensity,
} from '@healthy360/design-system';
import type { FieldControlProps } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { todayIso } from '../../commerce/dates.ts';
import { dateInstant } from '../../planner/format.ts';
import { monthOf } from '../orders/order-book.ts';
import { DeskButton } from './desk-button.tsx';
import { MonthPanel } from './mini-month.tsx';

/**
 * A form's date, the desk way: a field that reads "24 Nov 2026" behind a calendar mark and opens
 * the same small month as the day pill (`MiniMonthPicker`), with Today and Clear under it.
 *
 * ```
 *  Date received (i)
 *  [ 📅 24 Nov 2026          ]
 *  ┌──────────────────────────────┐
 *  │ (‹)    November 2026     (›) │
 *  │  Mon Tue Wed Thu Fri Sat Sun │
 *  │   …  [24]  …                 │
 *  │ Today                  Clear │
 *  └──────────────────────────────┘
 * ```
 *
 * It replaces the browser's own `input[type=date]` on the stepped posting forms — a "dd-----yyyy"
 * mask typed a segment at a time, its picker a small glyph at the far end — which kitchen staff
 * found the hardest field on the page to use.
 *
 * The value in and out is ISO `YYYY-MM-DD`, or `null` for no day, as `DateField`'s is, so a call
 * site swaps one for the other. `id` lands on the trigger, so `focusField` reaches it.
 */
export interface DeskDateFieldProps {
    /** Translated. */
    readonly label: string;
    readonly labelHidden?: boolean | undefined;
    /** `YYYY-MM-DD`, or `''` / `null` for no day. */
    readonly value: string | null;
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    /** A Clear link under the month — for a date that may be left blank. */
    readonly clearable?: boolean | undefined;
    /** Which edge the month lines up with — `end` for a field at the end of its row. */
    readonly align?: 'start' | 'end' | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID: string;
    readonly onChange: (day: string | null) => void;
}

export function DeskDateField({
    label,
    labelHidden = false,
    value,
    min,
    max,
    hint,
    error,
    required = false,
    clearable = false,
    align = 'start',
    id,
    className,
    testID,
    onChange,
}: DeskDateFieldProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const density = useDensity();
    const today = todayIso();
    const day = value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    const [shown, setShown] = useState(monthOf(day === '' ? today : day));
    const todayAllowed = (min === undefined || today >= min) && (max === undefined || today <= max);
    const shownValue =
        day === ''
            ? null
            : formatter.formatDate(dateInstant(day), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
              });

    return (
        <FormField
            label={label}
            labelHidden={labelHidden}
            hint={hint}
            error={error}
            required={required}
            id={id}
            className={className}
            testID={testID}
        >
            {(control: FieldControlProps) => (
                <Dropdown
                    testID={`${testID}-picker`}
                    label={label}
                    align={align}
                    role="dialog"
                    panelClassName="w-[296px] !rounded-[18px] !shadow-elevation-bar p-3"
                    onOpenChange={(open) => {
                        // Opens on the chosen day's month, or today's.
                        if (open) setShown(monthOf(day === '' ? today : day));
                    }}
                    trigger={({ triggerProps, toggle, open }) => (
                        <Pressable
                            {...triggerProps}
                            nativeID={control.nativeID}
                            testID={`${testID}-trigger`}
                            accessibilityRole="button"
                            accessibilityLabel={`${label}: ${
                                shownValue ?? t('kitchen:dateField.placeholder')
                            }`}
                            aria-describedby={control['aria-describedby']}
                            aria-invalid={control['aria-invalid']}
                            onPress={toggle}
                            className={cx(
                                inputFrameClassName({
                                    invalid: error !== undefined,
                                    focused: open,
                                    disabled: false,
                                    density,
                                    size: 'sm',
                                }),
                                'gap-2 web:cursor-pointer',
                            )}
                        >
                            <Icon name="calendar" size="sm" className="text-content-secondary" />
                            <RNText
                                numberOfLines={1}
                                testID={`${testID}-value`}
                                className={cx(
                                    'min-w-0 flex-1 text-role-body tabular-nums',
                                    shownValue === null
                                        ? 'text-content-secondary'
                                        : 'text-content-primary',
                                )}
                            >
                                {shownValue ?? t('kitchen:dateField.placeholder')}
                            </RNText>
                        </Pressable>
                    )}
                >
                    {({ close }) => (
                        <SlideIn edge="bottom" distance="small" duration="normal">
                            <MonthPanel
                                month={shown}
                                value={day}
                                today={today}
                                marked={undefined}
                                min={min}
                                max={max}
                                onMonth={setShown}
                                onPick={(picked) => {
                                    onChange(picked);
                                    close();
                                }}
                                testID={`${testID}-picker`}
                            />
                            <View className="mt-2 flex-row items-center justify-between border-t border-stroke-subtle pt-2">
                                <DeskButton
                                    testID={`${testID}-today`}
                                    variant="quiet"
                                    label={t('kitchen:dateField.today')}
                                    disabled={!todayAllowed}
                                    onPress={() => {
                                        onChange(today);
                                        close();
                                    }}
                                />
                                {clearable && day !== '' ? (
                                    <DeskButton
                                        testID={`${testID}-clear`}
                                        variant="quiet"
                                        label={t('common:action.clear')}
                                        onPress={() => {
                                            onChange(null);
                                            close();
                                        }}
                                    />
                                ) : null}
                            </View>
                        </SlideIn>
                    )}
                </Dropdown>
            )}
        </FormField>
    );
}
