import type { ServiceArea } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Checkbox,
    cx,
    fieldWidth,
    Icon,
    Inline,
    PickerField,
    Select,
    Stack,
    Tag,
    Text,
    TextInputField,
    useBreakpoint,
} from '@healthy360/design-system';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { weekdayKey } from '../marketplace/format.ts';
import { BilingualField } from './bilingual-field.tsx';
import { areaMatches, groupServiceAreas, normaliseWeekdays, toggleArea } from './delivery-model.ts';
import type { DeliveryWindowDraft, OperatingDayDraft } from './delivery-model.ts';
import { ISO_WEEKDAYS, displayName } from './format.ts';
import { TRADING_TRACKS, TradingDayRow } from './commercial/trading-day-row.tsx';
import { RowAnnouncer, UndoBar } from './row-editor-shell.tsx';

/**
 * The three repeated editors of the delivery slice (K1.7).
 *
 * They share a module because they share one problem: each of them edits a *rule about time or
 * place* that has no design-system control behind it, and each therefore has to compose one out of
 * the primitives without inventing a widget.
 *
 * ## There is no time field in the design system, and this slice does not add one
 *
 * `@healthy360/design-system` exports `DateField` (platform-split, web and native halves) and no
 * time equivalent. Adding one is a design-system change with its own platform split, its own
 * keyboard model and its own accessibility surface — not something a feature slice should land as a
 * side effect. So every time here is a constrained text field: `inputMode="numeric"`, a stated
 * `HH:mm` format in the hint, `parseClockTime` as the only accepted spelling, and a per-row error
 * that names the field rather than the row. That is the same shape the meal availability editor's
 * order cut-off already uses (`./catalogue-row-editors.tsx`), so the workspace has one way of
 * typing a time rather than two. **The gap is recorded, not papered over**: a real `TimeField`
 * belongs in the design system, and when it lands these three call sites change and nothing else
 * does.
 *
 * ## Weekday toggles are in ISO order and are not mirrored by hand
 *
 * Monday is 1 in every language. The toggles are laid out in a flex row, whose direction follows the
 * document, so Arabic renders Monday on the right *automatically* — and nothing here reverses the
 * array, because reversing it would produce a left-to-right week inside a right-to-left interface
 * exactly once, on the day somebody "fixed" the order.
 */

/**
 * The window table's fixed tracks (Commercial §3.4): name takes the rest. The times are 116 rather
 * than the design's 108 so they match the trading week's time tracks and hold a 12-hour value.
 * Exported so the header row lines up with every window beneath it.
 */
