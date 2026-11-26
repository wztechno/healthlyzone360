import { PLAN_DURATION_KINDS } from '@healthy360/api-client/contracts';
import type { PlanDurationKind } from '@healthy360/api-client/contracts';
import {
    DataTable,
    RowMenu,
    Select,
    Switch,
    Text,
    TextInputField,
    UndoBar,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { durationKindKey } from './format.ts';
import { withDurationKind } from './plan-matrix.ts';
import type { DurationDraft, DurationError, VariantDraft } from './plan-matrix.ts';

/**
 * The plan editor's two repeated-row editors (K1.6): configurations and durations.
 *
 * Its own module rather than a section of `./catalogue-row-editors.tsx`, for the same reason
 * `./price-row-editors.tsx` is its own: these rows enforce contract rules *while they are being
 * typed* — a duration's `CHECK`, a discount that must stay undecided rather than become zero — and
 * that logic wants to be readable next to the control it governs.
 *
 * Both are tables (Commercial canvas, 2026-11-15): one line per row, every field on that line, the
 * row's Remove behind its `⋯`, and what is wrong with a row said on a line *under* the row
 * (`DataList`'s `rowNote`) — never under one field, where it would make that cell taller and move
 * the row's other fields out of line with it.
 *
 * ## Configurations are entered here, and the matrix only reads them
 *
 * A configuration's meals, snacks and energy band *are* its cell. So the Configurations tab is where
 * a plan is built, and the Matrix tab (`./commercial/plan-matrix-grid.tsx`) draws what these rows say
 * without offering a control of its own — one place to write a fact, one place to read it back.
 *
 * ## Every numeric field keeps `null`
 *
 * `CountField` hands back `number | null`, where `null` means "not answered yet — distinct from
 * zero, which is an answer". That distinction is the whole of `plan_variant_durations.discount`:
 * a `null` discount is a commercial decision nobody has taken, and `0` is the decision that a week
 * earns nothing.
 */

/* ------------------------------------------------------------------------------------------------
 * Variant detail rows
 * ---------------------------------------------------------------------------------------------- */

export interface PlanVariantRowsProps {
    readonly rows: readonly VariantDraft[];
    readonly onChange: (rows: readonly VariantDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    /**
     * Never offers to remove the only row. A new plan opens on one configuration and one duration
     * and is not written without them, so taking the last one away would only put back an empty
     * section and a required field with nothing to type into.
     */
    readonly keepOne?: boolean | undefined;
    readonly testID: string;
}

/**
 * Every configuration in full (Commercial §3.3 Configurations tab, as a table since 2026-11-15).
 *
 * ```
 * CONFIGURATION NAME     MEALS A DAY   SNACKS A DAY   ENERGY FROM – TO          OFFER          ⋯
 * [Standard          ]   [ 3 ]         [ 1 ]          [ 1700 ] – [ 1900 ] kcal  (●) Active     ⋯
 * [Large             ]   [ 3 ]         [ 2 ]          [ 2400 ] – [      ] kcal  (●) Active     ⋯
 *   Give both ends of the energy band.                                      <- the row's note
 * ```
 *
 * Meals, snacks and the band are the configuration's **coordinates**: they are the cell of the
 * matrix it sits in. The band is one field of two halves — a range, not two facts — so its unit is
 * said once, after it. `Offer` is a switch that names its state (Active / Inactive), because the
 * two are named states and neither is a deletion.
 *
 * The name is the design's one field. It writes the English name and leaves the Arabic one as it
 * was, so a configuration imported with both keeps both.
 */
export function PlanVariantRows({
    rows,
    onChange,
    errors,
    canManage,
    keepOne = false,
    testID,
}: PlanVariantRowsProps) {
    const { t } = useTranslation();
    const [removed, setRemoved] = useState<{ row: VariantDraft; index: number } | null>(null);

    const nameOf = (row: VariantDraft): string =>
        row.name.en.trim() === '' ? t('kitchen:plans.unnamedVariant') : row.name.en;

    const patchRow = (key: string, next: Partial<VariantDraft>) => {
        onChange(rows.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)));
    };

    const removable = canManage && !(keepOne && rows.length === 1);
    const rowId = (row: VariantDraft) => `${testID}-row-${row.key}`;

    const columns: readonly DataListColumn<VariantDraft>[] = [
        {
            key: 'name',
            label: t('kitchen:plans.variantNameLabel'),
            width: NAME_TRACK,
            priority: 100,
            fill: true,
            render: (row) => (
                <View className="w-full py-tight">
                    <TextInputField
                        testID={`${rowId(row)}-name`}
                        id={`${rowId(row)}-name`}
                        label={t('kitchen:plans.variantNameLabel')}
                        labelHidden
                        placeholder={t('kitchen:plans.variantNamePlaceholder')}
                        size="sm"
                        required
                        disabled={!canManage}
                        value={row.name.en}
                        onChangeText={(next) => {
                            patchRow(row.key, { name: { ...row.name, en: next } });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'meals',
            label: t('kitchen:plans.mealsPerDayLabel'),
            width: COUNT_TRACK,
            priority: 99,
            grow: false,
            render: (row) => (
                <View className="w-full py-tight">
                    <CountField
                        testID={`${rowId(row)}-meals`}
                        label={t('kitchen:plans.mealsPerDayLabel')}
                        labelHidden
                        placeholder={t('kitchen:plans.mealsPerDayPlaceholder')}
                        value={row.mealsPerDay}
                        disabled={!canManage}
                        onChange={(next) => {
                            patchRow(row.key, { mealsPerDay: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'snacks',
            label: t('kitchen:plans.snacksPerDayLabel'),
            width: COUNT_TRACK,
            priority: 98,
            grow: false,
            render: (row) => (
                <View className="w-full py-tight">
                    <CountField
                        testID={`${rowId(row)}-snacks`}
                        label={t('kitchen:plans.snacksPerDayLabel')}
                        labelHidden
                        placeholder={t('kitchen:plans.snacksPerDayPlaceholder')}
                        value={row.snacksPerDay}
                        disabled={!canManage}
                        onChange={(next) => {
                            patchRow(row.key, { snacksPerDay: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'energy',
            label: t('kitchen:plans.energyBandHeader'),
            width: BAND_TRACK,
            priority: 97,
            grow: false,
            render: (row) => (
                <View className="w-full flex-row items-center gap-tight py-tight">
                    <View style={{ width: BAND_BOX }}>
                        <CountField
                            testID={`${rowId(row)}-energy-min`}
                            label={t('kitchen:plans.energyMinLabel')}
                            labelHidden
                            placeholder={t('kitchen:plans.energyMinPlaceholder')}
                            value={row.energyMin}
                            disabled={!canManage}
                            onChange={(next) => {
                                patchRow(row.key, { energyMin: next });
                            }}
                        />
                    </View>
                    <View aria-hidden>
                        <Text tone="secondary">–</Text>
                    </View>
                    <View style={{ width: BAND_BOX }}>
                        <CountField
                            testID={`${rowId(row)}-energy-max`}
                            label={t('kitchen:plans.energyMaxLabel')}
                            labelHidden
                            placeholder={t('kitchen:plans.energyMaxPlaceholder')}
                            value={row.energyMax}
                            disabled={!canManage}
                            onChange={(next) => {
                                patchRow(row.key, { energyMax: next });
                            }}
                        />
                    </View>
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:nutritionFacts.unitKcal')}
                    </Text>
                </View>
            ),
        },
        {
            key: 'offer',
            label: t('kitchen:plans.offerHeader'),
            width: OFFER_TRACK,
            priority: 96,
            grow: false,
            render: (row) => (
                <Switch
                    testID={`${rowId(row)}-active`}
                    id={`${rowId(row)}-active`}
                    label={t('kitchen:plans.variantActiveLabel')}
                    labelHidden
                    stateLabel={
                        row.isActive
                            ? t('kitchen:plans.variantActive')
                            : t('kitchen:plans.variantInactive')
                    }
                    checked={row.isActive}
                    disabled={!canManage}
                    onChange={(next) => {
                        patchRow(row.key, { isActive: next });
                    }}
                />
            ),
        },
        ...(removable
            ? [
                  {
                      key: 'actions',
                      label: t('kitchen:list.actionHeader'),
                      // The ⋯ needs no visible heading in a 48px track; its name stays for a reader.
                      renderHeader: () => (
                          <View accessibilityLabel={t('kitchen:list.actionHeader')} />
                      ),
                      width: MENU_TRACK,
                      priority: 95,
                      grow: false,
                      align: 'end',
                      render: (row: VariantDraft) => (
                          <RowMenu
                              testID={`${rowId(row)}-menu`}
                              label={t('kitchen:list.rowActions')}
                              actions={[
                                  {
                                      key: 'remove',
                                      label: t('kitchen:rows.remove'),
                                      icon: 'trash',
                                      tone: 'danger',
                                      testID: `${rowId(row)}-remove`,
                                      onSelect: () => {
                                          setRemoved({
                                              row,
                                              index: rows.findIndex(
                                                  (entry) => entry.key === row.key,
                                              ),
                                          });
                                          onChange(rows.filter((entry) => entry.key !== row.key));
                                      },
                                  },
                              ]}
                          />
                      ),
                  } satisfies DataListColumn<VariantDraft>,
              ]
            : []),
    ];

    return (
        // The table carries the component's id when it is drawn, so its rows are `{testID}-row-{key}`;
        // the wrapper takes it only while there is no table to carry it.
        <View {...(rows.length === 0 ? { testID } : {})} className="z-auto flex-col">
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.variantsEmpty')}
                </Text>
            ) : (
                <DataTable<VariantDraft>
                    lines
                    testID={testID}
                    label={t('kitchen:plans.variantsTitle')}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    density="sm"
                    framed
                    rowNote={(row) => {
                        const error = errors.get(row.key);
                        return error === undefined ? null : (
                            <Text
                                testID={`${rowId(row)}-error`}
                                role="alert"
                                tone="danger"
                                variant="caption"
                            >
                                {error}
                            </Text>
                        );
                    }}
                />
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:plans.variantRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}
        </View>
    );
}

/**
 * A whole-number field whose empty state is `null`, never `0`. Drawn as the design's plain mono
 * input: a desk surface types the number rather than stepping to it.
 */
export function CountField({
    testID,
    label,
    labelHidden,
    hint,
    value,
    disabled,
    placeholder,
    error,
    onChange,
}: {
    readonly testID: string;
    readonly label: string;
    readonly labelHidden?: boolean | undefined;
    readonly hint?: string | undefined;
    readonly value: number | null;
    readonly disabled: boolean;
    readonly placeholder?: string | undefined;
    readonly error?: string | undefined;
    readonly onChange: (next: number | null) => void;
}) {
    return (
        <TextInputField
            testID={testID}
            id={testID}
            label={label}
            labelHidden={labelHidden}
            hint={hint}
            error={error}
            placeholder={placeholder}
            size="sm"
            inputMode="numeric"
            autoCorrect={false}
            disabled={disabled}
            value={value === null ? '' : String(value)}
            onChangeText={(text) => {
                const digits = text.replace(/[^0-9]/g, '');
                onChange(digits === '' ? null : Number.parseInt(digits, 10));
            }}
        />
    );
}

/* ------------------------------------------------------------------------------------------------
 * Duration rows
 * ---------------------------------------------------------------------------------------------- */

export interface PlanDurationRowsProps {
    readonly rows: readonly DurationDraft[];
    readonly onChange: (rows: readonly DurationDraft[]) => void;
    /** From `durationErrors`: each row's one problem, and the field it belongs under. */
    readonly errors: ReadonlyMap<string, DurationError>;
    readonly canManage: boolean;
    /**
     * Never offers to remove the only row. A new plan opens on one configuration and one duration
     * and is not written without them, so taking the last one away would only put back an empty
     * section and a required field with nothing to type into.
     */
    readonly keepOne?: boolean | undefined;
    readonly testID: string;
}

/**
 * How long a plan runs — one line per option (Commercial §2.2 `PlanDurationRow`, §3.3 Durations).
 *
 * ```
 * KIND                   DAYS      DISCOUNT    WHAT THAT MEANS                               ⋯
 * [One-off          ▾]   None      [Not set]   A one-off is a single delivery …
 * [A fixed number … ▾]   [ 20 ]    [ 5 ]       This duration takes 5% off.
 * ```
 *
 * ## The `CHECK`, enforced while it is being typed
 *
 * **A one-off duration has no day count, and a fixed-days duration has a positive one**
 * (`isPlanDurationConsistent`). Switching a row to `one_off` clears the count and the Days cell reads
 * `None` — not zero, none — and switching back leaves it empty until a number is typed.
 *
 * ## The discount is `null` until somebody decides
 *
 * An empty field is `null` on the wire; a typed `0` is the decision that the commitment earns
 * nothing. The sentence in the last column says which of the two the row holds. A one-off row with
 * no discount decided says what a one-off is instead, which is the question its Days cell raises.
 *
 * ## A row's problem is said under the row
 *
 * Each row has one problem at a time, and it belongs to a field (`DurationError['field']`). It is
 * said on the row's note line, keeping that field's id (`…-days-error`, `…-discount-error`), so
 * the row's fields stay on one line whichever of them is wrong.
 */
export function PlanDurationRows({
    rows,
    onChange,
    errors,
    canManage,
    keepOne = false,
    testID,
}: PlanDurationRowsProps) {
    const { t } = useTranslation();
    const [removed, setRemoved] = useState<{ row: DurationDraft; index: number } | null>(null);

    const nameOf = (row: DurationDraft): string =>
        row.kind === 'one_off'
            ? t('kitchen:plans.kindOneOff')
            : row.days === null
              ? t('kitchen:plans.unnamedDuration')
              : t('kitchen:plans.dayCount', { count: row.days });

    const patchRow = (key: string, next: Partial<DurationDraft>) => {
        onChange(rows.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)));
    };

    const meaning = (row: DurationDraft): string =>
        row.kind === 'one_off' && row.discountPercent === null
            ? t('kitchen:plans.oneOffExplainer')
            : row.discountPercent === null
              ? t('kitchen:plans.discountNotSetExplainer')
              : row.discountPercent === 0
                ? t('kitchen:plans.discountZeroExplainer')
                : t('kitchen:plans.discountSetExplainer', { percent: row.discountPercent });

    /**
     * The note's id: a Days problem on a fixed-days row is that field's, a Discount problem always
     * is, and what is left — a one-off's day-count or duplicate problem — has no field, so it is
     * the row's.
     */
    const noteId = (row: DurationDraft, error: DurationError): string => {
        const rowTestId = `${testID}-row-${row.key}`;
        if (error.field === 'discount') return `${rowTestId}-discount-error`;
        if (row.kind === 'fixed_days') return `${rowTestId}-days-error`;
        return `${rowTestId}-error`;
    };

    const removable = canManage && !(keepOne && rows.length === 1);

    const columns: readonly DataListColumn<DurationDraft>[] = [
        {
            key: 'kind',
            label: t('kitchen:plans.kindLabel'),
            width: KIND_TRACK,
            priority: 100,
            grow: false,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <Select<PlanDurationKind>
                        testID={`${testID}-row-${row.key}-kind`}
                        id={`${testID}-row-${row.key}-kind`}
                        label={t('kitchen:plans.kindLabel')}
                        labelHidden
                        disabled={!canManage}
                        value={row.kind}
                        onChange={(next) => {
                            onChange(
                                rows.map((entry) =>
                                    entry.key === row.key ? withDurationKind(entry, next) : entry,
                                ),
                            );
                        }}
                        options={PLAN_DURATION_KINDS.map((kind) => ({
                            value: kind,
                            label: t(durationKindKey(kind)),
                        }))}
                    />
                </View>
            ),
        },
        {
            key: 'days',
            label: t('kitchen:plans.daysLabel'),
            width: DAYS_TRACK,
            priority: 99,
            grow: false,
            render: (row) => (
                <View className="w-full py-tight">
                    {row.kind === 'fixed_days' ? (
                        <CountField
                            testID={`${testID}-row-${row.key}-days`}
                            label={t('kitchen:plans.daysLabel')}
                            labelHidden
                            placeholder="0"
                            value={row.days}
                            disabled={!canManage}
                            onChange={(next) => {
                                patchRow(row.key, { days: next });
                            }}
                        />
                    ) : (
                        // "Not zero, none": the one-off's Days cell reads None on the read-only
                        // fill, and carries the reason as its name.
                        <View
                            testID={`${testID}-row-${row.key}-days-absent`}
                            accessibilityLabel={t('kitchen:plans.daysAbsentHint')}
                            className="h-control-sm justify-center rounded-sm border border-stroke-subtle bg-surface-sunken px-control-sm"
                        >
                            <Text tone="secondary">{t('kitchen:plans.daysNone')}</Text>
                        </View>
                    )}
                </View>
            ),
        },
        {
            key: 'discount',
            label: t('kitchen:plans.discountLabel'),
            width: DISCOUNT_TRACK,
            priority: 98,
            grow: false,
            render: (row) => (
                <View className="w-full py-tight">
                    <CountField
                        testID={`${testID}-row-${row.key}-discount`}
                        label={t('kitchen:plans.discountLabel')}
                        labelHidden
                        placeholder={t('kitchen:plans.discountNotSet')}
                        value={row.discountPercent}
                        disabled={!canManage}
                        onChange={(next) => {
                            patchRow(row.key, { discountPercent: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'meaning',
            label: t('kitchen:plans.durationMeaning'),
            width: MEANING_TRACK,
            priority: 97,
            fill: true,
            render: (row) => (
                <View className="min-w-0 flex-1 py-tight">
                    <Text
                        testID={`${testID}-row-${row.key}-discount-state`}
                        // A sentence, not a value: it wraps rather than ending in an ellipsis.
                        numberOfLines={3}
                        variant="caption"
                        tone="secondary"
                    >
                        {meaning(row)}
                    </Text>
                </View>
            ),
        },
        ...(removable
            ? [
                  {
                      key: 'remove',
                      label: t('kitchen:list.actionHeader'),
                      renderHeader: () => (
                          <View accessibilityLabel={t('kitchen:list.actionHeader')} />
                      ),
                      width: MENU_TRACK,
                      priority: 96,
                      grow: false,
                      align: 'end',
                      render: (row: DurationDraft) => (
                          <RowMenu
                              testID={`${testID}-row-${row.key}-menu`}
                              label={t('kitchen:list.rowActions')}
                              actions={[
                                  {
                                      key: 'remove',
                                      label: t('kitchen:rows.remove'),
                                      icon: 'trash',
                                      tone: 'danger',
                                      testID: `${testID}-row-${row.key}-remove`,
                                      onSelect: () => {
                                          setRemoved({
                                              row,
                                              index: rows.findIndex(
                                                  (entry) => entry.key === row.key,
                                              ),
                                          });
                                          onChange(rows.filter((entry) => entry.key !== row.key));
                                      },
                                  },
                              ]}
                          />
                      ),
                  } satisfies DataListColumn<DurationDraft>,
              ]
            : []),
    ];

    return (
        // The table carries the component's id when it is drawn, so its rows are `{testID}-row-{key}`;
        // the wrapper takes it only while there is no table to carry it.
        <View {...(rows.length === 0 ? { testID } : {})} className="z-auto flex-col">
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.durationsEmpty')}
                </Text>
            ) : (
                <DataTable<DurationDraft>
                    lines
                    testID={testID}
                    label={t('kitchen:plans.sectionDurations')}
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    density="sm"
                    framed
                    rowNote={(row) => {
                        const error = errors.get(row.key);
                        return error === undefined ? null : (
                            <Text
                                testID={noteId(row, error)}
                                role="alert"
                                tone="danger"
                                variant="caption"
                            >
                                {error.message}
                            </Text>
                        );
                    }}
                />
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:plans.durationRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}
        </View>
    );
}

/**
 * The tracks. Each is its box's width plus the cell's own `px-control-sm` (8 + 8), so the boxes
 * keep those widths; the configuration's name and the duration's sentence take the row's slack.
 */
const CELL_PADDING = 16;
const NAME_TRACK = 200;
const COUNT_TRACK = 96 + CELL_PADDING;
/** Two 88px boxes, the dash between them and the unit after them, on the band's one track. */
const BAND_BOX = 88;
const BAND_TRACK = 2 * BAND_BOX + 64 + CELL_PADDING;
const OFFER_TRACK = 112 + CELL_PADDING;
/** The design's duration tracks; its 150px kind is widened to show the longer label whole. */
const KIND_TRACK = 180 + CELL_PADDING;
const DAYS_TRACK = 110 + CELL_PADDING;
const DISCOUNT_TRACK = 130 + CELL_PADDING;
/** The sentence's floor; it takes the row's slack, so the band runs the card's width. */
const MEANING_TRACK = 240;
/** The `⋯`'s 28px target and the cell's padding. */
const MENU_TRACK = 48;
