import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { AnchoredLayer, PANEL_IS_LIFTED } from '../overlays/anchored-layer';
import { cx } from '../internal/class-names.ts';
import { KEYS } from '../internal/web-props.ts';
import { Text } from '../primitives/text.tsx';
import { TextInputField } from './text-input.tsx';
import {
    hourHasRoom,
    isWithin,
    isoTime,
    minuteOptions,
    parseTypedTime,
    stepTime,
    timeParts,
} from './time-field-shared.ts';

export interface TimeFieldProps {
    /** Translated. Visible above the control unless `labelHidden`. */
    readonly label: string;
    readonly labelHidden?: boolean | undefined;
    /** ISO `HH:mm` (24-hour) or `''` for no time. Never a localised string. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly disabled?: boolean | undefined;
    /** Inclusive ISO bounds. Times outside them are drawn but cannot be picked from the panel. */
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    /** The minute column's step. Typing still accepts any minute. */
    readonly minuteStep?: number | undefined;
    /** Which edge the panel lines up with — `end` for a field near the page's inline end. */
    readonly align?: 'start' | 'end' | undefined;
    /** Take the width of the cell it sits in instead of the field's own. */
    readonly fullWidth?: boolean | undefined;
    readonly testID?: string | undefined;
}

/** Wide enough for `00:00` and the clock button at the `sm` control size. */
export const TIME_FIELD_WIDTH = 112;
/** One option row. Matches the panel buttons' `h-8`, so the scroll offset is exact. */
const ROW_HEIGHT = 32;
/** Rows shown before a column scrolls. */
const VISIBLE_ROWS = 6;

/**
 * TimeField — a time typed, or picked from a themed panel.
 *
 * It replaced the browser's `<input type="time">`, which drew itself in the operating system's style
 * and locale, ignored dark mode, showed AM/PM to some readers of a 24-hour value, and made a mouse
 * work segment by segment. This one is the product's own text field at the `sm` size — same frame,
 * focus ring and error glow as every other input — with a clock button that opens two short columns:
 * hours, and minutes in `minuteStep` steps.
 *
 * - **Typing** is the fast path. What is typed reaches `onChange` as it is typed, so the page's own
 *   validation sees the box; leaving the field tidies anything that reads as a time (`930`, `9:30`,
 *   Arabic digits → `09:30`). Arrow ↑/↓ moves by the minute step, Shift+arrow by an hour.
 * - **The panel** is plain React Native, so it is the same on the web and on a device. Choosing an
 *   hour keeps the panel open for the minute; choosing a minute closes it. Escape or a press outside
 *   closes it on the web, as `DatePickerButton` does.
 * - **Bounds** (`min`/`max`) grey out what cannot be chosen, so a close time before the opening time
 *   is not on offer. A typed value is still the page's to validate.
 */
