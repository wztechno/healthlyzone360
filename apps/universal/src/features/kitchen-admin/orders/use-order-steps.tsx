import type { KitchenOrder } from '@healthy360/api-client/contracts';
import { useToast } from '@healthy360/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../../data/hooks.ts';
import {
    useConfirmOrderMutation,
    useFulfilOrderMutation,
} from '../../../data/kitchen-orders-hooks.ts';
import {
    AssignDriverDialog,
    CancelOrderDialog,
    DeliveryActionDialog,
    HandToCourierDialog,
    MarkDeliveredDialog,
    RecordPaymentDialog,
} from './order-dialogs.tsx';
import type { DeliveryAction } from './order-dialogs.tsx';
import type { BookRow, NextStep } from './order-book.ts';

/**
 * What an order's buttons do, wherever they are drawn — a row's Next step and the pop-up's
 * actions run through the same hook, so the two can never disagree about what "Confirm" means.
 *
 * Confirm and Mark picked up happen at once. Every other step asks first, in a dialog this hook
 * mounts: Mark delivered (it also ends the driver's run), Choose a driver, Record a payment, Hand to
 * courier, Cancel order and the failed-run actions.
 */

type OpenDialog =
    | { readonly kind: 'deliver'; readonly order: BookRow }
    | { readonly kind: 'driver'; readonly order: BookRow }
    | { readonly kind: 'payment'; readonly order: BookRow }
    | { readonly kind: 'courier'; readonly order: BookRow }
    | { readonly kind: 'cancel'; readonly order: BookRow }
    | { readonly kind: 'delivery'; readonly order: BookRow; readonly action: DeliveryAction };

export type OrderDialogKind = OpenDialog['kind'];

export interface OrderSteps {
    /** Run a row's next step. */
    readonly run: (order: BookRow, step: NextStep) => void;
    /** Open one of the dialogs by name. */
    readonly open: (kind: Exclude<OrderDialogKind, 'delivery'>, order: BookRow) => void;
    readonly openDelivery: (action: DeliveryAction, order: BookRow) => void;
    /** The order a confirm or a close is on its way for — its button spins. */
    readonly pendingId: string | null;
    /** Mount once, beside whatever opened them. */
    readonly dialogs: ReactNode;
}

