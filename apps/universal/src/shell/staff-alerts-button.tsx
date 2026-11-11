import type { StaffAlert, StaffAlertType } from '@healthy360/api-client/contracts';
import { DensityProvider, Icon, useBreakpoint, useToast } from '@healthy360/design-system';
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
import { DeskButton } from '../features/kitchen-admin/desk-kit/desk-button.tsx';
import { DeskChip } from '../features/kitchen-admin/desk-kit/desk-chip.tsx';
import { ORDER_SUPERVISE_PERMISSION } from '../features/kitchen-admin/entity-registry.ts';
import { withReturnTo } from '../navigation/return-to.ts';
import { useCurrentHref } from '../navigation/use-return-to.ts';
import { guardNavigation } from '../navigation/use-unsaved-guard.ts';

/**
 * The kitchen top bar's alerts: a pill with the unread count, opening the list of alerts addressed
 * to the reader. Drawn from the Search + Alerts canvas (2026-11-11): one list, grouped Today and
 * Earlier, an unread alert tinted by how urgent it is. Built as `KeptWorkButton` is (`kept-work-dock.tsx`), so the two pills read as one
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
    refund_approval: 'banknote',
    stock_expiring: 'clock',
    temperature_out_of_range: 'alert',
    refund_approved: 'banknote',
    refund_rejected: 'banknote',
    short_hand_in: 'banknote',
    short_close: 'banknote',
    price_approval: 'banknote',
    dish_below_target: 'alert',
    delivery_moved_closed: 'calendar',
    delivery_closed_unmoved: 'calendar',
    batch_stuck: 'clock',
    customer_cancelled: 'ban',
};

/**
 * How loud an unread alert is drawn: `danger` for what can hurt someone or lose an order now,
 * `warning` for what is waiting on the reader, `info` for news. A read alert is quiet whatever its
 * tone.
 */
type AlertTone = 'danger' | 'warning' | 'info';

const ROW_TONES: Readonly<Record<StaffAlertType, AlertTone>> = {
    unaccepted_manager: 'warning',
    unaccepted_owner: 'warning',
    allergy_order: 'danger',
    late_cancel: 'warning',
    delivery_failed: 'danger',
    no_cash_collected: 'warning',
    refund_approval: 'warning',
    stock_expiring: 'warning',
    temperature_out_of_range: 'danger',
    refund_approved: 'info',
    refund_rejected: 'info',
    short_hand_in: 'warning',
    short_close: 'warning',
    price_approval: 'warning',
    dish_below_target: 'warning',
    delivery_moved_closed: 'info',
    delivery_closed_unmoved: 'warning',
    batch_stuck: 'warning',
    customer_cancelled: 'info',
};

const TONE_ROW: Readonly<Record<AlertTone, string>> = {
    danger: 'border-danger-border bg-danger-subtle',
    warning: 'border-warning-border bg-warning-subtle',
    info: 'border-transparent bg-transparent hover:bg-surface-sunken',
};

const TONE_TILE: Readonly<Record<AlertTone, { readonly tile: string; readonly ink: string }>> = {
    danger: { tile: 'bg-surface-raised', ink: 'text-danger-on-subtle' },
    warning: { tile: 'bg-surface-raised', ink: 'text-warning-on-subtle' },
    info: { tile: 'bg-info-subtle', ink: 'text-info-on-subtle' },
};

