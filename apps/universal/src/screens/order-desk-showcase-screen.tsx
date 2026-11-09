import {
    Button,
    Cascade,
    DensityProvider,
    FilterChip,
    Icon,
    Inline,
    SegmentedControl,
    Text,
} from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { CatalogueList } from '../features/kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../features/kitchen-admin/catalogue/catalogue-column-spec.ts';
import { LensBar, LensScope } from '../features/kitchen-admin/catalogue/lens-bar.tsx';
import type { LensFigure } from '../features/kitchen-admin/catalogue/lens-bar.tsx';
import { DeskTableTitle } from '../features/kitchen-admin/order-desk/desk-parts.tsx';
import {
    KindTiles,
    SaleSteps,
    SectionRail,
    TicketLabel,
    TileStepper,
} from '../features/kitchen-admin/order-desk/sale-parts.tsx';

type Window = 'today' | 'overdue' | 'next_7';
type Kind = 'all' | 'delivery' | 'pickup' | 'counter';

interface SampleRow {
    readonly id: string;
    readonly customer: string;
    readonly due: string;
    readonly payment: string;
    readonly total: string;
}

const ROWS: readonly SampleRow[] = [
    {
        id: 'HZ-DESK-0018',
        customer: 'Rana Haddad',
        due: '10:30',
        payment: 'Cash on delivery',
        total: '$12.00',
    },
    {
        id: 'HZ-DESK-0019',
        customer: 'Karim Saab',
        due: '11:15',
        payment: 'Cash at the counter',
        total: '$19.50',
    },
    {
        id: 'HZ-DESK-0020',
        customer: 'Maya Khoury',
        due: '12:00',
        payment: 'Whish transfer',
        total: '$21.50',
    },
    {
        id: 'HZ-DESK-0021',
        customer: 'Omar Nassar',
        due: '12:30',
        payment: 'Cash on delivery',
        total: '$9.50',
    },
];

const COLUMNS: readonly CatalogueColumn<SampleRow>[] = [
    { key: 'id', label: 'Order', width: 140, priority: 90, value: (row) => row.id, mono: true },
    {
        key: 'customer',
        label: 'Customer',
        width: 200,
        priority: 100,
        grow: true,
        value: (row) => row.customer,
    },
    { key: 'due', label: 'Due', width: 80, priority: 85, value: (row) => row.due },
    { key: 'payment', label: 'Payment', width: 180, priority: 60, value: (row) => row.payment },
    {
        key: 'total',
        label: 'Total',
        width: 100,
        priority: 85,
        value: (row) => row.total,
    },
];

