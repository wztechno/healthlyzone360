import type {
    QualityCheck,
    QualityCheckStatus,
    QualityCheckSubjectType,
} from '@healthy360/api-client/contracts';
import {
    QUALITY_CHECK_STATUSES,
    QUALITY_CHECK_SUBJECT_TYPES,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreateQualityCheckMutation,
    useHoldQualityCheckMutation,
    useQualityChecksQuery,
    useReleaseQualityCheckMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import type { CatalogueStatusSegment } from '../catalogue/catalogue-toolbar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    qualityCheckRowTestId,
    qualityCheckStatusKey,
    qualityCheckStatusTone,
    qualityCheckSubjectKey,
} from '../ops-format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';

/**
 * `/kitchen/qc` — quality checks on receipts and production batches (Operations handoff, `qc`).
 *
 * ```
 * ┌ PENDING ┐ ┌ ON HOLD ┐ ┌ RELEASED ┐
 * [ ⌕ subject id ]  [ All | Pending | On hold | Released ]  [ + New check ]
 * SUBJECT           KIND                STATUS   ◉ ⏸ ▶
 * ```
 *
 * Hold and release are the only lifecycle actions beyond opening a check (O3/O4). Subjects are
 * limited to `goods_receipt` and `production_order`. "New check" opens the generic editor.
 *
 * ## What the design shows that the contract does not
 *
 * `QualityCheck` is an id, a subject and a status. The design's Opened, Opened by and Outcome
 * columns have no field behind them, so they are not drawn.
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

const PAGE_SIZE = 25;
const SEGMENT_STATUSES: readonly QualityCheckStatus[] = ['pending', 'hold', 'released'];
type StatusSegmentValue = QualityCheckStatus | 'all';

function shortId(id: string): string {
    return `${id.slice(0, 8)}…`;
}

function QualityControl() {
    const [creating, setCreating] = useState(false);
    return creating ? (
        <QualityCheckCreate
            onDone={() => {
                setCreating(false);
            }}
        />
    ) : (
        <QualityCheckList
            onCreate={() => {
                setCreating(true);
            }}
        />
    );
}

function QualityCheckList({ onCreate }: { readonly onCreate: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const checks = useQualityChecksQuery();
    const holdCheck = useHoldQualityCheckMutation();
    const releaseCheck = useReleaseQualityCheckMutation();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<StatusSegmentValue>('all');
    const [viewing, setViewing] = useState<QualityCheck | null>(null);

    const trimmed = query.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            (checks.data ?? []).filter((row) => {
                if (status !== 'all' && row.status !== status) return false;
                if (trimmed === '') return true;
                return `${String(row.id)} ${row.subjectId}`.toLowerCase().includes(trimmed);
            }),
        [checks.data, status, trimmed],
    );

    const [page, setPage] = useState(1);
    const [pageKey, setPageKey] = useState(`${trimmed}|${status}`);
    if (pageKey !== `${trimmed}|${status}`) {
        setPageKey(`${trimmed}|${status}`);
        setPage(1);
    }

    function onHold(check: QualityCheck) {
        holdCheck.mutate(check.id, {
            onSuccess: () => {
                setViewing(null);
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
                setViewing(null);
                toast.show({
                    testID: 'kitchen-qc-released-toast',
                    tone: 'success',
                    message: t('kitchen:ops.qc.releasedToast'),
                });
            },
        });
    }

    /** The one lifecycle move a check has from where it stands, or `null`. */
    const lifecycleAction = (row: QualityCheck) => {
        if (!canManage) return null;
        if (row.status === 'pending' || row.status === 'released') {
            return {
                key: 'hold',
                label: t('kitchen:ops.qc.hold'),
                run: () => {
                    onHold(row);
                },
            };
        }
        if (row.status === 'hold') {
            return {
                key: 'release',
                label: t('kitchen:ops.qc.release'),
                run: () => {
                    onRelease(row);
                },
            };
        }
        return null;
    };

    const columns: readonly ControlledColumn<QualityCheck, CatalogueColumn<QualityCheck>>[] = [
        {
            key: 'subject',
            role: 'title',
            label: t('kitchen:ops.qc.columnSubject'),
            width: 220,
            priority: 100,
            value: (row) => row.subjectId,
            sort: (left, right, direction) =>
                compareText(left.subjectId, right.subjectId, direction),
            render: (row) => (
                <Text
                    variant="mono"
                    numberOfLines={1}
                    testID={`${qualityCheckRowTestId(String(row.id))}-subject`}
                >
                    {shortId(row.subjectId)}
                </Text>
            ),
        },
        {
            key: 'kind',
            role: 'meta',
            label: t('kitchen:ops.qc.columnKind'),
            width: 190,
            priority: 80,
            value: (row) => t(qualityCheckSubjectKey(row.subjectType)),
            // A closed set of two, and the list is the whole answer, so it narrows in memory.
            filter: {
                values: () =>
                    QUALITY_CHECK_SUBJECT_TYPES.map((value) => ({
                        key: value,
                        label: t(qualityCheckSubjectKey(value)),
                    })),
                match: (row, value) => row.subjectType === value,
            },
            render: (row) => (
                <Text tone="secondary" testID={`${qualityCheckRowTestId(String(row.id))}-kind`}>
                    {t(qualityCheckSubjectKey(row.subjectType))}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.qc.columnStatus'),
            width: 110,
            priority: 90,
            value: (row) => t(qualityCheckStatusKey(row.status)),
            // The toolbar segments' own state, so the two never disagree. The header offers all
            // four, Passed included, which is what lets the segments name only three.
            filter: {
                values: () =>
                    QUALITY_CHECK_STATUSES.map((value) => ({
                        key: value,
                        label: t(qualityCheckStatusKey(value)),
                    })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(QUALITY_CHECK_STATUSES.find((value) => value === next) ?? 'all');
                        setViewing(null);
                    },
                },
            },
            render: (row) => (
                <Badge
                    testID={`${qualityCheckRowTestId(String(row.id))}-status`}
                    tone={qualityCheckStatusTone(row.status)}
                    label={t(qualityCheckStatusKey(row.status))}
                />
            ),
        },
    ];

    const controls = useColumnControls(filtered, columns, 'kitchen-qc');
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    // A header filter can narrow the rows under the page in hand; land on the last page there is.
    const currentPage = Math.min(page, totalPages);
    const pageRows = controls.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const failure = toFailure(checks.error);
    const unfiltered = trimmed === '' && status === 'all' && !controls.filtered;

    const statusSegments: readonly CatalogueStatusSegment<StatusSegmentValue>[] = [
        { value: 'all', label: t('kitchen:toolbar.statusAll') },
        ...SEGMENT_STATUSES.map((value) => ({ value, label: t(qualityCheckStatusKey(value)) })),
    ];

    const viewingAction = viewing === null ? null : lifecycleAction(viewing);

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-qc-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={t(qualityCheckSubjectKey(viewing.subjectType))}
                kind={t('kitchen:ops.qc.viewKind')}
                status={{
                    label: t(qualityCheckStatusKey(viewing.status)),
                    tone: qualityCheckStatusTone(viewing.status),
                }}
                {...(viewing.status === 'hold' ? { note: t('kitchen:ops.qc.holdNote') } : {})}
                footNote={t('kitchen:ops.qc.footNote')}
                fields={[
                    {
                        key: 'reference',
                        label: t('kitchen:ops.qc.fieldReference'),
                        value: String(viewing.id),
                        mono: true,
                    },
                    {
                        key: 'kind',
                        label: t('kitchen:ops.qc.columnKind'),
                        value: t(qualityCheckSubjectKey(viewing.subjectType)),
                    },
                    {
                        key: 'subject',
                        label: t('kitchen:ops.qc.subjectIdLabel'),
                        value: viewing.subjectId,
                        mono: true,
                    },
                ]}
                {...(viewingAction === null
                    ? {}
                    : {
                          primaryAction: {
                              label: viewingAction.label,
                              icon: null,
                              testID: `kitchen-qc-view-${viewingAction.key}`,
                              onPress: viewingAction.run,
                          },
                      })}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-qc-screen">
            {checks.isPending || failure !== null ? null : (
                <CatalogueStatCards testID="kitchen-qc-stats" cards={qcCards(controls.rows, t)} />
            )}

            <CatalogueToolbar<StatusSegmentValue>
                testID="kitchen-qc-toolbar"
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.qc.searchPlaceholder')}
                statusLabel={t('kitchen:toolbar.statusLabel')}
                statusSegments={statusSegments}
                status={status}
                onStatusChange={(next) => {
                    setStatus(next);
                    setViewing(null);
                }}
            >
                {canManage ? (
                    <Button
                        testID="kitchen-qc-create"
                        label={t('kitchen:ops.qc.create')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={onCreate}
                    />
                ) : null}
            </CatalogueToolbar>

            {checks.isPending ? (
                <Stack space="xs" testID="kitchen-qc-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-row-sm" />
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-qc-error"
                    title={t('kitchen:ops.qc.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void checks.refetch();
                    }}
                    retrying={checks.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-qc-empty"
                    title={
                        unfiltered
                            ? t('kitchen:ops.qc.emptyTitle')
                            : t('kitchen:ops.qc.filteredEmptyTitle')
                    }
                    body={
                        unfiltered
                            ? t('kitchen:ops.qc.emptyBody')
                            : t('kitchen:ops.qc.filteredEmptyBody')
                    }
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<QualityCheck>
                        testID="kitchen-qc-checks"
                        label={t('kitchen:ops.qc.checksHeading')}
                        columns={controls.columns}
                        rows={pageRows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={setViewing}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => {
                            const action = lifecycleAction(row);
                            return [
                                {
                                    key: 'view',
                                    label: t('kitchen:list.view'),
                                    icon: CATALOGUE_ROW_ICONS.view,
                                    testID: `${qualityCheckRowTestId(String(row.id))}-view`,
                                    onSelect: () => {
                                        setViewing(row);
                                    },
                                },
                                ...(action === null
                                    ? []
                                    : [
                                          {
                                              key: action.key,
                                              label: action.label,
                                              icon:
                                                  action.key === 'hold'
                                                      ? ('warning' as const)
                                                      : ('check' as const),
                                              testID: `${qualityCheckRowTestId(String(row.id))}-${action.key}`,
                                              onSelect: action.run,
                                          },
                                      ]),
                            ];
                        }}
                    />

                    <CataloguePager
                        testID="kitchen-qc-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: pageRows.length,
                            total: controls.rows.length,
                        })}
                        page={currentPage}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            setViewing(null);
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Stack>
    );
}

