import {
    Badge,
    Button,
    Callout,
    EmptyState,
    FormGrid,
    FormSection,
    QuantityInput,
    SegmentedControl,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { RecipeVersionId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useCreateProductionOrderMutation } from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { PRODUCTION_MANAGE_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { statusKey, statusTone } from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
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
            requirement={{ allOf: [PRODUCTION_MANAGE_PERMISSION] }}
            testID="kitchen-production-batch-new"
        >
            <ProductionBatchNew />
        </Gate>
    );
}

type Scale = 'yield' | 'factor';

function ProductionBatchNew() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const create = useCreateProductionOrderMutation();

    const [versionId, setVersionId] = useState('');
    const [scale, setScale] = useState<Scale>('yield');
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const parsedVersion =
        versionId.trim() === '' ? null : RecipeVersionId.safeParse(versionId.trim());
    const parsedAmount = readNumber(amount);
    const amountValid = parsedAmount !== null && parsedAmount > 0;
    const failure = toFailure(create.error);

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
     * What stops the create, each naming the field that fixes it. Both are blanks until something is
     * typed, so neither is named before the first press — the ingredient editor's rule.
     */
    const issues = [
        ...(parsedVersion === null
            ? [
                  {
                      key: 'version',
                      label: t('kitchen:ops.production.versionLabel'),
                      fieldId: 'kitchen-production-batch-new-version',
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
                  },
              ]),
    ];

    const submit = () => {
        setSubmitted(true);
        const first = issues[0];
        if (first !== undefined) {
            focusField(first.fieldId);
            return;
        }
        if (parsedVersion === null) return;

        create.mutate(
            {
                branchId,
                recipeVersionId: parsedVersion,
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
        <Stack space="md" testID="kitchen-production-batch-new-screen">
            {/*
             * The record forms' opening: the title with the state the batch will be opened in,
             * Cancel and the create at the inline end, and the banner naming what is missing once
             * the create has been pressed. One page, so a hairline rather than a step row.
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
                            loading={create.isPending}
                            disabled={create.isPending}
                            onPress={submit}
                        />
                    </>
                }
                errors={{
                    summary: t('kitchen:forms.requiredCount', { count: issues.length }),
                    items: submitted
                        ? issues.map((entry) => ({
                              key: entry.key,
                              label: entry.label,
                              onPress: () => {
                                  focusField(entry.fieldId);
                              },
                          }))
                        : [],
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

            {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
            <View className="z-auto flex-col gap-loose">
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-production-batch-new-recipe"
                    title={t('kitchen:ops.production.recipeLabel')}
                >
                    <FormGrid track="half" maxColumns={4}>
                        <TextInputField
                            span={4}
                            testID="kitchen-production-batch-new-version"
                            id="kitchen-production-batch-new-version"
                            size="sm"
                            label={t('kitchen:ops.production.versionLabel')}
                            hint={t('kitchen:ops.production.versionHint')}
                            value={versionId}
                            required
                            autoCapitalize="none"
                            autoCorrect={false}
                            {...(submitted && parsedVersion === null
                                ? { error: t('kitchen:ops.production.versionRequired') }
                                : {})}
                            onChangeText={setVersionId}
                        />
                    </FormGrid>
                </FormSection>

                {/*
                 * One of the two scales, never both: the segmented control is the question and the
                 * one figure under it is the answer, on the half track like every figure here.
                 */}
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-production-batch-new-scale-section"
                    title={t('kitchen:ops.production.scaleLabel')}
                >
                    <Stack space="sm">
                        <View className="self-start">
                            <SegmentedControl<Scale>
                                testID="kitchen-production-batch-new-scale"
                                label={t('kitchen:ops.production.scaleLabel')}
                                value={scale}
                                onChange={(next) => {
                                    setScale(next);
                                    // The number means something different under each option —
                                    // litres against multiples — so carrying it across would
                                    // silently plan a batch four hundred times the size of the one
                                    // somebody typed.
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
                        </View>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.scaleHint')}
                        </Text>
                        <FormGrid track="half">
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
                                value={amount}
                                {...(submitted && !amountValid
                                    ? { error: t('kitchen:ops.production.amountRequired') }
                                    : {})}
                                onChangeText={setAmount}
                            />
                        </FormGrid>
                        <Text variant="caption" tone="secondary">
                            {t(
                                scale === 'yield'
                                    ? 'kitchen:ops.production.plannedYieldHint'
                                    : 'kitchen:ops.production.batchFactorHint',
                            )}
                        </Text>
                    </Stack>
                </FormSection>

                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-production-batch-new-notes-section"
                    title={t('kitchen:ops.production.notesLabel')}
                >
                    <FormGrid track="half" maxColumns={4}>
                        <TextInputField
                            span={4}
                            testID="kitchen-production-batch-new-notes"
                            id="kitchen-production-batch-new-notes"
                            size="sm"
                            label={t('kitchen:ops.production.notesLabel')}
                            labelHidden
                            hint={t('kitchen:ops.production.notesHint')}
                            value={notes}
                            multiline
                            onChangeText={setNotes}
                        />
                    </FormGrid>
                </FormSection>
            </View>
        </Stack>
    );
}
