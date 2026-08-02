import type { ServiceArea } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Chip,
    FilterChip,
    Icon,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { weekdayKey } from '../marketplace/format.ts';
import { BilingualField } from './bilingual-field.tsx';
import {
    areaMatches,
    groupServiceAreas,
    normaliseWeekdays,
    toggleArea,
    withDayClosed,
} from './delivery-model.ts';
import type { DeliveryWindowDraft, OperatingDayDraft } from './delivery-model.ts';
import { ISO_WEEKDAYS, displayName } from './format.ts';
import { RowAnnouncer, RowShell, UndoBar } from './row-editor-shell.tsx';

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
 * ## Weekday chips are in ISO order and are not mirrored by hand
 *
 * Monday is 1 in every language. The chips are laid out with `Inline`, whose direction follows the
 * document, so Arabic renders Monday on the right *automatically* — and nothing here reverses the
 * array, because reversing it would produce a left-to-right week inside a right-to-left interface
 * exactly once, on the day somebody "fixed" the order.
 */

/* ------------------------------------------------------------------------------------------------
 * Delivery windows
 * ---------------------------------------------------------------------------------------------- */

export interface DeliveryWindowRowsProps {
    readonly rows: readonly DeliveryWindowDraft[];
    readonly onChange: (rows: readonly DeliveryWindowDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly onAdd: () => void;
    readonly testID: string;
}

/**
 * The delivery windows of one zone.
 *
 * No move controls, unlike the recipe-line and pack editors. A window's array position carries no
 * meaning anywhere — the consumer `DeliveryZone` has no window list at all, so nothing downstream
 * reads the order — and a permanently pointless Move up button is furniture (see `RowShell`).
 *
 * One window spans several weekdays rather than one row per day, because that is what the contract
 * models and what a person maintains: "Morning, 08:00–11:00, Monday to Friday" is one rule, and five
 * rows of it is five chances for an inconsistent Wednesday.
 */
export function DeliveryWindowRows({
    rows,
    onChange,
    errors,
    canManage,
    onAdd,
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

    return (
        <Stack space="sm" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:windows.none')}
                </Text>
            ) : null}

            {rows.map((row, index) => {
                const rowTestId = `${testID}-row-${row.key}`;
                const error = errors.get(row.key);
                const weekdays = normaliseWeekdays(row.weekdays);

                return (
                    <RowShell
                        key={row.key}
                        testID={rowTestId}
                        title={t('kitchen:windows.rowTitle', { position: index + 1 })}
                        position={index + 1}
                        total={rows.length}
                        canManage={canManage}
                        badge={
                            row.isActive ? null : (
                                <Badge
                                    testID={`${rowTestId}-inactive`}
                                    tone="neutral"
                                    icon="eyeOff"
                                    label={t('kitchen:windows.inactiveBadge')}
                                />
                            )
                        }
                        onRemove={() => {
                            setRemoved({ row, index });
                            onChange(rows.filter((_, position) => position !== index));
                        }}
                    >
                        <Stack space="sm">
                            <BilingualField
                                testID={`${rowTestId}-label`}
                                fieldLabel={t('kitchen:windows.labelField')}
                                value={row.label}
                                requiredEnglish
                                onChange={(next) => {
                                    patch(index, { label: next });
                                }}
                            />

                            <Stack space="xs">
                                <Text variant="label" testID={`${rowTestId}-weekdays-label`}>
                                    {t('kitchen:windows.weekdaysLabel')}
                                </Text>
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:windows.weekdaysHint')}
                                </Text>
                                <Inline space="xs" wrap testID={`${rowTestId}-weekdays`}>
                                    {ISO_WEEKDAYS.map((weekday) => (
                                        <FilterChip
                                            key={weekday}
                                            testID={`${rowTestId}-weekday-${String(weekday)}`}
                                            label={t(weekdayKey(weekday))}
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
                                </Inline>
                            </Stack>

                            <Inline space="sm" wrap>
                                <Stack space="none" grow>
                                    <TextInputField
                                        testID={`${rowTestId}-starts`}
                                        id={`${rowTestId}-starts`}
                                        label={t('kitchen:windows.startsLabel')}
                                        hint={t('kitchen:time.formatHint')}
                                        placeholder={t('kitchen:time.placeholder')}
                                        value={row.startsAt}
                                        inputMode="numeric"
                                        autoCorrect={false}
                                        required
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch(index, { startsAt: next });
                                        }}
                                    />
                                </Stack>
                                <Stack space="none" grow>
                                    <TextInputField
                                        testID={`${rowTestId}-ends`}
                                        id={`${rowTestId}-ends`}
                                        label={t('kitchen:windows.endsLabel')}
                                        hint={t('kitchen:time.formatHint')}
                                        placeholder={t('kitchen:time.placeholder')}
                                        value={row.endsAt}
                                        inputMode="numeric"
                                        autoCorrect={false}
                                        required
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch(index, { endsAt: next });
                                        }}
                                    />
                                </Stack>
                            </Inline>

                            <TextInputField
                                testID={`${rowTestId}-capacity`}
                                id={`${rowTestId}-capacity`}
                                label={t('kitchen:windows.capacityLabel')}
                                hint={t('kitchen:windows.capacityHint')}
                                value={row.capacity}
                                inputMode="numeric"
                                autoCorrect={false}
                                disabled={!canManage}
                                onChangeText={(next) => {
                                    patch(index, { capacity: next });
                                }}
                            />

                            {row.capacity.trim() === '' ? (
                                <Text
                                    testID={`${rowTestId}-capacity-state`}
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {t('kitchen:windows.capacityUncapped')}
                                </Text>
                            ) : null}

                            <Checkbox
                                testID={`${rowTestId}-active`}
                                id={`${rowTestId}-active`}
                                label={t('kitchen:windows.activeLabel')}
                                description={t('kitchen:windows.activeHint')}
                                checked={row.isActive}
                                disabled={!canManage}
                                onChange={(checked) => {
                                    patch(index, { isActive: checked });
                                }}
                            />

                            {error === undefined ? null : (
                                <Text testID={`${rowTestId}-error`} tone="danger" variant="caption">
                                    {error}
                                </Text>
                            )}
                        </Stack>
                    </RowShell>
                );
            })}

