import { DensityProvider, Stack, Text } from '@healthy360/design-system';
import { View } from 'react-native';

import { DeskTrail } from '../features/kitchen-admin/desk-kit/desk-trail.tsx';
import type { DeskCrumb } from '../features/kitchen-admin/desk-kit/desk-trail.tsx';

/**
 * `/showcase-trail` — the kitchen breadcrumb from the canvas's Breadcrumb boards (2026-11-11): a
 * record opened from its own list, a list, the module's menu with the rail's counts, and a page
 * opened from somewhere else with the return crumb that leads back. Narrow the window below `md` to
 * see each become one back pill.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
const noop = () => undefined;

const home: DeskCrumb = { key: 'hub', kind: 'home', label: 'Kitchen workspace', onPress: noop };

const buying: DeskCrumb = {
    key: 'module',
    kind: 'module',
    label: 'Buying',
    testID: 'trail-showcase-module',
    pages: [
        { key: 'supply-orders', label: 'Supply orders', selected: false, count: 3, onSelect: noop },
        { key: 'suppliers', label: 'Suppliers', selected: true, onSelect: noop },
        { key: 'procurement', label: 'Procurement', selected: false, onSelect: noop },
        { key: 'supplier-bills', label: 'Supplier bills', selected: false, onSelect: noop },
        { key: 'ledger', label: 'Purchases ledger', selected: false, onSelect: noop },
    ],
};

const SAMPLES: readonly { readonly title: string; readonly crumbs: readonly DeskCrumb[] }[] = [
    {
        title: 'A record, opened from its own list',
        crumbs: [
            home,
            buying,
            { key: 'suppliers', kind: 'page', label: 'Suppliers', onPress: noop },
            { key: 'leaf', kind: 'current', label: 'E2E Grain Supplier' },
        ],
    },
    {
        title: 'A list',
        crumbs: [home, buying, { key: 'suppliers', kind: 'current', label: 'Suppliers' }],
    },
    {
        title: 'Opened from another page',
        crumbs: [
            home,
            { key: 'return', kind: 'return', label: 'Stock gaps', onPress: noop },
            { key: 'leaf', kind: 'current', label: 'Basmati rice' },
        ],
    },
    {
        title: 'A long name is cut at 260px',
        crumbs: [
            home,
            { key: 'return', kind: 'return', label: 'Requirements', onPress: noop },
            {
                key: 'leaf',
                kind: 'current',
                label: 'Crispy chicken marination with lemon, garlic and smoked paprika',
            },
        ],
    },
];

export function TrailShowcaseScreen() {
    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[960px] p-6">
                <Stack space="lg" testID="trail-showcase">
                    <Text variant="title">Kitchen breadcrumb</Text>
                    {SAMPLES.map((sample, index) => (
                        <Stack key={sample.title} space="xs">
                            <Text variant="label">{sample.title}</Text>
                            <View className="h-[60px] flex-row items-center rounded-[22px] border border-stroke-subtle bg-surface-raised px-3.5">
                                <DeskTrail
                                    testID={`trail-showcase-${String(index)}`}
                                    crumbs={sample.crumbs}
                                />
                            </View>
                        </Stack>
                    ))}
                </Stack>
            </View>
        </DensityProvider>
    );
}
