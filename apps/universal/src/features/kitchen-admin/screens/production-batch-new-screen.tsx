import {
    Button,
    EmptyState,
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
        if (parsedVersion === null || !amountValid) return;

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
                <TextInputField
                    testID="kitchen-production-batch-new-version"
                    id="kitchen-production-batch-new-version"
                    label={t('kitchen:ops.production.versionLabel')}
                    hint={t('kitchen:ops.production.versionHint')}
                    value={versionId}
                    required
                    autoCapitalize="none"
                    autoCorrect={false}
                    error={
                        submitted && parsedVersion === null
                            ? t('kitchen:ops.production.versionRequired')
                            : undefined
                    }
                    onChangeText={setVersionId}
                />

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
                    hint={t(
                        scale === 'yield'
                            ? 'kitchen:ops.production.plannedYieldHint'
                            : 'kitchen:ops.production.batchFactorHint',
                    )}
                    required
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
                        loading={create.isPending}
                        onPress={submit}
                    />
                </View>
            </Stack>
        </Stack>
    );
}
