import type { BranchClosure } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    DataTable,
    DatePicker,
    RowMenu,
    Dialog,
    ErrorState,
    FormSection,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    useAddBranchClosureMutation,
    useBranchClosuresQuery,
    useRemoveBranchClosureMutation,
} from '../../data/kitchen-ops-hooks.ts';
import { toFailure } from '../../data/hooks.ts';

import { FailureToast } from './failure-toast.tsx';

/**
 * Holidays: dates this branch is shut on top of its week. Saves on its own, as the service timings
 * do, because a closure is one decision and the week's Save is another.
 *
 * Drawn as option A of the Opening hours redesign (Commercial canvas, 2026-11-23):
 *
 * ```
 * Holidays and closures (i) (This branch)                                   [ Add closure ]
 * FIRST DAY SHUT     LAST DAY SHUT     NOTE
 * 25 Dec 2026        One day           Christmas                                     ⋯
 * 31 Dec 2026        1 Jan 2027        New Year                                      ⋯
 * ```
 *
 * **Add closure opens a pop-up** rather than keeping three empty fields above the list: the form is
 * used a few times a year, and the list is what the page is read for the rest of the time.
 *
 * **The row's ⋯ holds Remove only**, because adding and removing is all a closure can do — there
 * is no edit on the wire. Removing asks first: it reopens those dates to orders at once.
 */
