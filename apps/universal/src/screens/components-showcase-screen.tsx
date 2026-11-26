import {
    Badge,
    Button,
    Checkbox,
    ChoiceChips,
    ChoiceRow,
    DataTable,
    DatePicker,
    DensityProvider,
    FilterChip,
    Icon,
    IconButton,
    QuantityInput,
    SEARCH_THRESHOLD,
    Select,
    Stack,
    StatusSteps,
    Switch,
    Tabs,
    Tag,
    Text,
    initialsOf,
} from '@healthy360/design-system';
import type { DataTableColumn, SelectOption } from '@healthy360/design-system';
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

/** A row of buttons, wrapping on a narrow window. */
function Row({ children }: { readonly children: ReactNode }) {
    return <View className="flex-row flex-wrap items-center gap-3">{children}</View>;
}

function ButtonsSection() {
    const [busy, setBusy] = useState(false);
    return (
        <Stack space="lg" testID="components-showcase-buttons">
            <Stack space="xs">
                <Text variant="section">Buttons</Text>
                <Text variant="caption" tone="secondary">
                    Button and IconButton · the admin look comes from the area, never a prop
                </Text>
            </Stack>

            <Sample
                title="Levels"
                note="primary · secondary · quiet · next · danger · dangerOutline"
            >
                <Row>
                    <Button
                        testID="components-showcase-button-primary"
                        label="New order"
                        iconStart={<Icon name="plus" size="sm" />}
                    />
                    <Button label="Pause kitchen" variant="secondary" />
                    <Button label="Clear filters" variant="quiet" />
                    <Button label="Mark delivered" variant="next" />
                    <Button label="Delete" variant="danger" />
                    <Button label="Cancel order" variant="dangerOutline" />
                </Row>
            </Sample>

            <Sample title="States" note="disabled primary is grey, not faded · loading sweeps">
                <Row>
                    <Button
                        testID="components-showcase-button-disabled"
                        label="Publish"
                        disabled
                        hint="Add a price first"
                    />
                    <Button label="Save" loading={busy} onPress={() => setBusy((on) => !on)} />
                    <Button
                        label="Stop the sweep"
                        variant="secondary"
                        onPress={() => setBusy(false)}
                    />
                </Row>
            </Sample>

            <Sample
                title="Sizes"
                note="sm and md are the 34px toolbar pill · lg is the 44px pill a panel ends in"
            >
                <Row>
                    <Button label="Toolbar" size="sm" />
                    <Button label="Place order" size="lg" />
                </Row>
            </Sample>

            <Sample
                title="Icon buttons"
                note={'variant="secondary" is the round bordered glyph · ghost sits in a row'}
            >
                <Row>
                    <IconButton
                        testID="components-showcase-icon-back"
                        label="Previous day"
                        variant="secondary"
                        icon={<Icon name="chevronStart" size="sm" />}
                    />
                    <IconButton
                        label="Next day"
                        variant="secondary"
                        icon={<Icon name="chevronEnd" size="sm" />}
                    />
                    <IconButton
                        label="Close"
                        variant="secondary"
                        icon={<Icon name="close" size="sm" />}
                    />
                    <IconButton
                        label="More"
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="more" size="sm" />}
                    />
                </Row>
            </Sample>

            <Sample title="On a dark band" note="inverse · inverseOutline">
                <View className="flex-1 flex-row flex-wrap items-center gap-3 rounded-[18px] bg-surface-inverse px-4 py-3">
                    <Button label="Clear" variant="inverseOutline" size="sm" />
                    <Button label="Ask for a quotation" variant="inverse" size="sm" />
                </View>
            </Sample>
        </Stack>
    );
}

function LabelsSection() {
    return (
        <Stack space="lg" testID="components-showcase-labels">
            <Stack space="xs">
                <Text variant="section">Labels</Text>
                <Text variant="caption" tone="secondary">
                    Badge · a word or a count about a record, never pressed
                </Text>
            </Stack>

            <Sample title="Tones" note="warning · info · success · danger · neutral · brand">
                <Row>
                    <Badge
                        testID="components-showcase-badge-warning"
                        tone="warning"
                        label="To confirm"
                    />
                    <Badge tone="info" label="Confirmed" />
                    <Badge tone="success" label="Done" />
                    <Badge tone="danger" label="Late" />
                    <Badge tone="neutral" label="Manager" />
                    <Badge tone="brand" label="Regular" />
                </Row>
            </Sample>

            <Sample
                title="Sizes and counts"
                note="sm in a calendar cell · md in a row · lg in a pop-up header"
            >
                <Row>
                    <Badge tone="warning" size="sm" label="3" />
                    <Badge tone="warning" label="5" />
                    <Badge tone="warning" size="lg" label="3 to confirm" />
                </Row>
            </Sample>

            <Sample title="Tag" note="an allergen or a diet under a name · never pressed">
                <Row>
                    <Tag label="Gluten" />
                    <Tag label="Vegan" />
                </Row>
            </Sample>
        </Stack>
    );
}