export function useOrderSteps({
    onChanged,
    onRefresh,
    refreshing,
    // A write from a dialog, so the page can land on the order or close it.
}: {
    readonly onChanged?: ((order: KitchenOrder) => void) | undefined;
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
}): OrderSteps {
    const { t } = useTranslation();
    const toast = useToast();
    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();
    const [dialog, setDialog] = useState<OpenDialog | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);

    function close() {
        setDialog(null);
    }

    function failed(error: unknown, number: string) {
        toast.show({
            testID: 'kitchen-orders-step-error',
            tone: 'danger',
            message: t(
                toFailure(error)?.code === 'resource.conflict'
                    ? 'kitchen:orders.toast.changed'
                    : 'kitchen:orders.toast.failed',
                { number },
            ),
        });
    }

    function fulfil(order: BookRow, delivered: boolean) {
        setPendingId(String(order.id));
        fulfilOrder.mutate(
            { id: order.id, lockVersion: order.lockVersion },
            {
                onSuccess: (next) => {
                    close();
                    onChanged?.(next);
                    toast.show({
                        testID: 'kitchen-orders-fulfilled-toast',
                        tone: 'success',
                        message: t(
                            delivered
                                ? 'kitchen:ops.orders.deliveredToast'
                                : 'kitchen:orders.toast.pickedUp',
                            { number: next.orderNumber },
                        ),
                    });
                },
                onError: (error) => {
                    close();
                    failed(error, order.orderNumber);
                },
                onSettled: () => {
                    setPendingId(null);
                },
            },
        );
    }

    function run(order: BookRow, step: NextStep) {
        switch (step) {
            case 'confirm':
                setPendingId(String(order.id));
                confirmOrder.mutate(
                    { id: order.id, lockVersion: order.lockVersion },
                    {
                        onSuccess: (next) => {
                            onChanged?.(next);
                            toast.show({
                                testID: 'kitchen-orders-confirmed-toast',
                                tone: 'success',
                                message: t('kitchen:ops.orders.confirmedToast', {
                                    number: next.orderNumber,
                                }),
                            });
                        },
                        onError: (error) => {
                            failed(error, order.orderNumber);
                        },
                        onSettled: () => {
                            setPendingId(null);
                        },
                    },
                );
                return;
            case 'pickup':
                fulfil(order, false);
                return;
            case 'deliver':
                setDialog({ kind: 'deliver', order });
                return;
            case 'driver':
                setDialog({ kind: 'driver', order });
                return;
            case 'payment':
                setDialog({ kind: 'payment', order });
                return;
        }
    }

    const dialogs = (() => {
        if (dialog === null) return null;
        const { order } = dialog;
        switch (dialog.kind) {
            case 'deliver':
                return (
                    <MarkDeliveredDialog
                        orderNumber={order.orderNumber}
                        pending={fulfilOrder.isPending}
                        onClose={close}
                        onConfirm={() => {
                            fulfil(order, true);
                        }}
                    />
                );
            case 'driver':
                return order.deliveryJob == null ? null : (
                    <AssignDriverDialog
                        job={order.deliveryJob}
                        orderNumber={order.orderNumber}
                        onClose={close}
                        onAssigned={(name) => {
                            close();
                            toast.show({
                                testID: 'kitchen-orders-assigned-toast',
                                tone: 'success',
                                message: t('kitchen:desk.assign.assignedToast', { name }),
                            });
                        }}
                        onRefresh={onRefresh}
                        refreshing={refreshing}
                        {...(courierReady(order)
                            ? {
                                  onCourier: () => {
                                      setDialog({ kind: 'courier', order });
                                  },
                              }
                            : {})}
                    />
                );
            case 'payment':
                return order.payment === undefined ? null : (
                    <RecordPaymentDialog
                        order={order}
                        payment={order.payment}
                        onClose={close}
                        onRecorded={(amount) => {
                            close();
                            toast.show({
                                testID: 'kitchen-orders-payment-recorded-toast',
                                tone: 'success',
                                message: t('kitchen:desk.recordPayment.recordedToast', {
                                    amount,
                                    number: order.orderNumber,
                                }),
                            });
                        }}
                        onRefresh={onRefresh}
                        refreshing={refreshing}
                    />
                );
            case 'courier':
                return (
                    <HandToCourierDialog
                        order={order}
                        onClose={close}
                        onHanded={(name) => {
                            close();
                            toast.show({
                                testID: 'kitchen-orders-courier-toast',
                                tone: 'success',
                                message: t('kitchen:desk.courier.handedToast', { name }),
                            });
                        }}
                    />
                );
            case 'cancel':
                return (
                    <CancelOrderDialog
                        order={order}
                        onClose={close}
                        onCancelled={(next) => {
                            close();
                            onChanged?.(next);
                            toast.show({
                                testID: 'kitchen-orders-cancelled-toast',
                                tone: 'success',
                                message: t('kitchen:ops.orders.cancelledToast', {
                                    number: next.orderNumber,
                                }),
                            });
                        }}
                    />
                );
            case 'delivery':
                return (
                    <DeliveryActionDialog action={dialog.action} order={order} onClose={close} />
                );
        }
    })();

    return {
        run,
        open: (kind, order) => {
            setDialog({ kind, order } as OpenDialog);
        },
        openDelivery: (action, order) => {
            setDialog({ kind: 'delivery', order, action });
        },
        pendingId,
        dialogs,
    };
}

/**
 * A courier company may take the run once the food is ready and nobody has set off with it — the
 * same rule as the pop-up's Hand to courier.
 */
function courierReady(order: BookRow): boolean {
    const job = order.deliveryJob ?? null;
    return (
        order.fulfilmentType === 'delivery' &&
        job !== null &&
        (order.readyAt ?? null) !== null &&
        (job.status === 'pending' || job.status === 'assigned')
    );
}
