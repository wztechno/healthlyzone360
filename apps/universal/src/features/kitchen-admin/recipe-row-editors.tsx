import type { IngredientAdmin, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Icon,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import type { IngredientId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BilingualField } from './bilingual-field.tsx';
import {
    displayName,
    humaniseCode,
    moveInList,
    unitDimensionKey,
    unitDimension,
    unitKey,
    unitsInDimension,
} from './format.ts';

/**
 * The three ordered-row editors of a recipe version: its lines, its outputs and its method.
 *
 * They live in one module because they share three mechanics that must not drift apart, and three
 * copies of "move a row" is how they would:
 *
 * 1. **Keys are stable and are never the array index.** A row keeps its identity across a move, a
 *    removal and an undo, so React keeps its input state and a screen reader keeps its focus. The
 *    *line number* a person reads is computed from the row's position in the current array — which
 *    is what "line 3" means — and never from a key or a stored ordinal.
 * 2. **Reordering is two buttons and an announcement, not a drag.** The design system has no
 *    accessible drag-and-drop and inventing one here would exclude every keyboard and screen-reader
 *    user from the one operation this editor is *for*. Move up / Move down work on every input
 *    device, and a `role="status"` region says where the row landed — "Tahini, moved to position 2
 *    of 5" — because a silent reorder is invisible to somebody who cannot see the list jump.
 * 3. **Removal is immediate and reversible.** No confirmation dialog: a line is cheap to retype and
 *    a modal on every removal makes a six-line recipe unbearable to edit. An undo control appears
 *    instead, restoring the row *to its old position* rather than appending it, which is the
 *    difference between an undo and a re-add.
 *
 * ## Duplicates are legal
 *
 * Nothing here collapses two lines that name the same ingredient. A sheet that lists olive oil
 * twice — once for the pan, once to finish — is describing two things, the schema has no unique
 * constraint per ingredient, and an editor that merged them would silently change the recipe.
 */

/* ------------------------------------------------------------------------------------------------
 * Shared shell
 * ---------------------------------------------------------------------------------------------- */

interface RowShellProps {
    readonly testID: string;
    readonly title: string;
    readonly position: number;
    readonly total: number;
    readonly canManage: boolean;
    readonly onMove: (to: number) => void;
    readonly onRemove: () => void;
    readonly badge?: ReactNode | undefined;
    readonly children: ReactNode;
}

function RowShell({
    testID,
    title,
    position,
    total,
    canManage,
    onMove,
    onRemove,
    badge,
    children,
}: RowShellProps) {
    const { t } = useTranslation();

    return (
        <Card testID={testID} padding="sm">
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Inline space="sm" align="center" wrap>
                        <Text variant="label" testID={`${testID}-position`}>
                            {title}
                        </Text>
                        {badge}
                    </Inline>

                    {canManage ? (
                        <Inline space="xs" wrap justify="end">
                            <Button
                                testID={`${testID}-move-up`}
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:recipes.moveUp')}
                                disabled={position <= 1}
                                onPress={() => {
                                    onMove(position - 2);
                                }}
                            />
                            <Button
                                testID={`${testID}-move-down`}
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:recipes.moveDown')}
                                disabled={position >= total}
                                onPress={() => {
                                    onMove(position);
                                }}
                            />
                            <Button
                                testID={`${testID}-remove`}
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:recipes.removeRow')}
                                onPress={onRemove}
                            />
                        </Inline>
                    ) : null}
                </Inline>

                {children}
            </Stack>
        </Card>
    );
}

/** The live region every row editor announces moves through. Polite: a move is not an emergency. */
function RowAnnouncer({ message, testID }: { readonly message: string; readonly testID: string }) {
    return (
        <Text testID={testID} role="status" aria-live="polite" variant="caption" tone="secondary">
            {message}
        </Text>
    );
}

interface UndoBarProps {
    readonly label: string;
    readonly onUndo: () => void;
    readonly testID: string;
}

function UndoBar({ label, onUndo, testID }: UndoBarProps) {
    const { t } = useTranslation();

    return (
        <Inline space="sm" align="center" wrap>
            <Text testID={`${testID}-removed`} variant="caption">
                {label}
            </Text>
            <Button
                testID={`${testID}-undo`}
                size="sm"
                variant="ghost"
                label={t('kitchen:common.undo')}
                onPress={onUndo}
            />
        </Inline>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Option lists
 * ---------------------------------------------------------------------------------------------- */

function useIngredientOptions(ingredients: readonly IngredientAdmin[]): readonly SelectOption[] {
    const { locale } = useLocale();

    return useMemo(
        () =>
            [...ingredients]
                .map((ingredient) => ({
                    value: String(ingredient.id),
                    label: displayName(ingredient.name, locale).value,
                    description:
                        ingredient.reference === null
                            ? humaniseCode(ingredient.categoryCode)
                            : `${humaniseCode(ingredient.categoryCode)} · ${ingredient.reference}`,
                }))
                .sort((left, right) => left.label.localeCompare(right.label, locale)),
        [ingredients, locale],
    );
}

/**
 * The units a line may be written in.
 *
 * Narrowed to the ingredient's own dimension, because conversion only happens within one (plan
 * §4.5): an ingredient issued in kilograms can be written in grams or kilograms, and offering
 * millilitres would produce a line the roll-up has to exclude and report. Until an ingredient is
 * chosen the dimension is unknown, so every unit is offered and the row says why.
 */
function unitOptionsFor(
    ingredient: IngredientAdmin | null,
    t: (key: string) => string,
): readonly SelectOption[] {
    const units: readonly MeasureUnit[] =
        ingredient === null ? MEASURE_UNITS : unitsInDimension(ingredient.measurementUnit);

    return units.map((unit) => ({
        value: unit,
        label: t(unitKey(unit)),
        description: t(unitDimensionKey(unitDimension(unit))),
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Lines
 * ---------------------------------------------------------------------------------------------- */

export interface LineDraft {
    /** Stable within the session. Never the array index, never random. */
    readonly key: string;
    readonly ingredientId: IngredientId | null;
    /** Held as typed text, not as a number — see `parseQuantity` in `./format.ts`. */
    readonly quantity: string;
    readonly unit: MeasureUnit;
    /** `sourceDesignation`: what the kitchen's own sheet called it, kept verbatim. */
    readonly note: string;
    readonly isOptional: boolean;
}

export interface LineEditorProps {
    readonly rows: readonly LineDraft[];
    readonly onChange: (rows: readonly LineDraft[]) => void;
    readonly ingredients: readonly IngredientAdmin[];
    readonly canManage: boolean;
    readonly nextKey: () => string;
    readonly testID: string;
}

export function RecipeLineEditor({
    rows,
    onChange,
    ingredients,
    canManage,
    nextKey,
    testID,
}: LineEditorProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const ingredientOptions = useIngredientOptions(ingredients);
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: LineDraft; index: number } | null>(null);

    const nameOf = (row: LineDraft): string => {
        const ingredient = ingredients.find((candidate) => candidate.id === row.ingredientId);
        return ingredient === undefined
            ? t('kitchen:recipes.unnamedLine')
            : displayName(ingredient.name, locale).value;
    };

    const move = (from: number, to: number) => {
        const next = moveInList(rows, from, to);
        if (next === rows) return;
        onChange(next);
        setAnnouncement(
            t('kitchen:recipes.movedAnnouncement', {
                name: nameOf(rows[from]!),
                position: to + 1,
                total: rows.length,
            }),
        );
    };

    return (
        <Stack space="md" testID={testID}>
            <Stack space="xs">
                <Text tone="secondary">{t('kitchen:recipes.linesDescription')}</Text>
            </Stack>

            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:recipes.linesEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const ingredient =
                        ingredients.find((candidate) => candidate.id === row.ingredientId) ?? null;
                    const patch = (next: Partial<LineDraft>) => {
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
                            title={t('kitchen:recipes.lineNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                row.isOptional ? (
                                    <Badge
                                        testID={`${rowTestId}-optional-badge`}
                                        tone="neutral"
                                        label={t('kitchen:recipes.optional')}
                                    />
                                ) : undefined
                            }
                            onMove={(to) => {
                                move(index, to);
                            }}
                            onRemove={() => {
                                setRemoved({ row, index });
                                onChange(rows.filter((entry) => entry.key !== row.key));
                            }}
                        >
                            <Select
                                testID={`${rowTestId}-ingredient`}
                                id={`${rowTestId}-ingredient`}
                                label={t('kitchen:recipes.lineIngredient')}
                                placeholder={t('kitchen:recipes.lineIngredientPlaceholder')}
                                searchable
                                required
                                disabled={!canManage}
                                options={ingredientOptions}
                                value={row.ingredientId === null ? null : String(row.ingredientId)}
                                onChange={(next) => {
                                    const chosen =
                                        ingredients.find(
                                            (candidate) => String(candidate.id) === next,
                                        ) ?? null;
                                    // Snapping the unit to the new ingredient's dimension is the
                                    // whole reason the picker is narrowed: leaving `ml` behind on
                                    // an ingredient issued in grams would keep a line the roll-up
                                    // has to exclude.
                                    const keepsUnit =
                                        chosen === null ||
                                        unitDimension(chosen.measurementUnit) ===
                                            unitDimension(row.unit);
                                    patch({
                                        ingredientId: next as IngredientId,
                                        ...(keepsUnit || chosen === null
                                            ? {}
                                            : { unit: chosen.measurementUnit }),
                                    });
                                }}
                            />

                            <Inline space="sm" align="start" wrap>
                                <Stack space="none" grow>
                                    <TextInputField
                                        testID={`${rowTestId}-quantity`}
                                        id={`${rowTestId}-quantity`}
                                        label={t('kitchen:recipes.lineQuantity')}
                                        hint={t('kitchen:recipes.lineQuantityHint')}
                                        value={row.quantity}
                                        inputMode="decimal"
                                        keyboardType="numeric"
                                        autoCorrect={false}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ quantity: next });
                                        }}
                                    />
                                </Stack>
                                <Stack space="none" grow>
                                    <Select
                                        testID={`${rowTestId}-unit`}
                                        id={`${rowTestId}-unit`}
                                        label={t('kitchen:recipes.lineUnit')}
                                        searchable
                                        disabled={!canManage}
                                        options={unitOptionsFor(ingredient, t)}
                                        value={row.unit}
                                        onChange={(next) => {
                                            patch({ unit: next as MeasureUnit });
                                        }}
                                    />
                                </Stack>
                            </Inline>

                            {ingredient === null ? (
                                <Text
                                    testID={`${rowTestId}-unit-warning`}
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {t('kitchen:recipes.lineUnitUnknownDimension')}
                                </Text>
                            ) : null}

                            <TextInputField
                                testID={`${rowTestId}-note`}
                                id={`${rowTestId}-note`}
                                label={t('kitchen:recipes.lineNote')}
                                hint={t('kitchen:recipes.lineNoteHint')}
                                value={row.note}
                                autoCorrect={false}
                                disabled={!canManage}
                                onChangeText={(next) => {
                                    patch({ note: next });
                                }}
                            />

                            <Button
                                testID={`${rowTestId}-optional`}
                                size="sm"
                                variant="ghost"
                                label={
                                    row.isOptional
                                        ? t('kitchen:recipes.markRequired')
                                        : t('kitchen:recipes.markOptional')
                                }
                                disabled={!canManage}
                                onPress={() => {
                                    patch({ isOptional: !row.isOptional });
                                }}
                            />
                        </RowShell>
                    );
                })
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={testID}
                    label={t('kitchen:recipes.lineRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}

            {canManage ? (
                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-add`}
                        variant="secondary"
                        iconStart={<Icon name="plus" />}
                        label={t('kitchen:recipes.addLine')}
                        onPress={() => {
                            setRemoved(null);
                            onChange([
                                ...rows,
                                {
                                    key: nextKey(),
                                    ingredientId: null,
                                    quantity: '',
                                    unit: 'g',
                                    note: '',
                                    isOptional: false,
                                },
                            ]);
                        }}
                    />
                </Inline>
            ) : null}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />

            <Text testID={`${testID}-count`} variant="caption" tone="secondary">
                {t('kitchen:recipes.lineCount', { count: rows.length })}
            </Text>
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Outputs
 * ---------------------------------------------------------------------------------------------- */

export interface OutputDraft {
    readonly key: string;
    readonly ingredientId: IngredientId | null;
    readonly quantity: string;
    readonly unit: MeasureUnit;
}

export interface OutputEditorProps {
    readonly rows: readonly OutputDraft[];
    readonly onChange: (rows: readonly OutputDraft[]) => void;
    /** The key of the primary output, or `null`. Exactly one, by construction — see below. */
    readonly primaryKey: string | null;
    readonly onPrimaryChange: (key: string | null) => void;
    readonly ingredients: readonly IngredientAdmin[];
    readonly canManage: boolean;
    readonly nextKey: () => string;
    readonly testID: string;
}

/**
 * What this version *produces* (plan §4.2).
 *
 * ## The primary output is one picker, not a checkbox per row
 *
 * "At most one may be primary" is a choice among the rows, and the design system has no radio group
 * outside `Select` — which is itself implemented as a modal radio group, so it is exactly the right
 * control. A checkbox per row would tell a screen reader that ticking it is independent of the
 * others, which is the opposite of what happens, and enforcing the rule afterwards would mean
 * rendering a state the contract rejects. Here the rule holds by construction: there is one answer,
 * and choosing a second one replaces the first.
 */
export function RecipeOutputEditor({
    rows,
    onChange,
    primaryKey,
    onPrimaryChange,
    ingredients,
    canManage,
    nextKey,
    testID,
}: OutputEditorProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const ingredientOptions = useIngredientOptions(ingredients);
    const [announcement, setAnnouncement] = useState('');

    const nameOf = (row: OutputDraft): string => {
        const ingredient = ingredients.find((candidate) => candidate.id === row.ingredientId);
        return ingredient === undefined
            ? t('kitchen:recipes.unnamedOutput')
            : displayName(ingredient.name, locale).value;
    };

    const primaryMissing = rows.length > 0 && primaryKey === null;

    return (
        <Stack space="md" testID={testID}>
            <Callout
                testID={`${testID}-explainer`}
                role="note"
                tone="info"
                title={t('kitchen:recipes.outputsExplainerTitle')}
                body={t('kitchen:recipes.outputsExplainerBody')}
            />

            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:recipes.outputsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const ingredient =
                        ingredients.find((candidate) => candidate.id === row.ingredientId) ?? null;
                    const patch = (next: Partial<OutputDraft>) => {
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
                            title={t('kitchen:recipes.outputNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                primaryKey === row.key ? (
                                    <Badge
                                        testID={`${rowTestId}-primary`}
                                        tone="success"
                                        icon="check"
                                        label={t('kitchen:recipes.primaryOutput')}
                                    />
                                ) : undefined
                            }
                            onMove={(to) => {
                                const next = moveInList(rows, index, to);
                                if (next === rows) return;
                                onChange(next);
                                setAnnouncement(
                                    t('kitchen:recipes.movedAnnouncement', {
                                        name: nameOf(row),
                                        position: to + 1,
                                        total: rows.length,
                                    }),
                                );
                            }}
                            onRemove={() => {
                                if (primaryKey === row.key) onPrimaryChange(null);
                                onChange(rows.filter((entry) => entry.key !== row.key));
                            }}
                        >
                            <Select
                                testID={`${rowTestId}-ingredient`}
                                id={`${rowTestId}-ingredient`}
                                label={t('kitchen:recipes.outputIngredient')}
                                placeholder={t('kitchen:recipes.lineIngredientPlaceholder')}
                                searchable
                                required
                                disabled={!canManage}
                                options={ingredientOptions}
                                value={row.ingredientId === null ? null : String(row.ingredientId)}
                                onChange={(next) => {
                                    patch({ ingredientId: next as IngredientId });
                                }}
                            />

                            <Inline space="sm" align="start" wrap>
                                <Stack space="none" grow>
                                    <TextInputField
                                        testID={`${rowTestId}-quantity`}
                                        id={`${rowTestId}-quantity`}
                                        label={t('kitchen:recipes.lineQuantity')}
                                        hint={t('kitchen:recipes.lineQuantityHint')}
                                        value={row.quantity}
                                        inputMode="decimal"
                                        keyboardType="numeric"
                                        autoCorrect={false}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ quantity: next });
                                        }}
                                    />
                                </Stack>
                                <Stack space="none" grow>
                                    <Select
                                        testID={`${rowTestId}-unit`}
                                        id={`${rowTestId}-unit`}
                                        label={t('kitchen:recipes.lineUnit')}
                                        searchable
                                        disabled={!canManage}
                                        options={unitOptionsFor(ingredient, t)}
                                        value={row.unit}
                                        onChange={(next) => {
                                            patch({ unit: next as MeasureUnit });
                                        }}
                                    />
                                </Stack>
                            </Inline>
                        </RowShell>
                    );
                })
            )}

            {rows.length === 0 ? null : (
                <Select
                    testID={`${testID}-primary`}
                    id={`${testID}-primary`}
                    label={t('kitchen:recipes.primaryOutputLabel')}
                    hint={t('kitchen:recipes.primaryOutputHint')}
                    placeholder={t('kitchen:recipes.primaryOutputPlaceholder')}
                    disabled={!canManage}
                    {...(primaryMissing
                        ? { error: t('kitchen:recipes.primaryOutputRequired') }
                        : {})}
                    options={rows.map((row, index) => ({
                        value: row.key,
                        label: nameOf(row),
                        description: t('kitchen:recipes.outputNumber', { number: index + 1 }),
                    }))}
                    value={primaryKey}
                    onChange={(next) => {
                        onPrimaryChange(next);
                    }}
                />
            )}

            {canManage ? (
                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-add`}
                        variant="secondary"
                        iconStart={<Icon name="plus" />}
                        label={t('kitchen:recipes.addOutput')}
                        onPress={() => {
                            onChange([
                                ...rows,
                                {
                                    key: nextKey(),
                                    ingredientId: null,
                                    quantity: '',
                                    unit: 'g',
                                },
                            ]);
                        }}
                    />
                </Inline>
            ) : null}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />

            <Text testID={`${testID}-count`} variant="caption" tone="secondary">
                {t('kitchen:recipes.outputCount', { count: rows.length })}
            </Text>
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------------------------------- */

export interface StepDraft {
    readonly key: string;
    readonly instruction: LocalisedText;
    readonly minutes: string;
}

export interface StepEditorProps {
    readonly rows: readonly StepDraft[];
    readonly onChange: (rows: readonly StepDraft[]) => void;
    readonly canManage: boolean;
    readonly nextKey: () => string;
    readonly testID: string;
}

/**
 * The method.
 *
 * Both languages per step, in their own writing directions, for the reason every admin record here
 * carries both: the person writing the method is responsible for both, and a form that hid one of
 * them could not be used to fix it (plan §4.18). `BilingualField` is composed rather than forked —
 * it already owns the per-field direction, the missing-Arabic marker and the copy-across control.
 */
export function RecipeStepEditor({ rows, onChange, canManage, nextKey, testID }: StepEditorProps) {
    const { t } = useTranslation();
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: StepDraft; index: number } | null>(null);

    return (
        <Stack space="md" testID={testID}>
            <Text tone="secondary">{t('kitchen:recipes.stepsDescription')}</Text>

            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:recipes.stepsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const patch = (next: Partial<StepDraft>) => {
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
                            title={t('kitchen:recipes.stepNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            onMove={(to) => {
                                const next = moveInList(rows, index, to);
                                if (next === rows) return;
                                onChange(next);
                                setAnnouncement(
                                    t('kitchen:recipes.movedAnnouncement', {
                                        name: t('kitchen:recipes.stepNumber', { number: position }),
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
                            <BilingualField
                                testID={`${rowTestId}-instruction`}
                                fieldLabel={t('kitchen:recipes.stepInstruction')}
                                multiline
                                value={row.instruction}
                                onChange={(next) => {
                                    patch({ instruction: next });
                                }}
                            />

                            <TextInputField
                                testID={`${rowTestId}-minutes`}
                                id={`${rowTestId}-minutes`}
                                label={t('kitchen:recipes.stepMinutes')}
                                hint={t('kitchen:recipes.stepMinutesHint')}
                                value={row.minutes}
                                inputMode="numeric"
                                keyboardType="numeric"
                                autoCorrect={false}
                                disabled={!canManage}
                                onChangeText={(next) => {
                                    patch({ minutes: next });
                                }}
                            />
                        </RowShell>
                    );
                })
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={testID}
                    label={t('kitchen:recipes.stepRemoved', { number: removed.index + 1 })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}

            {canManage ? (
                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-add`}
                        variant="secondary"
                        iconStart={<Icon name="plus" />}
                        label={t('kitchen:recipes.addStep')}
                        onPress={() => {
                            setRemoved(null);
                            onChange([
                                ...rows,
                                { key: nextKey(), instruction: { en: '', ar: '' }, minutes: '' },
                            ]);
                        }}
                    />
                </Inline>
            ) : null}

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />

            <Text testID={`${testID}-count`} variant="caption" tone="secondary">
                {t('kitchen:recipes.stepCount', { count: rows.length })}
            </Text>
        </Stack>
    );
}
