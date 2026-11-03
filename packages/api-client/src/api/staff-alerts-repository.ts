import { OrderId } from '@healthy360/domain-types';

import type {
    KitchenServiceSettings,
    StaffAlert,
    StaffAlertList,
    StaffAlertsRepository,
} from '../contracts/staff-alerts.ts';
import type {
    KitchenServiceSettings as WireKitchenServiceSettings,
    StaffNotification as WireStaffNotification,
    StaffNotificationsEnvelope,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * The bell over `/catalogue/staff-notifications`, and the timings over
 * `/catalogue/kitchen-service-settings`. `requestEnvelope` on the list, because the unread count
 * lives in the meta. No `If-Match` on the timings: the row carries no lock version.
 */
export function createApiStaffAlertsRepository(transport: Transport): StaffAlertsRepository {
    return {
        async listAlerts(): Promise<StaffAlertList> {
            const envelope = await transport.requestEnvelope<readonly WireStaffNotification[]>({
                method: 'GET',
                path: '/catalogue/staff-notifications',
            });

            const meta = envelope.meta as StaffNotificationsEnvelope['meta'];
            return { alerts: envelope.data.map(mapStaffAlert), unreadCount: meta.unread_count };
        },

        markAlertRead(alertId: string): Promise<void> {
            return transport.requestVoid({
                method: 'POST',
                path: `/catalogue/staff-notifications/${encodeURIComponent(alertId)}/read`,
            });
        },

        markAllAlertsRead(): Promise<void> {
            return transport.requestVoid({
                method: 'POST',
                path: '/catalogue/staff-notifications/read-all',
            });
        },

        async getServiceSettings(): Promise<KitchenServiceSettings> {
            return mapServiceSettings(
                await transport.request<WireKitchenServiceSettings>({
                    method: 'GET',
                    path: '/catalogue/kitchen-service-settings',
                }),
            );
        },

        async saveServiceSettings(
            settings: Omit<KitchenServiceSettings, 'pausedUntil'>,
        ): Promise<KitchenServiceSettings> {
            return mapServiceSettings(
                await transport.request<WireKitchenServiceSettings>({
                    method: 'PUT',
                    path: '/catalogue/kitchen-service-settings',
                    body: {
                        order_lead_minutes: settings.orderLeadMinutes,
                        alarm_after_minutes: settings.alarmAfterMinutes,
                        manager_alert_after_minutes: settings.managerAlertAfterMinutes,
                        owner_alert_after_minutes: settings.ownerAlertAfterMinutes,
                        orders_per_window: settings.ordersPerWindow,
                        refund_approval_above_minor: settings.refundApprovalAboveMinor,
                        price_approval_above_percent: settings.priceApprovalAbovePercent,
                        dish_margin_target_percent: settings.dishMarginTargetPercent,
                    },
                }),
            );
        },

        async pauseKitchen(minutes: number): Promise<KitchenServiceSettings> {
            return mapServiceSettings(
                await transport.request<WireKitchenServiceSettings>({
                    method: 'POST',
                    path: '/catalogue/kitchen-pause',
                    body: { minutes },
                }),
            );
        },

        async resumeKitchen(): Promise<KitchenServiceSettings> {
            return mapServiceSettings(
                await transport.request<WireKitchenServiceSettings>({
                    method: 'DELETE',
                    path: '/catalogue/kitchen-pause',
                }),
            );
        },
    };
}

function mapStaffAlert(wire: WireStaffNotification): StaffAlert {
    return {
        id: wire.id,
        type: wire.type,
        orderId: OrderId.unsafe(wire.order_id),
        orderNumber: wire.order_number,
        severe: wire.severe,
        readAt: wire.read_at,
        createdAt: wire.created_at,
    };
}

function mapServiceSettings(wire: WireKitchenServiceSettings): KitchenServiceSettings {
    return {
        orderLeadMinutes: wire.order_lead_minutes,
        alarmAfterMinutes: wire.alarm_after_minutes,
        managerAlertAfterMinutes: wire.manager_alert_after_minutes,
        ownerAlertAfterMinutes: wire.owner_alert_after_minutes,
        ordersPerWindow: wire.orders_per_window ?? null,
        pausedUntil: wire.paused_until ?? null,
        refundApprovalAboveMinor: wire.refund_approval_above_minor,
        priceApprovalAbovePercent: wire.price_approval_above_percent ?? null,
        dishMarginTargetPercent: wire.dish_margin_target_percent ?? null,
    };
}
