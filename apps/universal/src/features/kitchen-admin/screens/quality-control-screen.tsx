import type { QualityCheck, QualityCheckStatus } from '@healthy360/api-client/contracts';
import {
    QUALITY_CHECK_STATUSES,
    QUALITY_CHECK_SUBJECT_TYPES,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    Stack,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useHoldQualityCheckMutation,
    useQualityChecksQuery,
    useReleaseQualityCheckMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart, LensTone, LensToken } from '../catalogue/lens-bar.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    qualityCheckRowTestId,
    qualityCheckStatusKey,
    qualityCheckStatusTone,
    qualityCheckSubjectKey,
} from '../ops-format.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { QualityCheckCreate } from '../quality-check-create.tsx';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPage,
    useRememberedQuery,
} from '../list-memory.ts';
import { useViewedRecord } from '../use-viewed-record.ts';

/** The subject as a reader names it, for sorting: its label, or the bare id when it has none. */
function subjectName(row: QualityCheck): string {
    return row.subjectLabel ?? row.subjectId;
}

/**
 * `/kitchen/qc` — quality checks on receipts and production batches (Operations handoff, `qc`).
 *
 * ```
 * (All checks 12) │ ● Pending 4  ● On hold 1  ● Released 6                  [ + New check ]
 * [ ⌕ subject id                                     ]  [Status: On hold ×]   1 of 12  Clear
 * SUBJECT           KIND                STATUS   ◉ ⏸ ▶
 * ```
 *
 * Hold and release are the only lifecycle actions beyond opening a check (O3/O4). Subjects are
 * limited to `goods_receipt` and `production_order`. "New check" opens `QualityCheckCreate`, where
 * the subject is picked from this branch's recent receipts and batches.
 *
 * ## What the design shows that the contract does not
 *
 * `QualityCheck` is an id, a subject (named by the server where it still resolves) and a status. The design's Opened, Opened by and Outcome
 * columns have no field behind them, so they are not drawn.
 */
export function QualityControlScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-qc"
        >
            <QualityControl view={view} />
        </Gate>
    );
}

const PAGE_SIZE = 18;
const NO_CHECKS: readonly QualityCheck[] = [];
/** The statuses drawn as figures. Passed is the header's alone, and a part of the mix. */
const FIGURE_STATUSES: readonly QualityCheckStatus[] = ['pending', 'hold', 'released'];
type StatusSegmentValue = QualityCheckStatus | 'all';

function shortId(id: string): string {
    return `${id.slice(0, 8)}…`;
}

function QualityControl({ view }: { readonly view?: string | undefined }) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    // A check the editor sent the reader to — its duplicate warning's "Open" — shown on arrival.
    const [opening, setOpening] = useState<QualityCheck | null>(null);
    return creating ? (
        <QualityCheckCreate
            onDone={() => {
                setCreating(false);
            }}
            onOpenCheck={(check) => {
                setOpening(check);
                setCreating(false);
                router.setParams({ view: String(check.id) } as never);
            }}
        />
    ) : (
        <QualityCheckList
            view={view}
            initialViewing={opening}
            onCreate={() => {
                setOpening(null);
                setCreating(true);
            }}
        />
    );
}

