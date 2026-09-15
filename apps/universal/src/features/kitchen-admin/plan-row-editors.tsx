import { PLAN_DURATION_KINDS } from '@healthy360/api-client/contracts';
import type { PlanDurationKind } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    Icon,
    IconButton,
    Inline,
    NumberStepper,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
    spanWidth,
} from '@healthy360/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BilingualField } from './bilingual-field.tsx';
import { durationKindKey, moveInList } from './format.ts';
import { withDurationKind } from './plan-matrix.ts';
import type { CombinationDraft, DurationDraft, VariantDraft } from './plan-matrix.ts';
import { RowAnnouncer, RowShell, UndoBar } from './row-editor-shell.tsx';

/**
 * The plan editor's three repeated-row editors and its matrix (K1.6).
 *
 * Its own module rather than a fifth section of `./catalogue-row-editors.tsx`, for the same reason
 * `./price-row-editors.tsx` is its own: these rows enforce contract rules *while they are being
 * typed* — a duration's `CHECK`, a discount that must stay undecided rather than become zero — and
 * that logic wants to be readable next to the control it governs.
 *
 * ## The matrix is a `Table`, and that is a decision rather than a convenience
 *
 * A combination × energy-band grid is a data table: cells are meaningless without both of their
 * headers, and a grid built from bare `View`s gives a screen-reader user a column of checkboxes with
 * no way to tell which band each one is for. The design system's {@link Table} is already an ARIA
 * table above `md` — `columnheader` and `rowheader` cells, named by its caption — and already
 * becomes **stacked cards below `md`**, one card per combination with every cell labelled by its
 * column header. That is exactly the responsive behaviour a matrix needs on a phone, and building a
 * second one here would mean re-solving the accessibility the shared component has already solved.
 * Each cell additionally carries the whole sentence as its own accessible name, so the answer is
 * unambiguous in both presentations.
 *
 * ## Every numeric field is a `NumberStepper`, and the reason is `null`
 *
 * `NumberStepper` hands back `number | null`, where `null` means "not answered yet — distinct from
 * zero, which is an answer". That distinction is the whole of `plan_variant_durations.discount`:
 * a `null` discount is a commercial decision nobody has taken, and `0` is the decision that a week
 * earns nothing. A plain text field would have made those the same empty box.
 */

/* ------------------------------------------------------------------------------------------------
 * Variant detail rows
 * ---------------------------------------------------------------------------------------------- */