function TickBoxesSection() {
    const [rows, setRows] = useState<readonly boolean[]>([true, false, false]);
    const [market, setMarket] = useState(true);
    const [diets, setDiets] = useState<readonly string[]>(['Vegetarian']);
    const [onSale, setOnSale] = useState(true);
    const all = rows.every(Boolean);
    const some = rows.some(Boolean) && !all;
    const toggleDiet = (diet: string) => {
        setDiets((current) =>
            current.includes(diet) ? current.filter((entry) => entry !== diet) : [...current, diet],
        );
    };
    return (
        <Stack space="lg" testID="components-showcase-tick-boxes">
            <Stack space="xs">
                <Text variant="section">Tick boxes</Text>
                <Text variant="caption" tone="secondary">
                    Checkbox · plain, in a table (labelHidden), or as a card · Switch for a setting
                </Text>
            </Stack>

            <Sample title="Plain" note="a tick and its words">
                <Row>
                    <Checkbox
                        testID="components-showcase-checkbox-plain"
                        label="Market priced"
                        checked={market}
                        onChange={setMarket}
                    />
                    <Checkbox
                        label="Assorted / mixed box"
                        checked={false}
                        onChange={() => undefined}
                    />
                </Row>
            </Sample>

            <Sample title="In a table" note="labelHidden · the header box shows some ticked">
                <Stack space="xs">
                    <Row>
                        <Checkbox
                            testID="components-showcase-checkbox-all"
                            labelHidden
                            label="Order every item"
                            checked={all}
                            mixed={some}
                            onChange={(next) => {
                                setRows(rows.map(() => next));
                            }}
                        />
                        <Text variant="label">Item</Text>
                    </Row>
                    {['Aioli Sauce', 'Allspices', 'Almonds'].map((name, index) => (
                        <Row key={name}>
                            <Checkbox
                                labelHidden
                                label={`Order ${name}`}
                                checked={rows[index] === true}
                                onChange={(next) => {
                                    setRows(rows.map((value, at) => (at === index ? next : value)));
                                }}
                            />
                            <Text>{name}</Text>
                        </Row>
                    ))}
                </Stack>
            </Sample>

            <Sample
                title="Cards"
                note={'shape="card" · diets, sales channels · description is the second line'}
            >
                <Row>
                    {['Vegetarian', 'Vegan', 'High protein'].map((diet) => (
                        <Checkbox
                            key={diet}
                            shape="card"
                            label={diet}
                            checked={diets.includes(diet)}
                            onChange={() => {
                                toggleDiet(diet);
                            }}
                        />
                    ))}
                    <Checkbox
                        testID="components-showcase-checkbox-card"
                        shape="card"
                        label="Households"
                        description="Consumer"
                        checked
                        onChange={() => undefined}
                    />
                </Row>
            </Sample>

            <Sample title="Switch" note="a setting that applies where it stands">
                <Switch label="Available for sale" checked={onSale} onChange={setOnSale} />
            </Sample>
        </Stack>
    );
}

