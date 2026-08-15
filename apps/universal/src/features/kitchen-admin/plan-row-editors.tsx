import { PLAN_DURATION_KINDS } from '@healthy360/api-client/contracts';
import type { PlanDurationKind } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    Inline,
    NumberStepper,
    SegmentedControl,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BilingualField } from './bilingual-field.tsx';
import { durationKindKey, moveInList } from './format.ts';
import { cellVariants, withDurationKind } from './plan-matrix.ts';
import type {
    CombinationDraft,
    DurationDraft,
    MatrixBand,
    MatrixRow,
    VariantDraft,
} from './plan-matrix.ts';
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
 * The matrix
 * ---------------------------------------------------------------------------------------------- */

export interface PlanVariantMatrixProps {
    readonly rows: readonly MatrixRow[];
    readonly bands: readonly MatrixBand[];
    readonly variants: readonly VariantDraft[];
    /** Called with the cell that was pressed. The caller applies `toggleCell`. */
    readonly onToggle: (row: MatrixRow, band: MatrixBand) => void;
    readonly canManage: boolean;
    readonly testID: string;
}

export function PlanVariantMatrix({
    rows,
    bands,
    variants,
    onToggle,
    canManage,
    testID,
}: PlanVariantMatrixProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const bandLabel = (band: MatrixBand): string =>
        t('kitchen:plans.bandRange', {
            min: formatter.formatNumber(band.min),
            max: formatter.formatNumber(band.max),
        });

    const rowLabel = (row: MatrixRow): string =>
        t('kitchen:plans.servingsSummary', {
            meals: row.mealsPerDay,
            snacks: row.snacksPerDay,
        });

    const columns: readonly TableColumn<MatrixRow>[] = [
        {
            key: 'combination',
            header: t('kitchen:plans.matrixRowHeader'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none" testID={`${testID}-row-${row.key}`}>
                    <Text variant="bodyStrong">
                        {row.combination === null
                            ? rowLabel(row)
                            : row.combination.label.en.trim() === ''
                              ? row.combination.code
                              : row.combination.label.en}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {rowLabel(row)}
                    </Text>
                    {row.combination === null ? (
                        <Badge
                            testID={`${testID}-row-${row.key}-undeclared`}
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:plans.rowUndeclared')}
                        />
                    ) : row.combination.isAvailable ? null : (
                        <Badge
                            testID={`${testID}-row-${row.key}-unavailable`}
                            tone="neutral"
                            label={t('kitchen:plans.combinationUnavailable')}
                        />
                    )}
                </Stack>
            ),
        },
        ...bands.map<TableColumn<MatrixRow>>((band) => ({
            key: band.key,
            header: bandLabel(band),
            render: (row) => {
                const occupants = cellVariants(variants, row, band);
                const cellId = `${testID}-cell-${row.key}-${band.key}`;
                const label = t('kitchen:plans.cellLabel', {
                    combination: rowLabel(row),
                    band: bandLabel(band),
                });

                return (
                    <Checkbox
                        testID={cellId}
                        id={cellId}
                        checked={occupants.length > 0}
                        disabled={!canManage}
                        label={label}
                        onChange={() => {
                            onToggle(row, band);
                        }}
                        labelSlot={
                            <Stack space="none">
                                <Text variant="caption">
                                    {occupants.length > 0
                                        ? t('kitchen:plans.cellSold')
                                        : t('kitchen:plans.cellNotSold')}
                                </Text>
                                {occupants.length > 1 ? (
                                    <Text
                                        testID={`${cellId}-count`}
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('kitchen:plans.cellVariantCount', {
                                            count: occupants.length,
                                        })}
                                    </Text>
                                ) : null}
                            </Stack>
                        }
                    />
                );
            },
        })),
    ];

    return (
        <Table<MatrixRow>
            testID={testID}
            caption={t('kitchen:plans.matrixCaption')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.key}
            emptyLabel={t('kitchen:plans.matrixEmpty')}
        />
    );
}

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
 * Every variant as a card, with the fields the contract carries and nothing else.
 *
 * The meals/snacks and energy fields are the variant's **coordinates**: changing one moves the
 * configuration to a different cell of the matrix above, and the hint says so rather than leaving
 * somebody to discover it. That is the honest reading of a contract in which a variant carries its
 * own `mealsPerDay` and `energyBand` and no reference to a combination at all.
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
        <Stack space="md" testID={testID}>
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

                    return (
                        <RowShell
                            key={row.key}
                            testID={rowTestId}
                            title={t('kitchen:plans.variantNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
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
                                <BilingualField
                                    testID={`${rowTestId}-name`}
                                    fieldLabel={t('kitchen:plans.variantNameLabel')}
                                    value={row.name}
                                    requiredEnglish
                                    onChange={(next) => {
                                        patch({ name: next });
                                    }}
                                />

                                <Inline space="sm" wrap>
                                    <NumberStepper
                                        testID={`${rowTestId}-meals`}
                                        id={`${rowTestId}-meals`}
                                        label={t('kitchen:plans.mealsPerDayLabel')}
                                        hint={t('kitchen:plans.coordinateHint')}
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

                                <Inline space="sm" wrap>
                                    <NumberStepper
                                        testID={`${rowTestId}-energy-min`}
                                        id={`${rowTestId}-energy-min`}
                                        label={t('kitchen:plans.energyMinLabel')}
                                        unit={t('kitchen:plans.energyUnit')}
                                        min={0}
                                        step={50}
                                        disabled={!canManage}
                                        value={row.energyMin}
                                        onChange={(next) => {
                                            patch({ energyMin: next });
                                        }}
                                    />
                                    <NumberStepper
                                        testID={`${rowTestId}-energy-max`}
                                        id={`${rowTestId}-energy-max`}
                                        label={t('kitchen:plans.energyMaxLabel')}
                                        unit={t('kitchen:plans.energyUnit')}
                                        min={0}
                                        step={50}
                                        disabled={!canManage}
                                        value={row.energyMax}
                                        onChange={(next) => {
                                            patch({ energyMax: next });
                                        }}
                                    />
                                </Inline>

                                <Checkbox
                                    testID={`${rowTestId}-active`}
                                    id={`${rowTestId}-active`}
                                    checked={row.isActive}
                                    disabled={!canManage}
                                    label={t('kitchen:plans.variantActiveLabel')}
                                    description={t('kitchen:plans.variantActiveHint')}
                                    onChange={(next) => {
                                        patch({ isActive: next });
                                    }}
                                />

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
        </Stack>
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
 * How long a plan runs, one row per option.
 *
 * ## The `CHECK`, enforced while it is being typed
 *
 * `plan_durations` carries it: **a one-off duration has no day count, and a fixed-days duration has
 * a positive one**. The contract states it once as `isPlanDurationConsistent`, the store refuses a
 * write that breaks it, and this editor makes it unreachable through the controls — switching a row
 * to `one_off` clears the count *and takes the field away* in the same gesture, and switching back
 * leaves the row incomplete until a positive number is typed.
 *
 * The field is **removed rather than disabled**, exactly as the price editor's amount is, and for
 * the same two reasons: a greyed box invites the reading "you cannot type here *yet*", when the
 * truth is that this row has no day count and cannot acquire one without changing what kind of
 * duration it is — and a `readOnly` input at the disabled opacity fails the contrast ratio axe holds
 * every active control to.
 *
 * ## The discount is `null` until somebody decides, and never `0` to mean that
 *
 * "Not set" and "no discount" are different facts, and the row keeps them apart: an empty field is
 * `null` on the wire, and a typed `0` is a decision that this commitment earns nothing — which is
 * exactly what a one-week commitment earns in the seeded catalogue. The row says which of the two it
 * is holding rather than leaving a blank box to be read either way.
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
        <Stack space="md" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:plans.durationsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
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
                        <RowShell
                            key={row.key}
                            testID={rowTestId}
                            title={t('kitchen:plans.durationNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                <Badge
                                    testID={`${rowTestId}-badge`}
                                    tone={row.discountPercent === null ? 'neutral' : 'info'}
                                    label={
                                        row.discountPercent === null
                                            ? t('kitchen:plans.discountNotSet')
                                            : t('kitchen:plans.discountValue', {
                                                  percent: row.discountPercent,
                                              })
                                    }
                                />
                            }
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
                                {/*
                                 * A segmented control rather than a select: two mutually exclusive
                                 * values, both of which have to be *visible* at once, because "why
                                 * does this row have no day count?" is answered by seeing that
                                 * `one_off` exists and is the one that is chosen.
                                 */}
                                <Stack space="xs">
                                    <Text variant="label" testID={`${rowTestId}-kind-label`}>
                                        {t('kitchen:plans.kindLabel')}
                                    </Text>
                                    <SegmentedControl<PlanDurationKind>
                                        testID={`${rowTestId}-kind`}
                                        label={t('kitchen:plans.kindLabel')}
                                        block
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
                                </Stack>

                                {carriesDays ? (
                                    <NumberStepper
                                        testID={`${rowTestId}-days`}
                                        id={`${rowTestId}-days`}
                                        label={t('kitchen:plans.daysLabel')}
                                        hint={t('kitchen:plans.daysHint')}
                                        unit={t('kitchen:plans.daysUnit')}
                                        min={1}
                                        required
                                        disabled={!canManage}
                                        value={row.days}
                                        {...(error === undefined ? {} : { error })}
                                        onChange={(next) => {
                                            patch({ days: next });
                                        }}
                                    />
                                ) : (
                                    <Stack space="none" testID={`${rowTestId}-days-absent`}>
                                        <Text variant="label">{t('kitchen:plans.daysLabel')}</Text>
                                        <Text tone="secondary" variant="caption">
                                            {t('kitchen:plans.daysAbsentHint')}
                                        </Text>
                                    </Stack>
                                )}

                                <NumberStepper
                                    testID={`${rowTestId}-discount`}
                                    id={`${rowTestId}-discount`}
                                    label={t('kitchen:plans.discountLabel')}
                                    hint={t('kitchen:plans.discountHint')}
                                    unit={t('kitchen:plans.discountUnit')}
                                    min={0}
                                    max={100}
                                    disabled={!canManage}
                                    value={row.discountPercent}
                                    onChange={(next) => {
                                        patch({ discountPercent: next });
                                    }}
                                />

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

                                {/*
                                 * A row can be wrong for a reason the day field cannot carry — a
                                 * duplicate option, or a one-off row that is a second one-off — and
                                 * a one-off row has no day field to hang the message on at all.
                                 */}
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
                            </Stack>
                        </RowShell>
                    );
                })
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
        </Stack>
    );
}

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
