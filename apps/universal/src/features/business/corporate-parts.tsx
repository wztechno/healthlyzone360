import { Button, Icon } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

/**
 * `.stp` — a boxed whole-number stepper: (−) [ 20 ] (+). The corporate canvas's pack count, on the
 * line pop-up and on each line of a new quotation. The number is typed or stepped; it never goes
 * below `min`. 36px tall, 116px wide, on the desk ladder.
 */
export function PackStepper({
    value,
    onChange,
    min = 1,
    label,
    testID,
}: {
    readonly value: number;
    readonly onChange: (next: number) => void;
    readonly min?: number | undefined;
    /** Translated — the field's accessible name, "Packs of Buffalo Dip". */
    readonly label: string;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    // What is being typed, while it is; otherwise the value itself.
    const [draft, setDraft] = useState<string | null>(null);

    const step = (icon: IconName, accessibilityLabel: string, next: number, id: string) => {
        const disabled = next < min;
        return (
            <Pressable
                testID={`${testID}-${id}`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                aria-disabled={disabled}
                disabled={disabled}
                onPress={() => {
                    onChange(next);
                }}
                className={`h-[34px] w-8 items-center justify-center ${
                    disabled ? 'opacity-40' : 'hover:bg-surface-sunken'
                }`}
            >
                <Icon name={icon} size="sm" className="text-content-primary" />
            </Pressable>
        );
    };

    return (
        <View
            testID={testID}
            role="group"
            aria-label={label}
            className="h-9 flex-row items-center overflow-hidden rounded-[10px] border border-stroke bg-surface-raised"
        >
            {step('minus', t('business:stepper.fewer'), value - 1, 'decrement')}
            <TextInput
                testID={`${testID}-input`}
                accessibilityLabel={label}
                inputMode="numeric"
                value={draft ?? String(value)}
                onChangeText={(next) => {
                    setDraft(next);
                    const parsed = Number.parseInt(next, 10);
                    if (Number.isInteger(parsed) && parsed >= min) onChange(parsed);
                }}
                onBlur={() => {
                    setDraft(null);
                }}
                className="h-[34px] w-[52px] border-x border-stroke-subtle text-center text-[13px] font-semibold tabular-nums text-content-primary web:outline-none"
            />
            {step('plus', t('business:stepper.more'), value + 1, 'increment')}
        </View>
    );
}

/**
 * Parts the corporate canvas (2026-11-10) draws that the kitchen admin has no twin for. Each is on
 * `/showcase-corporate`.
 */

/**
 * `.savebar` on the Catalogue board — the lines the buyer has picked, and the one thing to do with
 * them: ask for a price. Dark, pinned to the foot of the scroll port, gone when nothing is picked.
 *
 * ```
 *  ┌─────────────────────────────────────────────────────────────────────────────┐
 *  │ 2 lines picked                                     ( Clear ) [ Ask for a price ] │
 *  │ Buffalo Dip, Caesar Dressing                                                 │
 *  └─────────────────────────────────────────────────────────────────────────────┘
 * ```
 */
export function PickedLinesBar({
    names,
    onClear,
    onAsk,
    testID,
}: {
    /** The picked lines' names, in the list's order. */
    readonly names: readonly string[];
    readonly onClear: () => void;
    readonly onAsk: () => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    if (names.length === 0) return null;

    const shown = names.slice(0, 3).join(t('business:picked.separator'));
    const more = names.length - 3;
    return (
        <View
            testID={testID}
            role="region"
            aria-label={t('business:picked.label')}
            className="z-20 mt-3 w-full flex-row items-center gap-3 rounded-[18px] bg-surface-inverse px-[18px] py-3.5 shadow-elevation-4 web:sticky web:bottom-0"
        >
            <View className="min-w-0 flex-1 flex-col">
                <RNText
                    testID={`${testID}-count`}
                    aria-live="polite"
                    className="text-sm font-bold text-content-inverse text-start"
                >
                    {t('business:picked.count', { count: names.length })}
                </RNText>
                <RNText
                    numberOfLines={1}
                    className="text-xs text-content-inverse opacity-75 text-start"
                >
                    {more > 0
                        ? t('business:picked.namesMore', { names: shown, count: more })
                        : shown}
                </RNText>
            </View>
            <Button
                testID={`${testID}-clear`}
                variant="inverseOutline"
                size="sm"
                label={t('business:picked.clear')}
                onPress={onClear}
            />
            <Button
                testID={`${testID}-ask`}
                variant="inverse"
                size="sm"
                label={t('business:picked.ask')}
                onPress={onAsk}
            />
        </View>
    );
}

export interface SendCheck {
    readonly key: string;
    /** What is ready ("Lines"), or what is still to do ("Add at least one line"). */
    readonly label: string;
    /** The ready check's answer — "2 with a quantity". */
    readonly detail?: string | undefined;
    readonly ok: boolean;
}

/**
 * `.dbd` in the New quotation board's aside — "Before you send": one row per thing the request
 * needs, ticked once it is there. Read off the same checks `validateDraft` refuses on, so the list
 * and the Send button never disagree.
 */
export function SendChecklist({
    checks,
    title,
    testID,
}: {
    readonly checks: readonly SendCheck[];
    /** Translated. The list's heading — "Before you send" unless the form says otherwise. */
    readonly title?: string | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const heading = title ?? t('business:builder.beforeYouSend');
    return (
        <View
            testID={testID}
            className="mt-2.5 flex-col border-t border-stroke-subtle pt-2.5"
            role="list"
            aria-label={heading}
        >
            <RNText className="mb-1 text-[13px] font-bold text-content-primary text-start">
                {heading}
            </RNText>
            {checks.map((check) => (
                <View
                    key={check.key}
                    testID={`${testID}-${check.key}`}
                    role="listitem"
                    accessibilityState={{ checked: check.ok }}
                    className="flex-row items-start gap-2 py-1"
                >
                    <View className="mt-0.5 h-4 w-4 items-center justify-center">
                        {check.ok ? (
                            <Icon name="check" size="sm" className="text-success-strong" />
                        ) : (
                            <View aria-hidden className="h-2 w-2 rounded-full bg-warning-strong" />
                        )}
                    </View>
                    <RNText className="min-w-0 flex-1 text-xs text-content-secondary text-start">
                        <RNText className="text-[13px] font-bold text-content-primary">
                            {check.label}
                        </RNText>
                        {check.detail === undefined ? '' : ` · ${check.detail}`}
                    </RNText>
                </View>
            ))}
        </View>
    );
}