/** Counted over the rows in hand, like the design's CARDS. */
function qcCards(rows: readonly QualityCheck[], t: TFunction): readonly CatalogueStatCard[] {
    const count = (status: QualityCheckStatus) =>
        rows.filter((row) => row.status === status).length;
    const held = count('hold');
    return [
        {
            key: 'pending',
            label: t('kitchen:ops.qc.metrics.openChecks'),
            value: String(count('pending')),
            unit: t('kitchen:ops.qc.statUnit'),
            caption: t('kitchen:ops.qc.statPendingCaption'),
            mark: 'clock',
        },
        {
            key: 'hold',
            label: t('kitchen:ops.qc.metrics.holds'),
            value: String(held),
            unit: t('kitchen:ops.qc.statUnit'),
            caption: t('kitchen:ops.qc.statHoldCaption'),
            mark: 'warning',
            tone: held === 0 ? 'default' : 'danger',
        },
        {
            key: 'released',
            label: t('kitchen:ops.qc.metrics.releases'),
            value: String(count('released')),
            unit: t('kitchen:ops.qc.statUnit'),
            caption: t('kitchen:ops.qc.statReleasedCaption'),
            mark: 'check',
        },
    ];
}

/* ------------------------------------------------------------------------------------------------
 * New check — the generic editor
 * ---------------------------------------------------------------------------------------------- */