function ChoicesSection() {
    const [day, setDay] = useState<string | null>('fri');
    const [factor, setFactor] = useState('2');
    const [driver, setDriver] = useState<string | null>('sami');
    const [reason, setReason] = useState<string | null>('kitchen');
    const drivers = [
        { key: 'hala', name: 'Hala Owner', runs: '2 runs today' },
        { key: 'sami', name: 'Sami Staff', runs: '1 run today' },
    ];
    const reasons = [
        { key: 'customer', label: 'The customer asked to cancel' },
        { key: 'kitchen', label: 'The kitchen cannot fulfil it' },
    ];
    return (
        <Stack space="lg" testID="components-showcase-choices">
            <Stack space="xs">
                <Text variant="section">Choices</Text>
                <Text variant="caption" tone="secondary">
                    ChoiceChips for a few short choices · ChoiceRow for choices with a detail
                </Text>
            </Stack>

            <Sample title="ChoiceChips" note="one of a few short choices, compared at a glance">
                <ChoiceChips
                    testID="components-showcase-choice-chips"
                    label="Delivery day"
                    value={day}
                    onChange={setDay}
                    items={[
                        { key: 'wed', label: 'Wed 11' },
                        { key: 'thu', label: 'Thu 12' },
                        { key: 'fri', label: 'Fri 13' },
                        { key: 'sat', label: 'Sat 14', disabled: true },
                    ]}
                />
            </Sample>

            <Sample title="FilterChip" note="the single pill ChoiceChips is made of">
                <Row>
                    {['1', '2', '4', '8'].map((value) => (
                        <FilterChip
                            key={value}
                            label={`${value}×`}
                            selected={factor === value}
                            onChange={() => {
                                setFactor(value);
                            }}
                        />
                    ))}
                </Row>
            </Sample>

            <Sample
                title="ChoiceRow"
                note={'mark="avatar" · "radio" · "check" · picking never acts on its own'}
            >
                <View className="w-[360px] flex-col gap-1">
                    {drivers.map((entry) => (
                        <ChoiceRow
                            key={entry.key}
                            testID={`components-showcase-choice-row-${entry.key}`}
                            mark="avatar"
                            initials={initialsOf(entry.name)}
                            label={entry.name}
                            meta={entry.runs}
                            selected={driver === entry.key}
                            onPress={() => {
                                setDriver(entry.key);
                            }}
                        />
                    ))}
                    {reasons.map((entry) => (
                        <ChoiceRow
                            key={entry.key}
                            mark="radio"
                            label={entry.label}
                            selected={reason === entry.key}
                            onPress={() => {
                                setReason(entry.key);
                            }}
                        />
                    ))}
                </View>
            </Sample>
        </Stack>
    );
}

function TabsSection() {
    const [view, setView] = useState('today');
    const [mode, setMode] = useState('month');
    const [method, setMethod] = useState('cash');
    const [layout, setLayout] = useState('table');
    return (
        <Stack space="lg" testID="components-showcase-tabs">
            <Stack space="xs">
                <Text variant="section">Tabs</Text>
                <Text variant="caption" tone="secondary">
                    Tabs · the admin uses two looks: strip for a page&apos;s views, segmented for a
                    toggle
                </Text>
            </Stack>

            <Sample title="Page tabs" note={'variant="strip" · counts in amber, hidden at 0'}>
                <Tabs
                    testID="components-showcase-tabs-strip"
                    label="Orders view"
                    variant="strip"
                    items={[
                        { value: 'today', label: 'Today', count: 13 },
                        { value: 'calendar', label: 'Calendar' },
                        { value: 'all', label: 'All orders' },
                    ]}
                    value={view}
                    onChange={setView}
                />
            </Sample>

            <Sample title="Toggle" note={'variant="segmented" · a mode inside a toolbar or form'}>
                <Tabs
                    testID="components-showcase-tabs-segmented"
                    label="Calendar view"
                    variant="segmented"
                    items={[
                        { value: 'month', label: 'Month' },
                        { value: 'week', label: 'Week' },
                        { value: 'day', label: 'Today' },
                    ]}
                    value={mode}
                    onChange={setMode}
                />
            </Sample>

            <Sample
                title="A value picked"
                note={'segmented + radio · payment method, Open / Closed'}
            >
                <View className="w-[360px]">
                    <Tabs
                        testID="components-showcase-tabs-radio"
                        label="Payment method"
                        variant="segmented"
                        radio
                        block
                        items={[
                            { value: 'cash', label: 'Cash on delivery' },
                            { value: 'card', label: 'Card at the door' },
                            { value: 'wish', label: 'Wish transfer' },
                        ]}
                        value={method}
                        onChange={setMethod}
                    />
                </View>
            </Sample>

            <Sample title="Icons only" note={'segmented + radio + labelHidden · list / cards'}>
                <Tabs
                    testID="components-showcase-tabs-icons"
                    label="Layout"
                    variant="segmented"
                    radio
                    labelHidden
                    items={[
                        { value: 'table', label: 'Table', icon: 'list' },
                        { value: 'cards', label: 'Cards', icon: 'layoutGrid' },
                    ]}
                    value={layout}
                    onChange={setLayout}
                />
            </Sample>
        </Stack>
    );
}

