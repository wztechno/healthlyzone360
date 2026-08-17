import { PLAN_MENU_SLOTS } from '@healthy360/api-client/contracts';
import type { MealAdmin, PlanMenuSlot } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Heading,
    Inline,
    NumberStepper,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { MealId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { addDays } from '../commerce/dates.ts';
import { displayName } from './format.ts';
import {
    MENU_SEQUENCE_MAX,
    addMenuEntry,
    emptyMenuEntry,
    menuDays,
    nextCoordinate,
    patchMenuEntry,
    removeMenuEntry,
    restoreMenuEntry,
} from './plan-menu.ts';
import type { MenuDraft, MenuEntryDraft } from './plan-menu.ts';
import { RowAnnouncer, RowShell, UndoBar } from './row-editor-shell.tsx';

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
 * ## No move buttons, and that is {@link RowShell}'s own rule
 *
 * The shell's `onMove` is documented as omittable "for a list whose array order carries no meaning —
 * a meal's availability days are keyed by calendar date, and a Move up button on a Tuesday would
 * offer to reorder something that is already ordered by what it is". A menu entry is keyed by
 * `(day, slot, sequence)` and rendered in that order, so a Move up would either do nothing visible or
 * silently rewrite the coordinate it claims to be preserving. The other two rules stand exactly as
 * written: removal is immediate and reversible through {@link UndoBar}, restored **to its old
 * position**, and keys are stable across both.
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
     * An em dash while there is no anchor: the day exists, the date it lands on is genuinely not
     * known yet, and a caption that disappeared would make the row jump as soon as one is picked.
     */
    const dayCaption = (cycleDay: number): string => {
        if (draft.anchorDate === null) return '—';
        const date = addDays(draft.anchorDate, cycleDay - 1);
        if (date === null) return '—';
        return t('kitchen:plans.menuDayFalls', {
            date: formatter.formatDate(`${date}T00:00:00.000Z`, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
            }),
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
        <Stack space="lg" testID={testID}>
            {days.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.menuEmpty')}
                </Text>
            ) : (
                days.map((day) => {
                    const dayTestId = `${testID}-day-${String(day.cycleDay)}`;

                    return (
                        <Stack space="sm" key={day.cycleDay} testID={dayTestId}>
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Stack space="none">
                                    <Heading level={3}>
                                        {t('kitchen:plans.menuDayNumber', {
                                            number: day.cycleDay,
                                        })}
                                    </Heading>
                                    <Text
                                        testID={`${dayTestId}-date`}
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {dayCaption(day.cycleDay)}
                                    </Text>
                                </Stack>
                                {day.isBeyondCycle ? (
                                    <Badge
                                        testID={`${dayTestId}-beyond`}
                                        tone="warning"
                                        icon="warning"
                                        label={t('kitchen:plans.menuDayBeyond')}
                                    />
                                ) : null}
                            </Inline>

                            {day.entries.length === 0 ? (
                                <Text
                                    testID={`${dayTestId}-empty`}
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {t('kitchen:plans.menuDayEmptyHint')}
                                </Text>
                            ) : (
                                day.entries.map((row, index) => {
                                    const rowTestId = `${testID}-row-${row.key}`;
                                    const error = errors.get(row.key);

                                    return (
                                        <RowShell
                                            key={row.key}
                                            testID={rowTestId}
                                            title={t('kitchen:plans.menuEntryNumber', {
                                                number: index + 1,
                                            })}
                                            position={index + 1}
                                            total={day.entries.length}
                                            canManage={canManage}
                                            badge={
                                                <Badge
                                                    testID={`${rowTestId}-badge`}
                                                    tone="neutral"
                                                    label={t(menuSlotKey(row.slot))}
                                                />
                                            }
                                            onRemove={() => {
                                                setRemoved({
                                                    row,
                                                    index: draft.entries.findIndex(
                                                        (entry) => entry.key === row.key,
                                                    ),
                                                });
                                                onChange(removeMenuEntry(draft, row.key));
                                            }}
                                        >
                                            <Stack space="sm">
                                                <Select
                                                    testID={`${rowTestId}-meal`}
                                                    id={`${rowTestId}-meal`}
                                                    label={t('kitchen:plans.menuMealLabel')}
                                                    hint={
                                                        mealsPending
                                                            ? t('kitchen:plans.menuMealsPending')
                                                            : t('kitchen:plans.menuMealHint')
                                                    }
                                                    searchable
                                                    required
                                                    disabled={!canManage}
                                                    options={optionsFor(row)}
                                                    value={
                                                        row.mealId === null
                                                            ? null
                                                            : String(row.mealId)
                                                    }
                                                    onChange={(next) => {
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
                                                />

                                                <Inline space="sm" wrap>
                                                    <Select<PlanMenuSlot>
                                                        testID={`${rowTestId}-slot`}
                                                        id={`${rowTestId}-slot`}
                                                        label={t('kitchen:plans.menuSlotLabel')}
                                                        disabled={!canManage}
                                                        options={slotOptions}
                                                        value={row.slot}
                                                        onChange={(next) => {
                                                            onChange(
                                                                patchMenuEntry(draft, row.key, {
                                                                    slot: next,
                                                                }),
                                                            );
                                                        }}
                                                    />
                                                    <NumberStepper
                                                        testID={`${rowTestId}-sequence`}
                                                        id={`${rowTestId}-sequence`}
                                                        label={t(
                                                            'kitchen:plans.menuSequenceLabel',
                                                        )}
                                                        hint={t('kitchen:plans.menuSequenceHint')}
                                                        min={1}
                                                        max={MENU_SEQUENCE_MAX}
                                                        required
                                                        disabled={!canManage}
                                                        value={row.sequence}
                                                        onChange={(next) => {
                                                            onChange(
                                                                patchMenuEntry(draft, row.key, {
                                                                    sequence: next,
                                                                }),
                                                            );
                                                        }}
                                                    />
                                                </Inline>

                                                {error === undefined ? null : (
                                                    <Text
                                                        testID={`${rowTestId}-error`}
                                                        role="alert"
                                                        tone="danger"
                                                        variant="caption"
                                                    >
                                                        {error}
                                                    </Text>
                                                )}
                                            </Stack>
                                        </RowShell>
                                    );
                                })
                            )}

                            {canManage ? (
                                <Inline space="sm" wrap>
                                    <Button
                                        testID={`${dayTestId}-add`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:plans.menuAddDish')}
                                        onPress={() => {
                                            const coordinate = nextCoordinate(draft, day.cycleDay);
                                            onChange(
                                                addMenuEntry(
                                                    draft,
                                                    emptyMenuEntry(
                                                        nextKey(),
                                                        day.cycleDay,
                                                        coordinate,
                                                    ),
                                                ),
                                            );
                                            setAnnouncement(
                                                t('kitchen:plans.menuAddedAnnouncement', {
                                                    day: day.cycleDay,
                                                    slot: t(menuSlotKey(coordinate.slot)),
                                                }),
                                            );
                                        }}
                                    />
                                </Inline>
                            ) : null}
                        </Stack>
                    );
                })
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
        </Stack>
    );
}
