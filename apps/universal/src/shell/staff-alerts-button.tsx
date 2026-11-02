import type { StaffAlert, StaffAlertType } from '@healthy360/api-client/contracts';
import { Button, DensityProvider, Icon, useBreakpoint, useToast } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { useCan } from '../access/gate.tsx';
import {
    useMarkAllStaffAlertsReadMutation,
    useMarkStaffAlertReadMutation,
    useStaffAlertsQuery,
} from '../data/staff-alerts-hooks.ts';
import { playAlertTone } from '../features/kds/alert-tone.ts';
import { ORDER_SUPERVISE_PERMISSION } from '../features/kitchen-admin/entity-registry.ts';
import { guardNavigation } from '../navigation/use-unsaved-guard.ts';

/**
 * The kitchen top bar's alerts: a pill with the unread count, opening the list of alerts addressed
 * to the reader. Built as `KeptWorkButton` is (`kept-work-dock.tsx`), so the two pills read as one
 * family: same pill, compact density, Escape closes, a panel hung from the bar, shut by a new page.
 *
 * The alert's wording is written here from `type` and the order number. The row holds no more than
 * that, by design, and its order link shows the rest to whoever may see it.
 */

const ROW_ICONS: Readonly<Record<StaffAlertType, IconName>> = {
    unaccepted_manager: 'clock',
    unaccepted_owner: 'clock',
    allergy_order: 'alert',
    late_cancel: 'ban',
    delivery_failed: 'truck',
    no_cash_collected: 'banknote',
};

const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/** The keys of the rows last seen in this page load, or `null` before the first answer. */
export type SeenAlerts = ReadonlySet<string> | null;

/** A row as of its latest news: a repeat delivery failure comes back on the same id. */
export function alertSeenKey(alert: StaffAlert): string {
    return `${alert.id}:${alert.createdAt}`;
}

/**
 * The unread rows that should sound: any newer than what this page load has already seen.
 *
 * The first answer only sets the mark. Rows waiting from before the page opened are unread but not
 * news, and the count already says so. "Newer" is by key rather than by time because `created_at`
 * holds whole seconds, so a row written in the second of the last one seen would otherwise be
 * missed. Rows only ever arrive at the top of the list, so a key not seen is news not seen.
 */
export function freshAlerts(
    alerts: readonly StaffAlert[],
    seen: SeenAlerts,
): readonly StaffAlert[] {
    if (seen === null) return [];
    return alerts.filter((alert) => alert.readAt === null && !seen.has(alertSeenKey(alert)));
}

function alertTitle(t: TFunction, alert: StaffAlert): string {
    const wording = alert.type === 'allergy_order' && alert.severe ? 'severe_allergy' : alert.type;
    return t(`kitchen:alerts.type.${wording}`, { number: alert.orderNumber });
}

/** A new alert announces itself, once, however many arrived in the same poll. */
function useAnnounceFreshAlerts(alerts: readonly StaffAlert[] | undefined): void {
    const { t } = useTranslation();
    const toast = useToast();
    const seen = useRef<SeenAlerts>(null);

    useEffect(() => {
        if (alerts === undefined) return;
        const fresh = freshAlerts(alerts, seen.current);
        seen.current = new Set(alerts.map(alertSeenKey));

        const newest = fresh[0];
        if (newest === undefined) return;
        playAlertTone();
        toast.show({
            testID: 'staff-alerts-toast',
            tone: 'warning',
            message:
                fresh.length === 1
                    ? alertTitle(t, newest)
                    : t('kitchen:alerts.freshMany', { n: fresh.length }),
        });
    }, [alerts, t, toast]);
}

