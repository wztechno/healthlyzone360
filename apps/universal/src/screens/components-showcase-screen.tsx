import { DensityProvider, SEARCH_THRESHOLD, Select, Stack, Text } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * `/showcase-components` — the one place the admin's current parts are shown (2026-11-26).
 *
 * Only parts that live in `packages/design-system` and are the agreed design go here; a part that
 * is not on this page is not the one to use. Each family gets a section as it is moved over —
 * the dropdown first. The older `/showcase-*` pages are retired as their parts arrive here.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */

const UNITS: readonly SelectOption[] = [
    { value: 'kg', label: 'kg' },
    { value: 'l', label: 'L' },
    { value: 'pc', label: 'Pc' },
];

const SUPPLIERS: readonly SelectOption[] = [
    'Al Quoz Fresh Produce',
    'Barakat Dairy',
    'Blue Harbour Seafood',
    'Emirates Grain Co.',
    'Gulf Spice Traders',
    'Hatta Honey Farm',
    'Jebel Ali Packaging',
    'Liwa Dates',
    'Masafi Water',
    'Oasis Poultry',
    'Ras Al Khor Meats',
    'Zaatar Bakery Supplies',
].map((name, index) => ({ value: `sup-${String(index)}`, label: name }));

const SLOTS: readonly SelectOption[] = [
    { value: 'all', label: 'All' },
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'dinner', label: 'Dinner' },
];

const INGREDIENTS: readonly SelectOption[] = [
    ['Cheddar, melted (canned)', 'Dairy · $7.68'],
    ['Emmental cheese', 'Dairy · $14.45'],
    ['Feta cheese', 'Dairy · $7.79'],
    ['Gouda cheese', 'Dairy · $11.01'],
    ['Halloumi cheese', 'Dairy · $11.47'],
    ['Mozzarella cheese', 'Dairy · $9.20'],
    ['Basmati rice', 'Grains · $3.10'],
    ['Chickpeas, dried', 'Pulses · $2.45'],
].map(([label = '', description = ''], index) => ({
    value: `ing-${String(index)}`,
    label,
    description,
    section: 'Raw materials',
}));

const COOKED: readonly SelectOption[] = [
    {
        value: 'cooked-0',
        label: 'Tomato sauce',
        description: 'Sub-recipe · $1.90',
        section: 'Cooked items',
    },
    {
        value: 'cooked-1',
        label: 'Garlic yoghurt',
        description: 'Sub-recipe · $2.30',
        section: 'Cooked items',
    },
];

/** One example: what it is for, and the part as a page would use it. */
function Sample({
    title,
    note,
    children,
}: {
    readonly title: string;
    readonly note: string;
    readonly children: ReactNode;
}) {
    return (
        <Stack space="xs">
            <Text variant="label">{title}</Text>
            <Text variant="caption" tone="secondary">
                {note}
            </Text>
            <View className="min-h-[96px] flex-row items-start rounded-[22px] border border-stroke-subtle bg-surface-raised p-4">
                {children}
            </View>
        </Stack>
    );
}

function DropdownSection() {
    const [unit, setUnit] = useState<string | null>('kg');
    const [supplier, setSupplier] = useState<string | null>(null);
    const [slot, setSlot] = useState('all');
    const [added, setAdded] = useState<readonly string[]>([]);
    const [required, setRequired] = useState<string | null>(null);

    const addable = [...INGREDIENTS, ...COOKED];
    const addedNames = added.map(
        (value) => addable.find((option) => option.value === value)?.label ?? value,
    );

    return (
        <Stack space="lg" testID="components-showcase-dropdown">
            <Stack space="xs">
                <Text variant="section">Dropdown</Text>
                <Text variant="caption" tone="secondary">
                    {`Select · the filter box turns on by itself past ${String(SEARCH_THRESHOLD)} options`}
                </Text>
            </Stack>

            <Sample
                title="Form field · short list"
                note="3 short options · no filter box, narrow by itself"
            >
                <View className="w-[320px]">
                    <Select
                        testID="components-showcase-unit"
                        label="Unit"
                        look="card"
                        options={UNITS}
                        value={unit}
                        onChange={setUnit}
                    />
                </View>
            </Sample>

            <Sample title="Form field · long list" note="12 options · filter box on by itself">
                <View className="w-[320px]">
                    <Select
                        testID="components-showcase-supplier"
                        label="Supplier"
                        look="card"
                        placeholder="Choose a supplier"
                        options={SUPPLIERS}
                        value={supplier}
                        onChange={setSupplier}
                    />
                </View>
            </Sample>

            <Sample
                title="Toolbar filter"
                note={'trigger="pill" · green once set to anything but All'}
            >
                <Select
                    testID="components-showcase-slot"
                    trigger="pill"
                    label="Slot"
                    options={SLOTS}
                    value={slot}
                    onChange={setSlot}
                />
            </Sample>

            <Sample
                title="Add from a list"
                note={
                    'trigger="pill" value={null} · groups and a second line from section / description'
                }
            >
                <Stack space="sm">
                    <Select
                        testID="components-showcase-add"
                        trigger="pill"
                        label="Add an ingredient"
                        placeholder="Add an ingredient…"
                        options={addable}
                        value={null}
                        onChange={(value) => {
                            setAdded((current) => [...current, value]);
                        }}
                    />
                    <Text variant="caption" tone="secondary" testID="components-showcase-added">
                        {addedNames.length === 0
                            ? 'Nothing added yet'
                            : `Added: ${addedNames.join(', ')}`}
                    </Text>
                </Stack>
            </Sample>

            <Sample title="Field states" note="required with an error · disabled">
                <View className="flex-row flex-wrap gap-4">
                    <View className="w-[320px]">
                        <Select
                            testID="components-showcase-required"
                            label="Storage"
                            look="card"
                            required
                            options={UNITS}
                            value={required}
                            onChange={setRequired}
                            {...(required === null ? { error: 'Choose how it is stored' } : {})}
                        />
                    </View>
                    <View className="w-[320px]">
                        <Select
                            testID="components-showcase-disabled"
                            label="Unit"
                            look="card"
                            disabled
                            options={UNITS}
                            value="kg"
                            onChange={() => undefined}
                        />
                    </View>
                </View>
            </Sample>
        </Stack>
    );
}

export function ComponentsShowcaseScreen() {
    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[960px] p-6">
                <Stack space="xl" testID="components-showcase">
                    <Text variant="title">Components</Text>
                    <DropdownSection />
                </Stack>
            </View>
        </DensityProvider>
    );
}
