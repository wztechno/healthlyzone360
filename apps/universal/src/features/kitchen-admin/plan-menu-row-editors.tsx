import { PLAN_MENU_SLOTS } from '@healthy360/api-client/contracts';
import type { MealAdmin, PlanMenuSlot } from '@healthy360/api-client/contracts';
import { Badge, Button, DataList, fieldWidth, Icon, Select, Text } from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
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
import type { MenuDay, MenuDraft, MenuEntryDraft } from './plan-menu.ts';
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
 * ## A `DataList`, like every admin table
 *
 * The same table the catalogue lists and the opening hours use — its green header band, its row
 * heights — with one row per dish. The day is drawn on its first row and its Add a dish on its last,
 * so a day still reads as one block. Every control is the desk's `sm` rung, and the dish picker is
 * one field wide; the row's controls column takes the slack, so the band still runs the card's
 * width.
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

    const pickMeal = (row: MenuEntryDraft, next: string) => {
        const meal = meals.find((candidate) => String(candidate.id) === next);
        onChange(
            patchMenuEntry(draft, row.key, {
                mealId: MealId.unsafe(next),
                mealName: meal?.name ?? row.mealName,
            }),
        );
    };

    const removeEntry = (row: MenuEntryDraft) => {
        setRemoved({
            row,
            index: draft.entries.findIndex((entry) => entry.key === row.key),
        });
        onChange(removeMenuEntry(draft, row.key));
    };

    const addDish = (cycleDay: number) => {
        const coordinate = nextCoordinate(draft, cycleDay);
        onChange(addMenuEntry(draft, emptyMenuEntry(nextKey(), cycleDay, coordinate)));
        setAnnouncement(
            t('kitchen:plans.menuAddedAnnouncement', {
                day: cycleDay,
                slot: t(menuSlotKey(coordinate.slot)),
            }),
        );
    };

    /*
     * One table row per dish, and one for a day with none. The day is the group, never a field: it
     * is drawn on the day's first row only, and its Add a dish on its last, so a day still reads as
     * one block down the table.
     */
    const rows = useMemo<readonly MenuRow[]>(
        () =>
            days.flatMap((day): MenuRow[] =>
                day.entries.length === 0
                    ? [
                          {
                              key: `day-${String(day.cycleDay)}`,
                              day,
                              entry: null,
                              first: true,
                              last: true,
                          },
                      ]
                    : day.entries.map((entry, index) => ({
                          key: entry.key,
                          day,
                          entry,
                          first: index === 0,
                          last: index === day.entries.length - 1,
                      })),
            ),
        [days],
    );

    const columns: readonly DataListColumn<MenuRow>[] = [
        {
            key: 'day',
            label: t('kitchen:plans.menuDayLabel'),
            width: DAY_TRACK,
            priority: 100,
            grow: false,
            render: (row) => {
                if (!row.first) return null;
                const dayTestId = `${testID}-day-${String(row.day.cycleDay)}`;
                return (
                    <View testID={dayTestId} className="flex-col gap-hair py-tight">
                        <Text variant="label">
                            {t('kitchen:plans.menuDayNumber', { number: row.day.cycleDay })}
                        </Text>
                        <Text testID={`${dayTestId}-date`} variant="caption" tone="secondary">
                            {dayCaption(row.day.cycleDay)}
                        </Text>
                        {row.day.isBeyondCycle ? (
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
                );
            },
        },
        {
            key: 'slot',
            label: t('kitchen:plans.menuSlotLabel'),
            width: SLOT_TRACK,
            priority: 99,
            grow: false,
            render: (row) =>
                row.entry === null ? null : (
                    <View className="z-auto min-w-0 flex-1 py-tight">
                        <Select<PlanMenuSlot>
                            testID={`${testID}-row-${row.entry.key}-slot`}
                            id={`${testID}-row-${row.entry.key}-slot`}
                            label={t('kitchen:plans.menuSlotLabel')}
                            labelHidden
                            size="sm"
                            disabled={!canManage}
                            options={slotOptions}
                            value={row.entry.slot}
                            onChange={(next) => {
                                if (row.entry === null) return;
                                onChange(patchMenuEntry(draft, row.entry.key, { slot: next }));
                            }}
                        />
                    </View>
                ),
        },
        {
            key: 'sequence',
            label: t('kitchen:plans.menuSequenceShort'),
            width: SEQUENCE_TRACK,
            priority: 98,
            grow: false,
            render: (row) =>
                row.entry === null ? null : (
                    <View className="min-w-0 flex-1 py-tight">
                        <CountField
                            testID={`${testID}-row-${row.entry.key}-sequence`}
                            label={t('kitchen:plans.menuSequenceLabel')}
                            labelHidden
                            placeholder="1"
                            value={row.entry.sequence}
                            disabled={!canManage}
                            onChange={(next) => {
                                if (row.entry === null) return;
                                onChange(patchMenuEntry(draft, row.entry.key, { sequence: next }));
                            }}
                        />
                    </View>
                ),
        },
        {
            key: 'dish',
            label: t('kitchen:plans.menuMealLabel'),
            // One field wide, like every other picker: the no-stretch rule.
            width: DISH_TRACK,
            priority: 97,
            grow: false,
            render: (row) => {
                if (row.entry === null) {
                    return (
                        <Text
                            testID={`${testID}-day-${String(row.day.cycleDay)}-empty`}
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:plans.menuDayEmptyHint')}
                        </Text>
                    );
                }
                const entry = row.entry;
                const error = errors.get(entry.key);
                return (
                    <View className="z-auto min-w-0 flex-1 flex-col gap-hair py-tight">
                        <Select
                            testID={`${testID}-row-${entry.key}-meal`}
                            id={`${testID}-row-${entry.key}-meal`}
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
                            options={optionsFor(entry)}
                            value={entry.mealId === null ? null : String(entry.mealId)}
                            onChange={(next) => {
                                pickMeal(entry, next);
                            }}
                        />
                        {error === undefined ? null : (
                            <Text
                                testID={`${testID}-row-${entry.key}-error`}
                                // A sentence, not a value: it wraps rather than ending in an ellipsis.
                                numberOfLines={3}
                                role="alert"
                                tone="danger"
                                variant="caption"
                            >
                                {error}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'actions',
            label: t('kitchen:list.actionHeader'),
            width: ACTIONS_TRACK,
            priority: 96,
            // Takes the row's slack, so the band runs the card's width and the picker stays one field.
            fill: true,
            render: (row) =>
                !canManage ? null : (
                    <View className="flex-row flex-wrap items-center gap-snug py-tight">
                        {row.entry === null ? null : (
                            <RemoveButton
                                testID={`${testID}-row-${row.entry.key}`}
                                onRemove={() => {
                                    if (row.entry !== null) removeEntry(row.entry);
                                }}
                            />
                        )}
                        {row.last ? (
                            <Button
                                testID={`${testID}-day-${String(row.day.cycleDay)}-add`}
                                size="sm"
                                variant="ghost"
                                iconStart={<Icon name="plus" size="sm" />}
                                label={t('kitchen:plans.menuAddDish')}
                                onPress={() => {
                                    addDish(row.day.cycleDay);
                                }}
                            />
                        ) : null}
                    </View>
                ),
        },
    ];

    return (
        // The table carries the component's id when it is drawn, so its rows are `{testID}-row-{key}`
        // exactly as before; the wrapper takes it only while there is no table to carry it.
        <View {...(days.length === 0 ? { testID } : {})} className="z-auto flex-col">
            {days.length === 0 ? (
                <Text testID={`${testID}-empty`} variant="caption" tone="secondary">
                    {t('kitchen:plans.menuEmpty')}
                </Text>
            ) : (
                <DataList<MenuRow>
                    testID={testID}
                    label={t('kitchen:plans.sectionMenu')}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    density="sm"
                    framed
                />
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

/** One line of the menu table: a dish on a day, or a day with no dish yet (`entry: null`). */
interface MenuRow {
    readonly key: string;
    readonly day: MenuDay;
    readonly entry: MenuEntryDraft | null;
    /** The day's first line — the one that names the day. */
    readonly first: boolean;
    /** The day's last line — the one that carries its Add a dish. */
    readonly last: boolean;
}

/**
 * The menu's column tracks: a day, a short select, a figure box, a picker, then the row's controls.
 * Each is its content's width plus the cell's own `px-control-sm` (8 + 8), so the boxes inside keep
 * the widths the design gives them — the dish picker is exactly one field.
 */
const CELL_PADDING = 16;
const DAY_TRACK = 120 + CELL_PADDING;
const SLOT_TRACK = 140 + CELL_PADDING;
const SEQUENCE_TRACK = 64 + CELL_PADDING;
const DISH_TRACK = fieldWidth + CELL_PADDING;
const ACTIONS_TRACK = 160;