function StepsSection() {
    const [section, setSection] = useState('receipt');
    return (
        <Stack space="lg" testID="components-showcase-steps">
            <Stack space="xs">
                <Text variant="section">Steps</Text>
                <Text variant="caption" tone="secondary">
                    Tabs pills for a form&apos;s sections · StatusSteps for how far a record has got
                </Text>
            </Stack>

            <Sample title="Form sections" note={'Tabs variant="pills" · detail, done, issues'}>
                <View className="w-full">
                    <Tabs
                        testID="components-showcase-steps-pills"
                        label="Post a goods receipt"
                        variant="pills"
                        items={[
                            {
                                value: 'arrival',
                                label: 'What arrived',
                                detail: 'Market purchase',
                                done: true,
                            },
                            { value: 'receipt', label: 'Receipt', detail: 'No supplier' },
                            {
                                value: 'lines',
                                label: 'Lines',
                                detail: '4 to post, 1 left out',
                                issues: { count: 2, tone: 'warning', label: '2 to fix' },
                            },
                            {
                                value: 'check',
                                label: 'Check and post',
                                detail: 'Over-receipt',
                                detailTone: 'warning',
                            },
                        ]}
                        value={section}
                        onChange={setSection}
                    />
                </View>
            </Sample>

            <Sample title="Where the reader is" note={'pills + readOnly · New order'}>
                <Tabs
                    testID="components-showcase-steps-readonly"
                    label="New order steps"
                    variant="pills"
                    readOnly
                    items={[
                        { value: 'customer', label: 'Customer' },
                        { value: 'meals', label: 'Meals' },
                        { value: 'checkout', label: 'Checkout' },
                    ]}
                    value="meals"
                    onChange={() => undefined}
                />
            </Sample>

            <Sample
                title="How far a record has got"
                note="StatusSteps · done, partial, current, pending"
            >
                <View className="w-full">
                    <StatusSteps
                        testID="components-showcase-status-steps"
                        label="Where the order is"
                        noValue="—"
                        steps={[
                            { key: 'placed', label: 'Placed', at: 'Nov 26, 10:41', state: 'done' },
                            {
                                key: 'part',
                                label: 'Partly received',
                                at: 'Nov 27',
                                state: 'partial',
                            },
                            { key: 'ready', label: 'Ready', at: null, state: 'current' },
                            { key: 'delivered', label: 'Delivered', at: null, state: 'pending' },
                        ]}
                        trailing={<Button label="Mark ready" size="sm" />}
                        className="rounded-2xl bg-surface-sunken px-3 py-2.5"
                    />
                </View>
            </Sample>
        </Stack>
    );
}

function DatesSection() {
    const [day, setDay] = useState('2026-11-26');
    const [from, setFrom] = useState('');
    const [received, setReceived] = useState<string | null>('2026-11-24');
    const [expires, setExpires] = useState('');
    return (
        <Stack space="lg" testID="components-showcase-dates">
            <Stack space="xs">
                <Text variant="section">Dates</Text>
                <Text variant="caption" tone="secondary">
                    DatePicker · one small month · a pill on a toolbar, a field in a form
                </Text>
            </Stack>

            <Sample title="A toolbar's day" note={'trigger="pill" · valueLabel, marked days'}>
                <DatePicker
                    testID="components-showcase-date-day"
                    trigger="pill"
                    label="Pick a day"
                    value={day}
                    today="2026-11-26"
                    valueLabel={day === '2026-11-26' ? 'Today · Thu, Nov 26' : undefined}
                    marked={(candidate) => candidate.endsWith('5')}
                    onChange={setDay}
                />
            </Sample>

            <Sample title="An open bound" note={'trigger="pill" · placeholder, onClear'}>
                <DatePicker
                    testID="components-showcase-date-from"
                    trigger="pill"
                    label="From"
                    placeholder="Any day"
                    value={from}
                    onChange={setFrom}
                    onClear={() => {
                        setFrom('');
                    }}
                />
                <DatePicker
                    testID="components-showcase-date-due"
                    trigger="pill"
                    label="Due on"
                    labelVisible
                    value={day}
                    onChange={setDay}
                />
            </Sample>

            <Sample title="A form's date" note={'trigger="field" · Today, Clear with onClear'}>
                <View className="z-auto w-full flex-row gap-3">
                    <DatePicker
                        testID="components-showcase-date-received"
                        label="Received on"
                        required
                        max="2026-11-26"
                        value={received}
                        onChange={setReceived}
                        className="min-w-0 flex-1"
                    />
                    <DatePicker
                        testID="components-showcase-date-expires"
                        label="Expires"
                        hint="Leave empty if it has no date"
                        value={expires}
                        onChange={setExpires}
                        onClear={() => {
                            setExpires('');
                        }}
                        className="min-w-0 flex-1"
                    />
                </View>
            </Sample>
        </Stack>
    );
}

interface StockRow {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly price: string;
    readonly status: 'published' | 'draft';
}

