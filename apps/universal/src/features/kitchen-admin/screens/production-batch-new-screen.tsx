import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    FormGrid,
    FormSection,
    QuantityInput,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { IngredientAdmin, RecipeVersionAdmin } from '@healthy360/api-client/contracts';
import type { GridSpanProps, SelectOption } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useRecipeQuery,
    useRecipesQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { useCreateProductionOrderMutation } from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { PRODUCTION_MANAGE_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { displayName, statusKey, statusTone, unitShortKey } from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    BATCH_QUANTITY_FORMAT,
    BatchSheet,
    useBatchIngredients,
    useShelfAvailability,
} from '../operations/batch-sheet.tsx';
import type { ShelfAvailability } from '../operations/batch-sheet.tsx';
import { RecordFormOpening } from '../record-form-opening.tsx';
import { readNumber } from '../production-desk/completion-model.ts';

/**
 * `/kitchen/production-desk/new` — open a draft batch against a published recipe version (PROD1).
 *
 * ## One of the two scales, never both
 *
 * A batch is scaled either by what it should make (40 litres) or by how many times the recipe is
 * run (twice over). They determine each other through the version's own yield, so the server
 * derives whichever was not sent — and a client that did that conversion would be a second place
 * the arithmetic lives, drifting from the first the day a version's yield is edited.
 *
 * So the form asks which of the two the person is thinking in and sends exactly that one. The
 * segmented control is the question, not a pair of fields where filling both is a puzzle.
 *
 * ## A recipe is chosen by name; the published version is this screen's to find
 *
 * The endpoint takes a version identifier, and this screen used to ask for one as pasted text —
 * which meant leaving the page, opening the recipe editor and copying a uuid back. The picker asks
 * the question a kitchen actually has ("which recipe?") and resolves the rest.
 *
 * **The published version is rarely the current one.** Editing a published recipe opens a *new
 * draft* rather than changing it, so any recipe in active use carries a draft on top of the version
 * that is actually sellable. Reading `currentVersion` would therefore plan batches against drafts
 * on exactly the recipes a kitchen edits most. The published one is found in `versions` instead,
 * where a partial unique index — `recipe_versions_one_published_per_recipe` — guarantees at most
 * one, so there is no newest-of-several tie-break to invent here.
 *
 * Narrowing the list to published recipes was the other option and is worse: that filter reads the
 * *current* version's status, so it would hide precisely the edited recipes above rather than
 * showing them with their published version intact.
 *
 * ## One card, a preview under it, and a summary beside it
 *
 * ```
 * Plan a batch  [DRAFT]                                      [ Cancel ] [ Create batch ]
 * ⓘ Opens a draft against a published recipe version. A draft claims nothing — confirming it does.
 * ┌ BATCH ─────────────────────────────┐   ┌ SUMMARY ───────────┐
 * │ Recipe ▾                  (both)   │   │ Recipe · Version   │
 * │ Scale by [ Planned yield | Factor ]│   │ Runs · Makes       │
 * │ Planned yield ___ L                │   └────────────────────┘   beside from xl, under below
 * │ Notes                     (both)   │
 * └────────────────────────────────────┘
 * ┌ WHAT IT WILL CONSUME ─ Required · Available · Short · Position ┐
 * ```
 *
 * The form is the Operations design's `edProduction`: its fields on two 280px columns in one card,
 * and what the batch will consume under it, set against this branch's shelves by `BatchSheet`. Runs
 * and makes in the summary and the preview are for reading only — the request still sends the one
 * figure that was typed.
 *
 * The preview needs the published version's lines, and only the current version arrives with them.
 * Where a draft sits on top the preview says so rather than scaling the draft under the published
 * version's name.
 *
 * ## Arriving from the batch planner
 *
 * `?recipe=<id>&runs=<factor>` fills the recipe and the batch factor, so a plan never has to be
 * retyped to become a batch. Runs rather than a quantity: the planner scales by the version's yield
 * unit, this form counts in the output's, and a factor means the same on both pages.
 *
 * ## A draft claims nothing, and the page says so before anything is pressed
 *
 * Nothing is reserved until confirm. That matters enough to state on the way in: a person who
 * believes opening a batch has taken the flour will open fewer of them than they should, and a
 * person who believes it has *not* when it has will oversell the shelf.
 */

