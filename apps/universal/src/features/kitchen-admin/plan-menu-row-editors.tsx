import { PLAN_MENU_SLOTS } from '@healthy360/api-client/contracts';
import type { MealAdmin, PlanMenuSlot } from '@healthy360/api-client/contracts';
import { Badge, Button, Icon, Select, Text } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { MealId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { addDays } from '../commerce/dates.ts';
import { displayName } from './format.ts';
import {
    addMenuEntry,
    emptyMenuEntry,
    menuDays,
    nextCoordinate,
    patchMenuEntry,
    removeMenuEntry,
    restoreMenuEntry,
} from './plan-menu.ts';
import type { MenuDraft, MenuEntryDraft } from './plan-menu.ts';
import { CountField, RemoveButton } from './plan-row-editors.tsx';
import { RowAnnouncer, UndoBar } from './row-editor-shell.tsx';

/**
 * The plan editor's fixed-menu rows (Order Desk, phase 5).
 *
 * Its own module beside `./plan-row-editors.tsx` rather than a fifth section of it, for that file's
 * own reason: these rows enforce a rule *while it is being typed* — a coordinate that has to stay
 * unique, a day that has to exist in the cycle — and that logic wants to be readable next to the
 * control it governs.
 *
 * ## The list is grouped by day, and the day is not a field
 *
 * A menu is read a day at a time, and cooked a day at a time. So the day is the **group**, and a row
 * inside it carries only what varies within a day: which sitting, which position in that sitting, and
 * which dish. Making the day an editable number on every row would have made "move Tuesday's lunch to
 * Wednesday" a typo away from "two lunches on Wednesday and nothing on Tuesday".
 *
 * ## A table, drawn the way the durations draw theirs
 *
 * Column headers once, then one hairline row per day: the day and the date it first falls on at the
 * start, its dishes beside it, each dish a single control-height line of sitting, position, dish and
 * ✕. Every control is the desk's `sm` rung. A fortnight of four-dish days is a page a cook can read
 * down, where the card-per-dish layout it replaces ran to several screens.
 *
 * ## No move buttons
 *
 * A menu entry is keyed by `(day, slot, sequence)` and rendered in that order, so a Move up would
 * either do nothing visible or silently rewrite the coordinate it claims to be preserving. Removal is
 * immediate and reversible through {@link UndoBar}, restored **to its old position**, and keys are
 * stable across both.
 *
 * ## The picker is a searchable `Select`, over published meals only
 *
 * Same idiom as the recipe line editor's ingredient picker: the records arrive as a prop, the options
 * are built here, and the control is `<Select searchable>` — a button opening a modal radio group,
 * which is valid ARIA on both platforms and needs no combobox bookkeeping. The narrowing to published
 * meals is the sale wizard's (`statuses: ['published']`), and it is a narrowing rather than a
 * validation because the server refuses a draft or retired dish with `422`: a menu entry is a promise
 * to serve the dish, and a control that let somebody choose an unpublished one would be the defect.
 *
 * A row whose dish is **not** in that list — retired since it was put on the menu, or past the
 * picker's page — keeps an option of its own, marked. Dropping it would blank the control and make
 * the next save quietly re-write the menu without that dish.
 */

/* ------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

const SLOT_KEYS: Readonly<Record<PlanMenuSlot, string>> = {
    breakfast: 'kitchen:plans.menuSlotBreakfast',
    lunch: 'kitchen:plans.menuSlotLunch',
    dinner: 'kitchen:plans.menuSlotDinner',
    snack: 'kitchen:plans.menuSlotSnack',
};

/** The translation key for one sitting. Exported so a screen can name a slot outside these rows. */
export function menuSlotKey(slot: PlanMenuSlot): string {
    return SLOT_KEYS[slot];
}

/* ------------------------------------------------------------------------------------------------
 * The days
 * ---------------------------------------------------------------------------------------------- */

export interface PlanMenuDaysProps {
    readonly draft: MenuDraft;
    readonly onChange: (next: MenuDraft) => void;
    /** Keyed by row key, from `menuEntryErrors`. */
    readonly errors: ReadonlyMap<string, string>;
    /** The kitchen's published meals, already loaded by the screen. */
    readonly meals: readonly MealAdmin[];
    /** True while that listing is still in flight, so an empty picker says why. */
    readonly mealsPending: boolean;
    readonly canManage: boolean;
    /** Mints a stable row key. The editor owns the counter, exactly as the matrix sections do. */
    readonly nextKey: () => string;
    readonly testID: string;
}

export function PlanMenuDays({
    draft,
    onChange,
    errors,
    meals,
    mealsPending,
    canManage,
    nextKey,
    testID,
}: PlanMenuDaysProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: MenuEntryDraft; index: number } | null>(null);

    const days = useMemo(() => menuDays(draft), [draft]);

    const mealOptions = useMemo<readonly SelectOption[]>(
        () =>
            [...meals]
                .map((meal) => ({
                    value: String(meal.id),
                    label: displayName(meal.name, locale).value,
                }))
                .sort((left, right) => left.label.localeCompare(right.label, locale)),
        [meals, locale],
    );

    const slotOptions = useMemo<readonly SelectOption<PlanMenuSlot>[]>(
        () => PLAN_MENU_SLOTS.map((slot) => ({ value: slot, label: t(menuSlotKey(slot)) })),
        [t],
    );

    /**
     * The date a cycle day first falls on — day 1 *is* the anchor, so the offset is `day - 1`.
     *
     * With its weekday, because the weekday is what a kitchen plans around: on a seven-day rotation
     * it is the same every time the day comes round, and on any other length it is the first of
     * several, which the cycle field warns about.
     *
     * An em dash while there is no anchor: the day exists, the date it lands on is genuinely not
     * known yet, and a caption that disappeared would make the row jump as soon as one is picked.
     */
    const dayCaption = (cycleDay: number): string => {
        if (draft.anchorDate === null) return '—';
        const date = addDays(draft.anchorDate, cycleDay - 1);
        if (date === null) return '—';
        return formatter.formatDate(`${date}T00:00:00.000Z`, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
        });
    };

    /** The row's own dish, kept as an option when the published listing does not carry it. */
    const optionsFor = (row: MenuEntryDraft): readonly SelectOption[] => {
        if (row.mealId === null) return mealOptions;
        const chosen = String(row.mealId);
        if (mealOptions.some((option) => option.value === chosen)) return mealOptions;

        const label = displayName(row.mealName, locale).value;
        return [
            {
                value: chosen,
                label: label === '' ? t('kitchen:plans.menuUnknownMeal') : label,
                description: t('kitchen:plans.menuMealUnavailable'),
            },
            ...mealOptions,
        ];
    };

    const nameOf = (row: MenuEntryDraft): string => {
        const label = displayName(row.mealName, locale).value;
        return label === '' ? t('kitchen:plans.menuEmptyDish') : label;
    };

    return (
        <View testID={testID} className="z-auto flex-col">
            {days.length === 0 ? (
                <Text testID={`${testID}-empty`} variant="caption" tone="secondary">
                    {t('kitchen:plans.menuEmpty')}
                </Text>
            ) : (
                <>
                    {/* Each header over the start of the field below it, as the durations draw it. */}
                    <View className="h-6 flex-row items-center gap-snug border-b border-stroke px-tight">
                        <View style={{ width: DAY_TRACK }}>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.menuDayLabel')}
                            </Text>
                        </View>
                        <View style={{ width: SLOT_TRACK }}>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.menuSlotLabel')}
                            </Text>
                        </View>
                        <View style={{ width: SEQUENCE_TRACK }}>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.menuSequenceShort')}
                            </Text>
                        </View>
                        <View className="min-w-0 flex-1">
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.menuMealLabel')}
                            </Text>
                        </View>
                    </View>

                    {days.map((day) => {
                        const dayTestId = `${testID}-day-${String(day.cycleDay)}`;
                        const addDish = () => {
                            const coordinate = nextCoordinate(draft, day.cycleDay);
                            onChange(
                                addMenuEntry(
                                    draft,
                                    emptyMenuEntry(nextKey(), day.cycleDay, coordinate),
                                ),
                            );
                            setAnnouncement(
                                t('kitchen:plans.menuAddedAnnouncement', {
                                    day: day.cycleDay,
                                    slot: t(menuSlotKey(coordinate.slot)),
                                }),
                            );
                        };
                        const addButton = canManage ? (
                            <Button
                                testID={`${dayTestId}-add`}
                                size="sm"
                                variant="ghost"
                                iconStart={<Icon name="plus" size="sm" />}
                                label={t('kitchen:plans.menuAddDish')}
                                onPress={addDish}
                            />
                        ) : null;

                        return (
                            <View
                                key={day.cycleDay}
                                testID={dayTestId}
                                className="z-auto flex-row items-start gap-snug border-b border-stroke-subtle px-tight py-1.5"
                            >
                                {/* The day is the group, never a field: see the module note. */}
                                <View
                                    style={{ width: DAY_TRACK }}
                                    className="min-h-control-sm flex-col justify-center gap-hair"
                                >
                                    <Text variant="label">
                                        {t('kitchen:plans.menuDayNumber', {
                                            number: day.cycleDay,
                                        })}
                                    </Text>
                                    <Text
                                        testID={`${dayTestId}-date`}
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {dayCaption(day.cycleDay)}
                                    </Text>
                                    {day.isBeyondCycle ? (
                                        <View className="flex-row">
                                            <Badge
                                                testID={`${dayTestId}-beyond`}
                                                tone="warning"
                                                icon="warning"
                                                label={t('kitchen:plans.menuDayBeyond')}
                                            />
                                        </View>
                                    ) : null}
                                </View>

                                <View className="z-auto min-w-0 flex-1 flex-col gap-hair">
                                    {day.entries.length === 0 ? (
                                        <View className="min-h-control-sm flex-row flex-wrap items-center gap-snug">
                                            <Text
                                                testID={`${dayTestId}-empty`}
                                                variant="caption"
                                                tone="secondary"
                                            >
                                                {t('kitchen:plans.menuDayEmptyHint')}
                                            </Text>
                                            {addButton}
                                        </View>
                                    ) : (
                                        <>
                                            {day.entries.map((row) => (
                                                <MenuEntryRow
                                                    key={row.key}
                                                    testID={`${testID}-row-${row.key}`}
                                                    row={row}
                                                    error={errors.get(row.key)}
                                                    slotOptions={slotOptions}
                                                    mealOptions={optionsFor(row)}
                                                    mealsPending={mealsPending}
                                                    canManage={canManage}
                                                    onPatch={(patch) => {
                                                        onChange(
                                                            patchMenuEntry(draft, row.key, patch),
                                                        );
                                                    }}
                                                    onPickMeal={(next) => {
                                                        const meal = meals.find(
                                                            (candidate) =>
                                                                String(candidate.id) === next,
                                                        );
                                                        onChange(
                                                            patchMenuEntry(draft, row.key, {
                                                                mealId: MealId.unsafe(next),
                                                                mealName:
                                                                    meal?.name ?? row.mealName,
                                                            }),
                                                        );
                                                    }}
                                                    onRemove={() => {
                                                        setRemoved({
                                                            row,
                                                            index: draft.entries.findIndex(
                                                                (entry) => entry.key === row.key,
                                                            ),
                                                        });
                                                        onChange(removeMenuEntry(draft, row.key));
                                                    }}
                                                />
                                            ))}
                                            {addButton === null ? null : (
                                                <View className="flex-row">{addButton}</View>
                                            )}
                                        </>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </>
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:plans.menuEntryRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        onChange(restoreMenuEntry(draft, removed.row, removed.index));
                        setRemoved(null);
                    }}
                />
            )}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
        </View>
    );
}

/**
 * One dish on one day: sitting, position, dish, ✕ — a single control-height line.
 *
 * Every label is hidden because the column headers above say it once; each control still carries its
 * own accessible name. The position is typed, not stepped — `CountField`, the durations' own figure
 * box — because a desk surface types a number, and a stepper's two buttons would triple the width of
 * a field whose answer is almost always `1`.
 */
function MenuEntryRow({
    testID,
    row,
    error,
    slotOptions,
    mealOptions,
    mealsPending,
    canManage,
    onPatch,
    onPickMeal,
    onRemove,
}: {
    readonly testID: string;
    readonly row: MenuEntryDraft;
    readonly error: string | undefined;
    readonly slotOptions: readonly SelectOption<PlanMenuSlot>[];
    readonly mealOptions: readonly SelectOption[];
    readonly mealsPending: boolean;
    readonly canManage: boolean;
    readonly onPatch: (patch: Partial<Omit<MenuEntryDraft, 'key'>>) => void;
    readonly onPickMeal: (mealId: string) => void;
    readonly onRemove: () => void;
}) {
    const { t } = useTranslation();

    return (
        <View testID={testID} className="z-auto flex-col gap-hair">
            <View className="z-auto min-h-control-sm flex-row items-center gap-snug">
                <View style={{ width: SLOT_TRACK }} className="z-auto">
                    <Select<PlanMenuSlot>
                        testID={`${testID}-slot`}
                        id={`${testID}-slot`}
                        label={t('kitchen:plans.menuSlotLabel')}
                        labelHidden
                        size="sm"
                        disabled={!canManage}
                        options={slotOptions}
                        value={row.slot}
                        onChange={(next) => {
                            onPatch({ slot: next });
                        }}
                    />
                </View>
                <View style={{ width: SEQUENCE_TRACK }}>
                    <CountField
                        testID={`${testID}-sequence`}
                        label={t('kitchen:plans.menuSequenceLabel')}
                        labelHidden
                        placeholder="1"
                        value={row.sequence}
                        disabled={!canManage}
                        onChange={(next) => {
                            onPatch({ sequence: next });
                        }}
                    />
                </View>
                <View className="z-auto min-w-0 flex-1">
                    <Select
                        testID={`${testID}-meal`}
                        id={`${testID}-meal`}
                        label={t('kitchen:plans.menuMealLabel')}
                        labelHidden
                        size="sm"
                        placeholder={
                            mealsPending
                                ? t('kitchen:plans.menuMealsPending')
                                : t('kitchen:plans.menuMealPlaceholder')
                        }
                        searchable
                        required
                        disabled={!canManage}
                        options={mealOptions}
                        value={row.mealId === null ? null : String(row.mealId)}
                        onChange={onPickMeal}
                    />
                </View>
                {canManage ? <RemoveButton testID={testID} onRemove={onRemove} /> : null}
            </View>

            {error === undefined ? null : (
                <Text testID={`${testID}-error`} role="alert" tone="danger" variant="caption">
                    {error}
                </Text>
            )}
        </View>
    );
}

/** The menu's column tracks, sized like the durations': a day, a short select, a figure box. */
const DAY_TRACK = 120;
const SLOT_TRACK = 140;
const SEQUENCE_TRACK = 64;
