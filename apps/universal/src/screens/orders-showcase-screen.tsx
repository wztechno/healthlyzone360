import type { KitchenOrder } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { Cascade, DensityProvider, Icon, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CatalogueList } from '../features/kitchen-admin/catalogue/catalogue-list.tsx';
import {
    CompactField,
    CompactRecordPopup,
    CompactSection,
} from '../features/kitchen-admin/catalogue/compact-record-popup.tsx';
import {
    ChoiceRow,
    DeskButton,
    DeskChip,
    DeskIconButton,
    DeskSelect,
    DeskTabs,
    ListGroupRow,
    MiniMonthPicker,
    initialsOf,
} from '../features/kitchen-admin/desk-kit/index.ts';
import { DayStepper } from '../features/kitchen-admin/orders/day-stepper.tsx';
import { orderColumns } from '../features/kitchen-admin/orders/order-columns.tsx';
import { localToday, slotKeyOf } from '../features/kitchen-admin/orders/order-book.ts';
import type { BookRow } from '../features/kitchen-admin/orders/order-book.ts';

/**
 * `/showcase-orders` — the parts the Orders redesign (Option A, 2026-11-10) added, on a page of
 * their own: the desk kit (`kitchen-admin/desk-kit/` — buttons, chips, the dropdown, the mini
 * month, the tabs, the group row), the day stepper, the order table with its slot headings
 * (`DataList` / `CatalogueList` `sectionHeader`), and the compact pop-up with its thin scrollbar.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */

const TODAY = localToday();

function sampleOrder(
    ordinal: number,
    overrides: Omit<Partial<BookRow>, 'delivery'> & {
        readonly delivery?: Partial<KitchenOrder['delivery']>;
    },
): BookRow {
    const { delivery, ...rest } = overrides;
    return {
        id: `showcase-order-${String(ordinal)}` as OrderId,
        orderNumber: `ORD-SHOW${String(ordinal).padStart(6, '0')}`,
        branchId: null,
        status: 'placed',
        currencyCode: 'USD',
        subtotalMinor: 1400,
        deliveryFeeMinor: 200,
        totalMinor: 1600,
        paymentMethod: 'cash_on_delivery',
        fulfilmentType: 'delivery',
        delivery: {
            label: null,
            lineOne: 'Sursock St, Bldg 14',
            lineTwo: null,
            city: null,
            areaNameEn: 'Achrafieh',
            areaNameAr: null,
            areaId: null,
            windowCode: 'lunch',
            requestedDate: TODAY,
            zoneId: null,
            ...delivery,
        },
        placedAt: `${TODAY}T07:00:00Z`,
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 1,
        customerAccountId: null,
        amendable: true,
        allergy: null,
        lineCount: 1,
        lines: [],
        payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
        deliveryJob: null,
        customer: { displayName: 'Rania Haddad', phone: '+96170214380' },
        ...rest,
    };
}

const ROWS: readonly BookRow[] = [
    sampleOrder(1, { delivery: { windowCode: 'breakfast' }, status: 'fulfilled' }),
    sampleOrder(2, {
        status: 'confirmed',
        deliveryJob: {
            id: 'job-1',
            status: 'pending',
            trackingStatus: 'awaiting_assignment',
            driverUserId: null,
            assignedAt: null,
            lockVersion: 1,
        },
        customer: { displayName: 'Karim Saleh', phone: '+96171552019' },
    }),
    sampleOrder(3, {
        fulfilmentType: 'pickup',
        paymentMethod: 'cash_at_counter',
        customer: { displayName: 'Maya Khoury', phone: '+96176903447' },
    }),
    sampleOrder(4, {
        delivery: { windowCode: 'dinner' },
        status: 'cancelled',
        cancelledAt: `${TODAY}T09:00:00Z`,
        cancellationReason: 'customer_requested',
    }),
];

