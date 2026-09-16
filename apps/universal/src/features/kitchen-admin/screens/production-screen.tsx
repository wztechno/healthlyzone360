import type { ProductionOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { RecipeVersionId } from '@healthy360/domain-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConfirmProductionOrderMutation,
    useCreateProductionOrderMutation,
    useProductionOrdersQuery,
    useStartProductionOrderMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { PRODUCTION_MANAGE_PERMISSION, PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    isProductionOrderOpen,
    nextProductionEdge,
    productionOrderRowTestId,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import { OpsPanel } from '../ops-panel.tsx';
import type { OpsMetric } from '../ops-panel.tsx';

/**
 * `/kitchen/production` — the batch list, pending its desk (PROD1).
 *
 * **This screen is interim and the plan replaces it** with a five-route desk under
 * `/kitchen/production-desk`. What it does today is honest and small: it lists batches, opens
 * drafts, and advances a batch along the one edge that needs no information — confirm, then start.
 *
 * It deliberately offers **no complete button**. Finishing a batch needs what actually came out:
 * produced, rejected, what went into the pot and what was dropped on the floor. A one-click
 * complete would have to invent a produced quantity, and the whole point of the settlement is that
 * those three facts are three different facts. A batch in production says so and waits for the desk.
 */

export function ProductionScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production"
        >
            <Production />
        </Gate>
    );
}

