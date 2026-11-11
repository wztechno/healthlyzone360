import type { BranchClosure } from '@healthy360/api-client/contracts';
import {
    DateField,
    ErrorState,
    FormGrid,
    FormSection,
    Inline,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useAddBranchClosureMutation,
    useBranchClosuresQuery,
    useRemoveBranchClosureMutation,
} from '../../data/kitchen-ops-hooks.ts';
import { toFailure } from '../../data/hooks.ts';

import { DeskButton } from './desk-kit/desk-button.tsx';
import { DeskChip } from './desk-kit/desk-chip.tsx';
import { FailureToast } from './failure-toast.tsx';
/**
 * Holidays: dates this branch is shut on top of its week. Saves on its own, as the service timings
 * do, because a closure is one decision and the week's Save is another.
 */
export function BranchClosuresSection({ canManage }: { readonly canManage: boolean }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const closures = useBranchClosuresQuery();
    const add = useAddBranchClosureMutation();
    const remove = useRemoveBranchClosureMutation();

    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [note, setNote] = useState('');

    const loadFailure = toFailure(closures.error);
    const saveFailure = toFailure(add.error ?? remove.error);

    if (loadFailure !== null) {
        return (
            <ErrorState
                testID="kitchen-branch-closures-load-error"
                failure={loadFailure}
                onRetry={() => {
                    void closures.refetch();
                }}
                retrying={closures.isFetching}
            />
        );
    }

    const addClosure = () => {
        add.mutate(
            {
                closedFrom: from,
                closedTo: to === '' ? from : to,
                note: note.trim() === '' ? null : note.trim(),
            },
            {
                onSuccess: () => {
                    setFrom('');
                    setTo('');
                    setNote('');
                    toast.show({
                        testID: 'kitchen-branch-closures-added-toast',
                        tone: 'success',
                        message: t('kitchen:branchClosures.addedToast'),
                    });
                },
            },
        );
    };

    const rangeOf = (closure: BranchClosure) => {
        const start = formatter.formatDate(`${closure.closedFrom}T00:00:00`, {
            dateStyle: 'medium',
        });
        const end = formatter.formatDate(`${closure.closedTo}T00:00:00`, { dateStyle: 'medium' });
        return closure.closedFrom === closure.closedTo ? start : `${start} – ${end}`;
    };

    return (
        <FormSection
            variant="panel"
            testID="kitchen-branch-closures"
            title={t('kitchen:branchClosures.title')}
            description={t('kitchen:branchClosures.description')}
            printDescription
            actions={
                canManage ? (
                    <DeskButton
                        testID="kitchen-branch-closures-add"
                        size="sm"
                        label={t('kitchen:branchClosures.add')}
                        loading={add.isPending}
                        disabled={from === '' || add.isPending}
                        onPress={addClosure}
                    />
                ) : undefined
            }
        >
            <FailureToast
                failure={saveFailure}
                testID="kitchen-branch-closures-error"
                title={t('kitchen:branchClosures.saveError')}
                body={saveFailure?.message}
            />
            {canManage ? (
                <FormGrid track="half" testID="kitchen-branch-closures-form">
                    <DateField
                        testID="kitchen-branch-closures-from"
                        label={t('kitchen:branchClosures.fromLabel')}
                        value={from}
                        onChange={(next) => {
                            setFrom(next ?? '');
                        }}
                    />
                    <DateField
                        testID="kitchen-branch-closures-to"
                        label={t('kitchen:branchClosures.toLabel')}
                        hint={t('kitchen:branchClosures.toHint')}
                        value={to}
                        onChange={(next) => {
                            setTo(next ?? '');
                        }}
                    />
                    <TextInputField
                        testID="kitchen-branch-closures-note"
                        id="kitchen-branch-closures-note"
                        label={t('kitchen:branchClosures.noteLabel')}
                        size="sm"
                        value={note}
                        onChangeText={setNote}
                    />
                </FormGrid>
            ) : null}
            <Stack space="xs" testID="kitchen-branch-closures-list">
                {(closures.data ?? []).length === 0 ? (
                    <Text variant="caption" tone="secondary" testID="kitchen-branch-closures-empty">
                        {t('kitchen:branchClosures.empty')}
                    </Text>
                ) : (
                    (closures.data ?? []).map((closure) => (
                        <Inline
                            key={closure.id}
                            space="sm"
                            align="center"
                            justify="between"
                            testID={`kitchen-branch-closures-row-${closure.id}`}
                        >
                            <Inline space="sm" align="center">
                                <DeskChip tone="warning" label={rangeOf(closure)} />
                                {closure.note === null ? null : (
                                    <Text variant="caption" tone="secondary">
                                        {closure.note}
                                    </Text>
                                )}
                            </Inline>
                            {canManage ? (
                                <DeskButton
                                    testID={`kitchen-branch-closures-remove-${closure.id}`}
                                    size="sm"
                                    variant="quiet"
                                    label={t('kitchen:branchClosures.remove')}
                                    disabled={remove.isPending}
                                    onPress={() => {
                                        remove.mutate(closure.id);
                                    }}
                                />
                            ) : null}
                        </Inline>
                    ))
                )}
            </Stack>
        </FormSection>
    );
}