function QualityCheckCreate({ onDone }: { readonly onDone: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    const concurrency = useOptimisticConcurrency({ onReload: onDone });
    const createCheck = useCreateQualityCheckMutation();

    const [subjectType, setSubjectType] = useState<QualityCheckSubjectType>('goods_receipt');
    const [subjectId, setSubjectId] = useState('');

    const subjectOptions = QUALITY_CHECK_SUBJECT_TYPES.map((value) => ({
        value,
        label: t(qualityCheckSubjectKey(value)),
    }));

    const saveFailure = toFailure(createCheck.error);

    function submit() {
        const trimmed = subjectId.trim();
        if (trimmed === '') return;
        createCheck.mutate(
            { subjectType, subjectId: trimmed },
            {
                onSuccess: () => {
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-qc-created-toast',
                        tone: 'success',
                        message: t('kitchen:ops.qc.createdToast'),
                    });
                    onDone();
                },
            },
        );
    }

    return (
        <EditorFrame
            testID="kitchen-qc-create-editor"
            title={t('kitchen:ops.qc.createTitle')}
            titleChip={{ label: t('kitchen:ops.qc.createChip'), tone: 'danger' }}
            meta={null}
            guard={guard}
            concurrency={concurrency}
            saveLabel={t('kitchen:ops.qc.createSubmit')}
            saving={createCheck.isPending}
            saveDisabled={subjectId.trim() === ''}
            onSaveDraft={submit}
            backLabel={t('kitchen:ops.qc.backToList')}
            onBack={onDone}
            banner={
                saveFailure === null ? undefined : (
                    <Callout
                        testID="kitchen-qc-create-error"
                        role="alert"
                        tone="danger"
                        title={t('kitchen:ops.qc.createFailed')}
                        body={saveFailure.message}
                    />
                )
            }
        >
            <FormSection
                first
                testID="kitchen-qc-create-subject"
                title={t('kitchen:ops.qc.subjectSection')}
                description={t('kitchen:ops.qc.footNote')}
            >
                <Stack space="sm">
                    <Select
                        testID="kitchen-qc-subject-type"
                        id="kitchen-qc-subject-type"
                        label={t('kitchen:ops.qc.subjectTypeLabel')}
                        options={subjectOptions}
                        value={subjectType}
                        onChange={(next) => {
                            setSubjectType(next);
                            guard.markDirty();
                        }}
                        className="min-w-[260px]"
                    />
                    <TextInputField
                        testID="kitchen-qc-subject-id"
                        id="kitchen-qc-subject-id"
                        label={t('kitchen:ops.qc.subjectIdLabel')}
                        hint={t('kitchen:ops.qc.subjectIdHint')}
                        value={subjectId}
                        onChangeText={(next) => {
                            setSubjectId(next);
                            guard.markDirty();
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </Stack>
            </FormSection>
        </EditorFrame>
    );
}