export function ProductionBatchNewScreen() {
    return (
        <Gate
            area="kitchen"
            /*
             * Two codes, because the picker reads the recipe book. A production manager without
             * `recipe.view_organisation` saw an empty dropdown and no way to proceed — the id field
             * that used to carry them is gone — so the gate states the requirement instead of the
             * screen half-working. `batch-planner-screen.tsx` demands the same pair for the same
             * reason.
             */
            requirement={{ allOf: [PRODUCTION_MANAGE_PERMISSION, RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-production-batch-new"
        >
            <ProductionBatchNew />
        </Gate>
    );
}

type Scale = 'yield' | 'factor';

function ProductionBatchNew() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const create = useCreateProductionOrderMutation();

    /*
     * Arriving from the batch planner: the recipe and the number of runs it was planned at. Read
     * once, as the initial state — the form is the person's from then on. Anything unreadable is
     * dropped rather than half-applied, so a mangled link opens an empty form, not a wrong one.
     */
    const params = useLocalSearchParams<{ readonly recipe?: string; readonly runs?: string }>();
    const handedRuns = (() => {
        const runs = typeof params.runs === 'string' ? readNumber(params.runs) : null;
        return runs !== null && runs > 0 ? params.runs : undefined;
    })();

    const [recipeId, setRecipeId] = useState<RecipeId | null>(() =>
        typeof params.recipe === 'string' ? RecipeId.safeParse(params.recipe) : null,
    );
    const [scale, setScale] = useState<Scale>(handedRuns === undefined ? 'yield' : 'factor');
    const [amount, setAmount] = useState(handedRuns ?? '');
    const [notes, setNotes] = useState('');
    const [submitted, setSubmitted] = useState(false);

    /*
     * One page of a hundred, filtered by the select's own search — the shape the recipe list is
     * already read in elsewhere. A kitchen with a longer book wants `query` pushed into the filter
     * and refetched as the reader types; the recipe list does exactly that and is the pattern.
     *
     * Deliberately unfiltered by status: see the note on the component about why narrowing to
     * published would hide the edited recipes rather than reveal them.
     */
    const recipes = useRecipesQuery({ limit: 100 });
    const recipeRows = recipesFromPages(recipes.data?.pages);

    const record = useRecipeQuery(recipeId);
    const recipe = record.data ?? null;

    const recipeOptions: readonly SelectOption[] = useMemo(
        () =>
            recipeRows.map((row) => ({
                value: String(row.id),
                // The reference and the status ride in the description because `Select`'s search
                // matches on both fields, which makes `RC-0001` a way to find a row as well as a
                // way to recognise one.
                label: displayName(row.name, locale).value,
                description: [row.reference, t(statusKey(row.meta.status))]
                    .filter((part): part is string => part !== null)
                    .join(' · '),
            })),
        [recipeRows, locale, t],
    );

    /** The one version a batch may be planned against, or `null` while unknown or absent. */
    const publishedVersion =
        recipe?.versions.find((version) => version.status === 'published') ?? null;

    /*
     * The unit the planned yield is counted in is the **output's**, not the version's yield unit —
     * `ProductionOrderService` stamps `planned_yield_unit_id` from the output row, and the batch
     * factor divides by the output's quantity. Outputs come back only for the current version, so
     * this is knowable exactly when the published version is the current one, which is the ordinary
     * case; where a draft sits on top the field says nothing rather than naming a unit it guessed.
     */
    const outputUnit =
        recipe !== null && recipe.currentVersion.status === 'published'
            ? ((
                  recipe.currentVersion.outputs.find((output) => output.isPrimary) ??
                  recipe.currentVersion.outputs[0]
              )?.unit ?? null)
            : null;

    const parsedAmount = readNumber(amount);
    const amountValid = parsedAmount !== null && parsedAmount > 0;
    const failure = toFailure(create.error);

    /*
     * The preview needs the published version's lines, and only the current version arrives with
     * lines. So it is drawn exactly when the two are one — the ordinary case — and where a draft
     * sits on top the page says so instead of scaling the draft's lines under the published name.
     */
    const previewVersion =
        recipe !== null &&
        publishedVersion !== null &&
        recipe.currentVersion.id === publishedVersion.id
            ? recipe.currentVersion
            : null;
    const primaryOutput =
        previewVersion === null
            ? null
            : (previewVersion.outputs.find((output) => output.isPrimary) ??
              previewVersion.outputs[0] ??
              null);

    /*
     * Runs and makes, for the summary and the preview only. The request still sends exactly the one
     * figure that was typed and lets the server derive the other; these are the same division the
     * server does (by the output's own quantity), shown so nobody has to create a draft to read them.
     */
    const runs: number | null = !amountValid
        ? null
        : scale === 'factor'
          ? parsedAmount
          : primaryOutput !== null && primaryOutput.quantity > 0
            ? parsedAmount / primaryOutput.quantity
            : null;
    const makes: number | null = !amountValid
        ? null
        : scale === 'yield'
          ? parsedAmount
          : primaryOutput === null
            ? null
            : parsedAmount * primaryOutput.quantity;

    const ingredients = useBatchIngredients(previewVersion);
    const availability = useShelfAvailability();

    /*
     * Why the recipe error is three states rather than one: "pick a recipe" and "this recipe has
     * nothing published" are different problems with different fixes, and a form that answered both
     * with the same sentence would send somebody back to the picker when what they need is the
     * publish button in the recipe editor. Loading is neither, and must not read as a refusal.
     */
    const recipeResolving = recipeId !== null && record.isPending;
    const recipeUnpublished = recipe !== null && publishedVersion === null;
    const recipeError =
        submitted && recipeId === null
            ? t('kitchen:ops.production.recipeRequired')
            : recipeUnpublished
              ? t('kitchen:ops.production.recipeUnpublished', {
                    name: displayName(recipe.name, locale).value,
                })
              : undefined;

    useKitchenTrailLeaf(t('kitchen:ops.production.newTitle'));

    if (branchId === null) {
        return (
            <EmptyState
                testID="kitchen-production-batch-new-no-branch"
                title={t('kitchen:ops.production.noBranchTitle')}
                body={t('kitchen:ops.production.noBranchBody')}
            />
        );
    }

    /*
     * What stops the create, each naming the field that fixes it. A recipe not yet chosen and an
     * amount not yet typed are blanks, named once the create is pressed; a recipe with nothing
     * published is named as soon as it is picked, because it was chosen, not left blank — the same
     * split `recipeError` above draws on the field itself.
     */
    const issues: readonly {
        readonly key: string;
        readonly label: string;
        readonly fieldId: string;
        readonly required: boolean;
    }[] = [
        ...(recipeId === null || recipeUnpublished
            ? [
                  {
                      key: 'recipe',
                      label: t('kitchen:ops.production.recipeLabel'),
                      fieldId: 'kitchen-production-batch-new-recipe',
                      required: recipeId === null,
                  },
              ]
            : []),
        ...(amountValid
            ? []
            : [
                  {
                      key: 'amount',
                      label: t(
                          scale === 'yield'
                              ? 'kitchen:ops.production.plannedYieldLabel'
                              : 'kitchen:ops.production.batchFactorLabel',
                      ),
                      fieldId: 'kitchen-production-batch-new-amount',
                      required: true,
                  },
              ]),
    ];
    const shownIssues = submitted ? issues : issues.filter((entry) => !entry.required);

    const submit = () => {
        setSubmitted(true);
        const first = issues[0];
        if (first !== undefined) {
            focusField(first.fieldId);
            return;
        }
        // The version is resolved from a second read, so unlike the pasted-id form this cannot
        // submit the instant the button is pressed: a recipe whose detail is still in flight has no
        // version to send yet, and one with nothing published never will.
        if (publishedVersion === null || !amountValid) return;

        create.mutate(
            {
                branchId,
                recipeVersionId: publishedVersion.id,
                ...(scale === 'yield'
                    ? { plannedYield: parsedAmount }
                    : { batchFactor: parsedAmount }),
                ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            },
            {
                onSuccess: (detail) => {
                    toast.show({
                        testID: 'kitchen-production-batch-new-toast',
                        tone: 'success',
                        message: t('kitchen:ops.production.createdToast'),
                    });
                    router.replace(`/kitchen/production-desk/${String(detail.order.id)}`);
                },
            },
        );
    };

    const dash = t('kitchen:list.noValue');
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    return (
        <Stack space="md" testID="kitchen-production-batch-new-screen">
            {/*
             * The record forms' opening: the title with the state the batch will be opened in,
             * Cancel and the create at the inline end, and the banner naming what stops the create.
             * One page, so a hairline rather than a step row.
             */}
            <RecordFormOpening
                testID="kitchen-production-batch-new"
                title={t('kitchen:ops.production.newTitle')}
                dirty={false}
                badges={
                    <Badge
                        variant="caps"
                        testID="kitchen-production-batch-new-status"
                        tone={statusTone('draft')}
                        icon={null}
                        label={t(statusKey('draft'))}
                    />
                }
                actions={
                    <>
                        <Button
                            testID="kitchen-production-batch-new-back"
                            variant="secondary"
                            label={t('kitchen:editor.cancel')}
                            onPress={() => {
                                router.push('/kitchen/production-desk');
                            }}
                        />
                        <Button
                            testID="kitchen-production-batch-new-submit"
                            label={t('kitchen:ops.production.createSubmit')}
                            /*
                             * Also while the version is being resolved, not only while the batch
                             * is being created. The id is fetched rather than typed, so there is a
                             * moment after picking a recipe when the form looks complete and has
                             * nothing to send — and a press in that moment used to be swallowed by
                             * the guard in `submit`, leaving a button that did nothing and said
                             * nothing.
                             */
                            loading={create.isPending || recipeResolving}
                            onPress={submit}
                        />
                    </>
                }
                errors={{
                    summary: t(
                        shownIssues.every((entry) => entry.required)
                            ? 'kitchen:forms.requiredCount'
                            : 'kitchen:forms.toFixCount',
                        { count: shownIssues.length },
                    ),
                    items: shownIssues.map((entry) => ({
                        key: entry.key,
                        label: entry.label,
                        /*
                         * Not the recipe: "has no published version — publish one first" is the
                         * only place that explanation lives, and a `Recipe` chip does not say it.
                         */
                        fieldId: entry.key === 'recipe' ? undefined : entry.fieldId,
                        onPress: () => {
                            focusField(entry.fieldId);
                        },
                    })),
                }}
            />

            {/*
             * Said before anything is pressed, because it changes how many batches somebody opens:
             * a draft claims nothing, and only confirming it does.
             */}
            <Callout
                testID="kitchen-production-batch-new-note"
                role="note"
                tone="info"
                title={t('kitchen:ops.production.newSubtitle')}
            />

            {failure === null ? null : (
                <Callout
                    testID="kitchen-production-batch-new-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:editor.saveError')}
                    body={failure.message}
                />
            )}

            {/*
             * The form beside what it will make. Below `xl` the summary drops under the form: with
             * the admin rail open, `lg` leaves the summary narrower than a field. `z-auto` down the
             * column — see `FormSection` on why a View would trap the recipe dropdown.
             */}
            <View
                testID="kitchen-production-batch-new-body"
                className="z-auto flex-col gap-base xl:flex-row xl:items-start"
            >
                <View className="z-auto min-w-0 flex-col gap-loose xl:flex-[21]">
                    {/*
                     * One card: recipe, scale and amount on one row, the notes under it.
                     * `relative z-raised`, or the picker's panel opens underneath the preview
                     * below it — react-native-web gives every View `z-index: 0`.
                     */}
                    <View className="relative z-raised">
                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-production-batch-new-batch-section"
                            title={t('kitchen:ops.production.batchSection')}
                        >
                            <Stack space="md">
                                {/*
                                 * Recipe, scale and amount on one row of the half grid: the recipe
                                 * and the scale at a field each, the amount at half of one — a
                                 * figure and its unit, which a whole field would only stretch. No
                                 * hints: the summary beside the form names the version and what
                                 * the figure makes.
                                 */}
                                <FormGrid track="half">
                                    <Select
                                        span={2}
                                        testID="kitchen-production-batch-new-recipe"
                                        id="kitchen-production-batch-new-recipe"
                                        label={t('kitchen:ops.production.recipeLabel')}
                                        placeholder={t('kitchen:ops.production.recipePlaceholder')}
                                        searchable
                                        required
                                        options={recipeOptions}
                                        value={recipeId === null ? null : String(recipeId)}
                                        {...(recipeError === undefined
                                            ? {}
                                            : { error: recipeError })}
                                        onChange={(value) => {
                                            setRecipeId(RecipeId.safeParse(value));
                                        }}
                                    />

                                    {/*
                                     * One of the two scales, never both: the segmented control
                                     * is the question and the figure beside it the answer.
                                     */}
                                    <GridCell span={2}>
                                        <View className="flex-col gap-hair">
                                            <Text variant="caption" className="font-medium">
                                                {t('kitchen:ops.production.scaleLabel')}
                                            </Text>
                                            <SegmentedControl<Scale>
                                                testID="kitchen-production-batch-new-scale"
                                                label={t('kitchen:ops.production.scaleLabel')}
                                                value={scale}
                                                block
                                                onChange={(next) => {
                                                    setScale(next);
                                                    // The number means something different
                                                    // under each option — litres against
                                                    // multiples — so carrying it across would
                                                    // silently plan a batch four hundred times
                                                    // the size of the one somebody typed.
                                                    setAmount('');
                                                }}
                                                items={[
                                                    {
                                                        value: 'yield',
                                                        label: t(
                                                            'kitchen:ops.production.scaleYield',
                                                        ),
                                                        testID: 'kitchen-production-batch-new-scale-yield',
                                                    },
                                                    {
                                                        value: 'factor',
                                                        label: t(
                                                            'kitchen:ops.production.scaleFactor',
                                                        ),
                                                        testID: 'kitchen-production-batch-new-scale-factor',
                                                    },
                                                ]}
                                            />
                                        </View>
                                    </GridCell>

                                    <QuantityInput
                                        testID="kitchen-production-batch-new-amount"
                                        id="kitchen-production-batch-new-amount"
                                        size="sm"
                                        label={t(
                                            scale === 'yield'
                                                ? 'kitchen:ops.production.plannedYieldLabel'
                                                : 'kitchen:ops.production.batchFactorLabel',
                                        )}
                                        required
                                        // The suffix only appears once the unit is actually
                                        // known. A box labelled with a unit the screen guessed
                                        // is worse than one with none: the figure is typed
                                        // against it.
                                        {...(scale === 'yield' && outputUnit !== null
                                            ? { unit: t(unitShortKey(outputUnit)) }
                                            : {})}
                                        value={amount}
                                        {...(submitted && !amountValid
                                            ? {
                                                  error: t('kitchen:ops.production.amountRequired'),
                                              }
                                            : {})}
                                        onChangeText={setAmount}
                                    />
                                </FormGrid>

                                <FormGrid track="half">
                                    <TextInputField
                                        span={4}
                                        testID="kitchen-production-batch-new-notes"
                                        id="kitchen-production-batch-new-notes"
                                        size="sm"
                                        label={t('kitchen:ops.production.notesLabel')}
                                        hint={t('kitchen:ops.production.notesHint')}
                                        value={notes}
                                        multiline
                                        onChangeText={setNotes}
                                    />
                                </FormGrid>
                            </Stack>
                        </FormSection>
                    </View>

                    <ConsumePreview
                        recipeChosen={recipe !== null}
                        draftOnTop={
                            recipe !== null && publishedVersion !== null && previewVersion === null
                                ? {
                                      draft: recipe.currentVersion.versionNumber,
                                      published: publishedVersion.versionNumber,
                                  }
                                : null
                        }
                        version={previewVersion}
                        factor={runs}
                        ingredients={ingredients}
                        availability={availability}
                    />
                </View>

                <View
                    testID="kitchen-production-batch-new-rail"
                    className="min-w-0 flex-col gap-base xl:flex-[10]"
                >
                    <Card
                        testID="kitchen-production-batch-new-summary"
                        tone="brand"
                        padding="md"
                        title={t('kitchen:ops.production.summaryTitle')}
                    >
                        <SummaryRow
                            testID="kitchen-production-batch-new-summary-recipe"
                            label={t('kitchen:ops.production.recipeLabel')}
                            value={recipe === null ? dash : displayName(recipe.name, locale).value}
                        />
                        <SummaryRow
                            testID="kitchen-production-batch-new-summary-version"
                            label={t('kitchen:ops.production.summaryVersion')}
                            value={
                                publishedVersion === null
                                    ? dash
                                    : t('kitchen:ops.batch.versionCell', {
                                          number: publishedVersion.versionNumber,
                                      })
                            }
                        />
                        <SummaryRow
                            testID="kitchen-production-batch-new-summary-runs"
                            label={t('kitchen:ops.production.summaryRuns')}
                            value={
                                runs === null
                                    ? dash
                                    : t('kitchen:ops.production.summaryRunsValue', {
                                          factor: number(runs),
                                      })
                            }
                        />
                        <SummaryRow
                            testID="kitchen-production-batch-new-summary-makes"
                            label={t('kitchen:ops.production.summaryMakes')}
                            value={
                                makes === null
                                    ? dash
                                    : outputUnit === null
                                      ? number(makes)
                                      : `${number(makes)} ${t(unitShortKey(outputUnit))}`
                            }
                        />
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.summaryFoot')}
                        </Text>
                    </Card>
                </View>
            </View>
        </Stack>
    );
}

/**
 * A grid cell for a control that is not a field. `FormGrid` reads `span` off its child's props,
 * and a segmented control has none to read.
 */
function GridCell({ children }: GridSpanProps & { readonly children: ReactNode }) {
    return <>{children}</>;
}

function SummaryRow({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}) {
    return (
        <View className="flex-row items-baseline justify-between gap-tight">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant="bodyStrong" testID={testID} numberOfLines={1} className="text-end">
                {value}
            </Text>
        </View>
    );
}

interface ConsumePreviewProps {
    readonly recipeChosen: boolean;
    /** Version numbers when the current version is a draft sitting on the published one. */
    readonly draftOnTop: { readonly draft: number; readonly published: number } | null;
    readonly version: RecipeVersionAdmin | null;
    readonly factor: number | null;
    readonly ingredients: Readonly<Record<string, IngredientAdmin>>;
    readonly availability: ShelfAvailability;
}

/**
 * What the batch will consume, against this branch's shelves — the Operations design's second
 * section, drawn by the sheet the production editor was built with. It says why when it cannot be
 * drawn, because an empty space under a form reads as "needs nothing".
 */
function ConsumePreview({
    recipeChosen,
    draftOnTop,
    version,
    factor,
    ingredients,
    availability,
}: ConsumePreviewProps) {
    const { t } = useTranslation();

    if (version !== null && factor !== null) {
        return (
            <Card testID="kitchen-production-batch-new-preview" tone="raised" padding="md">
                <BatchSheet
                    first
                    version={version}
                    factor={factor}
                    ingredients={ingredients}
                    availability={availability}
                />
            </Card>
        );
    }

    // The section's own card, heading and all, so the page keeps its shape as the form fills in.
    return (
        <Card testID="kitchen-production-batch-new-preview-pending" tone="raised" padding="md">
            <FormSection first title={t('kitchen:ops.batch.consumeHeading')}>
                <Text variant="caption" tone="secondary">
                    {draftOnTop !== null
                        ? t('kitchen:ops.production.previewDraftOnTop', draftOnTop)
                        : recipeChosen && version !== null
                          ? t('kitchen:ops.production.previewNeedsAmount')
                          : t('kitchen:ops.production.previewNeedsRecipe')}
                </Text>
            </FormSection>
        </Card>
    );
}
