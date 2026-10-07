import { PLAN_DURATION_KINDS } from '@healthy360/api-client/contracts';
import type { PlanDurationKind } from '@healthy360/api-client/contracts';
import {
    Badge,
    DataList,
    Icon,
    IconButton,
    Select,
    Text,
    TextInputField,
    spanWidth,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { durationKindKey } from './format.ts';
import { withDurationKind } from './plan-matrix.ts';
import type { DurationDraft, VariantDraft } from './plan-matrix.ts';
import { UndoBar } from './row-editor-shell.tsx';

/**
 * The plan editor's two repeated-row editors (K1.6): configurations and durations.
 *
 * Its own module rather than a section of `./catalogue-row-editors.tsx`, for the same reason
 * `./price-row-editors.tsx` is its own: these rows enforce contract rules *while they are being
 * typed* — a duration's `CHECK`, a discount that must stay undecided rather than become zero — and
 * that logic wants to be readable next to the control it governs.
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
 * Every configuration in full (Commercial §2.2 `PlanVariantCard`, §3.3 Configurations tab).
 *
 * ```
 * CONFIGURATION 1  [ACTIVE]                                                                ✕
 * Configuration name (span 2)                 Offer this configuration [Active ▾]
 * Meals a day [3]      Snacks a day [1]      Energy from [1500]  Energy to [1800]
 * ```
 *
 * One hairline row per configuration, the fields on the no-stretch 280px track. Meals, snacks and
 * the band are the configuration's **coordinates**: they are the cell of the matrix it sits in. `Inactive` is chosen from a select, not a checkbox, because it is
 * one of two named states and neither is a deletion.
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

    return (
        <View testID={testID} className="flex-col">
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.variantsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const error = errors.get(row.key);
                    const patch = (next: Partial<VariantDraft>) => {
                        onChange(
                            rows.map((entry) =>
                                entry.key === row.key ? { ...entry, ...next } : entry,
                            ),
                        );
                    };

                    return (
                        <View
                            key={row.key}
                            testID={rowTestId}
                            className="z-auto flex-col gap-2.5 border-b border-stroke-subtle py-snug"
                        >
                            <RowHeading
                                testID={rowTestId}
                                title={t('kitchen:plans.variantNumber', { number: index + 1 })}
                                badge={
                                    <Badge
                                        testID={`${rowTestId}-badge`}
                                        tone={row.isActive ? 'success' : 'neutral'}
                                        label={
                                            row.isActive
                                                ? t('kitchen:plans.variantActive')
                                                : t('kitchen:plans.variantInactive')
                                        }
                                    />
                                }
                                canManage={canManage && !(keepOne && rows.length === 1)}
                                onRemove={() => {
                                    setRemoved({ row, index });
                                    onChange(rows.filter((entry) => entry.key !== row.key));
                                }}
                            />

                            <View className="z-auto flex-row flex-wrap items-start gap-x-base gap-y-snug">
                                <View style={{ width: spanWidth(2) }}>
                                    <TextInputField
                                        testID={`${rowTestId}-name`}
                                        id={`${rowTestId}-name`}
                                        label={t('kitchen:plans.variantNameLabel')}
                                        placeholder={t('kitchen:plans.variantNamePlaceholder')}
                                        size="sm"
                                        required
                                        disabled={!canManage}
                                        value={row.name.en}
                                        onChangeText={(next) => {
                                            patch({ name: { ...row.name, en: next } });
                                        }}
                                    />
                                </View>
                                <View style={{ width: spanWidth(1) }} className="z-auto">
                                    <Select<'active' | 'inactive'>
                                        testID={`${rowTestId}-active`}
                                        id={`${rowTestId}-active`}
                                        label={t('kitchen:plans.variantActiveLabel')}
                                        disabled={!canManage}
                                        value={row.isActive ? 'active' : 'inactive'}
                                        options={[
                                            {
                                                value: 'active',
                                                label: t('kitchen:plans.variantActive'),
                                            },
                                            {
                                                value: 'inactive',
                                                label: t('kitchen:plans.variantInactive'),
                                            },
                                        ]}
                                        onChange={(next) => {
                                            patch({ isActive: next === 'active' });
                                        }}
                                    />
                                </View>
                                <View style={{ width: spanWidth(1) }}>
                                    <CountField
                                        testID={`${rowTestId}-meals`}
                                        label={t('kitchen:plans.mealsPerDayLabel')}
                                        placeholder={t('kitchen:plans.mealsPerDayPlaceholder')}
                                        value={row.mealsPerDay}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch({ mealsPerDay: next });
                                        }}
                                    />
                                </View>
                                <View style={{ width: spanWidth(1) }}>
                                    <CountField
                                        testID={`${rowTestId}-snacks`}
                                        label={t('kitchen:plans.snacksPerDayLabel')}
                                        placeholder={t('kitchen:plans.snacksPerDayPlaceholder')}
                                        value={row.snacksPerDay}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch({ snacksPerDay: next });
                                        }}
                                    />
                                </View>
                                {/* The band is one field of two halves: a range, not two facts. */}
                                <View
                                    style={{ width: spanWidth(1) }}
                                    className="flex-row gap-tight"
                                >
                                    <View className="min-w-0 flex-1">
                                        <CountField
                                            testID={`${rowTestId}-energy-min`}
                                            label={t('kitchen:plans.energyMinLabel')}
                                            placeholder={t('kitchen:plans.energyMinPlaceholder')}
                                            value={row.energyMin}
                                            disabled={!canManage}
                                            onChange={(next) => {
                                                patch({ energyMin: next });
                                            }}
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1">
                                        <CountField
                                            testID={`${rowTestId}-energy-max`}
                                            label={t('kitchen:plans.energyMaxLabel')}
                                            placeholder={t('kitchen:plans.energyMaxPlaceholder')}
                                            value={row.energyMax}
                                            disabled={!canManage}
                                            onChange={(next) => {
                                                patch({ energyMax: next });
                                            }}
                                        />
                                    </View>
                                </View>
                            </View>

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
                        </View>
                    );
                })
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