export function TimeField({
    label,
    labelHidden = false,
    value,
    onChange,
    hint,
    error,
    disabled = false,
    min,
    max,
    minuteStep = 15,
    align = 'start',
    fullWidth = false,
    testID,
}: TimeFieldProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `time-field-${generated.replace(/:/g, '')}`;
    const panelId = `${base}-panel`;

    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const containerRef = useRef<View | null>(null);
    // On the web the panel is lifted onto `body` (see below), so it is no longer inside the
    // container: a press inside it has to be recognised by its own node.
    const panelRef = useRef<View | null>(null);
    const hourScroll = useRef<ScrollView | null>(null);
    const minuteScroll = useRef<ScrollView | null>(null);

    const minutes = minuteOptions(minuteStep);
    const selected = timeParts(value);
    // Text that is not a time, once the person has left the field. The page may say more (an error
    // of its own wins); this is the field's floor, so a stray `9:7` never sits there unmarked.
    const unreadable = !editing && value !== '' && selected === null;

    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === KEYS.escape) setOpen(false);
        };
        const onPointerDown = (event: Event) => {
            const inside = (ref: typeof containerRef) =>
                (
                    ref.current as unknown as {
                        readonly contains?: (target: unknown) => boolean;
                    } | null
                )?.contains?.(event.target) === true;
            if (inside(containerRef) || inside(panelRef)) return;
            setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    const commit = (next: string) => {
        if (next !== value) onChange(next);
    };

    /*
     * Typed text goes up as it is typed, so the page's own validation sees exactly what is in the
     * box — the same contract the field had as a browser input. Leaving the field tidies a time that
     * reads (`930` → `09:30`); text that does not read is left for the page to name.
     */
    const leave = () => {
        setEditing(false);
        const parsed = parseTypedTime(value);
        if (parsed !== null) commit(parsed);
    };

    const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const key = event.nativeEvent.key;
        if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
        const shift = (event.nativeEvent as { readonly shiftKey?: boolean }).shiftKey === true;
        const delta = (key === 'ArrowUp' ? 1 : -1) * (shift ? 60 : minuteStep);
        (event as { preventDefault?: () => void }).preventDefault?.();
        commit(stepTime(parseTypedTime(value) ?? '', delta));
    };

    const scrollToSelection = () => {
        if (selected === null) return;
        const minuteIndex = Math.max(
            0,
            minutes.findIndex((minute) => minute >= selected.minute),
        );
        const offset = (index: number) => Math.max(0, (index - 2) * ROW_HEIGHT);
        hourScroll.current?.scrollTo({ y: offset(selected.hour), animated: false });
        minuteScroll.current?.scrollTo({ y: offset(minuteIndex), animated: false });
    };

    const pickHour = (hour: number) => {
        // Keep the minute already chosen if it still fits the bounds; otherwise the first that does.
        const keep = selected?.minute ?? minutes[0] ?? 0;
        const minute = isWithin(isoTime(hour, keep), min, max)
            ? keep
            : (minutes.find((candidate) => isWithin(isoTime(hour, candidate), min, max)) ?? keep);
        commit(isoTime(hour, minute));
    };

    const pickMinute = (minute: number) => {
        commit(isoTime(selected?.hour ?? 0, minute));
        setOpen(false);
    };

    const now = new Date();
    const nowHour = now.getHours();

    return (
        // `z-auto`: React Native Web gives every View `z-index: 0`, which would trap the panel under
        // whatever the page draws after the field. Same reason, same fix, as `DatePickerButton`.
        <View
            ref={containerRef}
            className="z-auto flex-col"
            style={fullWidth ? undefined : { width: TIME_FIELD_WIDTH }}
        >
            <TextInputField
                label={label}
                labelHidden={labelHidden}
                hint={hint}
                error={error ?? (unreadable ? t('designSystem:timeField.invalid') : undefined)}
                disabled={disabled}
                size="sm"
                value={value}
                placeholder={t('designSystem:timeField.placeholder')}
                inputMode="numeric"
                maxLength={5}
                onFocus={() => {
                    setEditing(true);
                }}
                onChangeText={commit}
                onBlur={leave}
                onSubmitEditing={leave}
                onKeyPress={onKeyPress}
                testID={testID}
                trailing={
                    <Pressable
                        testID={`${base}-trigger`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={t('designSystem:timeField.open', { label })}
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-haspopup="dialog"
                        disabled={disabled}
                        onPress={() => {
                            setOpen((current) => !current);
                        }}
                        className="h-6 w-6 items-center justify-center rounded"
                    >
                        <Icon
                            name="clock"
                            size="sm"
                            className={open ? 'text-brand-600' : 'text-content-secondary'}
                        />
                    </Pressable>
                }
            />

            {/*
             * Through `AnchoredLayer`, as every `Dropdown` is. Positioned in place, the panel was
             * trapped by react-native-web's `z-index: 0` on each ancestor: in a table every later row
             * painted over it. On the web the layer mounts it on `body` at the field's box; on native
             * it stays in place.
             */}
            {open && !disabled ? (
                <AnchoredLayer anchorRef={containerRef} align={align}>
                    <View
                        ref={panelRef}
                        testID={panelId}
                        nativeID={panelId}
                        role="dialog"
                        aria-label={label}
                        accessibilityLabel={label}
                        onLayout={scrollToSelection}
                        className={cx(
                            'w-[184px] flex-col gap-2 rounded-lg border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-3',
                            PANEL_IS_LIFTED
                                ? null
                                : cx(
                                      'absolute top-full z-tooltip mt-1',
                                      align === 'end' ? 'end-0' : 'start-0',
                                  ),
                        )}
                    >
                        <View className="flex-row gap-2">
                            <Column
                                heading={t('designSystem:timeField.hour')}
                                scrollRef={hourScroll}
                                testID={`${base}-hours`}
                            >
                                {Array.from({ length: 24 }, (_unused, hour) => (
                                    <Option
                                        key={hour}
                                        label={String(hour).padStart(2, '0')}
                                        selected={selected?.hour === hour}
                                        current={hour === nowHour}
                                        enabled={hourHasRoom(hour, minutes, min, max)}
                                        onPress={() => {
                                            pickHour(hour);
                                        }}
                                        testID={`${base}-hour-${String(hour).padStart(2, '0')}`}
                                    />
                                ))}
                            </Column>
                            <Column
                                heading={t('designSystem:timeField.minute')}
                                scrollRef={minuteScroll}
                                testID={`${base}-minutes`}
                            >
                                {minutes.map((minute) => (
                                    <Option
                                        key={minute}
                                        label={String(minute).padStart(2, '0')}
                                        selected={selected?.minute === minute}
                                        current={false}
                                        enabled={isWithin(
                                            isoTime(selected?.hour ?? 0, minute),
                                            min,
                                            max,
                                        )}
                                        onPress={() => {
                                            pickMinute(minute);
                                        }}
                                        testID={`${base}-minute-${String(minute).padStart(2, '0')}`}
                                    />
                                ))}
                            </Column>
                        </View>

                        <View className="flex-row items-center justify-between border-t border-stroke-subtle pt-2">
                            <Pressable
                                testID={`${base}-clear`}
                                role="button"
                                accessibilityRole="button"
                                disabled={value === ''}
                                onPress={() => {
                                    commit('');
                                    setOpen(false);
                                }}
                                className="h-control-sm items-center justify-center rounded px-control-sm"
                            >
                                <Text
                                    variant="caption"
                                    tone={value === '' ? 'disabled' : 'secondary'}
                                >
                                    {t('designSystem:timeField.clear')}
                                </Text>
                            </Pressable>
                            <Pressable
                                testID={`${base}-done`}
                                role="button"
                                accessibilityRole="button"
                                onPress={() => {
                                    setOpen(false);
                                }}
                                className="h-control-sm items-center justify-center rounded px-control-sm"
                            >
                                <Text variant="caption" tone="brand">
                                    {t('designSystem:timeField.done')}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </AnchoredLayer>
            ) : null}
        </View>
    );
}

