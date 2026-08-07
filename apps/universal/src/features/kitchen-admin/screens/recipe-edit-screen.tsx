import { isValidationFailure } from '@healthy360/api-client/contracts';
import type {
    IngredientAdmin,
    LocalisedText,
    RecipeAdmin,
    RecipeLineInput,
    RecipeRollupDraft,
    RecipeVersionAdmin,
    RecipeVersionSummary,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useBreakpoint,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    ingredientsFromPages,
    useCreateRecipeMutation,
    useIngredientsQuery,
    useOpenRecipeDraftMutation,
    usePublishRecipeMutation,
    useRecipeQuery,
    useRecipeRollupQuery,
    useRetireRecipeMutation,
    useSetRecipeLinesMutation,
    useSetRecipeOutputsMutation,
    useSetRecipeStepsMutation,
    useUpdateRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    UNIT_DIMENSIONS,
    displayName,
    isTranslationIncomplete,
    parseQuantity,
    statusKey,
    statusTone,
    unitDimension,
    unitDimensionKey,
    unitKey,
} from '../format.ts';
import { RecipeLineEditor, RecipeOutputEditor, RecipeStepEditor } from '../recipe-row-editors.tsx';
import type { LineDraft, OutputDraft, StepDraft } from '../recipe-row-editors.tsx';
import { RecipeRollupPanel } from '../recipe-rollup-panel.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/recipes/{recipe}` — the recipe and version editor.
 *
 * ## Two panes, because the two halves answer each other
 *
 * The left pane is the formulation a person is writing; the right is what it would *declare* — the
 * allergen label, the cost, the facts. They belong side by side above `lg` because the second is the
 * consequence of the first, and an editor that made you scroll to find out what you had just done
 * would be an editor nobody checked. Below `lg` the preview stacks under the lines rather than
 * hiding behind a tab: the label is not supplementary.
 *
 * ## One save, several writes, and the lock version rebases between them
 *
 * The contract splits a version into four writes — `updateRecipe` for the recipe fields and the
 * version's yield, then a wholesale setter each for lines, outputs and steps. Each answers with the
 * whole `RecipeAdmin` at its **new** lock version, so the save runs them in sequence and carries the
 * version forward from one answer to the next. Doing anything else would make the second write of
 * every save collide with the first.
 *
 * Only the dirty sections are written. That is not an optimisation: every write is an audited act
 * server-side, and a save that rewrote an untouched method would put a false entry in the log.
 *
 * ## A published version is immutable, and the editor says so rather than pretending
 *
 * Editing a published version does not change it: the server opens the next draft and the edit lands
 * there (plan §4.7). So this screen never presents a published version as editable. It renders it
 * read-only with one control — "create a new draft from this version" — which is the only thing that
 * can actually happen next, and which is why every setter on the contract answers with the recipe
 * rather than with the version the caller thought it was editing.
 *
 * **Contract gap, stated where it bites.** There is no `getRecipeVersion`. `RecipeAdmin` carries the
 * *current* version in full and every other one as a summary, so selecting an older version in the
 * picker shows what a summary can show — its number, its state, when it was published — and says
 * plainly that its lines cannot be loaded. Rendering an empty ingredient list there would be a lie
 * with a heading on it.
 *
 * ## Costs are confidential
 *
 * `CostAmount` exists on this contract and on no other (plan §4.8). Every figure derived from it is
 * labelled on this screen, because an unlabelled purchase cost is one copy-paste from a customer.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly yieldQuantity: string;
    readonly yieldUnit: MeasureUnit;
    readonly yieldPieces: string;
    readonly wastePercent: string;
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    yieldQuantity: '1',
    yieldUnit: 'portion',
    yieldPieces: '',
    wastePercent: '0',
};

function detailsFrom(recipe: RecipeAdmin): DetailsDraft {
    const version = recipe.currentVersion;
    return {
        name: recipe.name,
        description: recipe.description,
        yieldQuantity: String(version.yieldQuantity),
        yieldUnit: version.yieldUnit,
        yieldPieces: version.yieldPieces === null ? '' : String(version.yieldPieces),
        wastePercent: String(version.wastePercent),
    };
}

function linesFrom(version: RecipeVersionAdmin): readonly LineDraft[] {
    return version.lines.map((line, index) => ({
        key: `line-${String(index + 1)}`,
        ingredientId: line.ingredientId,
        quantity: String(line.quantity),
        unit: line.unit,
        note: line.sourceDesignation ?? '',
        isOptional: line.isOptional,
    }));
}

function outputsFrom(version: RecipeVersionAdmin): readonly OutputDraft[] {
    return version.outputs.map((output, index) => ({
        key: `output-${String(index + 1)}`,
        ingredientId: output.ingredientId,
        quantity: String(output.quantity),
        unit: output.unit,
    }));
}

