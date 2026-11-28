import { Dialog, Icon, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ColumnPickerProps } from '../catalogue/column-picker.tsx';
import { ChoiceRow } from './choice-row.tsx';
import { DeskButton } from './desk-button.tsx';
import { DeskChip } from './desk-chip.tsx';
import { DropTrigger } from './desk-select.tsx';

/**
 * The desk's Show columns (Requirements canvas, `Show columns · 6 of 6`; built 2026-11-11).
 *
 * ```
 * ( ▦ 6 of 6 ⌄ )     the toolbar's dropdown pill: the canvas's grid glyph with the count beside it
 *                     in bold; its accessible name is the whole "Show columns · 6 of 6"
 *
 *   ┌ Choose the columns to show ─────────────── ✕ ┐
 *   │ Show up to 6 columns               (3 of 6) │   one line: the cap, and the count as a chip
 *   │ [✓] Ingredient      [✓] Required             │   check rows, two to a row; a locked
 *   │ [✓] On hand         [ ] Reserved             │   column stays ticked and cannot be
 *   │ …                                            │   unticked, a full table greys the rest
 *   │           ( Clear all ) ( Reset ) (( Done )) │
 *   └──────────────────────────────────────────────┘
 * ```
 *
 * The props are `ColumnPicker`'s (`useColumnControls().picker`), so a table moves over by changing
 * the component.
 */
export function DeskColumnPicker({
    options,
    shown,
    max,
    onToggle,
    onReset,
    onClear,
    canClear,
    testID,
}: ColumnPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const close = () => {
        setOpen(false);
    };
    const count = t('kitchen:catalogue.columnsCount', { shown, max });

    return (
        <View testID={testID}>
            <DropTrigger
                triggerProps={{ 'aria-haspopup': 'dialog' }}
                onPress={() => {
                    setOpen(true);
                }}
                open={open}
                filled={false}
                icon={<Icon name="layoutGrid" size="sm" />}
                value={count}
                accessibilityLabel={t('kitchen:catalogue.columnsButton', { shown, max })}
                testID={`${testID}-trigger`}
            />
            <Dialog
                testID={`${testID}-dialog`}
                look="card"
                open={open}
                onClose={close}
                title={t('kitchen:catalogue.columnsLabel')}
                actions={
                    <>
                        <DeskButton
                            testID={`${testID}-clear`}
                            variant="secondary"
                            label={t('kitchen:catalogue.columnsClear')}
                            disabled={!canClear}
                            onPress={onClear}
                        />
                        <DeskButton
                            testID={`${testID}-reset`}
                            variant="secondary"
                            label={t('kitchen:catalogue.columnsReset')}
                            onPress={onReset}
                        />
                        <DeskButton
                            testID={`${testID}-done`}
                            label={t('common:action.done')}
                            onPress={close}
                        />
                    </>
                }
            >
                {/*
                 * The cap and the count on one line. They were two stacked captions — "Show up to
                 * 6 columns", then "Show columns · 3 of 6" — the second repeating the title.
                 */}
                <View className="flex-row items-center justify-between gap-3">
                    <Text variant="body" tone="secondary" testID={`${testID}-cap`}>
                        {t('kitchen:catalogue.columnsHeading', { max })}
                    </Text>
                    <DeskChip
                        testID={`${testID}-count`}
                        tone={shown >= max ? 'brand' : 'neutral'}
                        label={count}
                    />
                </View>
                {/* A gap between the rows, so two ticked neighbours read as two choices, not one band. */}
                <View className="flex-row flex-wrap gap-y-1.5">
                    {options.map((option) => (
                        <View key={option.key} className="w-1/2 pe-1.5">
                            <ChoiceRow
                                testID={`${testID}-${option.key}`}
                                mark="check"
                                label={option.label}
                                selected={option.shown}
                                disabled={option.disabled}
                                onPress={() => {
                                    onToggle(option.key);
                                }}
                            />
                        </View>
                    ))}
                </View>
            </Dialog>
        </View>
    );
}
