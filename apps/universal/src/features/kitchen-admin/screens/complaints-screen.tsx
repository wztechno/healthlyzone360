import type { OrderComplaint } from '@healthy360/api-client/contracts';
import { COMPLAINT_OUTCOMES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    Dialog,
    EmptyState,
    ErrorState,
    Select,
    Stack,
    TableSkeleton,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { parseMinorAmount } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useOrderComplaintsQuery,
    useOrderRefundsQuery,
    useRemakeComplaintMutation,
    useUpdateComplaintMutation,
} from '../../../data/kitchen-orders-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart } from '../catalogue/lens-bar.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { ORDER_SUPERVISE_PERMISSION } from '../entity-registry.ts';
import {
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPage,
    useRememberedQuery,
} from '../list-memory.ts';
import { useViewedRecord } from '../use-viewed-record.ts';

/**
 * `/kitchen/complaints`: what went wrong with orders, what it cost and how it ended. A complaint is
 * opened from its order's page. Here it is closed, with an outcome, or remade: a real order at zero
 * that reaches the kitchen and the stock as any order does.
 */
export function ComplaintsScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_SUPERVISE_PERMISSION] }}
            testID="kitchen-complaints"
        >
            <Complaints view={view} />
        </Gate>
    );
}

const PAGE_SIZE = 18;
const NONE: readonly OrderComplaint[] = [];
const MEDIUM_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
type StateFilter = 'all' | 'open' | 'closed';

function isOpen(row: OrderComplaint): boolean {
    return row.outcome === null;
}