function primaryKeyFrom(version: RecipeVersionAdmin): string | null {
    const index = version.outputs.findIndex((output) => output.isPrimary);
    return index < 0 ? null : `output-${String(index + 1)}`;
}

function stepsFrom(version: RecipeVersionAdmin): readonly StepDraft[] {
    return version.steps.map((step, index) => ({
        key: `step-${String(index + 1)}`,
        instruction: step.instruction,
        minutes: step.minutes === null ? '' : String(step.minutes),
    }));
}

/** The lines that are complete enough to send. Incomplete rows block the save instead. */
function lineInputsFrom(rows: readonly LineDraft[]): readonly RecipeLineInput[] {
    return rows.flatMap((row) => {
        const quantity = parseQuantity(row.quantity);
        if (row.ingredientId === null || quantity === null) return [];
        return [
            {
                ingredientId: row.ingredientId,
                quantity,
                unit: row.unit,
                ...(row.note.trim() === '' ? {} : { sourceDesignation: row.note.trim() }),
                isOptional: row.isOptional,
            },
        ];
    });
}

/* ------------------------------------------------------------------------------------------------
 * The debounce policy
 * ---------------------------------------------------------------------------------------------- */

/** Long enough that typing "1250" is one request, short enough to feel like a consequence. */
const ROLLUP_DEBOUNCE_MS = 400;

/**
 * The draft the preview actually runs against.
 *
 * Two speeds, because two kinds of edit deserve two answers. A quantity being *typed* is a stream of
 * intermediate values — `1`, `12`, `125`, `1250` — and previewing each of them would be four
 * requests to show three numbers nobody meant. Adding, removing, reordering or re-uniting a line is
 * a completed decision, and waiting four hundred milliseconds to acknowledge it feels broken.
 *
 * So the *structure* of the line set (which ingredients, in which order, in which units) is compared
 * on every change: different structure runs at once, same structure waits. The policy lives here
 * rather than in the query hook because only the editor knows which edit just happened.
 */
