import type { QualityCheck } from '@healthy360/api-client/contracts';
import { QUALITY_CHECK_SUBJECT_TYPES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreateQualityCheckMutation,
    useHoldQualityCheckMutation,
    useQualityChecksQuery,
    useReleaseQualityCheckMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    qualityCheckRowTestId,
    qualityCheckStatusKey,
    qualityCheckStatusTone,
    qualityCheckSubjectKey,
} from '../ops-format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';

/**
 * `/kitchen/qc` — quality checks on receipts and production batches (O3/O4).
 *
 * Hold and release are the only lifecycle actions beyond opening a check. Subjects are limited to
 * `goods_receipt` and `production_order`.
 */

export function QualityControlScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-qc"
        >
            <QualityControl />
        </Gate>
    );
}

function QualityControl() {
    const { t } = useTranslation();
    const toast = useToast();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const checks = useQualityChecksQuery();
    const checksFailure = toFailure(checks.error);
    const createCheck = useCreateQualityCheckMutation();
    const holdCheck = useHoldQualityCheckMutation();
    const releaseCheck = useReleaseQualityCheckMutation();

    const [creating, setCreating] = useState(false);
    const [subjectType, setSubjectType] =
        useState<(typeof QUALITY_CHECK_SUBJECT_TYPES)[number]>('goods_receipt');
    const [subjectId, setSubjectId] = useState('');

    const rows = checks.data ?? [];
    const pendingCount = rows.filter((row) => row.status === 'pending').length;
    const holdCount = rows.filter((row) => row.status === 'hold').length;
    const releasedCount = rows.filter((row) => row.status === 'released').length;

    const metrics: readonly OpsMetric[] = [
        {
            key: 'openChecks',
            labelKey: 'kitchen:ops.qc.metrics.openChecks',
            value: checks.isPending ? null : pendingCount,
        },
        {
            key: 'holds',
            labelKey: 'kitchen:ops.qc.metrics.holds',
            value: checks.isPending ? null : holdCount,
        },
        {
            key: 'releases',
            labelKey: 'kitchen:ops.qc.metrics.releases',
            value: checks.isPending ? null : releasedCount,
        },
    ];

    const subjectOptions = QUALITY_CHECK_SUBJECT_TYPES.map((value) => ({
        value,
        label: t(qualityCheckSubjectKey(value)),
    }));

    function closeCreating() {
        setCreating(false);
        setSubjectType('goods_receipt');
        setSubjectId('');
        createCheck.reset();
    }

    function submitCreate() {
        const trimmed = subjectId.trim();
        if (trimmed === '') return;
        createCheck.mutate(
            { subjectType, subjectId: trimmed },
            {
                onSuccess: () => {
                    closeCreating();
                    toast.show({
                        testID: 'kitchen-qc-created-toast',
                        tone: 'success',
                        message: t('kitchen:ops.qc.createdToast'),
                    });
                },
            },
        );
    }

    function onHold(check: QualityCheck) {
        holdCheck.mutate(check.id, {
            onSuccess: () => {
                toast.show({
                    testID: 'kitchen-qc-held-toast',
                    tone: 'warning',
                    message: t('kitchen:ops.qc.heldToast'),
                });
            },
        });
    }

    function onRelease(check: QualityCheck) {
        releaseCheck.mutate(check.id, {
            onSuccess: () => {
                toast.show({
                    testID: 'kitchen-qc-released-toast',
                    tone: 'success',
                    message: t('kitchen:ops.qc.releasedToast'),
                });
            },
        });
    }

    const columns: readonly TableColumn<QualityCheck>[] = [
        {
            key: 'subject',
            header: t('kitchen:ops.qc.columnSubject'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text
                        variant="bodyStrong"
                        testID={`${qualityCheckRowTestId(String(row.id))}-subject`}
                    >
                        {t(qualityCheckSubjectKey(row.subjectType))}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {String(row.subjectId).slice(0, 8)}…
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.qc.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${qualityCheckRowTestId(String(row.id))}-status`}
                    tone={qualityCheckStatusTone(row.status)}
                    label={t(qualityCheckStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'actions',
            header: t('kitchen:ops.qc.columnActions'),
            render: (row) => {
                if (!canManage) return <Text tone="secondary">—</Text>;
                if (row.status === 'pending' || row.status === 'released') {
                    return (
                        <Button
                            testID={`${qualityCheckRowTestId(String(row.id))}-hold`}
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:ops.qc.hold')}
                            loading={holdCheck.isPending}
                            onPress={() => {
                                onHold(row);
                            }}
                        />
                    );
                }
                if (row.status === 'hold') {
                    return (
                        <Button
                            testID={`${qualityCheckRowTestId(String(row.id))}-release`}
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:ops.qc.release')}
                            loading={releaseCheck.isPending}
                            onPress={() => {
                                onRelease(row);
                            }}
                        />
                    );
                }
                return <Text tone="secondary">—</Text>;
            },
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-qc-screen">
            <OpsPanel
                testID="kitchen-qc-panel"
                titleKey="kitchen:ops.qc.title"
                subtitleKey="kitchen:ops.qc.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.qc.emptyTitle"
                emptyBodyKey="kitchen:ops.qc.emptyBody"
            >
                {checks.isPending ? (
                    <Skeleton testID="kitchen-qc-loading" heightClassName="h-40" />
                ) : null}
                {checksFailure !== null ? (
                    <ErrorState
                        testID="kitchen-qc-error"
                        title={t('kitchen:ops.qc.loadErrorTitle')}
                        failure={checksFailure}
                        onRetry={() => {
                            void checks.refetch();
                        }}
                        retrying={checks.isFetching}
                    />
                ) : null}
                {!checks.isPending && !checks.isError ? (
                    <Stack space="sm">
                        <Inline space="sm" align="center" justify="between">
                            <Heading level={2} testID="kitchen-qc-checks-title">
                                {t('kitchen:ops.qc.checksHeading')}
                            </Heading>
                            {canManage ? (
                                <Button
                                    testID="kitchen-qc-create"
                                    size="sm"
                                    label={t('kitchen:ops.qc.create')}
                                    onPress={() => {
                                        setCreating(true);
                                    }}
                                />
                            ) : null}
                        </Inline>
                        {rows.length === 0 ? (
                            <EmptyState
                                testID="kitchen-qc-empty"
                                title={t('kitchen:ops.qc.emptyTitle')}
                                body={t('kitchen:ops.qc.emptyBody')}
                            />
                        ) : (
                            <Table
                                testID="kitchen-qc-checks"
                                caption={t('kitchen:ops.qc.checksHeading')}
                                captionHidden
                                columns={columns}
                                rows={rows}
                                rowKey={(row) => String(row.id)}
                            />
                        )}
                    </Stack>
                ) : null}
            </OpsPanel>

            <Dialog
                testID="kitchen-qc-create-dialog"
                open={creating}
                onClose={closeCreating}
                title={t('kitchen:ops.qc.createTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-qc-create-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeCreating}
                        />
                        <Button
                            testID="kitchen-qc-create-submit"
                            label={t('kitchen:ops.qc.createSubmit')}
                            loading={createCheck.isPending}
                            disabled={subjectId.trim() === ''}
                            onPress={submitCreate}
                        />
                    </>
                }
            >
                <Stack space="md">
                    <Select
                        testID="kitchen-qc-subject-type"
                        id="kitchen-qc-subject-type"
                        label={t('kitchen:ops.qc.subjectTypeLabel')}
                        options={subjectOptions}
                        value={subjectType}
                        onChange={setSubjectType}
                    />
                    <TextInputField
                        testID="kitchen-qc-subject-id"
                        id="kitchen-qc-subject-id"
                        label={t('kitchen:ops.qc.subjectIdLabel')}
                        hint={t('kitchen:ops.qc.subjectIdHint')}
                        value={subjectId}
                        onChangeText={setSubjectId}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {createCheck.error === null ? null : (
                        <Text tone="danger" testID="kitchen-qc-create-error">
                            {toFailure(createCheck.error)?.message ??
                                t('kitchen:ops.qc.createFailed')}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </Stack>
    );
}