function Column({
    heading,
    scrollRef,
    testID,
    children,
}: {
    readonly heading: string;
    readonly scrollRef: RefObject<ScrollView | null>;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    return (
        <View className="flex-1 flex-col gap-1">
            <Text variant="caption" tone="secondary" className="text-center">
                {heading}
            </Text>
            <ScrollView
                ref={scrollRef}
                testID={testID}
                aria-label={heading}
                accessibilityLabel={heading}
                style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}
                contentContainerClassName="flex-col gap-0"
                showsVerticalScrollIndicator={false}
            >
                {children}
            </ScrollView>
        </View>
    );
}

function Option({
    label,
    selected,
    current,
    enabled,
    onPress,
    testID,
}: {
    readonly label: string;
    readonly selected: boolean;
    readonly current: boolean;
    readonly enabled: boolean;
    readonly onPress: () => void;
    readonly testID: string;
}) {
    return (
        <Pressable
            testID={testID}
            role="option"
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-selected={selected}
            aria-disabled={!enabled}
            accessibilityState={{ selected, disabled: !enabled }}
            disabled={!enabled}
            onPress={onPress}
            className={cx(
                'h-8 items-center justify-center rounded',
                selected
                    ? 'bg-surface-brand-subtle'
                    : current
                      ? 'border border-stroke-strong'
                      : null,
            )}
        >
            <Text variant="mono" tone={selected ? 'brand' : enabled ? 'primary' : 'disabled'}>
                {label}
            </Text>
        </Pressable>
    );
}