export const WINDOW_TRACKS = {
    days: 260,
    starts: 116,
    ends: 116,
    capacity: 104,
    offered: 112,
    remove: 28,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Delivery windows
 * ---------------------------------------------------------------------------------------------- */

export interface DeliveryWindowRowsProps {
    readonly rows: readonly DeliveryWindowDraft[];
    readonly onChange: (rows: readonly DeliveryWindowDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly onAdd: () => void;
    /** Drawn beside "Add a window" — the section's save, which the screen owns. */
    readonly saveAction?: ReactNode | undefined;
    readonly testID: string;
}

type Offered = 'yes' | 'no';

/**
 * The delivery windows of one zone, as one ruled table.
 *
 * No move controls, unlike the recipe-line and pack editors. A window's array position carries no
 * meaning anywhere — the consumer `DeliveryZone` has no window list at all, so nothing downstream
 * reads the order — and a permanently pointless Move up button is furniture.
 *
 * One window spans several weekdays rather than one row per day, because that is what the contract
 * models and what a person maintains: "Morning, 08:00–11:00, Monday to Friday" is one rule, and five
 * rows of it is five chances for an inconsistent Wednesday.
 *
 * Each row carries at most one note under it, in order of what a person must act on first: the
 * row's error, then "not offered", then "uncapped" — empty capacity is a sentence, never `0`.
 */
export function DeliveryWindowRows({
    rows,
    onChange,
    errors,
    canManage,
    onAdd,
    saveAction,
    testID,
}: DeliveryWindowRowsProps) {
    const { t } = useTranslation();
    const [removed, setRemoved] = useState<{
        readonly row: DeliveryWindowDraft;
        readonly index: number;
    } | null>(null);

    const patch = (index: number, next: Partial<DeliveryWindowDraft>) => {
        onChange(rows.map((row, position) => (position === index ? { ...row, ...next } : row)));
    };

    /*
     * Every header at the start of its column, over the start of the field under it. Capacity used
     * to sit at the end, over the empty half of its box and away from the number it names. Sentence
     * case, as the catalogue writes it — an all-caps header row shouted over the fields it names.
     */
    const head = (label: string, width?: number) => (
        <View {...(width === undefined ? { className: 'min-w-0 flex-1' } : { style: { width } })}>
            <Text variant="micro" tone="secondary">
                {label}
            </Text>
        </View>
    );

    return (
        <Stack space="sm" testID={testID}>
            <View className="z-auto flex-col">
                <View className="h-6 flex-row items-center gap-3 border-b border-stroke px-tight">
                    {head(t('kitchen:windows.labelField'))}
                    {head(t('kitchen:windows.weekdaysLabel'), WINDOW_TRACKS.days)}
                    {head(t('kitchen:windows.startsLabel'), WINDOW_TRACKS.starts)}
                    {head(t('kitchen:windows.endsLabel'), WINDOW_TRACKS.ends)}
                    {head(t('kitchen:windows.capacityColumn'), WINDOW_TRACKS.capacity)}
                    {head(t('kitchen:windows.offeredColumn'), WINDOW_TRACKS.offered)}
                    <View style={{ width: WINDOW_TRACKS.remove }} />
                </View>

                {rows.length === 0 ? (
                    <View className="border-b border-stroke-subtle px-tight py-2">
                        <Text testID={`${testID}-empty`} tone="secondary" variant="caption">
                            {t('kitchen:windows.none')}
                        </Text>
                    </View>
                ) : null}

                {rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const error = errors.get(row.key);
                    const weekdays = normaliseWeekdays(row.weekdays);
                    const rowName = t('kitchen:windows.rowTitle', { position: index + 1 });

                    return (
                        <View
                            key={row.key}
                            testID={rowTestId}
                            className="z-auto flex-col gap-hair border-b border-stroke-subtle px-tight py-tight"
                        >
                            <View className="z-auto flex-row items-center gap-3">
                                <View className="z-auto min-w-0 flex-1">
                                    <BilingualField
                                        testID={`${rowTestId}-label`}
                                        fieldLabel={`${rowName} — ${t('kitchen:windows.labelField')}`}
                                        value={row.label}
                                        requiredEnglish
                                        labelHidden
                                        layout="fill"
                                        // What a window is called, by example: the name a customer
                                        // picks a delivery slot by — "Morning", not "Window 1".
                                        placeholder={{
                                            en: t('kitchen:windows.labelPlaceholderEn'),
                                            ar: t('kitchen:windows.labelPlaceholderAr'),
                                        }}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch(index, { label: next });
                                        }}
                                    />
                                </View>

                                <View
                                    style={{ width: WINDOW_TRACKS.days }}
                                    className="flex-row gap-hair"
                                    role="group"
                                    aria-label={`${rowName} — ${t('kitchen:windows.weekdaysLabel')}`}
                                    testID={`${rowTestId}-weekdays`}
                                >
                                    {ISO_WEEKDAYS.map((weekday) => (
                                        <DayToggle
                                            key={weekday}
                                            testID={`${rowTestId}-weekday-${String(weekday)}`}
                                            initial={t(
                                                `kitchen:windows.dayInitial.${String(weekday)}`,
                                            )}
                                            name={t(weekdayKey(weekday))}
                                            selected={weekdays.includes(weekday)}
                                            disabled={!canManage}
                                            onChange={(selected) => {
                                                patch(index, {
                                                    weekdays: selected
                                                        ? normaliseWeekdays([
                                                              ...row.weekdays,
                                                              weekday,
                                                          ])
                                                        : row.weekdays.filter(
                                                              (entry) => entry !== weekday,
                                                          ),
                                                });
                                            }}
                                        />
                                    ))}
                                </View>

                                <View style={{ width: WINDOW_TRACKS.starts }}>
                                    <PickerField
                                        kind="time"
                                        testID={`${rowTestId}-starts`}
                                        label={`${rowName} — ${t('kitchen:windows.startsLabel')}`}
                                        labelHidden
                                        value={row.startsAt}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch(index, { startsAt: next });
                                        }}
                                    />
                                </View>
                                <View style={{ width: WINDOW_TRACKS.ends }}>
                                    <PickerField
                                        kind="time"
                                        testID={`${rowTestId}-ends`}
                                        label={`${rowName} — ${t('kitchen:windows.endsLabel')}`}
                                        labelHidden
                                        value={row.endsAt}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch(index, { endsAt: next });
                                        }}
                                    />
                                </View>
                                <View style={{ width: WINDOW_TRACKS.capacity }}>
                                    <TextInputField
                                        testID={`${rowTestId}-capacity`}
                                        id={`${rowTestId}-capacity`}
                                        label={`${rowName} — ${t('kitchen:windows.capacityLabel')}`}
                                        labelHidden
                                        size="sm"
                                        placeholder={t('kitchen:windows.capacityPlaceholder')}
                                        value={row.capacity}
                                        inputMode="numeric"
                                        autoCorrect={false}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch(index, { capacity: next });
                                        }}
                                    />
                                </View>
                                <View style={{ width: WINDOW_TRACKS.offered }} className="z-auto">
                                    <Select<Offered>
                                        testID={`${rowTestId}-active`}
                                        id={`${rowTestId}-active`}
                                        label={`${rowName} — ${t('kitchen:windows.activeLabel')}`}
                                        labelHidden
                                        disabled={!canManage}
                                        value={row.isActive ? 'yes' : 'no'}
                                        options={[
                                            {
                                                value: 'yes',
                                                label: t('kitchen:windows.offeredYes'),
                                            },
                                            {
                                                value: 'no',
                                                label: t('kitchen:windows.inactiveBadge'),
                                            },
                                        ]}
                                        onChange={(next) => {
                                            patch(index, { isActive: next === 'yes' });
                                        }}
                                    />
                                </View>
                                <View
                                    style={{ width: WINDOW_TRACKS.remove }}
                                    className="items-center"
                                >
                                    {canManage ? (
                                        <Pressable
                                            testID={`${rowTestId}-remove`}
                                            role="button"
                                            accessibilityRole="button"
                                            accessibilityLabel={`${t('kitchen:rows.remove')} — ${rowName}`}
                                            aria-label={`${t('kitchen:rows.remove')} — ${rowName}`}
                                            onPress={() => {
                                                setRemoved({ row, index });
                                                onChange(
                                                    rows.filter(
                                                        (_, position) => position !== index,
                                                    ),
                                                );
                                            }}
                                            className="h-6 w-6 items-center justify-center rounded-sm border border-stroke bg-surface-raised hover:bg-surface-sunken"
                                        >
                                            <Icon
                                                name="close"
                                                size="sm"
                                                className="text-content-secondary"
                                            />
                                        </Pressable>
                                    ) : null}
                                </View>
                            </View>

                            {error !== undefined ? (
                                <Text testID={`${rowTestId}-error`} tone="danger" variant="caption">
                                    {error}
                                </Text>
                            ) : !row.isActive ? (
                                <Text
                                    testID={`${rowTestId}-active-state`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('kitchen:windows.activeHint')}
                                </Text>
                            ) : row.capacity.trim() === '' ? (
                                <Text
                                    testID={`${rowTestId}-capacity-state`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('kitchen:windows.capacityUncapped')}
                                </Text>
                            ) : null}
                        </View>
                    );
                })}
            </View>

            <Inline space="sm" wrap align="center">
                {canManage ? (
                    <Button
                        testID={`${testID}-add`}
                        size="sm"
                        variant="secondary"
                        iconStart={<Icon name="plus" />}
                        label={t('kitchen:windows.add')}
                        onPress={onAdd}
                    />
                ) : null}
                {saveAction}
                {removed === null || !canManage ? null : (
                    <UndoBar
                        testID={`${testID}-removed-bar`}
                        label={t('kitchen:windows.removed')}
                        onUndo={() => {
                            const next = [...rows];
                            next.splice(Math.min(removed.index, next.length), 0, removed.row);
                            onChange(next);
                            setRemoved(null);
                        }}
                    />
                )}
            </Inline>
        </Stack>
    );
}