function useDebouncedRollupDraft(draft: RecipeRollupDraft | null): RecipeRollupDraft | null {
    const structure =
        draft === null
            ? 'none'
            : JSON.stringify(draft.lines.map((line) => [String(line.ingredientId), line.unit]));

    const [settled, setSettled] = useState<RecipeRollupDraft | null>(draft);
    const [appliedStructure, setAppliedStructure] = useState<string | null>(null);

    // Adjusted during render rather than in an effect: this is the "immediate" half of the policy,
    // and React's own answer to deriving state from new input. An effect would paint one frame with
    // the previous structure's figures still undimmed, which is exactly the wrong frame to paint.
    if (appliedStructure !== structure) {
        setAppliedStructure(structure);
        setSettled(draft);
    }

    // `draft` is memoised by the caller on its own contents, so it is a legitimate dependency: the
    // timer restarts exactly when the draft changes and never merely because a sibling piece of
    // state did.
    useEffect(() => {
        if (appliedStructure !== structure) return;
        const timer = setTimeout(() => {
            setSettled(draft);
        }, ROLLUP_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [draft, structure, appliedStructure]);

    return settled;
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly recipe: string | undefined;
}

export function RecipeEditScreen({ recipe }: RecipeEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-recipe-editor"
        >
            <RecipeEditor recipe={recipe} />
        </Gate>
    );
}

function RecipeEditor({ recipe }: RecipeEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const { atLeast } = useBreakpoint();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = recipe === undefined || recipe === 'new';
    const parsed = isCreating ? null : RecipeId.safeParse(recipe);

    const record = useRecipeQuery(parsed);
    const ingredientsPage = useIngredientsQuery({ limit: 100 });
    const ingredients: readonly IngredientAdmin[] = ingredientsFromPages(
        ingredientsPage.data?.pages,
    );

    const create = useCreateRecipeMutation();
    const update = useUpdateRecipeMutation();
    const setLines = useSetRecipeLinesMutation();
    const setOutputs = useSetRecipeOutputsMutation();
    const setSteps = useSetRecipeStepsMutation();
    const publish = usePublishRecipeMutation();
    const retire = useRetireRecipeMutation();
    const openDraft = useOpenRecipeDraftMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [lines, setLinesDraft] = useState<readonly LineDraft[]>([]);
    const [outputs, setOutputsDraft] = useState<readonly OutputDraft[]>([]);
    const [primaryKey, setPrimaryKey] = useState<string | null>(null);
    const [steps, setStepsDraft] = useState<readonly StepDraft[]>([]);

    const [hydratedKey, setHydratedKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);
    const [linesDirty, setLinesDirty] = useState(false);
    const [outputsDirty, setOutputsDirty] = useState(false);
    const [stepsDirty, setStepsDirty] = useState(false);

    const [rowOrdinal, setRowOrdinal] = useState(1);
    const [selectedVersionId, setSelectedVersionId] = useState<RecipeVersionId | null>(null);
    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;
    const anyDirty = detailsDirty || linesDirty || outputsDirty || stepsDirty;

    /*
     * One rehydration key for the whole record rather than one per section.
     *
     * The ingredient editor could keep two sections independently rebased because its two writes are
     * independent. Here they are not: `setRecipeLines` against a published version *opens a new
     * version*, so the steps a person is looking at may now belong to a different row entirely.
     * Rebasing the untouched sections together is the only reading that stays true.
     */
    if (data !== undefined && serverKey !== hydratedKey && !anyDirty) {
        setHydratedKey(serverKey);
        setDetails(detailsFrom(data));
        setLinesDraft(linesFrom(data.currentVersion));
        setOutputsDraft(outputsFrom(data.currentVersion));
        setPrimaryKey(primaryKeyFrom(data.currentVersion));
        setStepsDraft(stepsFrom(data.currentVersion));
    }

    const nextKey = useCallback((): string => {
        const key = `row-${String(rowOrdinal)}`;
        setRowOrdinal((current) => current + 1);
        return key;
    }, [rowOrdinal]);

    const markDirty = (section: 'details' | 'lines' | 'outputs' | 'steps') => {
        if (section === 'details') setDetailsDirty(true);
        if (section === 'lines') setLinesDirty(true);
        if (section === 'outputs') setOutputsDirty(true);
        if (section === 'steps') setStepsDirty(true);
        guard.markDirty();
    };

    const settle = () => {
        setDetailsDirty(false);
        setLinesDirty(false);
        setOutputsDirty(false);
        setStepsDirty(false);
        guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setLinesDirty(false);
        setOutputsDirty(false);
        setStepsDirty(false);
        setHydratedKey(null);
        setSaveError(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── the version being looked at ─────────────────────────────────────────────────────────── */

    const versions: readonly RecipeVersionSummary[] = data?.versions ?? [];
    const currentVersion = data?.currentVersion ?? null;
    const selected =
        selectedVersionId === null
            ? (versions.find((version) => version.isCurrent) ?? null)
            : (versions.find((version) => version.id === selectedVersionId) ?? null);
    const isViewingCurrent = selected === null || selected.isCurrent;
    const versionStatus = currentVersion?.status ?? 'draft';
    const isEditable =
        isViewingCurrent && (versionStatus === 'draft' || versionStatus === 'review_required');

    /* ── the roll-up preview ─────────────────────────────────────────────────────────────────── */

    const servings = parseQuantity(details.yieldQuantity) ?? 1;
    const wastePercent = parseQuantity(details.wastePercent) ?? 0;
    const lineInputs = useMemo(() => lineInputsFrom(lines), [lines]);

    const liveDraft: RecipeRollupDraft | null = useMemo(
        () =>
            lineInputs.length === 0
                ? null
                : {
                      recipeId: data?.id ?? null,
                      servings: servings > 0 ? servings : 1,
                      wastePercent,
                      lines: lineInputs,
                  },
        [data?.id, servings, wastePercent, lineInputs],
    );

    const previewDraft = useDebouncedRollupDraft(liveDraft);
    const rollup = useRecipeRollupQuery(previewDraft);
    const rollupFailure = toFailure(rollup.error);

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            UNIT_DIMENSIONS.flatMap((dimension) =>
                MEASURE_UNITS.filter((unit) => unitDimension(unit) === dimension).map((unit) => ({
                    value: unit,
                    label: t(unitKey(unit)),
                    description: t(unitDimensionKey(dimension)),
                })),
            ),
        [t],
    );

    /* ── readiness ───────────────────────────────────────────────────────────────────────────── */

    const incompleteLines = lines.filter(
        (row) => row.ingredientId === null || parseQuantity(row.quantity) === null,
    );
    const incompleteOutputs = outputs.filter(
        (row) => row.ingredientId === null || parseQuantity(row.quantity) === null,
    );
    const incompleteSteps = steps.filter((row) => row.instruction.en.trim() === '');
    const primaryMissing = outputs.length > 0 && primaryKey === null;
    const nameMissing = details.name.en.trim() === '';
    const yieldInvalid = parseQuantity(details.yieldQuantity) === null || servings <= 0;

    const saveBlocked =
        !canManage ||
        nameMissing ||
        yieldInvalid ||
        incompleteLines.length > 0 ||
        incompleteOutputs.length > 0 ||
        incompleteSteps.length > 0 ||
        primaryMissing;

    /**
     * Everything that stands between this version and a published label.
     *
     * Split into two lists on purpose. *Blocking* items are ones where publishing would state
     * something untrue — no formulation at all, an untranslated name a consumer surface would have
     * to fall back on, a label derived from an ingredient that is itself quarantined or withdrawn.
     * The *unmapped* list is different in kind: an ingredient with no allergen mapping is either
     * genuinely free of all fourteen or has never been checked, and this contract cannot tell those
     * two apart. Blocking on it would make every honest olive oil unpublishable; saying nothing
     * would let an unchecked one onto a label. So it is stated, named ingredient by named
     * ingredient, each linked to the editor where the determination is recorded.
     */
    const publishBlockers = useMemo(() => {
        if (data === null || data === undefined) return [] as readonly string[];
        const reasons: string[] = [];
        if (data.currentVersion.lines.length === 0) reasons.push(t('kitchen:publish.blockNoLines'));
        if (isTranslationIncomplete(data.name)) reasons.push(t('kitchen:publish.blockName'));
        if (isTranslationIncomplete(data.description)) {
            reasons.push(t('kitchen:publish.blockDescription'));
        }
        if (anyDirty) reasons.push(t('kitchen:publish.blockUnsaved'));

        const unsafe = data.currentVersion.lines
            .map((line) => ingredients.find((entry) => entry.id === line.ingredientId))
            .filter(
                (entry): entry is IngredientAdmin =>
                    entry !== undefined &&
                    (entry.meta.status === 'review_required' || entry.meta.status === 'retired'),
            );
        for (const entry of unsafe) {
            reasons.push(
                t('kitchen:publish.blockIngredientState', {
                    name: displayName(entry.name, locale).value,
                    status: t(statusKey(entry.meta.status)),
                }),
            );
        }
        return reasons;
    }, [data, anyDirty, ingredients, locale, t]);

    const unmappedIngredients = useMemo(() => {
        if (data === null || data === undefined) return [] as readonly IngredientAdmin[];
        const seen = new Set<string>();
        const rows: IngredientAdmin[] = [];
        for (const line of data.currentVersion.lines) {
            const entry = ingredients.find((candidate) => candidate.id === line.ingredientId);
            if (entry === undefined || entry.allergens.length > 0) continue;
            if (seen.has(String(entry.id))) continue;
            seen.add(String(entry.id));
            rows.push(entry);
        }
        return rows;
    }, [data, ingredients]);

    const quarantined = data?.meta.status === 'review_required';
    const completenessDone =
        publishBlockers.length === 0 && data !== undefined && data.currentVersion.lines.length > 0;

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveAll = () => {
        if (saveBlocked) return;
        setSaveError(null);

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    description: details.description,
                    yieldQuantity: servings,
                    yieldUnit: details.yieldUnit,
                    ...(parseQuantity(details.yieldPieces) === null
                        ? {}
                        : { yieldPieces: parseQuantity(details.yieldPieces)! }),
                    wastePercent,
                },
                {
                    onSuccess: (created) => {
                        settle();
                        toast.show({
                            testID: 'kitchen-recipe-created-toast',
                            tone: 'success',
                            message: t('kitchen:recipes.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`/kitchen/recipes/${String(created.id)}` as never);
                    },
                    onError: (error) => {
                        setSaveError(toFailure(error)?.message ?? null);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        const recipeId = data.id;

        const run = async () => {
            let lockVersion = data.meta.lockVersion;

            if (detailsDirty) {
                const answer = await update.mutateAsync({
                    recipeId,
                    request: {
                        lockVersion,
                        name: details.name,
                        description: details.description,
                        yieldQuantity: servings,
                        yieldUnit: details.yieldUnit,
                        yieldPieces: parseQuantity(details.yieldPieces),
                        wastePercent,
                    },
                });
                lockVersion = answer.meta.lockVersion;
            }

            if (linesDirty) {
                const answer = await setLines.mutateAsync({
                    recipeId,
                    request: { lockVersion, lines: lineInputsFrom(lines) },
                });
                lockVersion = answer.meta.lockVersion;
            }

            if (outputsDirty) {
                const answer = await setOutputs.mutateAsync({
                    recipeId,
                    request: {
                        lockVersion,
                        outputs: outputs.flatMap((row) => {
                            const quantity = parseQuantity(row.quantity);
                            if (row.ingredientId === null || quantity === null) return [];
                            return [
                                {
                                    ingredientId: row.ingredientId,
                                    quantity,
                                    unit: row.unit,
                                    isPrimary: row.key === primaryKey,
                                },
                            ];
                        }),
                    },
                });
                lockVersion = answer.meta.lockVersion;
            }

            if (stepsDirty) {
                await setSteps.mutateAsync({
                    recipeId,
                    request: {
                        lockVersion,
                        steps: steps.map((row) => ({
                            instruction: row.instruction,
                            minutes: parseQuantity(row.minutes),
                        })),
                    },
                });
            }
        };

        void run().then(
            () => {
                settle();
                toast.show({
                    testID: 'kitchen-recipe-saved-toast',
                    tone: 'success',
                    message: t('kitchen:recipes.savedToast'),
                });
            },
            (error: unknown) => {
                if (concurrency.capture(error)) return;
                setSaveError(toFailure(error)?.message ?? t('kitchen:recipes.saveFailed'));
            },
        );
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-recipe-editor-screen">
                <Callout
                    testID="kitchen-recipe-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:recipes.notFoundTitle')}
                    body={t('kitchen:recipes.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-recipe-not-found-back"
                            variant="quiet"
                            label={t('kitchen:recipes.backToList')}
                            onPress={() => {
                                router.push('/kitchen/recipes' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-recipe-editor-loading">
                <Skeleton testID="kitchen-recipe-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-recipe-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-recipe-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-recipe-editor-screen">
                <ErrorState
                    testID="kitchen-recipe-load-error"
                    failure={loadFailure}
                    title={t('kitchen:recipes.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishQuarantined = Object.keys(publishFields).includes('status');

    const rollupPanel = (
        <RecipeRollupPanel
            testID="kitchen-recipe-rollup"
            preview={rollup.data}
            isRefreshing={rollup.isPlaceholderData && rollup.isFetching}
            isPending={rollup.isPending && previewDraft !== null}
            failureMessage={rollupFailure?.message ?? null}
            isEmpty={previewDraft === null}
            servings={servings}
            ingredients={ingredients}
        />
    );

    return (
        <EditorFrame
            testID="kitchen-recipe-editor-screen"
            title={
                isCreating
                    ? t('kitchen:recipes.createTitle')
                    : displayName(data?.name ?? { en: '', ar: '' }, locale).value
            }
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveAll}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={
                create.isPending ||
                update.isPending ||
                setLines.isPending ||
                setOutputs.isPending ||
                setSteps.isPending
            }
            saveDisabled={saveBlocked || !isEditable}
            backLabel={t('kitchen:recipes.backToList')}
            onBack={() => {
                router.push('/kitchen/recipes' as never);
            }}
            primaryAction={
                isCreating || !canManage ? null : (
                    <Inline space="sm" wrap>
                        {data?.meta.status === 'published' ? (
                            <Button
                                testID="kitchen-recipe-retire"
                                variant="secondary"
                                label={t('kitchen:recipes.retire')}
                                onPress={() => {
                                    setShowRetire(true);
                                }}
                            />
                        ) : null}
                        {isEditable ? (
                            <Button
                                testID="kitchen-recipe-publish"
                                variant="secondary"
                                label={t('kitchen:publish.action')}
                                onPress={() => {
                                    setShowPublish(true);
                                }}
                            />
                        ) : null}
                    </Inline>
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-recipe-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}
                    {saveError === null ? null : (
                        <Callout
                            testID="kitchen-recipe-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:recipes.saveErrorTitle')}
                            body={saveError}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── the record ───────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-recipe-details" padding="md">
                <Stack space="md">
                    <Inline space="sm" align="center" justify="between" wrap>
                        <Heading level={2}>{t('kitchen:recipes.sectionDetails')}</Heading>
                        <Badge
                            testID="kitchen-recipe-confidential"
                            tone="info"
                            icon="eyeOff"
                            label={t('kitchen:recipes.confidential')}
                        />
                    </Inline>

                    <Text tone="secondary" variant="caption">
                        {t('kitchen:recipes.confidentialHint')}
                    </Text>

                    <BilingualField
                        testID="kitchen-recipe-name"
                        fieldLabel={t('kitchen:fields.name')}
                        value={details.name}
                        requiredEnglish
                        {...(nameMissing
                            ? { englishError: t('kitchen:recipes.nameRequired') }
                            : {})}
                        onChange={(next) => {
                            setDetails({ ...details, name: next });
                            markDirty('details');
                        }}
                    />

                    <BilingualField
                        testID="kitchen-recipe-description"
                        fieldLabel={t('kitchen:recipes.descriptionLabel')}
                        multiline
                        value={details.description}
                        onChange={(next) => {
                            setDetails({ ...details, description: next });
                            markDirty('details');
                        }}
                    />

                    {isCreating || !canManage ? null : (
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-recipe-archive"
                                variant="secondary"
                                label={t('kitchen:recipes.archive')}
                                disabled={data?.meta.status === 'retired'}
                                onPress={() => {
                                    setShowRetire(true);
                                }}
                            />
                        </Inline>
                    )}
                </Stack>
            </Card>

            {/* ── yield ────────────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-recipe-yield" padding="md">
                <Stack space="md">
                    <Stack space="xs">
                        <Heading level={2}>{t('kitchen:recipes.sectionYield')}</Heading>
                        <Text tone="secondary">{t('kitchen:recipes.yieldDescription')}</Text>
                    </Stack>

                    <Inline space="sm" align="start" wrap>
                        <Stack space="none" grow>
                            <TextInputField
                                testID="kitchen-recipe-yield-quantity"
                                id="kitchen-recipe-yield-quantity"
                                label={t('kitchen:recipes.yieldQuantity')}
                                hint={t('kitchen:recipes.lineQuantityHint')}
                                value={details.yieldQuantity}
                                inputMode="decimal"
                                keyboardType="numeric"
                                autoCorrect={false}
                                disabled={!canManage || !isEditable}
                                {...(yieldInvalid
                                    ? { error: t('kitchen:recipes.yieldRequired') }
                                    : {})}
                                onChangeText={(next) => {
                                    setDetails({ ...details, yieldQuantity: next });
                                    markDirty('details');
                                }}
                            />
                        </Stack>
                        <Stack space="none" grow>
                            <Select
                                testID="kitchen-recipe-yield-unit"
                                id="kitchen-recipe-yield-unit"
                                label={t('kitchen:recipes.yieldUnit')}
                                searchable
                                disabled={!canManage || !isEditable}
                                options={unitOptions}
                                value={details.yieldUnit}
                                onChange={(next) => {
                                    setDetails({ ...details, yieldUnit: next as MeasureUnit });
                                    markDirty('details');
                                }}
                            />
                        </Stack>
                    </Inline>

                    <Inline space="sm" align="start" wrap>
                        <Stack space="none" grow>
                            <TextInputField
                                testID="kitchen-recipe-yield-pieces"
                                id="kitchen-recipe-yield-pieces"
                                label={t('kitchen:recipes.yieldPieces')}
                                hint={t('kitchen:recipes.yieldPiecesHint')}
                                value={details.yieldPieces}
                                inputMode="numeric"
                                keyboardType="numeric"
                                autoCorrect={false}
                                disabled={!canManage || !isEditable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, yieldPieces: next });
                                    markDirty('details');
                                }}
                            />
                        </Stack>
                        <Stack space="none" grow>
                            <TextInputField
                                testID="kitchen-recipe-waste"
                                id="kitchen-recipe-waste"
                                label={t('kitchen:recipes.wastePercent')}
                                hint={t('kitchen:recipes.wastePercentHint')}
                                value={details.wastePercent}
                                inputMode="decimal"
                                keyboardType="numeric"
                                autoCorrect={false}
                                disabled={!canManage || !isEditable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, wastePercent: next });
                                    markDirty('details');
                                }}
                            />
                        </Stack>
                    </Inline>

                    <Badge
                        testID="kitchen-recipe-completeness"
                        tone={completenessDone ? 'success' : 'warning'}
                        icon={completenessDone ? 'check' : 'warning'}
                        label={
                            completenessDone
                                ? t('kitchen:recipes.completenessReady')
                                : t('kitchen:recipes.completenessOutstanding', {
                                      count: publishBlockers.length,
                                  })
                        }
                    />
                </Stack>
            </Card>

            {/* ── versions ─────────────────────────────────────────────────────────────────── */}
            {isCreating ? null : (
                <Card testID="kitchen-recipe-versions" padding="md">
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('kitchen:recipes.sectionVersions')}</Heading>
                            <Text tone="secondary">{t('kitchen:recipes.versionsDescription')}</Text>
                        </Stack>

                        <Stack space="sm" testID="kitchen-recipe-version-list">
                            {versions.map((version) => {
                                const rowTestId = `kitchen-recipe-version-${String(version.id)}`;
                                const isSelected = selected !== null && selected.id === version.id;
                                return (
                                    <Card
                                        key={String(version.id)}
                                        testID={rowTestId}
                                        padding="sm"
                                        tone={isSelected ? 'sunken' : 'default'}
                                    >
                                        <Inline space="sm" align="center" justify="between" wrap>
                                            <Inline space="sm" align="center" wrap>
                                                <Text variant="bodyStrong">
                                                    {t('kitchen:recipes.versionNumber', {
                                                        number: version.versionNumber,
                                                    })}
                                                </Text>
                                                <Badge
                                                    testID={`${rowTestId}-status`}
                                                    tone={statusTone(version.status)}
                                                    label={t(statusKey(version.status))}
                                                />
                                                {version.isCurrent ? (
                                                    <Badge
                                                        testID={`${rowTestId}-current`}
                                                        tone="info"
                                                        label={t('kitchen:recipes.currentVersion')}
                                                    />
                                                ) : null}
                                            </Inline>
                                            <Button
                                                testID={`${rowTestId}-select`}
                                                size="sm"
                                                variant={isSelected ? 'secondary' : 'ghost'}
                                                label={
                                                    isSelected
                                                        ? t('kitchen:recipes.versionSelected')
                                                        : t('kitchen:recipes.versionSelect')
                                                }
                                                onPress={() => {
                                                    setSelectedVersionId(version.id);
                                                }}
                                            />
                                        </Inline>
                                    </Card>
                                );
                            })}
                        </Stack>

                        {isViewingCurrent ? null : (
                            <Callout
                                testID="kitchen-recipe-version-unavailable"
                                role="note"
                                tone="info"
                                title={t('kitchen:recipes.versionUnavailableTitle')}
                                body={t('kitchen:recipes.versionUnavailableBody')}
                                actions={
                                    <Button
                                        testID="kitchen-recipe-version-back-to-current"
                                        size="sm"
                                        variant="quiet"
                                        label={t('kitchen:recipes.backToCurrentVersion')}
                                        onPress={() => {
                                            setSelectedVersionId(null);
                                        }}
                                    />
                                }
                            />
                        )}

                        {/*
                         * A published or retired version is immutable (plan §4.7). The one thing
                         * that can happen next is the successor draft, and this is the control that
                         * makes it — an `updateRecipe` carrying nothing but the lock version.
                         */}
                        {isViewingCurrent && !isEditable && canManage ? (
                            <Callout
                                testID="kitchen-recipe-immutable"
                                role="note"
                                tone="info"
                                title={t('kitchen:recipes.immutableTitle')}
                                body={t('kitchen:recipes.immutableBody')}
                                actions={
                                    <Button
                                        testID="kitchen-recipe-new-draft"
                                        label={t('kitchen:recipes.newDraftFromVersion')}
                                        loading={openDraft.isPending}
                                        onPress={() => {
                                            if (data === undefined) return;
                                            openDraft.mutate(
                                                {
                                                    recipeId: data.id,
                                                    request: {
                                                        lockVersion: data.meta.lockVersion,
                                                    },
                                                },
                                                {
                                                    onSuccess: (updated) => {
                                                        setSelectedVersionId(null);
                                                        toast.show({
                                                            testID: 'kitchen-recipe-draft-opened-toast',
                                                            tone: 'success',
                                                            message: t(
                                                                'kitchen:recipes.draftOpenedToast',
                                                                {
                                                                    number: updated.currentVersion
                                                                        .versionNumber,
                                                                },
                                                            ),
                                                        });
                                                    },
                                                    onError: (error) => {
                                                        concurrency.capture(error);
                                                    },
                                                },
                                            );
                                        }}
                                    />
                                }
                            />
                        ) : null}
                    </Stack>
                </Card>
            )}

            {/* ── the two panes ────────────────────────────────────────────────────────────── */}
            {isCreating ? (
                <Callout
                    testID="kitchen-recipe-create-hint"
                    role="note"
                    tone="info"
                    title={t('kitchen:recipes.createHintTitle')}
                    body={t('kitchen:recipes.createHintBody')}
                />
            ) : (
                /*
                 * The right pane is `self-start` rather than sticky: React Native has no
                 * `position: sticky` and a web-only override would make the two platforms behave
                 * differently at exactly the width where this layout matters. Aligning to the top
                 * keeps the panel beside the first lines, which is where the reading happens.
                 */
                <View testID="kitchen-recipe-panes" className="flex-col gap-4 lg:flex-row">
                    <View className="flex-1 gap-4">
                        <Card testID="kitchen-recipe-lines-card" padding="md">
                            <Stack space="md">
                                <Heading level={2}>{t('kitchen:recipes.sectionLines')}</Heading>
                                <RecipeLineEditor
                                    testID="kitchen-recipe-lines"
                                    rows={lines}
                                    ingredients={ingredients}
                                    canManage={canManage && isEditable}
                                    nextKey={nextKey}
                                    onChange={(next) => {
                                        setLinesDraft(next);
                                        markDirty('lines');
                                    }}
                                />
                            </Stack>
                        </Card>

                        <Card testID="kitchen-recipe-outputs-card" padding="md">
                            <Stack space="md">
                                <Heading level={2}>{t('kitchen:recipes.sectionOutputs')}</Heading>
                                <RecipeOutputEditor
                                    testID="kitchen-recipe-outputs"
                                    rows={outputs}
                                    primaryKey={primaryKey}
                                    ingredients={ingredients}
                                    canManage={canManage && isEditable}
                                    nextKey={nextKey}
                                    onChange={(next) => {
                                        setOutputsDraft(next);
                                        markDirty('outputs');
                                    }}
                                    onPrimaryChange={(next) => {
                                        setPrimaryKey(next);
                                        markDirty('outputs');
                                    }}
                                />
                            </Stack>
                        </Card>

                        <Card testID="kitchen-recipe-steps-card" padding="md">
                            <Stack space="md">
                                <Heading level={2}>{t('kitchen:recipes.sectionSteps')}</Heading>
                                <RecipeStepEditor
                                    testID="kitchen-recipe-steps"
                                    rows={steps}
                                    canManage={canManage && isEditable}
                                    nextKey={nextKey}
                                    onChange={(next) => {
                                        setStepsDraft(next);
                                        markDirty('steps');
                                    }}
                                />
                            </Stack>
                        </Card>
                    </View>

                    <View className={atLeast('lg') ? 'w-96 self-start' : 'w-full'}>
                        {rollupPanel}
                    </View>
                </View>
            )}

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-recipe-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:publish.title')}
                description={t('kitchen:publish.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-publish-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-recipe-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        recipeId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (published) => {
                                            setShowPublish(false);
                                            setSelectedVersionId(null);
                                            toast.show({
                                                testID: 'kitchen-recipe-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:publish.publishedToast', {
                                                    number: published.currentVersion.versionNumber,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text testID="kitchen-recipe-publish-consequence">
                        {t('kitchen:publish.consequence')}
                    </Text>

                    <Stack space="xs" testID="kitchen-recipe-publish-allergens">
                        <Text variant="label">{t('kitchen:publish.allergenRowsTitle')}</Text>
                        {currentVersion === null || currentVersion.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-recipe-publish-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:publish.allergenRowsNone')}
                            </Text>
                        ) : (
                            currentVersion.allergens.map((declaration) => (
                                <Text
                                    key={declaration.allergenCode}
                                    testID={`kitchen-recipe-publish-allergen-${String(declaration.allergenCode)}`}
                                    variant="caption"
                                >
                                    {t('kitchen:publish.allergenRow', {
                                        code: String(declaration.allergenCode),
                                        containment: t(
                                            declaration.containment === 'contains'
                                                ? 'kitchen:containment.contains'
                                                : 'kitchen:containment.mayContain',
                                        ),
                                        names: declaration.sourceIngredientIds
                                            .map((id) => {
                                                const found = ingredients.find(
                                                    (entry) => entry.id === id,
                                                );
                                                return found === undefined
                                                    ? String(id)
                                                    : displayName(found.name, locale).value;
                                            })
                                            .join(', '),
                                    })}
                                </Text>
                            ))
                        )}
                    </Stack>

                    {quarantined ? (
                        <Callout
                            testID="kitchen-recipe-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-recipe-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:publish.blockedTitle')}
                        >
                            <Stack space="none">
                                {publishBlockers.map((reason) => (
                                    <Text key={reason} variant="caption">
                                        {reason}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}

                    {unmappedIngredients.length === 0 ? null : (
                        <Callout
                            testID="kitchen-recipe-publish-allergen-unmapped"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.unmappedTitle')}
                            body={t('kitchen:publish.unmappedBody')}
                        >
                            <Inline space="xs" wrap>
                                {unmappedIngredients.map((entry) => (
                                    <Button
                                        key={String(entry.id)}
                                        testID={`kitchen-recipe-publish-unmapped-${String(entry.id)}`}
                                        size="sm"
                                        variant="ghost"
                                        label={displayName(entry.name, locale).value}
                                        onPress={() => {
                                            setShowPublish(false);
                                            guard.intercept(() => {
                                                router.push(
                                                    `/kitchen/ingredients/${String(entry.id)}` as never,
                                                );
                                            });
                                        }}
                                    />
                                ))}
                            </Inline>
                        </Callout>
                    )}

                    {publishFailure === null ? null : publishQuarantined ? (
                        <Callout
                            testID="kitchen-recipe-publish-refused-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={(publishFields.status ?? []).join(' ')}
                        />
                    ) : (
                        <Callout
                            testID="kitchen-recipe-publish-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:publish.failedTitle')}
                            body={publishFailure.message}
                        >
                            <Stack space="none">
                                {Object.entries(publishFields).map(([field, messages]) => (
                                    <Text
                                        key={field}
                                        testID={`kitchen-recipe-publish-field-${field}`}
                                        variant="caption"
                                    >
                                        {messages.join(' ')}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}
                </Stack>
            </Dialog>

            {/* ── retire ───────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-recipe-retire-dialog"
                open={showRetire}
                onClose={() => {
                    setShowRetire(false);
                }}
                title={t('kitchen:recipes.archiveTitle')}
                description={t('kitchen:recipes.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowRetire(false);
                            }}
                        />
                        <Button
                            testID="kitchen-recipe-retire-confirm"
                            variant="danger"
                            label={t('kitchen:recipes.archiveConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                retire.mutate(
                                    {
                                        recipeId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowRetire(false);
                                            toast.show({
                                                testID: 'kitchen-recipe-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:recipes.archivedToast', {
                                                    name: displayName(data.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {retire.error === null ? null : (
                    <Text testID="kitchen-recipe-retire-error" tone="danger">
                        {toFailure(retire.error)?.message ?? t('kitchen:recipes.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </EditorFrame>
    );
}
