import {
    Button,
    EmptyState,
    QuantityInput,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { recipesFromPages, useRecipeQuery, useRecipesQuery } from '../../../data/kitchen-admin-hooks.ts';
import { useCreateProductionOrderMutation } from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { PRODUCTION_MANAGE_PERMISSION, RECIPE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, statusKey, unitShortKey } from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
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
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const create = useCreateProductionOrderMutation();

    const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
    const [scale, setScale] = useState<Scale>('yield');
    const [amount, setAmount] = useState('');
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
            ? (recipe.currentVersion.outputs.find((output) => output.isPrimary) ??
              recipe.currentVersion.outputs[0])?.unit ?? null
            : null;

    const parsedAmount = readNumber(amount);
    const amountValid = parsedAmount !== null && parsedAmount > 0;
    const failure = toFailure(create.error);

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

    if (branchId === null) {
        return (
            <EmptyState
                testID="kitchen-production-batch-new-no-branch"
                title={t('kitchen:ops.production.noBranchTitle')}
                body={t('kitchen:ops.production.noBranchBody')}
            />
        );
    }

    const submit = () => {
        setSubmitted(true);
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

    return (
        <Stack space="lg" testID="kitchen-production-batch-new-screen">
            <KitchenPageHeader
                testID="kitchen-production-batch-new-header"
                title={t('kitchen:ops.production.newTitle')}
                subtitle={t('kitchen:ops.production.newSubtitle')}
                back={
                    <View className="flex-row">
                        <Button
                            testID="kitchen-production-batch-new-back"
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:ops.production.backToDesk')}
                            onPress={() => {
                                router.push('/kitchen/production-desk');
                            }}
                        />
                    </View>
                }
            />

            <Stack space="md">
                {/*
                  * `relative z-raised`, or the panel opens underneath the segmented control below
                  * it: react-native-web gives every View `position: relative; z-index: 0`, so a
                  * later sibling paints over an earlier one's overflow. Same fix, same reason, as
                  * the batch planner's own picker.
                  */}
                <View className="relative z-raised">
                    <Select
                        testID="kitchen-production-batch-new-recipe"
                        id="kitchen-production-batch-new-recipe"
                        label={t('kitchen:ops.production.recipeLabel')}
                        placeholder={t('kitchen:ops.production.recipePlaceholder')}
                        hint={
                            recipeResolving
                                ? t('kitchen:ops.production.recipeResolving')
                                : publishedVersion === null
                                  ? t('kitchen:ops.production.recipeHint')
                                  : t('kitchen:ops.production.recipeVersionCaption', {
                                        number: publishedVersion.versionNumber,
                                    })
                        }
                        searchable
                        required
                        options={recipeOptions}
                        value={recipeId === null ? null : String(recipeId)}
                        {...(recipeError === undefined ? {} : { error: recipeError })}
                        onChange={(value) => {
                            setRecipeId(RecipeId.safeParse(value));
                        }}
                    />
                </View>

                <SegmentedControl<Scale>
                    testID="kitchen-production-batch-new-scale"
                    label={t('kitchen:ops.production.scaleLabel')}
                    value={scale}
                    onChange={(next) => {
                        setScale(next);
                        // The number means something different under each option — litres against
                        // multiples — so carrying it across would silently plan a batch four
                        // hundred times the size of the one somebody typed.
                        setAmount('');
                    }}
                    items={[
                        {
                            value: 'yield',
                            label: t('kitchen:ops.production.scaleYield'),
                            testID: 'kitchen-production-batch-new-scale-yield',
                        },
                        {
                            value: 'factor',
                            label: t('kitchen:ops.production.scaleFactor'),
                            testID: 'kitchen-production-batch-new-scale-factor',
                        },
                    ]}
                />
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.production.scaleHint')}
                </Text>

                <QuantityInput
                    testID="kitchen-production-batch-new-amount"
                    id="kitchen-production-batch-new-amount"
                    label={t(
                        scale === 'yield'
                            ? 'kitchen:ops.production.plannedYieldLabel'
                            : 'kitchen:ops.production.batchFactorLabel',
                    )}
                    hint={
                        scale === 'factor'
                            ? t('kitchen:ops.production.batchFactorHint')
                            : outputUnit === null
                              ? t('kitchen:ops.production.plannedYieldHint')
                              : t('kitchen:ops.production.plannedYieldHintUnit', {
                                    unit: t(unitShortKey(outputUnit)),
                                })
                    }
                    required
                    // The suffix only appears once the unit is actually known. A box labelled with
                    // a unit the screen guessed is worse than one with none: the figure is typed
                    // against it.
                    {...(scale === 'yield' && outputUnit !== null
                        ? { unit: t(unitShortKey(outputUnit)) }
                        : {})}
                    value={amount}
                    error={
                        submitted && !amountValid
                            ? t('kitchen:ops.production.amountRequired')
                            : undefined
                    }
                    onChangeText={setAmount}
                />

                <TextInputField
                    testID="kitchen-production-batch-new-notes"
                    id="kitchen-production-batch-new-notes"
                    label={t('kitchen:ops.production.notesLabel')}
                    hint={t('kitchen:ops.production.notesHint')}
                    value={notes}
                    multiline
                    onChangeText={setNotes}
                />

                {failure === null ? null : (
                    <Text tone="danger" testID="kitchen-production-batch-new-error">
                        {failure.message}
                    </Text>
                )}

                <View className="flex-row justify-end">
                    <Button
                        testID="kitchen-production-batch-new-submit"
                        label={t('kitchen:ops.production.createSubmit')}
                        /*
                         * Also while the version is being resolved, not only while the batch is
                         * being created. The id is fetched rather than typed now, so there is a
                         * moment after picking a recipe when the form looks complete and has
                         * nothing to send — and a press in that moment used to be swallowed by the
                         * guard in `submit`, leaving a button that did nothing and said nothing.
                         */
                        loading={create.isPending || recipeResolving}
                        onPress={submit}
                    />
                </View>
            </Stack>
        </Stack>
    );
}