export function BranchClosuresSection({ canManage }: { readonly canManage: boolean }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const closures = useBranchClosuresQuery();
    const add = useAddBranchClosureMutation();
    const remove = useRemoveBranchClosureMutation();

    const [adding, setAdding] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [note, setNote] = useState('');
    /** The closure the remove confirmation is open for. */
    const [removing, setRemoving] = useState<BranchClosure | null>(null);

    const loadFailure = toFailure(closures.error);
    const addFailure = toFailure(add.error);
    const removeFailure = toFailure(remove.error);

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

    const day = (iso: string) => formatter.formatDate(`${iso}T00:00:00`, { dateStyle: 'medium' });
    const rangeOf = (closure: BranchClosure) =>
        closure.closedFrom === closure.closedTo
            ? day(closure.closedFrom)
            : `${day(closure.closedFrom)} – ${day(closure.closedTo)}`;

    const openAdd = () => {
        add.reset();
        setFrom('');
        setTo('');
        setNote('');
        setAdding(true);
    };

    const addClosure = () => {
        add.mutate(
            {
                closedFrom: from,
                closedTo: to === '' ? from : to,
                note: note.trim() === '' ? null : note.trim(),
            },
            {
                onSuccess: () => {
                    setAdding(false);
                    toast.show({
                        testID: 'kitchen-branch-closures-added-toast',
                        tone: 'success',
                        message: t('kitchen:branchClosures.addedToast'),
                    });
                },
            },
        );
    };

    const removeClosure = () => {
        if (removing === null) return;
        remove.mutate(removing.id, {
            onSuccess: () => {
                setRemoving(null);
                toast.show({
                    testID: 'kitchen-branch-closures-removed-toast',
                    tone: 'success',
                    message: t('kitchen:branchClosures.removedToast'),
                });
            },
        });
    };

    const rows = closures.data ?? [];
    const columns: readonly DataListColumn<BranchClosure>[] = [
        {
            key: 'from',
            label: t('kitchen:branchClosures.fromLabel'),
            width: 160,
            priority: 100,
            grow: false,
            render: (closure) => (
                <Text testID={`kitchen-branch-closures-row-${closure.id}-from`}>
                    {day(closure.closedFrom)}
                </Text>
            ),
        },
        {
            key: 'to',
            label: t('kitchen:branchClosures.toLabel'),
            width: 160,
            priority: 90,
            grow: false,
            render: (closure) =>
                closure.closedFrom === closure.closedTo ? (
                    <Text tone="secondary">{t('kitchen:branchClosures.oneDay')}</Text>
                ) : (
                    <Text>{day(closure.closedTo)}</Text>
                ),
        },
        {
            key: 'note',
            label: t('kitchen:branchClosures.noteLabel'),
            width: 200,
            priority: 80,
            render: (closure) => (
                <Text numberOfLines={1} tone={closure.note === null ? 'secondary' : undefined}>
                    {closure.note ?? '—'}
                </Text>
            ),
        },
        ...(canManage
            ? [
                  {
                      key: 'actions',
                      label: t('kitchen:list.actionHeader'),
                      width: 48,
                      priority: 70,
                      grow: false,
                      sortable: false,
                      filterable: false,
                      render: (closure) => (
                          <RowMenu
                              testID={`kitchen-branch-closures-row-${closure.id}-menu`}
                              label={t('kitchen:branchClosures.rowMenu', {
                                  dates: rangeOf(closure),
                              })}
                              actions={[
                                  {
                                      key: 'remove',
                                      label: t('kitchen:branchClosures.removeAction'),
                                      icon: 'trash',
                                      tone: 'danger',
                                      testID: `kitchen-branch-closures-row-${closure.id}-remove`,
                                      onSelect: () => {
                                          remove.reset();
                                          setRemoving(closure);
                                      },
                                  },
                              ]}
                          />
                      ),
                  } satisfies DataListColumn<BranchClosure>,
              ]
            : []),
    ];

    return (
        <FormSection
            variant="panel"
            testID="kitchen-branch-closures"
            title={t('kitchen:branchClosures.title')}
            description={t('kitchen:branchClosures.description')}
            aside={
                <Badge
                    testID="kitchen-branch-closures-scope"
                    tone="neutral"
                    label={t('kitchen:branchHours.scopeBranch')}
                />
            }
            actions={
                canManage ? (
                    <Button
                        testID="kitchen-branch-closures-add"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:branchClosures.add')}
                        onPress={openAdd}
                    />
                ) : undefined
            }
        >
            {rows.length === 0 ? (
                <Text variant="caption" tone="secondary" testID="kitchen-branch-closures-empty">
                    {t('kitchen:branchClosures.empty')}
                </Text>
            ) : (
                <DataTable<BranchClosure>
                    lines
                    testID="kitchen-branch-closures-list"
                    label={t('kitchen:branchClosures.title')}
                    columns={columns}
                    rows={rows}
                    rowKey={(closure) => closure.id}
                    density="sm"
                />
            )}

            <Dialog
                look="card"
                testID="kitchen-branch-closures-add-dialog"
                open={adding}
                onClose={() => {
                    setAdding(false);
                }}
                title={t('kitchen:branchClosures.add')}
                actions={
                    <>
                        <Button
                            testID="kitchen-branch-closures-add-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setAdding(false);
                            }}
                        />
                        <Button
                            testID="kitchen-branch-closures-add-save"
                            label={t('kitchen:branchClosures.add')}
                            loading={add.isPending}
                            disabled={from === '' || add.isPending}
                            onPress={addClosure}
                        />
                    </>
                }
            >
                <FailureToast
                    failure={addFailure}
                    testID="kitchen-branch-closures-error"
                    title={t('kitchen:branchClosures.saveError')}
                    body={addFailure?.message}
                />
                {/* Two equal columns: a `FormGrid` track sized for a page squeezed them in the pop-up. */}
                <View className="z-auto flex-row gap-3" testID="kitchen-branch-closures-form">
                    <View className="z-auto min-w-0 flex-1">
                        <DatePicker
                            testID="kitchen-branch-closures-from"
                            label={t('kitchen:branchClosures.fromLabel')}
                            required
                            value={from}
                            onChange={(next) => {
                                setFrom(next);
                            }}
                        />
                    </View>
                    <View className="z-auto min-w-0 flex-1">
                        <DatePicker
                            testID="kitchen-branch-closures-to"
                            label={t('kitchen:branchClosures.toLabel')}
                            hint={t('kitchen:branchClosures.toHint')}
                            value={to}
                            onChange={(next) => {
                                setTo(next);
                            }}
                        />
                    </View>
                </View>
                <TextInputField
                    testID="kitchen-branch-closures-note"
                    id="kitchen-branch-closures-note"
                    label={t('kitchen:branchClosures.noteLabel')}
                    size="sm"
                    value={note}
                    onChangeText={setNote}
                />
            </Dialog>

            <Dialog
                look="card"
                testID="kitchen-branch-closures-remove-dialog"
                open={removing !== null}
                onClose={() => {
                    setRemoving(null);
                }}
                title={t('kitchen:branchClosures.removeTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-branch-closures-remove-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setRemoving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-branch-closures-remove-confirm"
                            variant="danger"
                            label={t('kitchen:branchClosures.removeAction')}
                            loading={remove.isPending}
                            disabled={remove.isPending}
                            onPress={removeClosure}
                        />
                    </>
                }
            >
                <FailureToast
                    failure={removeFailure}
                    testID="kitchen-branch-closures-remove-error"
                    title={t('kitchen:branchClosures.saveError')}
                    body={removeFailure?.message}
                />
                <Text tone="secondary" testID="kitchen-branch-closures-remove-body">
                    {removing === null
                        ? ''
                        : t('kitchen:branchClosures.removeBody', { dates: rangeOf(removing) })}
                </Text>
            </Dialog>
        </FormSection>
    );
}