/** A row's opening, as the design draws it: the micro number, its badge, and ✕ at the inline end. */
function RowHeading({
    testID,
    title,
    badge,
    canManage,
    onRemove,
}: {
    readonly testID: string;
    readonly title: string;
    readonly badge?: ReactNode | undefined;
    readonly canManage: boolean;
    readonly onRemove: () => void;
}) {
    return (
        <View className="flex-row items-center gap-tight">
            <Text variant="micro" tone="secondary" testID={`${testID}-position`}>
                {title}
            </Text>
            {badge}
            <View className="flex-1" />
            {canManage ? <RemoveButton testID={testID} onRemove={onRemove} /> : null}
        </View>
    );
}

export function RemoveButton({
    testID,
    onRemove,
}: {
    readonly testID: string;
    readonly onRemove: () => void;
}) {
    const { t } = useTranslation();
    return (
        <IconButton
            testID={`${testID}-remove`}
            variant="secondary"
            size="sm"
            tone="danger"
            label={t('kitchen:rows.remove')}
            icon={<Icon name="close" size="sm" />}
            onPress={onRemove}
        />
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
 * How long a plan runs — one line per option (Commercial §2.2 `PlanDurationRow`, §3.3 Durations).
 *
 * ```
 * KIND                   DAYS      DISCOUNT    WHAT THAT MEANS                               ✕
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
                            error={errors.get(row.key)}
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
            render: (row) => {
                // A fixed-days row's problem is the Days field's own error; any other row's problem
                // has no field to sit on, so it sits under the sentence that explains the row.
                const error = row.kind === 'fixed_days' ? undefined : errors.get(row.key);
                return (
                    <View className="min-w-0 flex-1 flex-col gap-hair py-tight">
                        <Text
                            testID={`${testID}-row-${row.key}-discount-state`}
                            // A sentence, not a value: it wraps rather than ending in an ellipsis.
                            numberOfLines={3}
                            variant="caption"
                            tone="secondary"
                        >
                            {meaning(row)}
                        </Text>
                        {error === undefined ? null : (
                            <Text
                                testID={`${testID}-row-${row.key}-error`}
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
        ...(removable
            ? [
                  {
                      key: 'remove',
                      label: t('kitchen:list.actionHeader'),
                      width: REMOVE_TRACK,
                      priority: 96,
                      grow: false,
                      align: 'end',
                      render: (row: DurationDraft) => (
                          <RemoveButton
                              testID={`${testID}-row-${row.key}`}
                              onRemove={() => {
                                  setRemoved({
                                      row,
                                      index: rows.findIndex((entry) => entry.key === row.key),
                                  });
                                  onChange(rows.filter((entry) => entry.key !== row.key));
                              }}
                          />
                      ),
                  } satisfies DataListColumn<DurationDraft>,
              ]
            : []),
    ];

    return (
        // The table carries the component's id when it is drawn, so its rows are `{testID}-row-{key}`;
        // the wrapper takes it only while there is no table to carry it.
        <View {...(rows.length === 0 ? { testID } : {})} className="flex-col">
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.durationsEmpty')}
                </Text>
            ) : (
                <DataList<DurationDraft>
                    testID={testID}
                    label={t('kitchen:plans.sectionDurations')}
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
 * The design's duration tracks; its 150px kind is widened to show the longer label whole. Each is
 * its box's width plus the cell's own `px-control-sm` (8 + 8), so the boxes keep those widths.
 */
const CELL_PADDING = 16;
const KIND_TRACK = 180 + CELL_PADDING;
const DAYS_TRACK = 110 + CELL_PADDING;
const DISCOUNT_TRACK = 130 + CELL_PADDING;
/** The sentence's floor; it takes the row's slack, so the band runs the card's width. */
const MEANING_TRACK = 240;
const REMOVE_TRACK = 48;