export function OrdersShowcaseScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [tab, setTab] = useState<'today' | 'calendar' | 'all'>('today');
    const [day, setDay] = useState(TODAY);
    const [open, setOpen] = useState(false);
    const [slot, setSlot] = useState<'all' | 'lunch' | 'dinner'>('all');
    const [mode, setMode] = useState<'month' | 'week'>('month');
    const [method, setMethod] = useState<'cash' | 'counter' | 'wish'>('cash');
    const [driver, setDriver] = useState<string>('hr');
    const [reason, setReason] = useState<string>('asked');

    const columns = orderColumns({
        t,
        formatter,
        today: TODAY,
        now: new Date(),
        windows: [
            {
                code: 'breakfast',
                nameEn: 'Breakfast',
                nameAr: '',
                startsAt: '08:00:00',
                endsAt: '10:00:00',
            },
            {
                code: 'lunch',
                nameEn: 'Lunch',
                nameAr: '',
                startsAt: '12:00:00',
                endsAt: '14:00:00',
            },
            {
                code: 'dinner',
                nameEn: 'Dinner',
                nameAr: '',
                startsAt: '19:00:00',
                endsAt: '21:00:00',
            },
        ],
        windowName: (code) => code.charAt(0).toUpperCase() + code.slice(1),
        driverName: () => null,
        onStep: () => undefined,
        pendingId: null,
    });

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="orders-showcase">
                    <Text variant="title">Desk tabs — a page's views, and a toolbar's switch</Text>
                    <DeskTabs
                        testID="showcase-orders-tabs"
                        label="Orders views"
                        value={tab}
                        onChange={setTab}
                        items={[
                            { value: 'today', label: 'Today', count: 9 },
                            { value: 'calendar', label: 'Calendar' },
                            { value: 'all', label: 'All orders' },
                        ]}
                    />

                    <DeskTabs
                        testID="showcase-orders-mode"
                        size="sm"
                        label="Calendar view"
                        value={mode}
                        onChange={setMode}
                        items={[
                            { value: 'month', label: 'Month' },
                            { value: 'week', label: 'Week' },
                        ]}
                    />

                    <Text variant="title">Desk buttons</Text>
                    <View className="flex-row flex-wrap items-center gap-2">
                        <DeskButton
                            label="New order"
                            iconStart={
                                <Icon name="plus" size="md" className="text-content-on-brand" />
                            }
                        />
                        <DeskButton variant="secondary" label="Pause kitchen" />
                        <DeskButton variant="next" label="Mark delivered" />
                        <DeskButton variant="quiet" label="Clear filters" />
                        <DeskButton variant="dangerOutline" label="Cancel order" />
                        <DeskButton variant="danger" label="Cancel this order" />
                        <DeskButton variant="secondary" label="Saving" loading />
                        <DeskIconButton
                            label="Previous day"
                            icon={<Icon name="chevronBackward" size="md" />}
                        />
                    </View>

                    <Text variant="title">Desk chips</Text>
                    <View className="flex-row flex-wrap items-center gap-1.5">
                        <DeskChip tone="warning" label="To confirm" />
                        <DeskChip tone="info" label="Confirmed" />
                        <DeskChip tone="success" label="Delivered" />
                        <DeskChip tone="neutral" label="Cancelled" />
                        <DeskChip tone="danger" label="Late" />
                        <DeskChip tone="warning" size="sm" label="1 to confirm" />
                        <DeskChip tone="danger" size="lg" label="2 late" />
                    </View>

                    <Text variant="title">Dialog choices — rows and radio segments</Text>
                    <View className="w-full max-w-[432px] flex-col gap-3">
                        <DeskTabs<'cash' | 'counter' | 'wish'>
                            testID="showcase-orders-method"
                            size="sm"
                            radio
                            block
                            label="How did the money arrive?"
                            value={method}
                            onChange={setMethod}
                            items={[
                                { value: 'cash', label: 'Cash on delivery' },
                                { value: 'counter', label: 'Cash at the counter' },
                                { value: 'wish', label: 'Whish transfer' },
                            ]}
                        />
                        <View className="flex-col gap-0.5">
                            {[
                                ['hr', 'Hadi Rizk'],
                                ['ss', 'Sami Staff'],
                            ].map(([key, name]) => (
                                <ChoiceRow
                                    key={key}
                                    mark="avatar"
                                    initials={initialsOf(name ?? null)}
                                    label={name ?? ''}
                                    {...(key === 'hr' ? { meta: 'Has it now' } : {})}
                                    selected={driver === key}
                                    onPress={() => {
                                        setDriver(key ?? '');
                                    }}
                                />
                            ))}
                        </View>
                        <View className="flex-col gap-0.5">
                            {[
                                ['asked', 'The customer asked to cancel'],
                                ['kitchen', 'The kitchen cannot fulfil it'],
                            ].map(([key, label]) => (
                                <ChoiceRow
                                    key={key}
                                    label={label ?? ''}
                                    selected={reason === key}
                                    onPress={() => {
                                        setReason(key ?? '');
                                    }}
                                />
                            ))}
                        </View>
                    </View>

                    <Text variant="title">Desk dropdown and mini month</Text>
                    <View className="z-10 flex-row flex-wrap items-center gap-2">
                        <DeskSelect<'all' | 'lunch' | 'dinner'>
                            testID="showcase-orders-slot"
                            label="Slot"
                            value={slot}
                            onChange={setSlot}
                            options={[
                                { value: 'all', label: 'All' },
                                { value: 'lunch', label: 'Lunch' },
                                { value: 'dinner', label: 'Dinner' },
                            ]}
                        />
                        <MiniMonthPicker
                            testID="showcase-orders-month"
                            label="Pick a day"
                            value={day}
                            today={TODAY}
                            valueLabel={day}
                            onChange={setDay}
                            marked={(candidate) => candidate.endsWith('5')}
                        />
                    </View>

                    <Text variant="title">List group rows</Text>
                    <View className="overflow-hidden rounded-xl border border-stroke-subtle">
                        <ListGroupRow
                            tone="danger"
                            title="Late from earlier days"
                            sub="Still open"
                            count="43 orders"
                            actionLabel="See all"
                            onPress={() => undefined}
                        />
                        <ListGroupRow title="Breakfast" sub="08:00–10:00" count="2 orders" />
                    </View>

                    <Text variant="title">Day stepper</Text>
                    <DayStepper
                        testID="showcase-orders-day"
                        day={day}
                        today={TODAY}
                        onChange={setDay}
                    />

                    <Text variant="title">Order table — slot headings over the rows</Text>
                    <CatalogueList<BookRow>
                        testID="showcase-orders-table"
                        label="Orders"
                        columns={columns}
                        rows={ROWS}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        rowActionsLabel="Actions"
                        onRowPress={() => {
                            setOpen(true);
                        }}
                        sectionHeader={(row, previous) =>
                            previous !== undefined &&
                            slotKeyOf(previous) === slotKeyOf(row) ? null : (
                                <ListGroupRow title={slotKeyOf(row)} count="1 order" />
                            )
                        }
                    />

                    <Text variant="title">Compact pop-up</Text>
                    <View className="flex-row">
                        <DeskButton
                            testID="showcase-orders-open-popup"
                            variant="secondary"
                            label="Open the compact pop-up"
                            onPress={() => {
                                setOpen(true);
                            }}
                        />
                    </View>
                    {!open ? null : (
                        <CompactRecordPopup
                            testID="showcase-orders-popup"
                            label="Order ORD-SHOW000002"
                            kind="Delivery order"
                            title="ORD-SHOW000002"
                            nav={{
                                position: '2 of 4',
                                onPrevious: () => undefined,
                                onNext: () => undefined,
                            }}
                            chips={
                                <>
                                    <DeskChip tone="info" label="Confirmed" />
                                    <DeskChip tone="danger" label="Late" />
                                </>
                            }
                            figure={{ label: 'Total', value: '$16.00' }}
                            facts={[
                                {
                                    key: 'when',
                                    icon: 'calendarDays',
                                    text: 'Today, Tue 10 Nov · Lunch 12:00–14:00',
                                },
                                { key: 'who', icon: 'person', text: 'Karim Saleh' },
                                { key: 'phone', icon: 'smartphone', text: '+961 71 552 019' },
                                { key: 'where', icon: 'mapPin', text: 'Achrafieh' },
                                {
                                    key: 'money',
                                    icon: 'banknote',
                                    text: 'To collect $16.00',
                                    tone: 'warning',
                                },
                            ]}
                            primary={<DeskButton label="Choose a driver" />}
                            main={
                                <CompactSection title="Items">
                                    {Array.from({ length: 12 }, (_, index) => (
                                        <CompactField key={index} label={`× ${String(index + 1)}`}>
                                            <Text variant="strong">Grilled Salmon Bowl</Text>
                                        </CompactField>
                                    ))}
                                </CompactSection>
                            }
                            side={
                                <CompactSection title="Payment">
                                    <CompactField label="Paying by">
                                        <Text variant="strong">Cash on delivery</Text>
                                    </CompactField>
                                    <CompactField
                                        label="To collect"
                                        action={
                                            <DeskButton variant="quiet" label="Record a payment" />
                                        }
                                    >
                                        <Text variant="strong" tone="warning">
                                            $16.00
                                        </Text>
                                    </CompactField>
                                </CompactSection>
                            }
                            footer={
                                <>
                                    <DeskButton variant="secondary" label="Print ticket" />
                                    <DeskButton variant="secondary" label="Edit order" />
                                </>
                            }
                            footerEnd={<DeskButton variant="dangerOutline" label="Cancel order" />}
                            onClose={() => {
                                setOpen(false);
                            }}
                        />
                    )}
                </Cascade>
            </View>
        </DensityProvider>
    );
}