function Complaints({ view }: { readonly view: string | undefined }) {
    const { t } = useTranslation();
    const toast = useToast();
    const router = useRouter();
    const formatter = useFormatter();
    const complaints = useOrderComplaintsQuery();
    const remake = useRemakeComplaintMutation();

    const memory = useListMemory('kitchen.complaints');
    const [query, setQuery] = useRememberedQuery(memory);
    const [state, setState] = useRememberedFilter<StateFilter>(memory, 'state', 'all');
    const { viewing, setViewing } = useViewedRecord(
        view,
        complaints.data ?? NONE,
        (row) => row.id,
        complaints.isSuccess && !complaints.isFetching,
    );
    const [lastOpenedId, rememberOpened] = useRememberedOpened(memory);
    const [closing, setClosing] = useState(false);

    const money = (row: OrderComplaint) =>
        formatMoney(formatter, { amount: row.costMinor, currency: row.currencyCode });
    const stateLabel = (row: OrderComplaint) =>
        row.outcome === null
            ? t('kitchen:complaints.stateOpen')
            : t(`kitchen:complaints.outcome.${row.outcome}`);

    const trimmed = query.trim().toLowerCase();
    const scope = useMemo(
        () =>
            (complaints.data ?? NONE).filter((row) =>
                `${row.orderNumber ?? ''} ${row.description ?? ''}`
                    .toLowerCase()
                    .includes(trimmed),
            ),
        [complaints.data, trimmed],
    );
    const filtered = useMemo(
        () =>
            state === 'all'
                ? scope
                : scope.filter((row) => (state === 'open' ? isOpen(row) : !isOpen(row))),
        [scope, state],
    );
    const [page, setPage] = useRememberedPage(memory, `${trimmed}|${state}`);

    const columns: readonly ControlledColumn<OrderComplaint, CatalogueColumn<OrderComplaint>>[] = [
        {
            key: 'order',
            role: 'title',
            label: t('kitchen:complaints.columnOrder'),
            width: 160,
            priority: 100,
            value: (row) => row.orderNumber ?? '',
            sort: (left, right, direction) =>
                compareText(left.orderNumber ?? '', right.orderNumber ?? '', direction),
            render: (row) => <Text numberOfLines={1}>{row.orderNumber}</Text>,
        },
        {
            key: 'cause',
            role: 'meta',
            label: t('kitchen:complaints.columnCause'),
            width: 180,
            priority: 90,
            value: (row) => t(`kitchen:complaints.cause.${row.cause}`),
            render: (row) => (
                <Text tone="secondary">{t(`kitchen:complaints.cause.${row.cause}`)}</Text>
            ),
        },
        {
            key: 'cost',
            role: 'meta',
            label: t('kitchen:complaints.columnCost'),
            width: 110,
            priority: 70,
            value: (row) => money(row),
            render: (row) => <Text tone="secondary">{money(row)}</Text>,
        },
        {
            key: 'state',
            role: 'status',
            label: t('kitchen:complaints.columnState'),
            width: 130,
            priority: 80,
            value: (row) => stateLabel(row),
            render: (row) => (
                <Badge tone={isOpen(row) ? 'warning' : 'neutral'} label={stateLabel(row)} />
            ),
        },
    ];

    const controls = useColumnControls(filtered, columns, 'kitchen-complaints');
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const pageRows = controls.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const failure = toFailure(complaints.error);
    const unfiltered = trimmed === '' && state === 'all' && !controls.filtered;
    const remakeFailure = toFailure(remake.error);

    const openRecord = (row: OrderComplaint) => {
        rememberOpened(row.id);
        setViewing(row);
    };

    if (viewing !== null) {
        return (
            <>
                <RecordViewPage
                    testID="kitchen-complaints-view"
                    onBack={() => {
                        setViewing(null);
                    }}
                    title={viewing.orderNumber ?? t('kitchen:complaints.viewKind')}
                    kind={t('kitchen:complaints.viewKind')}
                    status={{
                        label: stateLabel(viewing),
                        tone: isOpen(viewing) ? 'warning' : 'neutral',
                    }}
                    {...(remakeFailure === null ? {} : { note: remakeFailure.message })}
                    fields={[
                        {
                            key: 'cause',
                            label: t('kitchen:complaints.columnCause'),
                            value: t(`kitchen:complaints.cause.${viewing.cause}`),
                        },
                        {
                            key: 'cost',
                            label: t('kitchen:complaints.columnCost'),
                            value: money(viewing),
                        },
                        {
                            key: 'opened',
                            label: t('kitchen:complaints.fieldOpened'),
                            value:
                                viewing.createdAt === null
                                    ? t('kitchen:list.noValue')
                                    : formatter.formatDate(viewing.createdAt, MEDIUM_DATE),
                        },
                        ...(viewing.description === null
                            ? []
                            : [
                                  {
                                      key: 'description',
                                      label: t('kitchen:complaints.fieldDescription'),
                                      value: viewing.description,
                                  },
                              ]),
                        ...(viewing.remakeOrderNumber === null
                            ? []
                            : [
                                  {
                                      key: 'remake',
                                      label: t('kitchen:complaints.fieldRemake'),
                                      value: viewing.remakeOrderNumber,
                                  },
                              ]),
                    ]}
                    sections={[
                        {
                            key: 'order',
                            title: t('kitchen:complaints.columnOrder'),
                            content: (
                                <Stack space="xs">
                                    <Button
                                        testID="kitchen-complaints-open-order"
                                        variant="secondary"
                                        size="sm"
                                        label={t('kitchen:complaints.openOrder')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchen/orders?view=${encodeURIComponent(String(viewing.orderId))}` as never,
                                            );
                                        }}
                                    />
                                    {!isOpen(viewing) ? null : (
                                        <Button
                                            testID="kitchen-complaints-close"
                                            variant="secondary"
                                            size="sm"
                                            label={t('kitchen:complaints.close')}
                                            onPress={() => {
                                                setClosing(true);
                                            }}
                                        />
                                    )}
                                </Stack>
                            ),
                        },
                    ]}
                    {...(!isOpen(viewing)
                        ? {}
                        : {
                              primaryAction: {
                                  label: t('kitchen:complaints.remake'),
                                  icon: null,
                                  testID: 'kitchen-complaints-remake',
                                  loading: remake.isPending,
                                  disabled: remake.isPending,
                                  onPress: () => {
                                      remake.mutate(viewing.id, {
                                          onSuccess: (done) => {
                                              setViewing(done);
                                              toast.show({
                                                  testID: 'kitchen-complaints-remade-toast',
                                                  tone: 'success',
                                                  message: t('kitchen:complaints.remadeToast', {
                                                      number: done.remakeOrderNumber,
                                                  }),
                                              });
                                          },
                                      });
                                  },
                              },
                          })}
                />
                {!closing ? null : (
                    <CloseDialog
                        complaint={viewing}
                        onClose={(done) => {
                            setClosing(false);
                            if (done !== null) setViewing(done);
                        }}
                    />
                )}
            </>
        );
    }

    return (
        <Cascade space="md" testID="kitchen-complaints-screen">
            <LensBar
                testID="kitchen-complaints-toolbar"
                label={t('kitchen:lens.label')}
                {...(failure !== null
                    ? { figures: [] }
                    : lens(complaints.isPending ? null : scope, state, setState, t))}
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('kitchen:toolbar.searchLabel')}
                searchPlaceholder={t('kitchen:complaints.searchPlaceholder')}
                tokens={[]}
                result={
                    complaints.isPending
                        ? null
                        : t('kitchen:lens.result', {
                              shown: controls.rows.length,
                              total: complaints.data?.length ?? 0,
                          })
                }
                clearLabel={t('kitchen:lens.clear')}
                {...(unfiltered
                    ? {}
                    : {
                          onClear: () => {
                              setQuery('');
                              controls.clearFilters();
                              setState('all');
                          },
                      })}
            />

            {complaints.isPending ? (
                <TableSkeleton testID="kitchen-complaints-loading" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-complaints-error"
                    title={t('kitchen:complaints.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void complaints.refetch();
                    }}
                    retrying={complaints.isFetching}
                />
            ) : controls.rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-complaints-empty"
                    title={t('kitchen:complaints.emptyTitle')}
                    body={t('kitchen:complaints.emptyBody')}
                />
            ) : (
                <Stack space="sm">
                    <CatalogueList<OrderComplaint>
                        testID="kitchen-complaints-list"
                        label={t('kitchen:families.complaints.name')}
                        columns={controls.columns}
                        rows={pageRows}
                        rowKey={(row) => row.id}
                        highlightedId={lastOpenedId}
                        onRowPress={openRecord}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `kitchen-complaints-row-${row.id}-view`,
                                onSelect: () => {
                                    openRecord(row);
                                },
                            },
                        ]}
                    />
                    <CataloguePager
                        testID="kitchen-complaints-pagination"
                        page={currentPage}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Cascade>
    );
}

function lens(
    scope: readonly OrderComplaint[] | null,
    state: StateFilter,
    pick: (next: StateFilter) => void,
    t: ReturnType<typeof useTranslation>['t'],
): {
    readonly figures: readonly LensFigure[];
    readonly mix: readonly LensMixPart[];
    readonly mixLabel: string;
} {
    const open = scope === null ? 0 : scope.filter(isOpen).length;
    const closed = scope === null ? 0 : scope.length - open;
    return {
        figures: [
            {
                key: 'all',
                label: t('kitchen:complaints.figureAll'),
                value: scope === null ? null : scope.length,
                active: state === 'all',
                onPress: () => {
                    pick('all');
                },
                accessibilityLabel: t('kitchen:lens.allAction'),
            },
            {
                key: 'open',
                label: t('kitchen:complaints.stateOpen'),
                value: scope === null ? null : open,
                tone: 'danger',
                alarm: true,
                separated: true,
                active: state === 'open',
                onPress: () => {
                    pick('open');
                },
                accessibilityLabel: t('kitchen:complaints.figureOpenAction'),
            },
            {
                key: 'closed',
                label: t('kitchen:complaints.stateClosed'),
                value: scope === null ? null : closed,
                tone: 'neutral',
                active: state === 'closed',
                onPress: () => {
                    pick('closed');
                },
                accessibilityLabel: t('kitchen:complaints.figureClosedAction'),
            },
        ],
        mix: [
            { key: 'open', value: open, tone: 'danger', dimmed: state === 'closed' },
            { key: 'closed', value: closed, tone: 'neutral', dimmed: state === 'open' },
        ],
        mixLabel: t('kitchen:complaints.mix', { open, closed }),
    };
}

/** Close with an outcome, what it finally cost, and the refund when the answer was money. */
function CloseDialog({
    complaint,
    onClose,
}: {
    readonly complaint: OrderComplaint;
    readonly onClose: (done: OrderComplaint | null) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const update = useUpdateComplaintMutation();
    const ledger = useOrderRefundsQuery(complaint.orderId);
    const [outcome, setOutcome] = useState<'refunded' | 'apologised' | 'no_action'>('apologised');
    const [cost, setCost] = useState(String(complaint.costMinor / 100));
    const [refundId, setRefundId] = useState<string | null>(complaint.orderRefundId);
    const costMinor = parseMinorAmount(cost, complaint.currencyCode);
    const failure = toFailure(update.error);

    return (
        <Dialog
            testID="kitchen-complaints-close-dialog"
            open
            onClose={() => {
                onClose(null);
            }}
            title={t('kitchen:complaints.closeTitle')}
            actions={
                <Button
                    testID="kitchen-complaints-close-confirm"
                    label={t('kitchen:complaints.closeConfirm')}
                    loading={update.isPending}
                    disabled={update.isPending || costMinor === null}
                    onPress={() => {
                        if (costMinor === null) return;
                        update.mutate(
                            {
                                complaintId: complaint.id,
                                outcome,
                                costMinor,
                                ...(refundId === null ? {} : { orderRefundId: refundId }),
                            },
                            {
                                onSuccess: (done) => {
                                    onClose(done);
                                },
                            },
                        );
                    }}
                />
            }
        >
            <Stack space="sm">
                <Select
                    testID="kitchen-complaints-close-outcome"
                    label={t('kitchen:complaints.fieldOutcome')}
                    size="sm"
                    value={outcome}
                    options={COMPLAINT_OUTCOMES.flatMap((value) =>
                        value === 'remade'
                            ? []
                            : [{ value, label: t(`kitchen:complaints.outcome.${value}`) }],
                    )}
                    onChange={setOutcome}
                />
                <TextInputField
                    testID="kitchen-complaints-close-cost"
                    id="kitchen-complaints-close-cost"
                    label={t('kitchen:complaints.columnCost')}
                    hint={t('kitchen:complaints.costHint')}
                    size="sm"
                    inputMode="decimal"
                    value={cost}
                    onChangeText={setCost}
                />
                {outcome !== 'refunded' || (ledger.data?.entries.length ?? 0) === 0 ? null : (
                    <Select
                        testID="kitchen-complaints-close-refund"
                        label={t('kitchen:complaints.fieldRefund')}
                        size="sm"
                        value={refundId}
                        options={(ledger.data?.entries ?? []).map((entry) => ({
                            value: entry.id,
                            label: `${formatMoney(formatter, {
                                amount: entry.amountMinor,
                                currency: complaint.currencyCode,
                            })} · ${entry.reason}`,
                        }))}
                        onChange={setRefundId}
                    />
                )}
                {failure === null ? null : (
                    <Text variant="caption" tone="danger" testID="kitchen-complaints-close-error">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