function Production() {
    const { t } = useTranslation();
    const toast = useToast();
    const access = useAccessState();
    const canManage = useCan(PRODUCTION_MANAGE_PERMISSION);
    const branchId = access.branch?.id ?? null;

    // Every state rather than the open ones, because this list is also the only
    // place a completed batch can be seen until the register lands.
    const orders = useProductionOrdersQuery({});
    const createOrder = useCreateProductionOrderMutation();
    const confirmOrder = useConfirmProductionOrderMutation();
    const startOrder = useStartProductionOrderMutation();

    const [creating, setCreating] = useState(false);
    const [recipeVersionId, setRecipeVersionId] = useState('');

    const rows = orders.data?.orders ?? [];
    const ordersFailure = toFailure(orders.error);
    const openCount = rows.filter((row) => isProductionOrderOpen(row.status)).length;
    const completedCount = rows.filter((row) => row.status === 'completed').length;

    const metrics: readonly OpsMetric[] = [
        {
            key: 'batches',
            labelKey: 'kitchen:ops.production.metrics.batches',
            value: orders.isPending ? null : rows.length,
        },
        {
            key: 'inProgress',
            labelKey: 'kitchen:ops.production.metrics.inProgress',
            value: orders.isPending ? null : openCount,
        },
        {
            key: 'yield',
            labelKey: 'kitchen:ops.production.metrics.yield',
            value: orders.isPending ? null : completedCount,
        },
    ];

    function closeCreating() {
        setCreating(false);
        setRecipeVersionId('');
        createOrder.reset();
    }

    function submitCreate() {
        const trimmed = recipeVersionId.trim();
        if (branchId === null || trimmed === '') return;
        createOrder.mutate(
            {
                branchId,
                recipeVersionId: RecipeVersionId.unsafe(trimmed),
            },
            {
                onSuccess: () => {
                    closeCreating();
                    toast.show({
                        testID: 'kitchen-production-created-toast',
                        tone: 'success',
                        message: t('kitchen:ops.production.createdToast'),
                    });
                },
            },
        );
    }

    /**
     * Advance a batch along its next edge, carrying the version it was read at.
     *
     * Two people share this list, so the `lockVersion` is what stops the second press
     * double-confirming a batch the first already moved.
     */
    function advance(order: ProductionOrder) {
        const edge = nextProductionEdge(order.status);
        if (edge === null) return;

        const variables = { productionOrderId: order.id, lockVersion: order.lockVersion };

        const onSuccess = () => {
            toast.show({
                testID: 'kitchen-production-advanced-toast',
                tone: 'success',
                message: t(
                    edge === 'confirm'
                        ? 'kitchen:ops.production.confirmedToast'
                        : 'kitchen:ops.production.startedToast',
                ),
            });
        };

        if (edge === 'confirm') {
            confirmOrder.mutate(variables, { onSuccess });
            return;
        }

        startOrder.mutate(variables, { onSuccess });
    }

    const columns: readonly TableColumn<ProductionOrder>[] = [
        {
            key: 'id',
            header: t('kitchen:ops.production.columnId'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`${productionOrderRowTestId(String(row.id))}-id`}
                >
                    {String(row.id).slice(0, 8)}…
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:ops.production.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${productionOrderRowTestId(String(row.id))}-status`}
                    tone={productionStatusTone(row.status)}
                    label={t(productionStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'actions',
            header: t('kitchen:ops.production.columnActions'),
            render: (row) => {
                const edge = canManage ? nextProductionEdge(row.status) : null;

                if (edge === null) {
                    return <Text tone="secondary">—</Text>;
                }

                return (
                    <Button
                        testID={`${productionOrderRowTestId(String(row.id))}-${edge}`}
                        size="sm"
                        variant="secondary"
                        label={t(
                            edge === 'confirm'
                                ? 'kitchen:ops.production.confirm'
                                : 'kitchen:ops.production.start',
                        )}
                        loading={confirmOrder.isPending || startOrder.isPending}
                        onPress={() => {
                            advance(row);
                        }}
                    />
                );
            },
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-production-screen">
            <OpsPanel
                testID="kitchen-production-panel"
                titleKey="kitchen:ops.production.title"
                subtitleKey="kitchen:ops.production.subtitle"
                metrics={metrics}
                emptyTitleKey="kitchen:ops.production.emptyTitle"
                emptyBodyKey="kitchen:ops.production.emptyBody"
            >
                {orders.isPending ? (
                    <Skeleton testID="kitchen-production-loading" heightClassName="h-40" />
                ) : null}
                {ordersFailure !== null ? (
                    <ErrorState
                        testID="kitchen-production-error"
                        title={t('kitchen:ops.production.loadErrorTitle')}
                        failure={ordersFailure}
                        onRetry={() => {
                            void orders.refetch();
                        }}
                        retrying={orders.isFetching}
                    />
                ) : null}
                {!orders.isPending && !orders.isError ? (
                    <Stack space="sm">
                        <Inline space="sm" align="center" justify="between">
                            <Heading level={2} testID="kitchen-production-orders-title">
                                {t('kitchen:ops.production.ordersHeading')}
                            </Heading>
                            {canManage ? (
                                <Button
                                    testID="kitchen-production-create"
                                    size="sm"
                                    label={t('kitchen:ops.production.create')}
                                    onPress={() => {
                                        setCreating(true);
                                    }}
                                />
                            ) : null}
                        </Inline>
                        {rows.length === 0 ? (
                            <EmptyState
                                testID="kitchen-production-empty"
                                title={t('kitchen:ops.production.emptyTitle')}
                                body={t('kitchen:ops.production.emptyBody')}
                            />
                        ) : (
                            <Table
                                testID="kitchen-production-orders"
                                caption={t('kitchen:ops.production.ordersHeading')}
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
                testID="kitchen-production-create-dialog"
                open={creating}
                onClose={closeCreating}
                title={t('kitchen:ops.production.createTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-production-create-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={closeCreating}
                        />
                        <Button
                            testID="kitchen-production-create-submit"
                            label={t('kitchen:ops.production.createSubmit')}
                            loading={createOrder.isPending}
                            disabled={branchId === null || recipeVersionId.trim() === ''}
                            onPress={submitCreate}
                        />
                    </>
                }
            >
                <Stack space="md">
                    {branchId === null ? (
                        <EmptyState
                            testID="kitchen-production-no-branch"
                            title={t('kitchen:ops.production.noBranchTitle')}
                            body={t('kitchen:ops.production.noBranchBody')}
                        />
                    ) : (
                        <TextInputField
                            testID="kitchen-production-version"
                            id="kitchen-production-version"
                            label={t('kitchen:ops.production.versionLabel')}
                            hint={t('kitchen:ops.production.versionHint')}
                            value={recipeVersionId}
                            onChangeText={setRecipeVersionId}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    )}
                    {createOrder.error === null ? null : (
                        <Text tone="danger" testID="kitchen-production-create-error">
                            {toFailure(createOrder.error)?.message ??
                                t('kitchen:ops.production.createFailed')}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </Stack>
    );
}