/** `YYYY-MM-DD` in the reader's own day, for the Today / Earlier split. */
function localDay(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Where an alert about something other than an order opens. `{id}` is the alert's subject. */
const PAGES: Partial<Readonly<Record<StaffAlertType, string>>> = {
    stock_expiring: '/kitchen/stock',
    temperature_out_of_range: '/kitchen/temperature-logs',
    short_hand_in: '/kitchen/order-desk/cash?tab=handins',
    short_close: '/kitchen/order-desk/cash?tab=close',
    price_approval: '/kitchen/supplier-bills?tab=bills',
    dish_below_target: '/kitchen/dish-margins',
    delivery_closed_unmoved: '/kitchen/branch-operating',
    batch_stuck: '/kitchen/production-desk/{id}',
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
    const tone = ROW_TONES[alert.type];
    const tile = TONE_TILE[tone];

    // Unread: tinted by its tone, the glyph in a tile, the sentence bold, a red dot, Open as the
    // green pill. Read: quiet — no tint, regular weight, Open as a link.
    return (
        <View
            testID="staff-alerts-panel-row"
            className={`flex-row items-start gap-3 rounded-[14px] border p-2.5 web:transition-colors ${
                unread ? TONE_ROW[tone] : 'border-transparent hover:bg-surface-sunken'
            }`}
        >
            <View
                className={`h-[34px] w-[34px] items-center justify-center rounded-[10px] ${
                    unread ? tile.tile : 'bg-surface-sunken'
                }`}
            >
                <Icon
                    name={ROW_ICONS[alert.type]}
                    size="md"
                    className={unread ? tile.ink : 'text-content-secondary'}
                />
            </View>
            <View className="min-w-0 flex-1 flex-col gap-1">
                <View className="flex-row items-start gap-2">
                    <RNText
                        numberOfLines={2}
                        className={`min-w-0 flex-1 text-sm text-content-primary text-start ${
                            unread ? 'font-semibold' : ''
                        }`}
                    >
                        {title}
                    </RNText>
                    {unread ? (
                        <View
                            aria-hidden
                            className="mt-1.5 h-2 w-2 rounded-full bg-danger-strong"
                        />
                    ) : null}
                </View>
                <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                    {unread ? t('kitchen:alerts.unreadDetail', { when }) : when}
                </RNText>
                <View className="flex-row pt-1">
                    <DeskButton
                        testID="staff-alerts-panel-open"
                        variant={unread ? 'primary' : 'quiet'}
                        label={t('kitchen:alerts.open')}
                        accessibilityLabel={t('kitchen:alerts.openLabel', { title })}
                        className={unread ? '!h-[30px] !px-3' : '!px-0'}
                        onPress={() => {
                            onOpen(alert);
                        }}
                    />
                </View>
            </View>
        </View>
    );
}

/** A group's upper label — Today, Earlier. */
function GroupLabel({ label, divided }: { readonly label: string; readonly divided: boolean }) {
    return (
        <RNText
            accessibilityRole="header"
            className={`px-2 pb-1.5 text-role-caption font-bold uppercase tracking-wider text-content-secondary text-start ${
                divided ? 'mt-1.5 border-t border-stroke-subtle pt-3' : 'pt-2'
            }`}
        >
            {label}
        </RNText>
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
    const lit = unreadCount > 0 || open;
    const today = localDay(new Date());
    const todays = rows.filter((alert) => localDay(new Date(alert.createdAt)) === today);
    const earlier = rows.filter((alert) => localDay(new Date(alert.createdAt)) !== today);

    const here = useCurrentHref();
    const openAlert = (alert: StaffAlert) => {
        setOpenOn(null);
        // Read only once the reader is really going: Stay must leave an unopened alert unread.
        guardNavigation(() => {
            if (alert.readAt === null) markRead.mutate(alert.id);
            // Carrying the page the reader was on, so the alert's page leads back to it.
            router.push(
                withReturnTo(
                    (PAGES[alert.type] ?? '/kitchen/orders?view={id}').replace(
                        '{id}',
                        encodeURIComponent(alert.orderId),
                    ),
                    here,
                ) as never,
            );
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
                    // Soft green with a red count while anything is unread; plain once all is read.
                    className={`h-11 flex-row items-center gap-2 rounded-full border pe-3 ps-4 web:transition-colors ${
                        open
                            ? 'border-surface-brand bg-surface-brand-subtle'
                            : unreadCount > 0
                              ? 'border-stroke bg-surface-brand-subtle hover:border-surface-brand'
                              : 'border-stroke-subtle bg-surface-raised hover:bg-surface-brand-subtle'
                    }`}
                >
                    <Icon
                        name="bell"
                        size="sm"
                        className={lit ? 'text-content-on-brand-subtle' : 'text-content-primary'}
                    />
                    {roomy ? (
                        <RNText
                            className={`text-sm font-semibold ${
                                lit ? 'text-content-on-brand-subtle' : 'text-content-primary'
                            }`}
                        >
                            {t('kitchen:alerts.title')}
                        </RNText>
                    ) : null}
                    {unreadCount === 0 ? null : (
                        <View className="h-5 min-w-5 items-center justify-center rounded-full bg-danger-strong px-1.5">
                            <RNText
                                testID="staff-alerts-count"
                                className="text-xs font-bold tabular-nums text-danger-on-strong"
                            >
                                {unreadCount}
                            </RNText>
                        </View>
                    )}
                    {/* The top bar is full on a phone, so the pill gives up its chevron there. */}
                    {roomy ? (
                        <View className={`web:transition-transform ${open ? 'rotate-180' : ''}`}>
                            <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                        </View>
                    ) : null}
                </Pressable>
                {open ? (
                    <View
                        testID="staff-alerts-panel"
                        role="dialog"
                        aria-label={t('kitchen:alerts.title')}
                        className="absolute end-0 top-full z-tooltip mt-2 w-[420px] overflow-hidden rounded-[20px] border border-stroke-subtle bg-surface-raised shadow-elevation-4 web:max-w-[92vw]"
                    >
                        <View className="flex-row items-center gap-2.5 px-4 pb-2.5 pt-4">
                            <RNText
                                accessibilityRole="header"
                                numberOfLines={1}
                                className="min-w-0 shrink font-display text-lg font-bold text-content-primary text-start"
                            >
                                {t('kitchen:alerts.title')}
                            </RNText>
                            {unreadCount === 0 ? null : (
                                <DeskChip
                                    testID="staff-alerts-new"
                                    tone="danger"
                                    label={t('kitchen:alerts.newCount', { n: unreadCount })}
                                />
                            )}
                            <View className="flex-1" />
                            {unreadCount === 0 ? null : (
                                <DeskButton
                                    testID="staff-alerts-mark-all"
                                    variant="quiet"
                                    label={t('kitchen:alerts.markAllRead')}
                                    loading={markAllRead.isPending}
                                    onPress={() => {
                                        markAllRead.mutate();
                                    }}
                                />
                            )}
                        </View>
                        {alerts.isPending ? null : rows.length === 0 ? (
                            <View className="items-center gap-2.5 px-4 pb-8 pt-6">
                                {alerts.isError ? null : (
                                    <View className="h-[52px] w-[52px] items-center justify-center rounded-full bg-surface-brand-subtle">
                                        <Icon
                                            name="check"
                                            size="lg"
                                            className="text-content-on-brand-subtle"
                                        />
                                    </View>
                                )}
                                <RNText
                                    testID="staff-alerts-panel-empty"
                                    className="text-center text-sm font-semibold text-content-primary"
                                >
                                    {t(
                                        alerts.isError
                                            ? 'kitchen:alerts.loadError'
                                            : 'kitchen:alerts.empty',
                                    )}
                                </RNText>
                            </View>
                        ) : (
                            <ScrollView
                                className="max-h-[440px]"
                                contentContainerClassName="flex-col gap-1.5 px-2 pb-2"
                            >
                                {todays.length === 0 ? null : (
                                    <GroupLabel
                                        label={t('kitchen:alerts.groupToday')}
                                        divided={false}
                                    />
                                )}
                                {todays.map((alert) => (
                                    <AlertRow key={alert.id} alert={alert} onOpen={openAlert} />
                                ))}
                                {earlier.length === 0 ? null : (
                                    <GroupLabel
                                        label={t('kitchen:alerts.groupEarlier')}
                                        divided={todays.length > 0}
                                    />
                                )}
                                {earlier.map((alert) => (
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