            {canManage ? (
                <Inline space="sm" wrap align="center">
                    <Button
                        testID={`${testID}-add`}
                        size="sm"
                        variant="secondary"
                        iconStart={<Icon name="plus" />}
                        label={t('kitchen:windows.add')}
                        onPress={onAdd}
                    />
                    {removed === null ? null : (
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
            ) : null}
        </Stack>
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

    const patch = (weekday: number, next: Partial<OperatingDayDraft>) => {
        onChange(rows.map((row) => (row.weekday === weekday ? { ...row, ...next } : row)));
    };

    return (
        <Stack space="sm" testID={testID}>
            {rows.map((row) => {
                const rowTestId = `${testID}-day-${String(row.weekday)}`;
                const error = errors.get(row.weekday);

                return (
                    <Card key={row.weekday} testID={rowTestId} padding="sm">
                        <Stack space="sm">
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Inline space="sm" align="center" wrap>
                                    <Text variant="label" testID={`${rowTestId}-name`}>
                                        {t(weekdayKey(row.weekday))}
                                    </Text>
                                    {row.isClosed ? (
                                        <Badge
                                            testID={`${rowTestId}-closed-badge`}
                                            tone="neutral"
                                            icon="dot"
                                            label={t('kitchen:branchHours.closedBadge')}
                                        />
                                    ) : null}
                                </Inline>

                                <Checkbox
                                    testID={`${rowTestId}-closed`}
                                    id={`${rowTestId}-closed`}
                                    label={t('kitchen:branchHours.closedLabel')}
                                    checked={row.isClosed}
                                    disabled={!canManage}
                                    onChange={(checked) => {
                                        onChange(
                                            rows.map((candidate) =>
                                                candidate.weekday === row.weekday
                                                    ? withDayClosed(candidate, checked)
                                                    : candidate,
                                            ),
                                        );
                                    }}
                                />
                            </Inline>

                            {row.isClosed ? (
                                <Text
                                    testID={`${rowTestId}-closed-note`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('kitchen:branchHours.closedNote')}
                                </Text>
                            ) : (
                                <Stack space="sm">
                                    <Inline space="sm" wrap>
                                        <Stack space="none" grow>
                                            <TextInputField
                                                testID={`${rowTestId}-opens`}
                                                id={`${rowTestId}-opens`}
                                                label={t('kitchen:branchHours.opensLabel')}
                                                hint={t('kitchen:time.formatHint')}
                                                placeholder={t('kitchen:time.placeholder')}
                                                value={row.opensAt}
                                                inputMode="numeric"
                                                autoCorrect={false}
                                                required
                                                disabled={!canManage}
                                                onChangeText={(next) => {
                                                    patch(row.weekday, { opensAt: next });
                                                }}
                                            />
                                        </Stack>
                                        <Stack space="none" grow>
                                            <TextInputField
                                                testID={`${rowTestId}-closes`}
                                                id={`${rowTestId}-closes`}
                                                label={t('kitchen:branchHours.closesLabel')}
                                                hint={t('kitchen:time.formatHint')}
                                                placeholder={t('kitchen:time.placeholder')}
                                                value={row.closesAt}
                                                inputMode="numeric"
                                                autoCorrect={false}
                                                required
                                                disabled={!canManage}
                                                onChangeText={(next) => {
                                                    patch(row.weekday, { closesAt: next });
                                                }}
                                            />
                                        </Stack>
                                    </Inline>

                                    <TextInputField
                                        testID={`${rowTestId}-cut-off`}
                                        id={`${rowTestId}-cut-off`}
                                        label={t('kitchen:branchHours.cutOffLabel')}
                                        hint={t('kitchen:branchHours.cutOffHint')}
                                        placeholder={t('kitchen:time.placeholder')}
                                        value={row.orderCutOffAt}
                                        inputMode="numeric"
                                        autoCorrect={false}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch(row.weekday, { orderCutOffAt: next });
                                        }}
                                    />

                                    {row.orderCutOffAt.trim() === '' ? (
                                        <Text
                                            testID={`${rowTestId}-cut-off-state`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t('kitchen:branchHours.cutOffNone')}
                                        </Text>
                                    ) : null}

                                    {canManage ? (
                                        <Inline space="sm" wrap>
                                            <Button
                                                testID={`${rowTestId}-copy`}
                                                size="sm"
                                                variant="ghost"
                                                label={t('kitchen:branchHours.copyToOpenDays')}
                                                onPress={() => {
                                                    onCopyToOpenDays(row.weekday);
                                                }}
                                            />
                                        </Inline>
                                    ) : null}
                                </Stack>
                            )}

                            {error === undefined ? null : (
                                <Text testID={`${rowTestId}-error`} tone="danger" variant="caption">
                                    {error}
                                </Text>
                            )}
                        </Stack>
                    </Card>
                );
            })}

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
 */
const VISIBLE_AREA_LIMIT = 40;

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
    const [query, setQuery] = useState('');

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

    return (
        <Stack space="sm" testID={testID}>
            <Stack space="xs">
                <Text variant="label" testID={`${testID}-selected-label`}>
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
                                <Chip
                                    key={String(areaId)}
                                    testID={`${testID}-chip-${String(areaId)}`}
                                    label={label}
                                    tone="brand"
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

            <TextInputField
                testID={`${testID}-search`}
                id={`${testID}-search`}
                label={t('kitchen:areas.searchLabel')}
                hint={t('kitchen:areas.searchHint')}
                placeholder={t('kitchen:areas.searchPlaceholder')}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="search"
                returnKeyType="search"
                trailing={<Icon name="search" />}
            />

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
                <Stack space="sm" role="group" aria-label={t('kitchen:areas.groupLabel')}>
                    {groups.map((group) => (
                        <Stack key={group.key} space="xs" testID={`${testID}-group-${group.key}`}>
                            <Text variant="label" tone="secondary">
                                {group.parentName === null
                                    ? t('kitchen:areas.noParent')
                                    : displayName(group.parentName, locale).value}
                            </Text>
                            {group.areas.map((area) => {
                                const name = displayName(area.name, locale);
                                return (
                                    <Checkbox
                                        key={String(area.id)}
                                        testID={`${testID}-option-${String(area.id)}`}
                                        id={`${testID}-option-${String(area.id)}`}
                                        label={name.value}
                                        {...(area.isActive
                                            ? {}
                                            : { description: t('kitchen:areas.inactive') })}
                                        checked={selectedSet.has(String(area.id))}
                                        disabled={!canManage}
                                        onChange={(checked) => {
                                            onChange(
                                                toggleArea(selected, area.id, checked, gazetteer),
                                            );
                                        }}
                                    />
                                );
                            })}
                        </Stack>
                    ))}
                </Stack>
            )}

            {hidden > 0 ? (
                <Text testID={`${testID}-more`} tone="secondary" variant="caption">
                    {t('kitchen:areas.moreHidden', { count: hidden })}
                </Text>
            ) : null}
        </Stack>
    );
}