export interface PlanVariantRowsProps {
    readonly rows: readonly VariantDraft[];
    readonly onChange: (rows: readonly VariantDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly testID: string;
}

/**
 * Every configuration in full (Commercial §2.2 `PlanVariantCard`, §3.3 Configurations tab).
 *
 * ```
 * CONFIGURATION 1  [ACTIVE]                                                    ▲ ▼ ✕
 * Configuration name (span 2)                 Offer this configuration [Active ▾]
 * Meals a day [3]      Snacks a day [1]      Energy from [1500]  Energy to [1800]
 * ```
 *
 * One hairline row per configuration, the fields on the no-stretch 280px track. Meals, snacks and
 * the band are the configuration's **coordinates**: changing one moves it to another cell of the
 * matrix, and the hint under Meals says so. `Inactive` is chosen from a select, not a checkbox,
 * because it is one of two named states and neither is a deletion.
 */
export function PlanVariantRows({
    rows,
    onChange,
    errors,
    canManage,
    testID,
}: PlanVariantRowsProps) {
    const { t } = useTranslation();
    const [announcement, setAnnouncement] = useState('');
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
                    const position = index + 1;
                    const error = errors.get(row.key);
                    const patch = (next: Partial<VariantDraft>) => {
                        onChange(
                            rows.map((entry) =>
                                entry.key === row.key ? { ...entry, ...next } : entry,
                            ),
                        );
                    };
                    const move = (to: number) => {
                        const next = moveInList(rows, index, to);
                        if (next === rows) return;
                        onChange(next);
                        setAnnouncement(
                            t('kitchen:rows.movedAnnouncement', {
                                name: nameOf(row),
                                position: to + 1,
                                total: rows.length,
                            }),
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
                                title={t('kitchen:plans.variantNumber', { number: position })}
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
                                canManage={canManage}
                                position={position}
                                total={rows.length}
                                onMove={move}
                                onRemove={() => {
                                    setRemoved({ row, index });
                                    onChange(rows.filter((entry) => entry.key !== row.key));
                                }}
                            />

                            <View className="z-auto flex-row flex-wrap items-start gap-x-base gap-y-snug">
                                <View style={{ width: spanWidth(2) }}>
                                    <BilingualField
                                        testID={`${rowTestId}-name`}
                                        fieldLabel={t('kitchen:plans.variantNameLabel')}
                                        value={row.name}
                                        requiredEnglish
                                        onChange={(next) => {
                                            patch({ name: next });
                                        }}
                                    />
                                </View>
                                <View style={{ width: spanWidth(1) }} className="z-auto">
                                    <Select<'active' | 'inactive'>
                                        testID={`${rowTestId}-active`}
                                        id={`${rowTestId}-active`}
                                        label={t('kitchen:plans.variantActiveLabel')}
                                        hint={t('kitchen:plans.variantActiveHint')}
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
                                        hint={t('kitchen:plans.coordinateHint')}
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

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
        </View>
    );
}

/**
 * A row's opening: the micro number, its badge, and the reorder and remove controls at the inline
 * end. `RowShell`'s behaviour — the move buttons, the remove, the ids a suite presses — drawn on a
 * hairline row instead of a card, because the design stacks these rows as a list, not as panels.
 */
function RowHeading({
    testID,
    title,
    badge,
    canManage,
    position,
    total,
    onMove,
    onRemove,
}: {
    readonly testID: string;
    readonly title: string;
    readonly badge?: ReactNode | undefined;
    readonly canManage: boolean;
    readonly position: number;
    readonly total: number;
    readonly onMove: (to: number) => void;
    readonly onRemove: () => void;
}) {
    const { t } = useTranslation();
    return (
        <View className="flex-row items-center gap-tight">
            <Text variant="micro" tone="secondary" testID={`${testID}-position`}>
                {title}
            </Text>
            {badge}
            <View className="flex-1" />
            {canManage ? (
                <RowControls
                    testID={testID}
                    position={position}
                    total={total}
                    onMove={onMove}
                    onRemove={onRemove}
                    label={t('kitchen:rows.remove')}
                />
            ) : null}
        </View>
    );
}

function RowControls({
    testID,
    position,
    total,
    onMove,
    onRemove,
    label,
}: {
    readonly testID: string;
    readonly position: number;
    readonly total: number;
    readonly onMove: (to: number) => void;
    readonly onRemove: () => void;
    readonly label: string;
}) {
    const { t } = useTranslation();
    return (
        <View className="flex-row items-center gap-hair">
            <IconButton
                testID={`${testID}-move-up`}
                variant="ghost"
                size="sm"
                label={t('kitchen:rows.moveUp')}
                icon={<Icon name="chevronUp" size="sm" />}
                disabled={position <= 1}
                onPress={() => {
                    onMove(position - 2);
                }}
            />
            <IconButton
                testID={`${testID}-move-down`}
                variant="ghost"
                size="sm"
                label={t('kitchen:rows.moveDown')}
                icon={<Icon name="chevronDown" size="sm" />}
                disabled={position >= total}
                onPress={() => {
                    onMove(position);
                }}
            />
            <IconButton
                testID={`${testID}-remove`}
                variant="secondary"
                size="sm"
                tone="danger"
                label={label}
                icon={<Icon name="close" size="sm" />}
                onPress={onRemove}
            />
        </View>
    );
}

/**
 * A whole-number field whose empty state is `null`, never `0` — the reason these editors used
 * `NumberStepper`. Drawn as the design's plain mono input: a desk surface types the number rather
 * than stepping to it.
 */
function CountField({
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
 * Combination rows
 * ---------------------------------------------------------------------------------------------- */

export interface PlanCombinationRowsProps {
    readonly rows: readonly CombinationDraft[];
    readonly onChange: (rows: readonly CombinationDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly testID: string;
}

/** The rows of the matrix, as the contract's own hand-authored table. */
export function PlanCombinationRows({
    rows,
    onChange,
    errors,
    canManage,
    testID,
}: PlanCombinationRowsProps) {
    const { t } = useTranslation();
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: CombinationDraft; index: number } | null>(null);

    const nameOf = (row: CombinationDraft): string =>
        row.code.trim() === '' ? t('kitchen:plans.unnamedCombination') : row.code;

    return (
        <Stack space="md" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.combinationsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const error = errors.get(row.key);
                    const patch = (next: Partial<CombinationDraft>) => {
                        onChange(
                            rows.map((entry) =>
                                entry.key === row.key ? { ...entry, ...next } : entry,
                            ),
                        );
                    };

                    return (
                        <RowShell
                            key={row.key}
                            testID={rowTestId}
                            title={t('kitchen:plans.combinationNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            onMove={(to) => {
                                const next = moveInList(rows, index, to);
                                if (next === rows) return;
                                onChange(next);
                                setAnnouncement(
                                    t('kitchen:rows.movedAnnouncement', {
                                        name: nameOf(row),
                                        position: to + 1,
                                        total: rows.length,
                                    }),
                                );
                            }}
                            onRemove={() => {
                                setRemoved({ row, index });
                                onChange(rows.filter((entry) => entry.key !== row.key));
                            }}
                        >
                            <Stack space="sm">
                                <TextInputField
                                    testID={`${rowTestId}-code`}
                                    id={`${rowTestId}-code`}
                                    label={t('kitchen:plans.combinationCodeLabel')}
                                    hint={t('kitchen:plans.combinationCodeHint')}
                                    value={row.code}
                                    required
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    disabled={!canManage}
                                    {...(error === undefined ? {} : { error })}
                                    onChangeText={(next) => {
                                        patch({ code: next });
                                    }}
                                />

                                <BilingualField
                                    testID={`${rowTestId}-label`}
                                    fieldLabel={t('kitchen:plans.combinationLabelLabel')}
                                    value={row.label}
                                    requiredEnglish
                                    onChange={(next) => {
                                        patch({ label: next });
                                    }}
                                />

                                <Inline space="sm" wrap>
                                    <NumberStepper
                                        testID={`${rowTestId}-meals`}
                                        id={`${rowTestId}-meals`}
                                        label={t('kitchen:plans.mealsPerDayLabel')}
                                        min={0}
                                        max={12}
                                        disabled={!canManage}
                                        value={row.mealsPerDay}
                                        onChange={(next) => {
                                            patch({ mealsPerDay: next });
                                        }}
                                    />
                                    <NumberStepper
                                        testID={`${rowTestId}-snacks`}
                                        id={`${rowTestId}-snacks`}
                                        label={t('kitchen:plans.snacksPerDayLabel')}
                                        min={0}
                                        max={12}
                                        disabled={!canManage}
                                        value={row.snacksPerDay}
                                        onChange={(next) => {
                                            patch({ snacksPerDay: next });
                                        }}
                                    />
                                </Inline>

                                <Checkbox
                                    testID={`${rowTestId}-available`}
                                    id={`${rowTestId}-available`}
                                    checked={row.isAvailable}
                                    disabled={!canManage}
                                    label={t('kitchen:plans.combinationAvailableLabel')}
                                    description={t('kitchen:plans.combinationAvailableHint')}
                                    onChange={(next) => {
                                        patch({ isAvailable: next });
                                    }}
                                />
                            </Stack>
                        </RowShell>
                    );
                })
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:plans.combinationRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
        </Stack>
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
    readonly testID: string;
}

/**
 * How long a plan runs — one line per option (Commercial §2.2 `PlanDurationRow`, §3.3 Durations).
 *
 * ```
 * KIND                        DAYS      DISCOUNT    WHAT THAT MEANS                      ▲ ▼ ✕
 * [ One-off | Fixed days ]    None      [Not set]   A one-off is a single delivery …
 * [ One-off | Fixed days ]    [ 20 ]    [ 5 ]       This duration takes 5% off.
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
 * nothing. The sentence in the last column says which of the two the row holds — the component *is*
 * the three-state distinction (`DiscountExplainer`).
 *
 * The kind stays a segmented control rather than the design's select: both values have to be visible
 * at once, because "why has this row no days?" is answered by seeing that `One-off` is the one chosen.
 */
export function PlanDurationRows({
    rows,
    onChange,
    errors,
    canManage,
    testID,
}: PlanDurationRowsProps) {
    const { t } = useTranslation();
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: DurationDraft; index: number } | null>(null);

    const nameOf = (row: DurationDraft): string =>
        row.kind === 'one_off'
            ? t('kitchen:plans.kindOneOff')
            : row.days === null
              ? t('kitchen:plans.unnamedDuration')
              : t('kitchen:plans.dayCount', { count: row.days });

    return (
        <View testID={testID} className="flex-col">
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.durationsEmpty')}
                </Text>
            ) : (
                <>
                    <View className="h-6 flex-row items-center gap-snug border-b border-stroke px-tight">
                        <View style={{ width: KIND_TRACK }}>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.kindLabel')}
                            </Text>
                        </View>
                        <View style={{ width: DAYS_TRACK }}>
                            <Text variant="micro" tone="secondary" align="end">
                                {t('kitchen:plans.daysLabel')}
                            </Text>
                        </View>
                        <View style={{ width: DISCOUNT_TRACK }}>
                            <Text variant="micro" tone="secondary" align="end">
                                {t('kitchen:plans.discountLabel')}
                            </Text>
                        </View>
                        <View className="min-w-0 flex-1">
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:plans.durationMeaning')}
                            </Text>
                        </View>
                    </View>

                    {rows.map((row, index) => {
                        const rowTestId = `${testID}-row-${row.key}`;
                        const position = index + 1;
                        const error = errors.get(row.key);
                        const carriesDays = row.kind === 'fixed_days';
                        const patch = (next: Partial<DurationDraft>) => {
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
                                className="flex-col gap-hair border-b border-stroke-subtle px-tight py-1.5"
                            >
                                <View className="min-h-control-sm flex-row items-center gap-snug">
                                    <View style={{ width: KIND_TRACK }}>
                                        <SegmentedControl<PlanDurationKind>
                                            testID={`${rowTestId}-kind`}
                                            label={t('kitchen:plans.kindLabel')}
                                            value={row.kind}
                                            onChange={(next) => {
                                                onChange(
                                                    rows.map((entry) =>
                                                        entry.key === row.key
                                                            ? withDurationKind(entry, next)
                                                            : entry,
                                                    ),
                                                );
                                            }}
                                            items={PLAN_DURATION_KINDS.map((kind) => ({
                                                value: kind,
                                                label: t(durationKindKey(kind)),
                                                disabled: !canManage,
                                                testID: `${rowTestId}-kind-${kind}`,
                                            }))}
                                        />
                                    </View>

                                    <View style={{ width: DAYS_TRACK }}>
                                        {carriesDays ? (
                                            <CountField
                                                testID={`${rowTestId}-days`}
                                                label={t('kitchen:plans.daysLabel')}
                                                labelHidden
                                                placeholder="0"
                                                value={row.days}
                                                disabled={!canManage}
                                                error={error}
                                                onChange={(next) => {
                                                    patch({ days: next });
                                                }}
                                            />
                                        ) : (
                                            // "Not zero, none": the one-off's Days cell reads None on
                                            // the read-only fill, and carries the reason as its name.
                                            <View
                                                testID={`${rowTestId}-days-absent`}
                                                accessibilityLabel={t(
                                                    'kitchen:plans.daysAbsentHint',
                                                )}
                                                className="h-control-sm justify-center rounded-sm border border-stroke-subtle bg-surface-sunken px-control-sm"
                                            >
                                                <Text tone="secondary" align="end">
                                                    {t('kitchen:plans.daysNone')}
                                                </Text>
                                            </View>
                                        )}
                                    </View>

                                    <View style={{ width: DISCOUNT_TRACK }}>
                                        <CountField
                                            testID={`${rowTestId}-discount`}
                                            label={t('kitchen:plans.discountLabel')}
                                            labelHidden
                                            placeholder={t('kitchen:plans.discountNotSet')}
                                            value={row.discountPercent}
                                            disabled={!canManage}
                                            onChange={(next) => {
                                                patch({ discountPercent: next });
                                            }}
                                        />
                                    </View>

                                    <View className="min-w-0 flex-1">
                                        <Text
                                            testID={`${rowTestId}-discount-state`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {row.discountPercent === null
                                                ? t('kitchen:plans.discountNotSetExplainer')
                                                : row.discountPercent === 0
                                                  ? t('kitchen:plans.discountZeroExplainer')
                                                  : t('kitchen:plans.discountSetExplainer', {
                                                        percent: row.discountPercent,
                                                    })}
                                        </Text>
                                    </View>

                                    {canManage ? (
                                        <RowControls
                                            testID={rowTestId}
                                            position={position}
                                            total={rows.length}
                                            label={t('kitchen:rows.remove')}
                                            onMove={(to) => {
                                                const next = moveInList(rows, index, to);
                                                if (next === rows) return;
                                                onChange(next);
                                                setAnnouncement(
                                                    t('kitchen:rows.movedAnnouncement', {
                                                        name: nameOf(row),
                                                        position: to + 1,
                                                        total: rows.length,
                                                    }),
                                                );
                                            }}
                                            onRemove={() => {
                                                setRemoved({ row, index });
                                                onChange(
                                                    rows.filter((entry) => entry.key !== row.key),
                                                );
                                            }}
                                        />
                                    ) : null}
                                </View>

                                {error === undefined || carriesDays ? null : (
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
                    })}
                </>
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

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
        </View>
    );
}

/** The design's duration tracks. The kind is wider than its 150px: two named values, both shown. */
const KIND_TRACK = 240;
const DAYS_TRACK = 110;
const DISCOUNT_TRACK = 130;

/* ------------------------------------------------------------------------------------------------
 * Adding a column
 * ---------------------------------------------------------------------------------------------- */

export interface PlanBandAdderProps {
    readonly onAdd: (band: { readonly min: number; readonly max: number }) => void;
    readonly canManage: boolean;
    readonly testID: string;
}

/**
 * Adds an energy band — a *column* — to the matrix.
 *
 * There is no band entity in this contract: a band exists exactly because some variant carries it
 * (`../plan-matrix.ts`). So a column with nothing in it cannot be saved and is not pretended to be
 * — it is drawn so that its cells can be switched on, and it disappears on reload if none were.
 * The note beside the control says exactly that, because a column that silently vanishes is worse
 * than one that never appeared.
 */
export function PlanBandAdder({ onAdd, canManage, testID }: PlanBandAdderProps) {
    const { t } = useTranslation();
    const [min, setMin] = useState<number | null>(null);
    const [max, setMax] = useState<number | null>(null);

    const invalid = min === null || max === null || min <= 0 || max < min;

    return (
        <Stack space="sm" testID={testID}>
            <Inline space="sm" wrap>
                <NumberStepper
                    testID={`${testID}-min`}
                    id={`${testID}-min`}
                    label={t('kitchen:plans.energyMinLabel')}
                    unit={t('kitchen:plans.energyUnit')}
                    min={0}
                    step={50}
                    disabled={!canManage}
                    value={min}
                    onChange={setMin}
                />
                <NumberStepper
                    testID={`${testID}-max`}
                    id={`${testID}-max`}
                    label={t('kitchen:plans.energyMaxLabel')}
                    unit={t('kitchen:plans.energyUnit')}
                    min={0}
                    step={50}
                    disabled={!canManage}
                    value={max}
                    onChange={setMax}
                />
            </Inline>

            <Callout
                testID={`${testID}-note`}
                role="note"
                tone="info"
                title={t('kitchen:plans.bandAddTitle')}
                body={t('kitchen:plans.bandAddBody')}
            />

            <Inline space="sm" align="center" wrap>
                <Button
                    testID={`${testID}-confirm`}
                    size="sm"
                    variant="secondary"
                    label={t('kitchen:plans.bandAddAction')}
                    disabled={!canManage || invalid}
                    onPress={() => {
                        if (min === null || max === null || invalid) return;
                        onAdd({ min, max });
                        setMin(null);
                        setMax(null);
                    }}
                />
                <Text testID={`${testID}-state`} variant="caption" tone="secondary">
                    {invalid
                        ? t('kitchen:plans.bandAddIncomplete')
                        : t('kitchen:plans.bandAddReady')}
                </Text>
            </Inline>
        </Stack>
    );
}