/**
 * One weekday of a window: the design's 34px lettered square. The letter is what is drawn; the
 * whole day name is what is announced, because "T" is two days.
 */
export function DayToggle({
    initial,
    name,
    selected,
    disabled,
    onChange,
    testID,
}: {
    readonly initial: string;
    readonly name: string;
    readonly selected: boolean;
    readonly disabled: boolean;
    readonly onChange: (selected: boolean) => void;
    readonly testID: string;
}) {
    return (
        <Pressable
            testID={testID}
            role="checkbox"
            accessibilityRole="checkbox"
            accessibilityLabel={name}
            aria-label={name}
            aria-checked={selected}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
                onChange(!selected);
            }}
            className={cx(
                'h-control-sm flex-1 items-center justify-center rounded-sm border',
                selected
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke bg-surface-raised hover:bg-surface-sunken',
                disabled ? 'opacity-50' : null,
            )}
        >
            <Text
                variant="caption"
                className={selected ? 'text-content-on-brand-subtle' : 'text-content-secondary'}
            >
                {initial}
            </Text>
        </Pressable>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Branch operating week
 * ---------------------------------------------------------------------------------------------- */

export interface OperatingWeekRowsProps {
    readonly rows: readonly OperatingDayDraft[];
    readonly onChange: (rows: readonly OperatingDayDraft[]) => void;
    readonly errors: ReadonlyMap<number, string>;
    readonly canManage: boolean;
    /** Copies this day's three times onto every other open day. */
    readonly onCopyToOpenDays: (weekday: number) => void;
    readonly announcement: string;
    readonly testID: string;
}