function QualityCheckList({
    view,
    initialViewing,
    onCreate,
}: {
    readonly view: string | undefined;
    /** The check the create form sent the reader to, when the address does not name one yet. */
    readonly initialViewing: QualityCheck | null;
    readonly onCreate: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const checks = useQualityChecksQuery();
    const holdCheck = useHoldQualityCheckMutation();
    const releaseCheck = useReleaseQualityCheckMutation();

    // Search, status, page and the check last opened survive leaving the list — for another page,
    // or for the create form this screen swaps in.
    const memory = useListMemory('kitchen.quality-checks');
    const [query, setQuery] = useRememberedQuery(memory);
    const [status, setStatus] = useRememberedFilter<StatusSegmentValue>(memory, 'status', 'all');
    // The open check is an address, `?view=`, so Back and a refresh keep it open.
    const { viewing, setViewing } = useViewedRecord(
        view,
        checks.data ?? NO_CHECKS,
        (row) => String(row.id),
        checks.isSuccess && !checks.isFetching,
        { seed: initialViewing },
    );
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const openView = (row: QualityCheck) => {
        rememberOpened(String(row.id));
        setViewing(row);
    };

    const trimmed = query.trim().toLowerCase();
    // The checks the search leaves, the status aside: what the status figures count.
    const scopeRows = useMemo(
        () =>
            trimmed === ''
                ? (checks.data ?? NO_CHECKS)
                : (checks.data ?? NO_CHECKS).filter((row) =>
                      `${String(row.id)} ${row.subjectId} ${row.subjectLabel ?? ''} ${row.subjectDetail ?? ''}`
                          .toLowerCase()
                          .includes(trimmed),
                  ),
        [checks.data, trimmed],
    );
    const filtered = useMemo(
        () => (status === 'all' ? scopeRows : scopeRows.filter((row) => row.status === status)),
        [scopeRows, status],
    );

    // Back to page one whenever the search or the status changes — `useListPage`'s reset, keyed
    // on the two as text.
    const [page, setPage] = useRememberedPage(memory, `${trimmed}|${status}`);

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
            value: (row) => subjectName(row),
            sort: (left, right, direction) =>
                compareText(subjectName(left), subjectName(right), direction),
            // By name — the supplier and invoice, or the batch's lot — with what it holds under it.
            // The bare id only when the subject no longer resolves.
            render: (row) => (
                <View className="min-w-0 flex-col">
                    <Text
                        {...(row.subjectLabel == null ? { variant: 'mono' as const } : {})}
                        numberOfLines={1}
                        testID={`${qualityCheckRowTestId(String(row.id))}-subject`}
                    >
                        {row.subjectLabel ?? shortId(row.subjectId)}
                    </Text>
                    {row.subjectDetail == null ? null : (
                        <Text
                            variant="caption"
                            tone="secondary"
                            numberOfLines={1}
                            testID={`${qualityCheckRowTestId(String(row.id))}-subject-detail`}
                        >
                            {row.subjectDetail}
                        </Text>
                    )}
                </View>
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

    const pickStatus = (next: StatusSegmentValue) => {
        setStatus(next);
        setViewing(null);
    };
    const clearFilters = () => {
        setQuery('');
        controls.clearFilters();
        pickStatus('all');
    };
    const statusLabel =
        status === 'all'
            ? null
            : t('kitchen:lens.token', {
                  label: t('kitchen:toolbar.statusLabel'),
                  value: t(qualityCheckStatusKey(status)),
              });
    const tokens: readonly LensToken[] =
        statusLabel === null
            ? []
            : [
                  {
                      key: 'status',
                      label: statusLabel,
                      removeLabel: t('kitchen:toolbar.removeFilter', { filter: statusLabel }),
                      onRemove: () => {
                          pickStatus('all');
                      },
                  },
              ];

    const viewingAction = viewing === null ? null : lifecycleAction(viewing);

    if (viewing !== null) {
        return (
            <RecordViewPage
                testID="kitchen-qc-view"
                onBack={() => {
                    setViewing(null);
                }}
                title={viewing.subjectLabel ?? t(qualityCheckSubjectKey(viewing.subjectType))}
                kind={t('kitchen:ops.qc.viewKind')}
                status={{
                    label: t(qualityCheckStatusKey(viewing.status)),
                    tone: qualityCheckStatusTone(viewing.status),
                }}
                {...(viewing.status === 'hold' ? { note: t('kitchen:ops.qc.holdNote') } : {})}
                footNote={t('kitchen:ops.qc.footNote')}
                fields={[
                    {
                        key: 'kind',
                        label: t('kitchen:ops.qc.columnKind'),
                        value: t(qualityCheckSubjectKey(viewing.subjectType)),
                    },
                    {
                        key: 'subject',
                        label: t('kitchen:ops.qc.columnSubject'),
                        value: viewing.subjectLabel ?? viewing.subjectId,
                        mono: viewing.subjectLabel == null,
                    },
                    ...(viewing.subjectDetail == null
                        ? []
                        : [
                              {
                                  key: 'holds',
                                  label: t('kitchen:ops.qc.fieldHolds'),
                                  value: viewing.subjectDetail,
                              },
                          ]),
                ]}
                {...(viewingAction === null
                    ? {}
                    : {
                          primaryAction: {
                              label: viewingAction.label,
                              icon: null,
                              testID: `kitchen-qc-view-${viewingAction.key}`,
                              onPress: viewingAction.run,
                              // A hold can take seconds on a slow server; say it is working.
                              loading: holdCheck.isPending || releaseCheck.isPending,
                              disabled: holdCheck.isPending || releaseCheck.isPending,
                          },
                      })}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-qc-screen">
            {/* The Lens bar — figures, mix and query row as one object (`lens-bar.tsx`). */}
            <LensBar
                testID="kitchen-qc-toolbar"
                label={t('kitchen:lens.label')}
                {...(failure !== null
                    ? { figures: [] }
                    : qcLens(checks.isPending ? null : scopeRows, status, pickStatus, t))}
                search={query}
                onSearchChange={(next) => {
                    setQuery(next);
                    setViewing(null);
                }}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:ops.qc.searchPlaceholder')}
                tokens={tokens}
                result={
                    checks.isPending
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: checks.data?.length ?? 0,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered ? {} : { onClear: clearFilters })}
                trailing={(narrow) => <ColumnPicker {...controls.picker} compact={narrow} />}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-qc-create"
                            label={t('kitchen:ops.qc.create')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={onCreate}
                        />
                    ) : undefined
                }
            />

            {checks.isPending ? (
                <TableSkeleton testID="kitchen-qc-loading" />
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
                        highlightedId={lastOpenedId}
                        onRowPress={openView}
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
                                        openView(row);
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
        </Cascade>
    );
}

/**
 * The Lens bar's figures: All checks, then Pending · On hold · Released, each a filter, counted over
 * the checks the search leaves. On hold blocks the stock it covers, so it alone takes the alarm.
 * Passed has no figure — the Status header offers it — but it is a part of the mix. `null`: in flight.
 */
function qcLens(
    scope: readonly QualityCheck[] | null,
    status: StatusSegmentValue,
    pick: (next: StatusSegmentValue) => void,
    t: TFunction,
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
} {
    const count = (value: QualityCheckStatus): number =>
        scope === null ? 0 : scope.filter((row) => row.status === value).length;
    return {
        figures: [
            {
                key: 'all',
                label: t('kitchen:lens.allChecks'),
                value: scope === null ? null : scope.length,
                active: status === 'all',
                onPress: () => {
                    pick('all');
                },
                accessibilityLabel: t('kitchen:lens.allAction'),
            },
            ...FIGURE_STATUSES.map((value, index): LensFigure => ({
                key: value,
                label: t(qualityCheckStatusKey(value)),
                value: scope === null ? null : count(value),
                tone: QC_TONES[value],
                alarm: value === 'hold',
                separated: index === 0,
                active: status === value,
                onPress: () => {
                    pick(value);
                },
                accessibilityLabel: t(QC_ACTIONS[value]),
            })),
        ],
        mix: QUALITY_CHECK_STATUSES.map((value) => ({
            key: value,
            value: count(value),
            tone: QC_TONES[value],
            dimmed: status !== 'all' && status !== value,
        })),
        mixLabel: t('kitchen:lens.qcMix', {
            pending: count('pending'),
            hold: count('hold'),
            released: count('released'),
            passed: count('passed'),
        }),
    };
}

const QC_TONES: Readonly<Record<QualityCheckStatus, LensTone>> = {
    pending: 'info',
    passed: 'neutral',
    hold: 'danger',
    released: 'success',
};

const QC_ACTIONS: Readonly<Record<QualityCheckStatus, string>> = {
    pending: 'kitchen:lens.pendingChecksAction',
    passed: 'kitchen:lens.allAction',
    hold: 'kitchen:lens.holdChecksAction',
    released: 'kitchen:lens.releasedChecksAction',
};
