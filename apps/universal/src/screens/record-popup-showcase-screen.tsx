import { Button, Cascade, DensityProvider, RecordDialog, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { RecordViewPage } from '../features/kitchen-admin/catalogue/record-view-page.tsx';

function noop(): void {}

const ROWS = [
    ['ORD-1042', 'Lina H.', 'Confirmed', 'AED 86.00'],
    ['ORD-1043', 'Omar S.', 'Placed', 'AED 42.50'],
    ['ORD-1044', 'Fatima R.', 'Ready', 'AED 120.00'],
    ['ORD-1045', 'Sara K.', 'Confirmed', 'AED 64.00'],
] as const;

/**
 * `/showcase-record-popup` — the `View as a pop-up` canvas (2026-11-07) on a page of its own: a
 * stand-in list with an order open over it, its actions behind ⋯ — the primary first in brand ink,
 * Edit order apart under a hairline — then the bare `RecordDialog` window with a short body.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function RecordPopupShowcaseScreen() {
    const [open, setOpen] = useState<'order' | 'bare' | null>('order');
    const close = () => {
        setOpen(null);
    };

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="record-popup-showcase">
                    <Text variant="title">Record pop-up</Text>
                    <View className="flex-row flex-wrap gap-2">
                        <Button
                            testID="record-popup-showcase-open-order"
                            variant="secondary"
                            size="sm"
                            label="Open the order"
                            onPress={() => {
                                setOpen('order');
                            }}
                        />
                        <Button
                            testID="record-popup-showcase-open-bare"
                            variant="secondary"
                            size="sm"
                            label="Open the bare window"
                            onPress={() => {
                                setOpen('bare');
                            }}
                        />
                    </View>

                    {/* The list that stays behind. */}
                    <View className="flex-col rounded-xl border border-stroke bg-surface-raised">
                        {ROWS.map((row) => (
                            <View
                                key={row[0]}
                                className="flex-row gap-base border-b border-stroke-subtle px-base py-3"
                            >
                                {row.map((cell) => (
                                    <Text key={cell} className="flex-1">
                                        {cell}
                                    </Text>
                                ))}
                            </View>
                        ))}
                    </View>

                    {open !== 'order' ? null : (
                        <RecordViewPage
                            testID="record-popup-showcase-order"
                            title="Order ORD-1042"
                            kind="Order"
                            status={{ label: 'Confirmed', tone: 'brand' }}
                            onBack={close}
                            fields={[
                                { key: 'customer', label: 'Customer', value: 'Lina H.' },
                                {
                                    key: 'phone',
                                    label: 'Phone',
                                    value: '+971 50 123 4567',
                                    mono: true,
                                },
                                { key: 'slot', label: 'Slot', value: 'Lunch · 12:00–13:00' },
                            ]}
                            sections={[
                                {
                                    key: 'lines',
                                    title: 'What was ordered',
                                    icon: 'utensils',
                                    content: <Text>2 × Chicken shawarma bowl · 1 × Hummus</Text>,
                                },
                            ]}
                            primaryAction={{ label: 'Mark fulfilled', icon: null, onPress: noop }}
                            actions={[
                                {
                                    key: 'pay',
                                    label: 'Record a payment',
                                    icon: 'banknote',
                                    onSelect: noop,
                                },
                                {
                                    key: 'assign',
                                    label: 'Assign a driver',
                                    icon: 'bike',
                                    onSelect: noop,
                                },
                                {
                                    key: 'courier',
                                    label: 'Hand to courier',
                                    icon: 'truck',
                                    onSelect: noop,
                                },
                                {
                                    key: 'edit',
                                    label: 'Edit order',
                                    icon: 'pen',
                                    separated: true,
                                    onSelect: noop,
                                },
                            ]}
                        />
                    )}

                    <RecordDialog
                        open={open === 'bare'}
                        onClose={close}
                        kind="Ingredient"
                        label="Tahini paste"
                        actions={[
                            {
                                key: 'edit',
                                label: 'Edit',
                                icon: 'pen',
                                tone: 'brand',
                                onSelect: noop,
                            },
                            { key: 'print', label: 'Print label', icon: 'receipt', onSelect: noop },
                        ]}
                        testID="record-popup-showcase-bare"
                    >
                        <Text>The window holds whatever the record draws.</Text>
                    </RecordDialog>
                </Cascade>
            </View>
        </DensityProvider>
    );
}