/**
 * A branch's trading week: seven rows, always, one per ISO weekday.
 *
 * ## Closed removes the fields; it does not disable them
 *
 * The same rule the price editor's amount follows, and for a sharper reason here. A closed day is
 * three nulls on the wire, so a disabled field still holding `08:00` would show a time that is not
 * being saved — and an order cut-off is the last rule in this application that should be readable
 * one way and stored another. Closing therefore clears and hides; re-opening starts empty.
 *
 * ## Copy-to-every-open-day, not copy-to-all
 *
 * Most branches trade the same hours six days a week and shut on the seventh, so typing the same
 * three times seven times is the common case worth removing. The control copies onto the days that
 * are already **open** and leaves closed days shut, because opening a day nobody said was open would
 * be the editor inventing trading hours — and it announces what it did, since a copy that changes
 * six rows below the fold is invisible to somebody who cannot see them change.
 */
export function OperatingWeekRows({
    rows,
    onChange,
    errors,
    canManage,
    onCopyToOpenDays,
    announcement,
    testID,
}: OperatingWeekRowsProps) {
    const { t } = useTranslation();
    const head = (label: string, width?: number) =>
        width === undefined ? (
            <View className="min-w-0 flex-1">
                <Text variant="micro" tone="secondary">
                    {label}
                </Text>
            </View>
        ) : (
            <View style={{ width }}>
                <Text variant="micro" tone="secondary">
                    {label}
                </Text>
            </View>
        );

    return (
        <Stack space="none" testID={testID}>
            {/* The column labels, on the same tracks as every day below them. */}
            <View className="h-6 flex-row items-center gap-3.5 border-b border-stroke px-tight">
                {head(t('kitchen:branchHours.columnDay'), TRADING_TRACKS.day)}
                {head(t('kitchen:branchHours.columnTrading'), TRADING_TRACKS.trading)}
                {head(t('kitchen:branchHours.opensLabel'), TRADING_TRACKS.opens)}
                {head(t('kitchen:branchHours.closesLabel'), TRADING_TRACKS.closes)}
                {head(t('kitchen:branchHours.cutOffLabel'), TRADING_TRACKS.cutOff)}
                {head(t('kitchen:branchHours.columnSays'))}
            </View>
            {rows.map((row) => (
                <TradingDayRow
                    key={row.weekday}
                    testID={`${testID}-day-${String(row.weekday)}`}
                    day={row}
                    canManage={canManage}
                    error={errors.get(row.weekday)}
                    onChange={(next) => {
                        onChange(
                            rows.map((candidate) =>
                                candidate.weekday === row.weekday ? next : candidate,
                            ),
                        );
                    }}
                    onCopyToOpenDays={() => {
                        onCopyToOpenDays(row.weekday);
                    }}
                />
            ))}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Service-area picker
 * ---------------------------------------------------------------------------------------------- */

/**
 * How many unselected options are drawn at once.
 *
 * The production gazetteer is around 125 rows and the contract's page limit is 100, so "draw them
 * all" is neither possible in one request nor useful in one column. Everything already selected is
 * always drawn — a chip that could not be found again would be a chip nobody can remove — and the
 * rest is capped with a stated count and a search box, which is how somebody finds Jumeirah without
 * reading Ras Al Khor.
 *
 * The cap is 100 — the contract's own page limit — rather than the 40 it was while the options ran
 * down a single column: at three and four columns a hundred short place names is a dozen lines, and
 * the cap existed to stop a page of scrolling rather than to stop rendering.
 */
const VISIBLE_AREA_LIMIT = 100;

export interface ServiceAreaPickerProps {
    /** The gazetteer as loaded. Platform reference data; this screen never writes it. */
    readonly gazetteer: readonly ServiceArea[];
    readonly selected: readonly ServiceAreaId[];
    readonly onChange: (selected: readonly ServiceAreaId[]) => void;
    readonly canManage: boolean;
    readonly locale: string;
    /** True when more rows exist on the server than were loaded — see `useServiceAreasQuery`. */
    readonly truncated: boolean;
    readonly testID: string;
}

/**
 * The zone's areas, chosen from the platform gazetteer.
 *
 * ## Why this is a search box plus a checkbox group, and not a combobox
 *
 * Exactly the argument `Select` makes for itself in the design system, one size larger. An ARIA
 * combobox owning a multi-selectable listbox is the hardest widget in the specification to get
 * right, axe reports every slip as serious, and none of it maps onto React Native. Two independently
 * valid widgets — a labelled text field that filters, and a group of labelled checkboxes — say the
 * same thing, work identically on both platforms, and are what a screen reader already knows.
 *
 * The count under the search box is a polite live region because filtering silently shortens the
 * list: somebody who cannot see it shrink has to be told that it did. The selected areas are drawn
 * *above* the search as removable chips so that the answer to "what have I chosen?" never depends on
 * scrolling past the question.
 */
export function ServiceAreaPicker({
    gazetteer,
    selected,
    onChange,
    canManage,
    locale,
    truncated,
    testID,
}: ServiceAreaPickerProps) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const [query, setQuery] = useState('');

    /*
     * The gazetteer runs to ~125 rows, and one row per line means a page of scrolling to read a
     * list of short place names. The options therefore flow into as many columns as the viewport
     * holds — six on a desk screen — as a percentage rather than a fixed track, so the last column
     * ends where the rule does.
     */
    const columns = atLeast('xl') ? 6 : atLeast('lg') ? 4 : atLeast('md') ? 2 : 1;
    const columnWidth: `${number}%` = `${100 / columns}%`;

    const selectedSet = useMemo(() => new Set(selected.map(String)), [selected]);
    const byId = useMemo(
        () => new Map(gazetteer.map((area) => [String(area.id), area])),
        [gazetteer],
    );

    const matched = useMemo(
        () => gazetteer.filter((area) => areaMatches(area, query)),
        [gazetteer, query],
    );

    /*
     * Selected rows first and uncapped, then as much of the rest as the cap allows. Without the
     * first half, deselecting an area that has fallen past the cap would be impossible from the
     * list — the chips above are the other way out, and two ways is the right number here.
     */
    const visible = useMemo(() => {
        const chosen = matched.filter((area) => selectedSet.has(String(area.id)));
        const rest = matched
            .filter((area) => !selectedSet.has(String(area.id)))
            .slice(0, VISIBLE_AREA_LIMIT);
        const keep = new Set([...chosen, ...rest].map((area) => String(area.id)));
        return matched.filter((area) => keep.has(String(area.id)));
    }, [matched, selectedSet]);

    const groups = useMemo(() => groupServiceAreas(visible), [visible]);
    const hidden = matched.length - visible.length;

    /*
     * Commercial §3.4 draws this as a desk list rather than a form: small removable chips, a
     * 280px search, then the gazetteer as ruled rows under sunken governorate bands.
     */
    return (
        <Stack space="md" testID={testID}>
            <Stack space="xs">
                <Text
                    variant="micro"
                    tone="secondary"
                    className="uppercase"
                    testID={`${testID}-selected-label`}
                >
                    {t('kitchen:areas.selectedLabel')}
                </Text>
                {selected.length === 0 ? (
                    <Text testID={`${testID}-selected-none`} tone="secondary" variant="caption">
                        {t('kitchen:areas.selectedNone')}
                    </Text>
                ) : (
                    <Inline space="xs" wrap testID={`${testID}-selected`}>
                        {selected.map((areaId) => {
                            const area = byId.get(String(areaId));
                            const label =
                                area === undefined
                                    ? t('kitchen:areas.unknownArea')
                                    : displayName(area.name, locale).value;
                            return (
                                <AreaChip
                                    key={String(areaId)}
                                    testID={`${testID}-chip-${String(areaId)}`}
                                    label={label}
                                    removeLabel={t('designSystem:chip.remove', { label })}
                                    {...(canManage
                                        ? {
                                              onRemove: () => {
                                                  onChange(
                                                      toggleArea(
                                                          selected,
                                                          areaId,
                                                          false,
                                                          gazetteer,
                                                      ),
                                                  );
                                              },
                                          }
                                        : {})}
                                />
                            );
                        })}
                    </Inline>
                )}
            </Stack>

            <Inline space="sm" align="center" wrap>
                <View style={{ width: fieldWidth }}>
                    <TextInputField
                        testID={`${testID}-search`}
                        id={`${testID}-search`}
                        label={t('kitchen:areas.searchLabel')}
                        labelHidden
                        size="sm"
                        placeholder={t('kitchen:areas.searchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        inputMode="search"
                        returnKeyType="search"
                        trailing={<Icon name="search" />}
                    />
                </View>
                {/* A polite live region: filtering silently shortens the list below. */}
                <Text
                    testID={`${testID}-count`}
                    role="status"
                    aria-live="polite"
                    variant="caption"
                    tone="secondary"
                >
                    {t('kitchen:areas.matchCount', {
                        count: matched.length,
                        total: gazetteer.length,
                    })}
                </Text>
            </Inline>

            {truncated ? (
                <Callout
                    testID={`${testID}-truncated`}
                    role="note"
                    tone="info"
                    title={t('kitchen:areas.truncatedTitle')}
                    body={t('kitchen:areas.truncatedBody')}
                />
            ) : null}

            {matched.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:areas.noMatches')}
                </Text>
            ) : (
                <View
                    role="group"
                    aria-label={t('kitchen:areas.groupLabel')}
                    className="flex-col border-t border-stroke"
                >
                    {groups.map((group) => (
                        <View key={group.key} testID={`${testID}-group-${group.key}`}>
                            <View className="bg-surface-sunken px-tight pb-1 pt-tight">
                                <Text variant="micro" tone="secondary" className="uppercase">
                                    {group.parentName === null
                                        ? t('kitchen:areas.noParent')
                                        : displayName(group.parentName, locale).value}
                                </Text>
                            </View>
                            <View className="flex-row flex-wrap">
                                {group.areas.map((area) => {
                                    const name = displayName(area.name, locale);
                                    return (
                                        <View
                                            key={String(area.id)}
                                            style={{ width: columnWidth }}
                                            className="min-h-control-sm flex-row items-center gap-tight border-b border-stroke-subtle px-tight"
                                        >
                                            <Checkbox
                                                testID={`${testID}-option-${String(area.id)}`}
                                                id={`${testID}-option-${String(area.id)}`}
                                                className="min-w-0 flex-1"
                                                label={name.value}
                                                checked={selectedSet.has(String(area.id))}
                                                disabled={!canManage}
                                                onChange={(checked) => {
                                                    onChange(
                                                        toggleArea(
                                                            selected,
                                                            area.id,
                                                            checked,
                                                            gazetteer,
                                                        ),
                                                    );
                                                }}
                                            />
                                            {area.isActive ? null : (
                                                <Tag
                                                    testID={`${testID}-option-${String(area.id)}-inactive`}
                                                    label={t('kitchen:areas.inactiveTag')}
                                                />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    ))}
                </View>
            )}

            {hidden > 0 ? (
                <Text testID={`${testID}-more`} tone="secondary" variant="caption">
                    {t('kitchen:areas.moreHidden', { count: hidden })}
                </Text>
            ) : null}
        </Stack>
    );
}

/**
 * A chosen area: the design's 24px brand-subtle pill with its own remove control.
 *
 * Not the design-system `Chip`, which carries the customer surfaces' 44px touch floor — the kitchen
 * admin is a desk surface and sizes from `control.ts` (CLAUDE.md, touch targets).
 */
function AreaChip({
    label,
    removeLabel,
    onRemove,
    testID,
}: {
    readonly label: string;
    readonly removeLabel: string;
    readonly onRemove?: (() => void) | undefined;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            className="h-control-xs flex-row items-center gap-1 rounded-full bg-surface-brand-subtle pe-1 ps-2"
        >
            <Text variant="caption" className="text-content-on-brand-subtle">
                {label}
            </Text>
            {onRemove === undefined ? null : (
                <Pressable
                    testID={`${testID}-remove`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={removeLabel}
                    aria-label={removeLabel}
                    onPress={onRemove}
                    className="h-4 w-4 items-center justify-center rounded-full hover:bg-surface-raised"
                >
                    <Icon name="close" size="sm" className="text-content-on-brand-subtle" />
                </Pressable>
            )}
        </View>
    );
}