const STOCK_ROWS: readonly StockRow[] = [
    {
        id: 'ING-050',
        name: 'Cheddar, melted',
        category: 'Dairy',
        price: '7.68',
        status: 'published',
    },
    {
        id: 'ING-052',
        name: 'Emmental cheese',
        category: 'Dairy',
        price: '14.45',
        status: 'published',
    },
    { id: 'ING-053', name: 'Feta cheese', category: 'Dairy', price: '7.79', status: 'draft' },
];

interface LineRow {
    readonly key: string;
    readonly item: string;
    readonly quantity: string;
}

function TablesSection() {
    const [lines, setLines] = useState<readonly LineRow[]>([
        { key: 'a', item: 'Mayonnaise', quantity: '1.5' },
        { key: 'b', item: 'Ketchup', quantity: '' },
    ]);
    const records: readonly DataTableColumn<StockRow>[] = [
        { key: 'id', label: 'ID', width: 96, priority: 60, role: 'meta', value: (row) => row.id },
        {
            key: 'name',
            label: 'Item',
            width: 200,
            priority: 100,
            role: 'title',
            value: (row) => row.name,
        },
        {
            key: 'category',
            label: 'Category',
            width: 140,
            priority: 40,
            role: 'meta',
            value: (row) => row.category,
        },
        {
            key: 'price',
            label: 'Unit price',
            width: 110,
            priority: 50,
            role: 'metric',
            value: (row) => row.price,
        },
        {
            key: 'status',
            label: 'Status',
            width: 120,
            priority: 70,
            role: 'status',
            value: (row) => (row.status === 'published' ? 'Published' : 'Draft'),
            render: (row) => (
                <Badge
                    tone={row.status === 'published' ? 'success' : 'neutral'}
                    label={row.status === 'published' ? 'Published' : 'Draft'}
                />
            ),
        },
    ];
    const lineColumns: readonly DataTableColumn<LineRow>[] = [
        {
            key: 'item',
            label: 'Item',
            width: 220,
            priority: 100,
            fill: true,
            value: (row) => row.item,
        },
        {
            key: 'quantity',
            label: 'Quantity',
            width: 140,
            priority: 90,
            render: (row) => (
                <View className="w-full">
                    <QuantityInput
                        testID={`components-showcase-lines-${row.key}-quantity`}
                        id={`components-showcase-lines-${row.key}-quantity`}
                        label={`Quantity of ${row.item}`}
                        labelHidden
                        size="sm"
                        unit="kg"
                        value={row.quantity}
                        onChangeText={(quantity) => {
                            setLines((current) =>
                                current.map((line) =>
                                    line.key === row.key ? { ...line, quantity } : line,
                                ),
                            );
                        }}
                    />
                </View>
            ),
        },
    ];
    return (
        <Stack space="lg" testID="components-showcase-tables">
            <Stack space="xs">
                <Text variant="section">Tables</Text>
                <Text variant="caption" tone="secondary">
                    DataTable · a list of records, or a form&apos;s lines
                </Text>
            </Stack>

            <Sample
                title="A list of records"
                note="DataTable · RowMenu ⋯ per row (green while open), pages past 18, two-line rows on a phone"
            >
                <View className="w-full">
                    <DataTable<StockRow>
                        testID="components-showcase-table"
                        label="Ingredients"
                        columns={records}
                        rows={STOCK_ROWS}
                        rowKey={(row) => row.id}
                        rowActions={() => [
                            { key: 'view', label: 'View', onSelect: () => undefined },
                            { key: 'archive', label: 'Archive', onSelect: () => undefined },
                        ]}
                    />
                </View>
            </Sample>

            <Sample
                title="A form's lines"
                note="DataTable lines · every row, every width, no pager"
            >
                <View className="w-full">
                    <DataTable<LineRow>
                        lines
                        testID="components-showcase-lines"
                        label="Recipe lines"
                        columns={lineColumns}
                        rows={lines}
                        rowKey={(row) => row.key}
                        rowTone={(row) => (row.quantity === '' ? 'danger' : undefined)}
                        rowNote={(row) =>
                            row.quantity === '' ? (
                                <Text variant="caption" tone="danger">
                                    Enter a quantity
                                </Text>
                            ) : null
                        }
                    />
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
                    <ButtonsSection />
                    <LabelsSection />
                    <TickBoxesSection />
                    <ChoicesSection />
                    <TabsSection />
                    <StepsSection />
                    <DatesSection />
                    <TablesSection />
                </Stack>
            </View>
        </DensityProvider>
    );
}