function AlertRow({
    alert,
    onOpen,
}: {
    readonly alert: StaffAlert;
    readonly onOpen: (alert: StaffAlert) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const title = alertTitle(t, alert);
    const when = formatter.formatDate(alert.createdAt, WHEN);
    const unread = alert.readAt === null;

    return (
        <View
            testID="staff-alerts-panel-row"
            className="flex-row items-center gap-2 border-t border-stroke-subtle py-2"
        >
            <Icon
                name={ROW_ICONS[alert.type]}
                size="sm"
                className={unread ? 'text-content-primary' : 'text-content-secondary'}
            />
            <View className="min-w-0 flex-1">
                <RNText
                    numberOfLines={2}
                    className={
                        unread
                            ? 'text-sm font-semibold text-content-primary text-start'
                            : 'text-sm text-content-primary text-start'
                    }
                >
                    {title}
                </RNText>
                <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                    {unread ? t('kitchen:alerts.unreadDetail', { when }) : when}
                </RNText>
            </View>
            <Button
                testID="staff-alerts-panel-open"
                size="sm"
                variant="secondary"
                label={t('kitchen:alerts.open')}
                accessibilityLabel={t('kitchen:alerts.openLabel', { title })}
                className="self-center"
                onPress={() => {
                    onOpen(alert);
                }}
            />
        </View>
    );
}

function AlertsBell() {
    const { t } = useTranslation();
    const pathname = usePathname();
    const router = useRouter();
    const alerts = useStaffAlertsQuery();
    const markRead = useMarkStaffAlertReadMutation();
    const markAllRead = useMarkAllStaffAlertsReadMutation();
    useAnnounceFreshAlerts(alerts.data?.alerts);

    // Open on the page it was opened on, as `KeptWorkButton` is.
    const [openOn, setOpenOn] = useState<string | null>(null);
    const open = openOn === pathname;
    const roomy = useBreakpoint().atLeast('md');

    // Escape closes it, as any panel hung from a top bar does.
    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenOn(null);
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const rows = alerts.data?.alerts ?? [];
    const unreadCount = alerts.data?.unreadCount ?? 0;
    const label = t('kitchen:alerts.buttonLabel', { n: unreadCount });

    const openAlert = (alert: StaffAlert) => {
        setOpenOn(null);
        // Read only once the reader is really going: Stay must leave an unopened alert unread.
        guardNavigation(() => {
            if (alert.readAt === null) markRead.mutate(alert.id);
            router.push(`/kitchen/orders?view=${encodeURIComponent(alert.orderId)}` as never);
        });
    };

    return (
        <DensityProvider value="compact">
            <View className="relative self-center">
                <Pressable
                    testID="staff-alerts-button"
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    aria-expanded={open}
                    accessibilityState={{ expanded: open }}
                    onPress={() => {
                        setOpenOn(open ? null : pathname);
                    }}
                    className="h-8 flex-row items-center gap-1.5 rounded-full border border-stroke-strong bg-surface-sunken pe-2 ps-3"
                >
                    <Icon name="bell" size="sm" className="text-content-primary" />
                    {roomy ? (
                        <RNText className="text-xs font-semibold text-content-primary">
                            {t('kitchen:alerts.title')}
                        </RNText>
                    ) : null}
                    {unreadCount === 0 ? null : (
                        <View className="items-center rounded-full bg-surface-brand px-1.5">
                            <RNText
                                testID="staff-alerts-count"
                                className="text-xs font-semibold tabular-nums text-content-on-brand"
                            >
                                {unreadCount}
                            </RNText>
                        </View>
                    )}
                    {/* The top bar is full on a phone, so the pill gives up its chevron there. */}
                    {roomy ? (
                        <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                    ) : null}
                </Pressable>
                {open ? (
                    <View
                        testID="staff-alerts-panel"
                        role="dialog"
                        aria-label={t('kitchen:alerts.title')}
                        className="absolute end-0 top-full z-tooltip mt-1 w-[320px] rounded-xl border border-stroke-strong bg-surface-raised px-3 pb-1 pt-2 shadow-elevation-3 web:max-w-[92vw]"
                    >
                        <View className="flex-row items-center gap-2 pb-1">
                            <View className="min-w-0 flex-1 flex-row items-center gap-2">
                                <Icon name="bell" size="sm" className="text-content-secondary" />
                                <RNText
                                    accessibilityRole="header"
                                    numberOfLines={1}
                                    className="min-w-0 shrink text-sm font-semibold text-content-primary text-start"
                                >
                                    {t('kitchen:alerts.title')}
                                </RNText>
                            </View>
                            {unreadCount === 0 ? null : (
                                <Button
                                    testID="staff-alerts-mark-all"
                                    size="sm"
                                    variant="quiet"
                                    label={t('kitchen:alerts.markAllRead')}
                                    loading={markAllRead.isPending}
                                    className="self-center"
                                    onPress={() => {
                                        markAllRead.mutate();
                                    }}
                                />
                            )}
                        </View>
                        {alerts.isPending ? null : rows.length === 0 ? (
                            <RNText
                                testID="staff-alerts-panel-empty"
                                className="border-t border-stroke-subtle py-2 text-xs text-content-secondary text-start"
                            >
                                {t(
                                    alerts.isError
                                        ? 'kitchen:alerts.loadError'
                                        : 'kitchen:alerts.empty',
                                )}
                            </RNText>
                        ) : (
                            <ScrollView className="max-h-[320px]">
                                {rows.map((alert) => (
                                    <AlertRow key={alert.id} alert={alert} onOpen={openAlert} />
                                ))}
                            </ScrollView>
                        )}
                    </View>
                ) : null}
            </View>
        </DensityProvider>
    );
}

/** Drawn only for someone alerts are addressed to; the poll starts with the bell. */
export function StaffAlertsButton() {
    return useCan(ORDER_SUPERVISE_PERMISSION) ? <AlertsBell /> : null;
}