/**
 * `/showcase-order-desk` — the parts the Order desk redesign added, on a page of their own
 * (2026-11-07): the Lens bar's split layout over a joined list, the same bar with nothing under it,
 * and the figure chips loading.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function OrderDeskShowcaseScreen() {
    const [window, setWindow] = useState<Window>('today');
    const [kind, setKind] = useState<Kind>('all');
    const [placed, setPlaced] = useState(false);
    const [search, setSearch] = useState('');
    const [pastDue, setPastDue] = useState(false);

    const figures: readonly LensFigure[] = [
        { key: 'open', label: 'Open now', value: 16 },
        {
            key: 'pastDue',
            label: 'Past due',
            value: 3,
            tone: 'danger',
            alarm: true,
            separated: true,
            active: pastDue,
            info: 'Every open order past its due time, on any date.',
            onPress: () => {
                setPastDue(!pastDue);
            },
        },
        { key: 'driver', label: 'Needs a driver', value: 8, tone: 'warning' },
        { key: 'settled', label: 'Not settled', value: 0, tone: 'info' },
    ];

    const scope = (
        <>
            <SegmentedControl<Window>
                label="Which orders"
                value={window}
                onChange={setWindow}
                items={[
                    { value: 'today', label: 'Today' },
                    { value: 'overdue', label: 'Overdue' },
                    { value: 'next_7', label: 'Next 7 days' },
                ]}
            />
            <FilterChip size="sm" label="Placed" selected={placed} onChange={setPlaced} />
            <LensScope<Kind>
                testID="showcase-desk-kind"
                label="Kind"
                value={kind}
                onChange={setKind}
                options={[
                    { value: 'all', label: 'All kinds' },
                    { value: 'delivery', label: 'Delivery' },
                    { value: 'pickup', label: 'Collection' },
                    { value: 'counter', label: 'At the counter' },
                ]}
            />
        </>
    );

    const actions = (
        <Inline space="xs" align="center">
            <Button variant="secondary" size="sm" label="Pause kitchen" />
            <Button label="New order" iconStart={<Icon name="plus" size="sm" />} />
        </Inline>
    );

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="order-desk-showcase">
                    <Text variant="title">Lens bar, split — over a joined list</Text>
                    <View>
                        <LensBar
                            testID="showcase-desk-lens"
                            layout="split"
                            joined
                            label="Order desk summary and filters"
                            figures={figures}
                            mix={[
                                { key: 'placed', value: 6, tone: 'warning', dimmed: placed },
                                { key: 'confirmed', value: 10, tone: 'info' },
                            ]}
                            mixLabel="6 placed, 10 confirmed"
                            actions={actions}
                            scope={scope}
                            search={search}
                            onSearchChange={setSearch}
                            searchLabel="Order number"
                            searchPlaceholder="Search by order number"
                            result="4 of 16"
                            clearLabel="Clear filters"
                            {...(placed || search !== ''
                                ? {
                                      onClear: () => {
                                          setPlaced(false);
                                          setSearch('');
                                      },
                                  }
                                : {})}
                        />
                        <CatalogueList<SampleRow>
                            testID="showcase-desk-list"
                            label="Open orders"
                            columns={COLUMNS}
                            rows={ROWS}
                            rowKey={(row) => row.id}
                            density="sm"
                            joined
                            rowActionsLabel="Actions"
                        />
                    </View>

                    <Text variant="title">Split, nothing under it — loading figures</Text>
                    <LensBar
                        testID="showcase-desk-lens-loading"
                        layout="split"
                        label="Order desk summary and filters"
                        figures={figures.map((figure) => ({ ...figure, value: null }))}
                        actions={actions}
                        scope={scope}
                        search=""
                        onSearchChange={() => undefined}
                        searchLabel="Order number"
                        searchPlaceholder="Search by order number"
                        result={null}
                        clearLabel="Clear filters"
                    />

                    <NewOrderParts />

                    <Text variant="title">Report table titles — with and without waiting rows</Text>
                    <DeskTableTitle title="Drivers holding cash" count={2} />
                    <DeskTableTitle
                        title="Shifts to close"
                        count={0}
                        aside={
                            <Text variant="caption" tone="secondary">
                                Days are read on the kitchen clock.
                            </Text>
                        }
                    />
                </Cascade>
            </View>
        </DensityProvider>
    );
}

type Section = 'meals' | 'product' | 'sauce' | 'dressing' | 'frozen_meal';
type Leaving = 'counter' | 'pickup' | 'delivery';

/** New order: the step marker, the sections rail, a tile's stepper, the kind tiles, the ticket. */
function NewOrderParts() {
    const [step, setStep] = useState(1);
    const [section, setSection] = useState<Section>('meals');
    const [count, setCount] = useState(2);
    const [leaving, setLeaving] = useState<Leaving | null>(null);

    return (
        <>
            <Text variant="title">New order — step marker</Text>
            <View className="flex-row flex-wrap items-center gap-3">
                <SaleSteps
                    testID="showcase-sale-steps"
                    label="Steps"
                    current={step}
                    steps={[
                        { key: 'customer', label: 'Customer' },
                        { key: 'meals', label: 'Meals' },
                        { key: 'checkout', label: 'Checkout' },
                    ]}
                />
                <Button
                    variant="secondary"
                    size="sm"
                    label="Next step"
                    onPress={() => {
                        setStep((step + 1) % 3);
                    }}
                />
            </View>

            <Text variant="title">Sections rail, tile stepper, kind tiles</Text>
            <View className="flex-row flex-wrap items-start gap-6">
                <View style={{ width: 168 }}>
                    <SectionRail<Section>
                        testID="showcase-sale-rail"
                        label="Menu sections"
                        value={section}
                        onChange={setSection}
                        sections={[
                            {
                                value: 'meals',
                                label: 'Meals',
                                icon: 'utensils',
                                tint: 'brand',
                                count: 20,
                            },
                            {
                                value: 'product',
                                label: 'Products',
                                icon: 'package',
                                tint: 'neutral',
                                count: 55,
                            },
                            {
                                value: 'sauce',
                                label: 'Sauces',
                                icon: 'droplet',
                                tint: 'danger',
                                count: 43,
                            },
                            {
                                value: 'dressing',
                                label: 'Dressings',
                                icon: 'salad',
                                tint: 'warning',
                                count: 19,
                            },
                            {
                                value: 'frozen_meal',
                                label: 'Frozen meals',
                                icon: 'snowflake',
                                tint: 'info',
                                count: null,
                            },
                        ]}
                    />
                </View>
                <TileStepper
                    testID="showcase-sale-stepper"
                    count={count}
                    decreaseLabel="One fewer"
                    increaseLabel="One more"
                    onDecrease={() => {
                        setCount(Math.max(0, count - 1));
                    }}
                    onIncrease={() => {
                        setCount(count + 1);
                    }}
                />
                <View style={{ width: 560 }}>
                    <KindTiles<Leaving>
                        testID="showcase-sale-kind"
                        label="How is this order leaving?"
                        value={leaving}
                        onChange={setLeaving}
                        tiles={[
                            { value: 'counter', title: 'Counter', body: 'Pays now', icon: 'store' },
                            {
                                value: 'pickup',
                                title: 'Collection',
                                body: 'Collects later',
                                icon: 'shoppingBag',
                            },
                            {
                                value: 'delivery',
                                title: 'Delivery',
                                body: 'We take it to them',
                                icon: 'truck',
                            },
                        ]}
                    />
                </View>
            </View>

            <Text variant="title">The ticket's ground — sidebar tones and button</Text>
            <View
                className="flex-col gap-3 rounded-2xl bg-surface-sidebar p-4"
                style={{ width: 340 }}
            >
                <View className="flex-row items-center justify-between">
                    <Text variant="section" tone="sidebar">
                        Ticket
                    </Text>
                    <Text variant="caption" tone="sidebarMuted">
                        3 items
                    </Text>
                </View>
                <View className="flex-row items-baseline justify-between border-b border-dashed border-content-on-sidebar/40 py-2">
                    <Text variant="label" tone="sidebar">
                        2 × Chicken Red Tawouk
                    </Text>
                    <Text variant="mono" tone="sidebar">
                        $15.00
                    </Text>
                </View>
                <TicketLabel>How are they paying?</TicketLabel>
                <Button variant="sidebar" size="lg" block label="Charge $18.00" />
            </View>
        </>
    );
}
