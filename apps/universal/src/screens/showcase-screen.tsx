import { apiFailure, rateLimitFailure, validationFailure } from '@healthy360/api-client';
import {
    Accordion,
    ActionSheet,
    Avatar,
    Badge,
    BADGE_TONES,
    Breadcrumbs,
    Button,
    BUTTON_SIZES,
    BUTTON_VARIANTS,
    CalendarGrid,
    Callout,
    CALLOUT_TONES,
    Card,
    CARD_TONES,
    CARD_PADDINGS,
    Checkbox,
    Chip,
    Collapse,
    DataList,
    DateField,
    DensityProvider,
    Dialog,
    Drawer,
    Dropdown,
    EmptyState,
    ErrorState,
    FadeIn,
    FileUploadField,
    FilterChip,
    FormField,
    FormGrid,
    FormSection,
    Heading,
    Icon,
    ICON_GLYPHS,
    IconButton,
    ImagePlaceholder,
    Inline,
    INPUT_SIZES,
    ListItem,
    Menu,
    MeterBar,
    NumberStepper,
    NUTRITION_LEVELS,
    OfflineIndicator,
    OtpInput,
    PageTransition,
    Pagination,
    PasswordInput,
    Popover,
    ProgressRing,
    QuantityInput,
    RangeFilter,
    Rating,
    RECORD_STATUSES,
    SegmentedControl,
    Select,
    SearchInput,
    Separator,
    Skeleton,
    SlideIn,
    SliderField,
    Spinner,
    Stack,
    StatusBadge,
    Stepper,
    Switch,
    Table,
    Tabs,
    TABS_VARIANTS,
    TAG_TONES,
    Tag,
    TagRow,
    Text,
    TEXT_ALIGNMENTS,
    TEXT_TONES,
    TEXT_VARIANTS,
    TextInputField,
    UNDROPPABLE_PRIORITY,
    useAnimatedNumber,
    useToast,
} from '@healthy360/design-system';
import type {
    DataListColumn,
    IconName,
    RangeValue,
    RecordStatus,
    TableColumn,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'nativewind';
import { Text as RNText, View } from 'react-native';

import { EntityImage, MediaChip } from '../media/entity-image.tsx';
import type { PublishableStatus } from '@healthy360/api-client/contracts';
import { BilingualField } from '../features/kitchen-admin/bilingual-field.tsx';
import { DerivedPanel } from '../features/kitchen-admin/catalogue/derived-panel.tsx';
import type { DerivedFigure } from '../features/kitchen-admin/catalogue/derived-panel.tsx';
import { CatalogueStatCards } from '../features/kitchen-admin/catalogue/catalogue-stat-cards.tsx';
import { CatalogueToolbar } from '../features/kitchen-admin/catalogue/catalogue-toolbar.tsx';
import { CatalogueColumnHeader } from '../features/kitchen-admin/catalogue/catalogue-column-header.tsx';
import { CatalogueViewDrawer } from '../features/kitchen-admin/catalogue/catalogue-view-drawer.tsx';
import { GateRailCard } from '../features/kitchen-admin/gate-rail-card.tsx';
import { KitchenPageHeader } from '../features/kitchen-admin/kitchen-page-header.tsx';
import { KpiTile } from '../features/kitchen-admin/kpi-tile.tsx';
import { ListToolbar } from '../features/kitchen-admin/list-toolbar.tsx';
import { ToolbarRow } from '../features/marketplace/toolbar-row.tsx';
import { AiBand, AiRailCard } from '../ui/ai-surface.tsx';
import { BrowseCard } from '../ui/browse-card.tsx';
import { BrowsePanel } from '../ui/browse-panel.tsx';
import { ListingHeader } from '../ui/listing-header.tsx';
import { PageHero } from '../ui/page-hero.tsx';

interface SectionProps {
    readonly id: string;
    readonly title: string;
    readonly children: React.ReactNode;
}

function Section({ id, title, children }: SectionProps) {
    return (
        <Card testID={`showcase-${id}`} padding="lg" tone="raised">
            <Heading level={2}>{title}</Heading>
            <Stack space="md">{children}</Stack>
        </Card>
    );
}

interface NutrientRow {
    readonly key: string;
    readonly name: string;
    readonly amount: string;
    readonly target: string;
}

const NUTRIENT_ROWS: readonly NutrientRow[] = [
    { key: 'protein', name: 'Protein', amount: '96 g', target: '120 g' },
    { key: 'carbohydrate', name: 'Carbohydrate', amount: '210 g', target: '240 g' },
    { key: 'fibre', name: 'Fibre', amount: '22 g', target: '30 g' },
];

/**
 * The sortable table story sorts its own rows, because {@link Table} deliberately does not: it
 * reports the intent and the owner of the data decides what "sorted" means.
 */
const NUTRIENT_SORT_KEYS = ['name', 'amount', 'target'] as const;
type NutrientSortKey = (typeof NUTRIENT_SORT_KEYS)[number];

function isNutrientSortKey(value: string): value is NutrientSortKey {
    return (NUTRIENT_SORT_KEYS as readonly string[]).includes(value);
}

/** Rendered inside the motion section so the animated figure has something to travel towards. */
function AnimatedFigure({ value }: { readonly value: number }) {
    const shown = useAnimatedNumber(value);
    return (
        <Text testID="showcase-animated-number" variant="bodyStrong">
            {String(shown)}
        </Text>
    );
}

interface CatalogueRow {
    readonly key: string;
    readonly designation: string;
    readonly reference: string;
    readonly kind: string;
    readonly cost: string;
    readonly status: RecordStatus;
    readonly statusLabel: string;
    readonly updated: string;
}

/** The design's own four figures, so the panel's story is the panel's real content. */
const SHOWCASE_NUTRIENTS: readonly DerivedFigure[] = [
    { key: 'energy', label: 'Energy', value: '680', unit: 'kcal / 100 g' },
    { key: 'fat', label: 'Fat', value: '74.8', unit: 'g / 100 g' },
    { key: 'carbohydrate', label: 'Carbohydrate', value: '1.4', unit: 'g / 100 g' },
    { key: 'protein', label: 'Protein', value: '1.1', unit: 'g / 100 g' },
];

const CATALOGUE_ROWS: readonly CatalogueRow[] = [
    {
        key: 'tahini',
        designation: 'Tahini paste',
        reference: 'ING-0142',
        kind: 'paste',
        cost: '4.5700',
        status: 'live',
        statusLabel: 'Live',
        updated: '3 Sep',
    },
    {
        key: 'zaatar',
        designation: 'Zaatar blend',
        reference: 'ING-0207',
        kind: 'spice',
        cost: '9.2400',
        status: 'draft',
        statusLabel: 'Draft',
        updated: '1 Sep',
    },
    {
        key: 'labneh',
        designation: 'Labneh',
        reference: 'ING-0088',
        kind: 'dairy',
        cost: '2.1050',
        status: 'review',
        statusLabel: 'Review',
        updated: '28 Aug',
    },
];

const CATALOGUE_KINDS = ['paste', 'spice', 'dairy'] as const;

/**
 * The recipe editor's five, with the counts the two line tabs carry.
 *
 * `count` is drawn on Production and Packaging and absent from the other three, which is the whole
 * of its contract: a tab whose content is a list says how long the list is, and a tab whose content
 * is a form has nothing to count. `0` still draws — an empty Packaging tab saying so is the point.
 */
const RECIPE_TABS = [
    { value: 'description', label: 'Description' },
    { value: 'production', label: 'Production', count: 9 },
    { value: 'packaging', label: 'Packaging', count: 0 },
    { value: 'costing', label: 'Costing' },
    { value: 'sheet', label: 'Technical sheet' },
] as const;

/** `rowHeight` from `control.ts`, which is what `DataList` switches on. */
const ROW_DENSITIES = ['sm', 'md', 'lg'] as const;
const TABLE_ROW_SIZES = ['sm', 'md', 'lg'] as const;

const PASS_TABLE_COLUMNS: readonly TableColumn<NutrientRow>[] = [
    {
        key: 'name',
        header: 'Nutrient',
        rowHeader: true,
        flex: 2,
        render: (row) => <Text variant="label">{row.name}</Text>,
    },
    {
        key: 'amount',
        header: 'Amount',
        numeric: true,
        render: (row) => (
            <Text variant="mono" align="end">
                {row.amount}
            </Text>
        ),
    },
    {
        key: 'target',
        header: 'Target',
        numeric: true,
        render: (row) => (
            <Text variant="mono" align="end">
                {row.target}
            </Text>
        ),
    },
];

/**
 * Every component the two Catalogue passes produced — the layout, overlay and field components
 * built on `control.ts`, and the primitives rebuilt on the role ramp.
 *
 * It is one component rendered twice, once bare and once inside `DensityProvider value="compact"`,
 * because the whole point of the pass is that the same call site resolves differently under the
 * two densities: a `sm` button carries the 44px floor on the customer surfaces and `controlHeight`
 * in the admin, and `body` is the shipped 14px against the ramp's 12px. Two hand-written copies
 * would drift; one component taking a `prefix` for its testIDs cannot.
 */
function BilingualStory({ prefix }: { readonly prefix: string }) {
    const [row, setRow] = useState({ en: 'Mayonnaise', ar: 'مايونيز' });
    const [stacked, setStacked] = useState({ en: 'Mayonnaise', ar: '' });
    const id = (suffix: string) => `${prefix}-${suffix}`;

    return (
        <Stack space="sm">
            <FormGrid testID={id('bilingual-row-grid')}>
                <BilingualField
                    span={2}
                    layout="row"
                    testID={id('bilingual-row')}
                    fieldLabel="Designation"
                    value={row}
                    requiredEnglish
                    onChange={setRow}
                />
            </FormGrid>
            <BilingualField
                testID={id('bilingual-stacked')}
                fieldLabel="Name"
                value={stacked}
                requiredEnglish
                onChange={setStacked}
            />
        </Stack>
    );
}

function SwitchStory({ prefix }: { readonly prefix: string }) {
    const [sellable, setSellable] = useState(true);
    const id = (suffix: string) => `${prefix}-${suffix}`;

    return (
        <Stack space="xs">
            <Switch
                testID={id('switch-on')}
                id={id('switch-on')}
                label="Available for sale"
                stateLabel={sellable ? 'On — pricing required' : 'Off — used in recipes only'}
                checked={sellable}
                onChange={setSellable}
            />
            <Switch
                testID={id('switch-off')}
                id={id('switch-off')}
                label="Restricted"
                stateLabel="Off — visible to every station"
                checked={false}
                onChange={() => undefined}
            />
            <Switch
                testID={id('switch-disabled')}
                id={id('switch-disabled')}
                label="Available for sale"
                stateLabel="Locked on a platform library row"
                checked
                disabled
                onChange={() => undefined}
            />
        </Stack>
    );
}

function CataloguePassStories({ prefix }: { readonly prefix: string }) {
    const [search, setSearch] = useState('zaatar');
    const [quantity, setQuantity] = useState('1.750');
    const [designation, setDesignation] = useState('');
    const [restricted, setRestricted] = useState(false);
    const [tab, setTab] = useState<string>('description');
    const [segment, setSegment] = useState('all');
    const [toolbarSearch, setToolbarSearch] = useState('');
    const [toolbarStatus, setToolbarStatus] = useState('all');
    const [viewOpen, setViewOpen] = useState(false);
    const [pressedRow, setPressedRow] = useState<string | null>(null);
    const [kinds, setKinds] = useState<readonly string[]>(['paste']);

    const id = (name: string) => `${prefix}-${name}`;

    const toggleKind = (kind: string) => {
        setKinds((current) =>
            current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
        );
    };

    /*
     * The §4.3 column header: sort commands, then the column's distinct values as toggleable rows,
     * then `Clear` in the footer only while a filter is on. `scope` keeps the testIDs unique across
     * the three density copies of the list below — the menu is the same menu in each.
     */
    /*
     * A column header with its sort-and-filter menu, in the shape every Catalogue list now draws.
     * `kinds` is the filter, so pressing a value here flips the header from its idle `⌄` to the
     * filter mark — which is the whole point of the component and the thing the previous header
     * had no way of saying.
     */
    const columnMenu = (scope: string) => (
        <CatalogueColumnHeader
            label="Kind"
            sortDirection={null}
            filtered={kinds.length > 0}
            testID={id(`${scope}-column-menu`)}
            sections={[
                {
                    items: [
                        {
                            key: 'asc',
                            label: 'Sort ascending',
                            icon: 'chevronUp',
                            onSelect: () => undefined,
                        },
                        {
                            key: 'desc',
                            label: 'Sort descending',
                            icon: 'chevronDown',
                            onSelect: () => undefined,
                        },
                    ],
                },
                {
                    label: 'Kind',
                    items: [
                        ...CATALOGUE_KINDS.map((kind) => ({
                            key: kind,
                            label: kind,
                            onSelect: () => toggleKind(kind),
                            selected: kinds.includes(kind),
                        })),
                        ...(kinds.length === 0
                            ? []
                            : [
                                  {
                                      key: 'clear',
                                      label: 'Clear',
                                      testID: id(`${scope}-column-menu-clear`),
                                      onSelect: () => {
                                          setKinds([]);
                                      },
                                  },
                              ]),
                    ],
                },
            ]}
        />
    );

    /*
     * Edit and Archive carry no icon: `pen` and `archive` are the two glyphs §10 records as
     * missing from `ICON_GLYPHS`, and that decision is still open. View takes `eye`, which exists.
     * When the two entries land, they belong here.
     */
    const catalogueColumns = (scope: string): readonly DataListColumn<CatalogueRow>[] => [
        {
            key: 'designation',
            label: 'Designation',
            width: 180,
            priority: 100,
            sortable: true,
            value: (row) => row.designation,
        },
        {
            key: 'reference',
            label: 'Reference',
            width: 110,
            priority: 70,
            mono: true,
            sortable: true,
            value: (row) => row.reference,
        },
        {
            key: 'kind',
            label: 'Kind',
            width: 130,
            priority: 60,
            sortable: true,
            filterable: true,
            value: (row) => row.kind,
            renderHeader: () => columnMenu(scope),
        },
        {
            key: 'cost',
            label: 'Cost / kg',
            width: 100,
            priority: 85,
            mono: true,
            sortable: true,
            value: (row) => row.cost,
        },
        {
            key: 'status',
            label: 'Status',
            width: 110,
            priority: 80,
            render: (row) => <StatusBadge status={row.status} label={row.statusLabel} />,
        },
        {
            key: 'updated',
            label: 'Updated',
            width: 90,
            priority: 20,
            // Start-aligned, like every other Catalogue column including the numeric ones. `end`
            // and `center` both exist and both were spent here, on the argument that a short track
            // reads as pushed against its neighbour — but the tracks are no longer short: they
            // grow to fill the port, and a figure read down a ragged inner edge is harder to scan
            // than one that starts under its own label.
            value: (row) => row.updated,
        },
        {
            key: 'actions',
            label: 'Actions',
            width: 72,
            priority: UNDROPPABLE_PRIORITY,
            align: 'end',
            // Sized to its control, so it takes no share of the port's leftover width.
            grow: false,
            render: (row) => (
                <Menu
                    testID={id(`${scope}-row-menu-${row.key}`)}
                    label={`Actions for ${row.designation}`}
                    align="end"
                    sections={[
                        {
                            items: [
                                {
                                    key: 'view',
                                    label: 'View',
                                    icon: 'eye',
                                    onSelect: () => undefined,
                                },
                                {
                                    key: 'edit',
                                    label: 'Edit',
                                    onSelect: () => undefined,
                                },
                                {
                                    key: 'archive',
                                    label: 'Archive',
                                    tone: 'danger',
                                    onSelect: () => undefined,
                                },
                            ],
                        },
                    ]}
                    trigger={({ triggerProps, toggle }) => (
                        <IconButton
                            {...triggerProps}
                            testID={id(`${scope}-row-menu-trigger-${row.key}`)}
                            size="sm"
                            variant="ghost"
                            label="More"
                            icon={<Icon name="more" size="sm" />}
                            onPress={toggle}
                        />
                    )}
                />
            ),
        },
    ];

    return (
        <Stack space="lg">
            {/* The type ramp: eight role steps plus mono, then every tone and alignment. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Type ramp
                </Text>
                {TEXT_VARIANTS.map((variant) => (
                    <Text key={variant} testID={id(`text-${variant}`)} variant={variant}>
                        {variant} — 1,750 g · 4.5700
                    </Text>
                ))}
                <Inline space="sm">
                    {TEXT_TONES.filter((tone) => tone !== 'inverse').map((tone) => (
                        <Text
                            key={tone}
                            testID={id(`text-tone-${tone}`)}
                            variant="body"
                            tone={tone}
                        >
                            {tone}
                        </Text>
                    ))}
                </Inline>
                {/* `inverse` is only legible on a dark ground, so it gets one. */}
                <View className="rounded-md bg-surface-canopy p-3">
                    <Text testID={id('text-tone-inverse')} variant="body" tone="inverse">
                        inverse
                    </Text>
                </View>
                <Stack space="none">
                    {TEXT_ALIGNMENTS.map((align) => (
                        <Text
                            key={align}
                            testID={id(`text-align-${align}`)}
                            variant="caption"
                            align={align}
                        >
                            {align}
                        </Text>
                    ))}
                </Stack>
            </Stack>

            {/* Button: every variant at every size, then the states that are not variants. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Button
                </Text>
                {BUTTON_SIZES.map((size) => (
                    <Inline key={size} space="sm" align="center">
                        {BUTTON_VARIANTS.map((variant) => (
                            <Button
                                key={variant}
                                testID={id(`button-${variant}-${size}`)}
                                size={size}
                                variant={variant}
                                label={`${variant} ${size}`}
                                onPress={() => undefined}
                            />
                        ))}
                    </Inline>
                ))}
                <Inline space="sm" align="center">
                    <Button
                        testID={id('button-icon-start')}
                        size="sm"
                        label="New ingredient"
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => undefined}
                    />
                    <Button
                        testID={id('button-icon-end')}
                        size="sm"
                        variant="secondary"
                        label="Fields"
                        iconEnd={<Icon name="filter" size="sm" />}
                        onPress={() => undefined}
                    />
                    <Button
                        testID={id('button-loading')}
                        size="sm"
                        loading
                        label="Saving"
                        onPress={() => undefined}
                    />
                    <Button
                        testID={id('button-disabled')}
                        size="sm"
                        disabled
                        label="Publish"
                        onPress={() => undefined}
                    />
                </Inline>
                <Button
                    testID={id('button-block')}
                    size="sm"
                    variant="secondary"
                    block
                    label="block"
                    onPress={() => undefined}
                />
            </Stack>

            {/* IconButton: the same ladder, square, plus disabled. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Icon button
                </Text>
                {BUTTON_SIZES.map((size) => (
                    <Inline key={size} space="sm" align="center">
                        {BUTTON_VARIANTS.map((variant) => (
                            <IconButton
                                key={variant}
                                testID={id(`icon-button-${variant}-${size}`)}
                                size={size}
                                variant={variant}
                                label={`${variant} ${size}`}
                                icon={<Icon name="more" size="sm" />}
                                onPress={() => undefined}
                            />
                        ))}
                        <IconButton
                            testID={id(`icon-button-disabled-${size}`)}
                            size={size}
                            disabled
                            label={`disabled ${size}`}
                            icon={<Icon name="close" size="sm" />}
                            onPress={() => undefined}
                        />
                    </Inline>
                ))}
                {/*
                 * `tone="danger"` recolours the glyph and leaves the container alone — the flat
                 * destructive control, as opposed to `variant="danger"`'s filled one beside it.
                 * The Catalogue's row actions are the reason it exists: View, Edit and Archive
                 * drawn directly on the row, where a filled red square repeated down twenty-five
                 * rows would read as an error state.
                 */}
                <Inline space="xs" align="center">
                    <IconButton
                        testID={id('icon-button-row-view')}
                        size="sm"
                        label="View"
                        icon={<Icon name="eye" size="sm" />}
                        onPress={() => undefined}
                    />
                    <IconButton
                        testID={id('icon-button-row-edit')}
                        size="sm"
                        label="Edit"
                        icon={<Icon name="pen" size="sm" />}
                        onPress={() => undefined}
                    />
                    <IconButton
                        testID={id('icon-button-row-archive')}
                        size="sm"
                        tone="danger"
                        label="Archive"
                        icon={<Icon name="archive" size="sm" />}
                        onPress={() => undefined}
                    />
                </Inline>
            </Stack>

            {/* Breadcrumbs, both tones — `canopy` needs the band under it to be judged. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Breadcrumbs
                </Text>
                <Breadcrumbs
                    testID={id('trail')}
                    items={[
                        { key: 'catalogue', label: 'Catalogue', onPress: () => undefined },
                        { key: 'ingredients', label: 'Ingredients', onPress: () => undefined },
                        { key: 'tahini', label: 'Tahini paste' },
                    ]}
                />
                <View className="rounded-md bg-surface-canopy p-3">
                    <Breadcrumbs
                        testID={id('trail-canopy')}
                        tone="canopy"
                        items={[
                            { key: 'catalogue', label: 'Catalogue', onPress: () => undefined },
                            { key: 'recipes', label: 'Recipes' },
                        ]}
                    />
                </View>
            </Stack>

            {/* Tabs: both variants, block, and the segmented control on the same ladder. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Tabs
                </Text>
                {TABS_VARIANTS.map((variant) => (
                    <Tabs
                        key={variant}
                        testID={id(`tabs-${variant}`)}
                        variant={variant}
                        label={`Recipe, ${variant}`}
                        items={RECIPE_TABS}
                        value={tab}
                        onChange={setTab}
                    />
                ))}
                <Tabs
                    testID={id('tabs-block')}
                    variant="segmented"
                    block
                    label="Recipe, block"
                    items={RECIPE_TABS}
                    value={tab}
                    onChange={setTab}
                />
                <SegmentedControl
                    testID={id('segments')}
                    label="Status"
                    items={[
                        { value: 'all', label: 'All' },
                        { value: 'draft', label: 'Draft' },
                        { value: 'live', label: 'Live' },
                    ]}
                    value={segment}
                    onChange={setSegment}
                />
            </Stack>

            {/* Badge and StatusBadge. Both are closed sets, so both are iterated. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Badges
                </Text>
                <Inline space="sm">
                    {BADGE_TONES.map((tone) => (
                        <Badge key={tone} testID={id(`badge-${tone}`)} tone={tone} label={tone} />
                    ))}
                </Inline>
                <Inline space="sm">
                    {RECORD_STATUSES.map((status) => (
                        <StatusBadge
                            key={status}
                            testID={id(`status-${status}`)}
                            status={status}
                            label={status}
                        />
                    ))}
                </Inline>
            </Stack>

            {/* Card: every tone, every padding, then the footer and interactive shapes. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Card
                </Text>
                <View className="flex-row flex-wrap gap-3">
                    {CARD_TONES.map((tone) => (
                        <View key={tone} className="w-[200px]">
                            <Card testID={id(`card-${tone}`)} tone={tone} title={tone}>
                                <Text variant="caption" tone="secondary">
                                    Flat panel, 8px corner.
                                </Text>
                            </Card>
                        </View>
                    ))}
                </View>
                <View className="flex-row flex-wrap gap-3">
                    {CARD_PADDINGS.map((padding) => (
                        <View key={padding} className="w-[200px]">
                            <Card
                                testID={id(`card-padding-${padding}`)}
                                tone="raised"
                                padding={padding}
                            >
                                <Text variant="caption">padding {padding}</Text>
                            </Card>
                        </View>
                    ))}
                </View>
                <View className="flex-row flex-wrap gap-3">
                    <View className="w-[240px]">
                        <Card
                            testID={id('card-footer')}
                            tone="raised"
                            title="Tahini paste"
                            subtitle="Sauces · kg"
                            footer={
                                <Inline space="sm">
                                    <Text variant="mono">4.5700</Text>
                                    <StatusBadge status="live" label="Live" />
                                </Inline>
                            }
                        >
                            <Text variant="caption" tone="secondary">
                                The footer pins to the baseline.
                            </Text>
                        </Card>
                    </View>
                    <View className="w-[240px]">
                        <Card
                            testID={id('card-interactive')}
                            tone="raised"
                            interactive
                            title="Interactive"
                            accessibilityLabel="Open Tahini paste"
                            onPress={() => undefined}
                        >
                            <Text variant="caption" tone="secondary">
                                One target, so it lifts on hover.
                            </Text>
                        </Card>
                    </View>
                </View>
            </Stack>

            {/* Separator — the only border-drawing component. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Separator
                </Text>
                <Separator testID={id('separator-horizontal')} />
                <Separator testID={id('separator-semantic')} semantic />
                <View className="h-8 flex-row items-center gap-3">
                    <Text variant="caption">before</Text>
                    <Separator testID={id('separator-vertical')} orientation="vertical" />
                    <Text variant="caption">after</Text>
                </View>
            </Stack>

            {/*
             * Grid: the no-stretch rule. A field is 280px at every breakpoint and a breakpoint
             * moves the column count, so `span` and `fullWidth` are the only routes to wider.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Grid and form field
                </Text>
                <FormGrid testID={id('form-grid-responsive')}>
                    <FormField
                        testID={id('field-designation')}
                        id={id('field-designation')}
                        label="Designation"
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Designation"
                                size="sm"
                                value={designation}
                                onChangeText={setDesignation}
                                placeholder="Tahini paste"
                            />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-hint')}
                        id={id('field-hint')}
                        label="Reference"
                        hint="Generated when the record is first saved."
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Reference"
                                size="sm"
                                value="ING-0142"
                                disabled
                            />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-error')}
                        id={id('field-error')}
                        label="Yield"
                        required
                        error="Enter a yield above zero."
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Yield"
                                size="sm"
                                value="0"
                                onChangeText={() => undefined}
                            />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-disabled')}
                        id={id('field-disabled')}
                        label="Category"
                        disabled
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Category"
                                size="sm"
                                value="Sauces"
                                disabled
                            />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-span')}
                        id={id('field-span')}
                        label="Method"
                        span={2}
                        hint="span={2} — 280px twice, plus the gap."
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Method"
                                size="sm"
                                multiline
                                value="Blend, then rest."
                                onChangeText={() => undefined}
                            />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-full')}
                        id={id('field-full')}
                        label="Storage"
                        fullWidth
                        hint="fullWidth — the declared column count, clamped on a phone."
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Storage"
                                size="sm"
                                value="Chilled, 4 °C"
                                onChangeText={() => undefined}
                            />
                        )}
                    </FormField>
                    {/*
                     * `TextInputField` states its own span, with no `FormField` wrapper above it.
                     * That is §4.4's "textareas are the intended `span={2}` users" written the
                     * short way — the field is already a `FormField` inside, so wrapping it in a
                     * second one to reach the grid was two labels for one control. `FormGrid` reads
                     * the prop off the element it places; the component destructures it so it never
                     * reaches the DOM as an attribute.
                     */}
                    <TextInputField
                        span={2}
                        testID={id('field-span-direct')}
                        id={id('field-span-direct')}
                        label="Notes"
                        size="sm"
                        hint="span={2}, stated by the field itself."
                        multiline
                        numberOfLines={3}
                        value="Arrives in 10 kg pails."
                        onChangeText={() => undefined}
                    />
                </FormGrid>
                {/* Stated column count: deliberately not responsive. */}
                <FormGrid testID={id('form-grid-two')} columns={2}>
                    <FormField
                        testID={id('field-two-a')}
                        id={id('field-two-a')}
                        label="Fixed at two"
                    >
                        {(control) => (
                            <TextInputField {...control} label="Fixed at two" size="sm" value="A" />
                        )}
                    </FormField>
                    <FormField
                        testID={id('field-two-b')}
                        id={id('field-two-b')}
                        label="Not responsive"
                    >
                        {(control) => (
                            <TextInputField
                                {...control}
                                label="Not responsive"
                                size="sm"
                                value="B"
                            />
                        )}
                    </FormField>
                </FormGrid>
                {/*
                 * The input ladder, including the `xs` step the recipe editor's line table added:
                 * 24px, and the only place a field is smaller than the page's ordinary control.
                 */}
                <FormGrid testID={id('form-grid-input-sizes')} columns={3}>
                    <TextInputField
                        testID={id('field-size-xs')}
                        id={id('field-size-xs')}
                        label="xs — a line-table cell"
                        size="xs"
                        value="1"
                    />
                    <TextInputField
                        testID={id('field-size-sm')}
                        id={id('field-size-sm')}
                        label="sm — the Catalogue default"
                        size="sm"
                        value="250"
                    />
                    <TextInputField
                        testID={id('field-size-md')}
                        id={id('field-size-md')}
                        label="md"
                        size="md"
                        value="250"
                    />
                </FormGrid>
            </Stack>

            {/* FormSection: `first` has no leading hairline; the second carries both slots. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Form section
                </Text>
                <FormSection testID={id('form-section-first')} first title="Description">
                    <Text variant="caption" tone="secondary">
                        First section — no leading hairline.
                    </Text>
                </FormSection>
                <FormSection
                    testID={id('form-section-aside')}
                    title="Sale"
                    aside={
                        <Text variant="caption" tone="secondary">
                            Sold as-is, outside recipes
                        </Text>
                    }
                >
                    <Text variant="caption" tone="secondary">
                        `aside` sits on the title&apos;s baseline; `actions` goes to the far end.
                    </Text>
                </FormSection>
                <FormSection
                    testID={id('form-section-actions')}
                    title="Raw materials"
                    description="Lines resolve their cost from the ingredient database."
                    aside={<Badge tone="info" icon={null} label="From database" />}
                    actions={
                        <Button
                            testID={id('form-section-add')}
                            size="sm"
                            variant="secondary"
                            label="Add line"
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => undefined}
                        />
                    }
                >
                    <Text variant="caption" tone="secondary">
                        Section title, hairline, no card.
                    </Text>
                </FormSection>
            </Stack>

            {/*
             * Select at the Catalogue's density — 28px trigger, 28px rows, the panel anchored under
             * the field rather than a modal over the form. The searchable one is the same control
             * with the filter above its list.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Select
                </Text>
                <FormGrid testID={id('select-grid')}>
                    <Select
                        testID={id('select-plain')}
                        id={id('select-plain')}
                        label="Category"
                        placeholder="Choose a category"
                        options={[
                            { value: 'condiments', label: 'Condiments' },
                            { value: 'produce', label: 'Produce' },
                            { value: 'spices', label: 'Spices' },
                            { value: 'dairy', label: 'Dairy' },
                        ]}
                        value="condiments"
                        onChange={() => undefined}
                    />
                    <Select
                        testID={id('select-searchable')}
                        id={id('select-searchable')}
                        label="Stock unit"
                        searchable
                        options={[
                            { value: 'kg', label: 'Kilograms (kg)', description: 'Mass' },
                            { value: 'g', label: 'Grams (g)', description: 'Mass' },
                            { value: 'l', label: 'Litres (L)', description: 'Volume' },
                        ]}
                        value="kg"
                        onChange={() => undefined}
                    />
                    <Select
                        testID={id('select-disabled')}
                        id={id('select-disabled')}
                        label="Sub-category"
                        hint="No sub-category has been used under this category yet."
                        placeholder="Choose a sub-category"
                        disabled
                        options={[]}
                        value={null}
                        onChange={() => undefined}
                    />
                </FormGrid>
            </Stack>

            {/*
             * BilingualField's two layouts. `row` is the Catalogue's — two 280px fields and
             * nothing else; `stacked` keeps the hints, the missing-Arabic badge and copy-across
             * that every other editor relies on.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Bilingual field
                </Text>
                <BilingualStory prefix={prefix} />
            </Stack>

            {/* Switch: both states, and the disabled one. `role="switch"`, not a checkbox. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Switch
                </Text>
                <SwitchStory prefix={prefix} />
            </Stack>

            {/*
             * DerivedPanel — handoff §6.2's read-only confirmation surface.
             *
             * Both states of the panel are drawn, because the empty one is the one that matters: a
             * nutrient set nobody has recorded must read as absent, never as four zeroes.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Derived, never typed
                </Text>
                <FormSection
                    testID={id('derived-section')}
                    first
                    title="Composition &amp; allergens"
                    aside={<Badge tone="info" icon={null} label="From database" />}
                >
                    <DerivedPanel
                        testID={id('derived-panel')}
                        description="Nutrients and allergen classes resolve from the reference food database on save. They are shown for confirmation and cannot be typed in."
                        figures={SHOWCASE_NUTRIENTS}
                        emptyValue="—"
                        chips={[
                            <Tag key="egg" tone="danger" label="Egg" />,
                            <Tag key="mustard" tone="warning" label="Mustard" />,
                        ]}
                    />
                </FormSection>
                {/* The same four tiles with nothing behind them — em dashes, never zeroes. */}
                <DerivedPanel
                    testID={id('derived-panel-empty')}
                    description="The same panel on a record with no reference facts."
                    figures={SHOWCASE_NUTRIENTS.map((figure) => ({ ...figure, value: null }))}
                    emptyValue="—"
                    chips={[]}
                />
                {/*
                 * The margin readout is a `QuantityInput readOnly` — the same control the cost
                 * cascade's `Total per kg` already uses two stories down. A derived figure on the
                 * sunken fill is what that variant exists for; a second component for it would have
                 * been the same field with a different name.
                 */}
                <FormGrid testID={id('derived-readout-grid')}>
                    <QuantityInput
                        testID={id('derived-margin')}
                        id={id('derived-margin')}
                        size="sm"
                        readOnly
                        label="Margin on cost"
                        unit="%"
                        hint="B2B against unit price 3.50"
                        value="+20.0"
                        onChangeText={() => undefined}
                    />
                    <QuantityInput
                        testID={id('derived-margin-empty')}
                        id={id('derived-margin-empty')}
                        size="sm"
                        readOnly
                        label="Margin on cost"
                        unit="%"
                        hint="Needs a B2B price and a unit price"
                        value=""
                        placeholder="—"
                        onChangeText={() => undefined}
                    />
                </FormGrid>
            </Stack>

            {/* SearchInput and QuantityInput at all three sizes, and in every state each has. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Search and quantity
                </Text>
                {/*
                 * Each variant is captioned. `SearchInput`'s own `label` is an accessible name
                 * only — it renders `aria-label` and draws nothing — so a ladder of it is four
                 * boxes a reader cannot tell apart, unlike the `QuantityInput` grid below, whose
                 * labels come from `FormField` and are visible. The caption is what makes this
                 * read as a ladder rather than as the same control four times.
                 */}
                <View className="flex-row flex-wrap gap-3">
                    {INPUT_SIZES.map((size) => (
                        <Stack key={size} space="xs" className="w-[240px]">
                            <Text variant="caption" tone="secondary">
                                size {size}
                            </Text>
                            <SearchInput
                                testID={id(`search-${size}`)}
                                size={size}
                                label={`Search ${size}`}
                                value={search}
                                onChangeText={setSearch}
                                placeholder="Search ingredients"
                            />
                        </Stack>
                    ))}
                    <Stack space="xs" className="w-[240px]">
                        <Text variant="caption" tone="secondary">
                            empty
                        </Text>
                        <SearchInput
                            testID={id('search-empty')}
                            size="sm"
                            label="Search, empty"
                            value=""
                            onChangeText={() => undefined}
                            placeholder="Search ingredients"
                        />
                    </Stack>
                    <Stack space="xs" className="w-[240px]">
                        <Text variant="caption" tone="secondary">
                            disabled
                        </Text>
                        <SearchInput
                            testID={id('search-disabled')}
                            size="sm"
                            label="Search, disabled"
                            value=""
                            onChangeText={() => undefined}
                            disabled
                        />
                    </Stack>
                </View>
                <FormGrid testID={id('quantity-grid')}>
                    {INPUT_SIZES.map((size) => (
                        <QuantityInput
                            key={size}
                            testID={id(`quantity-${size}`)}
                            id={id(`quantity-${size}`)}
                            size={size}
                            label={`Quantity ${size}`}
                            unit="kg"
                            value={quantity}
                            onChangeText={setQuantity}
                        />
                    ))}
                    <QuantityInput
                        testID={id('quantity-required')}
                        id={id('quantity-required')}
                        size="sm"
                        required
                        label="Unit price"
                        unit="KWD"
                        hint="Two decimal places."
                        value="4.22"
                        onChangeText={() => undefined}
                    />
                    <QuantityInput
                        testID={id('quantity-error')}
                        id={id('quantity-error')}
                        size="sm"
                        label="Waste"
                        unit="%"
                        error="Enter a percentage between 0 and 100."
                        value="140"
                        onChangeText={() => undefined}
                    />
                    <QuantityInput
                        testID={id('quantity-readonly')}
                        id={id('quantity-readonly')}
                        size="sm"
                        readOnly
                        label="Total per kg"
                        unit="KWD"
                        hint="Derived — read-only on the sunken fill."
                        value="4.5700"
                        onChangeText={() => undefined}
                    />
                    <QuantityInput
                        testID={id('quantity-disabled')}
                        id={id('quantity-disabled')}
                        size="sm"
                        disabled
                        label="Portions"
                        value="8"
                        onChangeText={() => undefined}
                    />
                    <QuantityInput
                        testID={id('quantity-empty')}
                        id={id('quantity-empty')}
                        size="sm"
                        label="Shelf life"
                        unit="days"
                        placeholder="0"
                        value=""
                        onChangeText={() => undefined}
                    />
                </FormGrid>
            </Stack>

            {/* The two rebuilt controls that are not a field: the input frame and the checkbox. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Text input and checkbox
                </Text>
                <View className="flex-row flex-wrap gap-3">
                    {INPUT_SIZES.map((size) => (
                        <View key={size} className="w-[240px]">
                            <TextInputField
                                testID={id(`text-input-${size}`)}
                                id={id(`text-input-${size}`)}
                                size={size}
                                label={`Input ${size}`}
                                value="Tahini paste"
                                onChangeText={() => undefined}
                            />
                        </View>
                    ))}
                    <View className="w-[240px]">
                        <TextInputField
                            testID={id('text-input-error')}
                            id={id('text-input-error')}
                            size="sm"
                            required
                            label="Designation"
                            error="Enter a designation."
                            value=""
                            onChangeText={() => undefined}
                        />
                    </View>
                    <View className="w-[240px]">
                        <TextInputField
                            testID={id('text-input-trailing')}
                            id={id('text-input-trailing')}
                            size="sm"
                            label="Yield"
                            hint="The trailing slot sits inside the frame."
                            value="1.700"
                            onChangeText={() => undefined}
                            trailing={
                                <Text variant="mono" tone="secondary">
                                    kg
                                </Text>
                            }
                        />
                    </View>
                    <View className="w-[240px]">
                        <TextInputField
                            testID={id('text-input-disabled')}
                            id={id('text-input-disabled')}
                            size="sm"
                            disabled
                            label="Reference"
                            value="ING-0142"
                        />
                    </View>
                </View>
                <Inline space="sm" align="center">
                    <Checkbox
                        testID={id('checkbox')}
                        checked={restricted}
                        onChange={setRestricted}
                        label="Restricted"
                    />
                    <Checkbox
                        testID={id('checkbox-disabled')}
                        checked
                        disabled
                        onChange={() => undefined}
                        label="Disabled"
                    />
                </Inline>
                <Checkbox
                    testID={id('checkbox-error')}
                    checked={false}
                    required
                    error="This must be acknowledged."
                    onChange={() => undefined}
                    label="Required"
                    description="Extra copy under the label."
                />
            </Stack>

            {/*
             * Catalogue stat cards: the four figures a list page opens with, in all four tones.
             * Two are filters and take the hover tint; two are read-only.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Catalogue stat cards
                </Text>
                <CatalogueStatCards
                    testID={id('stat-cards')}
                    cards={[
                        {
                            key: 'shown',
                            label: 'Shown',
                            value: '18',
                            unit: 'of 306',
                            caption: 'Filtered — clear',
                            mark: 'calendar',
                            tone: 'brand',
                            onPress: () => undefined,
                            accessibilityLabel: 'Clear every filter',
                        },
                        {
                            key: 'draft',
                            label: 'Draft',
                            value: '2',
                            unit: 'records',
                            caption: 'not published yet',
                            mark: 'eyeOff',
                            tone: 'warning',
                            onPress: () => undefined,
                            accessibilityLabel: 'Show only draft records',
                        },
                        {
                            key: 'missing',
                            label: 'Missing Arabic',
                            value: '3',
                            unit: 'records',
                            caption: 'blocked from publishing',
                            mark: 'warning',
                            tone: 'danger',
                        },
                        {
                            key: 'uncosted',
                            label: 'Uncosted',
                            value: '0',
                            unit: 'records',
                            caption: 'no unit price on file',
                            mark: 'warning',
                        },
                    ]}
                />
            </Stack>

            {/*
             * The Catalogue's toolbar, drawn on a full-width ground so its centring is visible.
             * The row holds a 240px search and the status set and nothing else, and it is centred
             * because the stat-card row above it is — a left-hung control row under a centred band
             * reads as the start of a column that never arrives.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Catalogue toolbar
                </Text>
                <CatalogueToolbar
                    testID={id('toolbar')}
                    search={toolbarSearch}
                    onSearchChange={setToolbarSearch}
                    searchLabel="Search the catalogue"
                    searchPlaceholder="Search ingredients"
                    statusLabel="Status"
                    statusSegments={[
                        { value: 'all', label: 'All' },
                        { value: 'live', label: 'Live' },
                        { value: 'draft', label: 'Draft' },
                        { value: 'review', label: 'Review' },
                    ]}
                    status={toolbarStatus}
                    onStatusChange={setToolbarStatus}
                />
            </Stack>

            {/*
             * The read-only record panel behind a row's View action. The chip run stands in for
             * the allergens an ingredient resolves from the database and cannot override here.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    View drawer
                </Text>
                <Inline space="sm" align="center">
                    <Button
                        testID={id('view-drawer-open')}
                        size="sm"
                        variant="secondary"
                        label="Open the view drawer"
                        onPress={() => setViewOpen(true)}
                    />
                </Inline>
                <CatalogueViewDrawer
                    testID={id('view-drawer')}
                    open={viewOpen}
                    onClose={() => setViewOpen(false)}
                    onEdit={() => setViewOpen(false)}
                    kindLabel="Ingredient"
                    fieldsLabel="Fields"
                    closeLabel="Close"
                    editLabel="Edit"
                    reference="ING-0142"
                    title="Tahini paste"
                    status={<Badge tone="success" label="Live" />}
                    fields={[
                        { key: 'reference', label: 'Reference', value: 'ING-0142', mono: true },
                        { key: 'category', label: 'Category', value: 'Condiments' },
                        { key: 'unit', label: 'Unit', value: 'kg' },
                        { key: 'price', label: 'Unit price', value: 'AED 7.80', mono: true },
                        { key: 'status', label: 'Status', value: 'Live' },
                        { key: 'updated', label: 'Updated', value: '8 days ago' },
                    ]}
                    chipsLabel="Allergens"
                    chipsSource="From database"
                    chipsCaption="Resolved from the ingredient database. Correct it on the record itself, not here."
                    chips={
                        <>
                            <Badge tone="danger" label="Sesame" />
                            <Badge tone="warning" label="Nuts" />
                        </>
                    }
                />
            </Stack>

            {/*
             * Pagination on this ladder: the design's 24px pill, not the customer 44px pager. The
             * comfortable one is in the navigation section above; the difference is the whole point.
             */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Pagination
                </Text>
                <Pagination
                    testID={id('pagination')}
                    page={3}
                    totalPages={10}
                    onPageChange={() => undefined}
                    label="Pages"
                />
            </Stack>

            {/* DataList: the three row heights, a header slot per §4.3, and the empty state. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Data list
                </Text>
                {/*
                 * Captioned for the same reason as the search ladder: `DataList`'s `label` is the
                 * list's accessible name, not a caption, so three densities over identical rows
                 * render as the same table three times to anyone looking rather than measuring.
                 */}
                {ROW_DENSITIES.map((density) => (
                    <Stack key={density} space="xs">
                        <Text variant="caption" tone="secondary">
                            density {density}
                        </Text>
                        <DataList
                            testID={id(`data-list-${density}`)}
                            label={`Ingredients, ${density}`}
                            density={density}
                            columns={catalogueColumns(`list-${density}`)}
                            rows={CATALOGUE_ROWS}
                            rowKey={(row) => row.key}
                            onRowPress={(row) => setPressedRow(row.key)}
                        />
                    </Stack>
                ))}
                <Text testID={id('data-list-pressed')} variant="caption" tone="secondary">
                    Last row pressed: {pressedRow ?? 'none'}
                </Text>
                <DataList
                    testID={id('data-list-empty')}
                    label="Ingredients, empty"
                    columns={catalogueColumns('list-empty')}
                    rows={[]}
                    rowKey={(row) => row.key}
                    emptyState={
                        <Text variant="caption" tone="secondary">
                            No ingredient matches “zaatar”.
                        </Text>
                    }
                />
            </Stack>

            {/* ListItem: the row the list collapses to below `md`. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    List item
                </Text>
                <ListItem
                    testID={id('list-item')}
                    title="Tahini paste"
                    description="Blended sesame, chilled."
                    meta={
                        <Inline space="xs">
                            <Text variant="caption" tone="secondary">
                                Sauces
                            </Text>
                            <Text variant="caption" tone="secondary">
                                ·
                            </Text>
                            <Text variant="caption" tone="secondary">
                                kg
                            </Text>
                        </Inline>
                    }
                    metric={<Text variant="mono">4.5700</Text>}
                    leading={<Icon name="eye" size="sm" />}
                    trailing={<StatusBadge status="live" label="Live" />}
                    chevron
                    onPress={() => undefined}
                />
                <ListItem
                    testID={id('list-item-selected')}
                    title="Selected"
                    description="Carries the selected tint."
                    selected
                    onPress={() => undefined}
                />
                <ListItem
                    testID={id('list-item-disabled')}
                    title="Disabled"
                    description="Not pressable."
                    disabled
                    onPress={() => undefined}
                />
                <ListItem
                    testID={id('list-item-static')}
                    title="Static"
                    description="No onPress, so no chevron and no target."
                />
            </Stack>

            {/* Overlays. Dropdown is the mechanism; Menu is Dropdown plus a list. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Dropdown and menu
                </Text>
                <Inline space="sm" align="center">
                    <Dropdown
                        testID={id('dropdown')}
                        label="Fields"
                        role="dialog"
                        trigger={({ triggerProps, toggle }) => (
                            <Button
                                {...triggerProps}
                                testID={id('dropdown-trigger')}
                                size="sm"
                                variant="secondary"
                                label="Fields"
                                iconEnd={<Icon name="filter" size="sm" />}
                                onPress={toggle}
                            />
                        )}
                    >
                        {({ close }) => (
                            <Stack space="xs">
                                <Text variant="micro" tone="secondary">
                                    Visible fields
                                </Text>
                                <Checkbox
                                    testID={id('dropdown-checkbox')}
                                    checked
                                    onChange={() => undefined}
                                    label="Reference"
                                />
                                <Button
                                    testID={id('dropdown-close')}
                                    size="sm"
                                    variant="ghost"
                                    label="Done"
                                    onPress={close}
                                />
                            </Stack>
                        )}
                    </Dropdown>
                    <Dropdown
                        testID={id('dropdown-end')}
                        label="Results"
                        role="listbox"
                        align="end"
                        trigger={({ triggerProps, toggle }) => (
                            <Button
                                {...triggerProps}
                                testID={id('dropdown-end-trigger')}
                                size="sm"
                                variant="secondary"
                                label="align end"
                                onPress={toggle}
                            />
                        )}
                    >
                        <Text variant="caption">Anchored to the trailing edge.</Text>
                    </Dropdown>
                    {columnMenu('standalone')}
                    <Menu
                        testID={id('menu-commands')}
                        label="Row actions"
                        align="end"
                        sections={[
                            {
                                label: 'Record',
                                items: [
                                    {
                                        key: 'view',
                                        label: 'View',
                                        icon: 'eye',
                                        onSelect: () => undefined,
                                    },
                                    {
                                        key: 'edit',
                                        label: 'Edit',
                                        onSelect: () => undefined,
                                    },
                                    {
                                        key: 'refresh',
                                        label: 'Disabled',
                                        icon: 'refresh',
                                        disabled: true,
                                        onSelect: () => undefined,
                                    },
                                ],
                            },
                            {
                                items: [
                                    {
                                        key: 'archive',
                                        label: 'Archive',
                                        tone: 'danger',
                                        onSelect: () => undefined,
                                    },
                                ],
                            },
                        ]}
                        trigger={({ triggerProps, toggle }) => (
                            <IconButton
                                {...triggerProps}
                                testID={id('menu-commands-trigger')}
                                size="sm"
                                variant="ghost"
                                label="More"
                                icon={<Icon name="more" size="sm" />}
                                onPress={toggle}
                            />
                        )}
                    />
                </Inline>
            </Stack>

            {/* Table's row ladder, which the Catalogue's density control drives. */}
            <Stack space="xs">
                <Text variant="section" tone="secondary">
                    Table density
                </Text>
                {TABLE_ROW_SIZES.map((rowSize) => (
                    <Table
                        key={rowSize}
                        testID={id(`table-${rowSize}`)}
                        rowSize={rowSize}
                        caption={`Nutrients, ${rowSize}`}
                        columns={PASS_TABLE_COLUMNS}
                        rows={NUTRIENT_ROWS}
                        rowKey={(row) => row.key}
                    />
                ))}
            </Stack>
        </Stack>
    );
}

/**
 * The design-system showcase.
 *
 * This page is the Playwright and axe target: every component appears at least once, in every
 * variant that changes its markup, and the locale and theme toggles let one browser session cover
 * English/Arabic × light/dark. If a component cannot be reached from here it is not covered, which
 * is why the variant lists are iterated from the exported constants rather than hand-written.
 */
export function ShowcaseScreen() {
    const { t } = useTranslation();
    const { locale, setLocale } = useLocale();
    const { colorScheme, toggleColorScheme } = useColorScheme();
    const toast = useToast();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [endDrawerOpen, setEndDrawerOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [checked, setChecked] = useState(false);
    const [densityTab, setDensityTab] = useState('description');
    const [densityRestricted, setDensityRestricted] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [filtered, setFiltered] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<NutrientSortKey>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [text, setText] = useState('');
    const [otp, setOtp] = useState('');
    const [tab, setTab] = useState('overview');
    const [showcasePage, setShowcasePage] = useState(18);
    const [segment, setSegment] = useState('overview');
    const [portion, setPortion] = useState<number | null>(2);
    const [range, setRange] = useState<RangeValue>({ min: 300, max: 700 });
    const [ceiling, setCeiling] = useState<number | null>(700);
    const [floor, setFloor] = useState<number | null>(null);
    const [filterOn, setFilterOn] = useState(true);
    const [startDate, setStartDate] = useState<string | null>('2026-08-03');
    const [replays, setReplays] = useState(0);
    const [kitchenQuery, setKitchenQuery] = useState('');
    const [kitchenStatuses, setKitchenStatuses] = useState<readonly PublishableStatus[]>(['draft']);

    const options = [1, 2, 3].map((index) => ({
        value: `option-${index}`,
        label: t('designSystem:showcase.sampleOption', { index }),
    }));

    /** Long enough that filtering it is worth doing, which is the point of the story. */
    const manyOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => ({
        value: `filtered-option-${index}`,
        label: t('designSystem:showcase.sampleOption', { index }),
        description: t('designSystem:showcase.sampleHint'),
    }));

    const tabs = [
        {
            value: 'overview',
            label: t('designSystem:showcase.tabOverview'),
            testID: 'showcase-tab-overview',
        },
        {
            value: 'nutrition',
            label: t('designSystem:showcase.tabNutrition'),
            testID: 'showcase-tab-nutrition',
        },
        {
            value: 'delivery',
            label: t('designSystem:showcase.tabDelivery'),
            testID: 'showcase-tab-delivery',
        },
    ];

    const columns: readonly TableColumn<NutrientRow>[] = [
        {
            key: 'name',
            header: t('designSystem:showcase.tableColumnName'),
            rowHeader: true,
            flex: 2,
            render: (row) => <Text variant="label">{row.name}</Text>,
        },
        {
            key: 'amount',
            header: t('designSystem:showcase.tableColumnAmount'),
            numeric: true,
            // The one figure a reader compares down the column, so it carries the display face.
            primary: true,
            render: (row) => <Text align="end">{row.amount}</Text>,
        },
        {
            key: 'target',
            header: t('designSystem:showcase.tableColumnTarget'),
            numeric: true,
            render: (row) => <Text align="end">{row.target}</Text>,
        },
    ];

    const sortableColumns: readonly TableColumn<NutrientRow>[] = columns.map((column) => ({
        ...column,
        sortable: true,
    }));

    const sortedNutrientRows = [...NUTRIENT_ROWS].sort((left, right) => {
        const comparison = left[sortKey].localeCompare(right[sortKey], locale, { numeric: true });
        return sortDirection === 'asc' ? comparison : -comparison;
    });

    return (
        <PageTransition testID="showcase-page">
            <Stack testID="showcase-screen" space="lg">
                <Stack space="xs">
                    <Heading level={1} testID="showcase-title">
                        {t('designSystem:showcase.title')}
                    </Heading>
                    <Text tone="secondary">{t('designSystem:showcase.subtitle')}</Text>
                    <Inline space="sm">
                        <Button
                            testID="showcase-toggle-locale"
                            size="sm"
                            variant="secondary"
                            label={t('designSystem:controls.toggleLocale')}
                            onPress={() => {
                                void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                            }}
                        />
                        <Button
                            testID="showcase-toggle-theme"
                            size="sm"
                            variant="secondary"
                            label={t('designSystem:controls.toggleTheme')}
                            onPress={toggleColorScheme}
                        />
                        <Badge
                            testID="showcase-theme"
                            tone="info"
                            label={t('designSystem:controls.currentTheme', {
                                theme: colorScheme ?? 'light',
                            })}
                        />
                    </Inline>
                </Stack>

                <Section id="typography" title={t('designSystem:showcase.sections.typography')}>
                    <Heading level={1}>Heading 1</Heading>
                    <Heading level={2}>Heading 2</Heading>
                    <Heading level={3}>Heading 3</Heading>
                    <Heading level={4}>Heading 4</Heading>
                    <Text variant="body">{t('designSystem:spike.sample.latin')}</Text>
                    <Text variant="bodyStrong">{t('designSystem:spike.sample.arabic')}</Text>
                    <Text variant="caption" tone="secondary">
                        {t('designSystem:spike.sample.digits')}
                    </Text>
                    <Inline space="sm">
                        <Badge label="Inline" tone="neutral" icon={null} />
                        <Badge label="items" tone="neutral" icon={null} />
                        <Badge label="wrap" tone="neutral" icon={null} />
                    </Inline>
                </Section>

                <Section id="density" title="Density — the admin ladder">
                    {/*
                     * The two ladders, one above the other, because the only way to review this
                     * change is to compare them. Above: `comfortable`, the customer surfaces, with
                     * the 44px touch floor intact and Inter throughout. Below: `compact`, wrapped
                     * in `DensityProvider`, where every control resolves its height from
                     * `controlHeight` (28 / 32 / 36), corners are 4px on controls and 8px on the
                     * panel, cards are flat, and the type is the role ramp in Schibsted Grotesk
                     * with IBM Plex Mono on the figure.
                     *
                     * What to check: the compact row's three buttons step 28/32/36 and nothing in
                     * it is 44; the admin faces appear *only* below the divider; the flat card
                     * still reads as a panel without a shadow.
                     */}
                    <Stack space="sm">
                        <Text variant="caption" tone="secondary">
                            Comfortable — customer surfaces, 44px floor
                        </Text>
                        <Inline space="sm">
                            {BUTTON_SIZES.map((size) => (
                                <Button
                                    key={size}
                                    testID={`showcase-density-comfortable-${size}`}
                                    size={size}
                                    variant="secondary"
                                    label={size}
                                    onPress={() => undefined}
                                />
                            ))}
                            <Badge label="Draft" tone="warning" />
                        </Inline>
                    </Stack>

                    <DensityProvider value="compact">
                        <Stack space="sm">
                            <Text variant="caption" tone="secondary">
                                Compact — kitchen admin, controlHeight
                            </Text>
                            <Breadcrumbs
                                testID="showcase-density-trail"
                                items={[
                                    {
                                        key: 'catalogue',
                                        label: 'Catalogue',
                                        onPress: () => undefined,
                                    },
                                    { key: 'ingredients', label: 'Ingredients' },
                                ]}
                            />
                            <Inline space="sm">
                                {BUTTON_SIZES.map((size) => (
                                    <Button
                                        key={size}
                                        testID={`showcase-density-compact-${size}`}
                                        size={size}
                                        variant="secondary"
                                        label={size}
                                        onPress={() => undefined}
                                    />
                                ))}
                                <Button
                                    testID="showcase-density-primary"
                                    label="New ingredient"
                                    iconStart={<Icon name="plus" size="sm" />}
                                    onPress={() => undefined}
                                />
                                <IconButton
                                    testID="showcase-density-more"
                                    label="More"
                                    variant="secondary"
                                    size="sm"
                                    icon={<Icon name="more" size="sm" />}
                                    onPress={() => undefined}
                                />
                                <Badge label="Draft" tone="warning" />
                                <Badge label="From database" tone="info" />
                            </Inline>
                            <Tabs
                                testID="showcase-density-tabs"
                                label="Recipe"
                                items={[
                                    { value: 'description', label: 'Description' },
                                    { value: 'production', label: 'Production' },
                                    { value: 'costing', label: 'Costing' },
                                ]}
                                value={densityTab}
                                onChange={setDensityTab}
                            />
                            <Card testID="showcase-density-card" tone="raised" padding="md">
                                <Text variant="micro" tone="secondary">
                                    Unit price
                                </Text>
                                <Text variant="mono">12.500</Text>
                                <Text variant="caption" tone="secondary">
                                    Flat panel, 8px corner, no elevation.
                                </Text>
                                <TextInputField
                                    testID="showcase-density-input"
                                    size="sm"
                                    label="Designation"
                                    placeholder="Zaatar"
                                />
                                <Checkbox
                                    testID="showcase-density-checkbox"
                                    checked={densityRestricted}
                                    onChange={setDensityRestricted}
                                    label="Restricted"
                                />
                            </Card>
                        </Stack>
                    </DensityProvider>
                </Section>

                <Section id="catalogue-comfortable" title="Catalogue components — comfortable">
                    {/*
                     * The same stories twice. This copy takes the default density, which is what
                     * the customer surfaces render: the 44px floor still applies, and the ramp's
                     * shared variant names resolve to the shipped 12/14/16px scale.
                     */}
                    <CataloguePassStories prefix="showcase-pass-comfortable" />
                </Section>

                <Section id="catalogue-compact" title="Catalogue components — compact">
                    {/*
                     * And under `DensityProvider`, which is the kitchen admin: every control
                     * resolves its height from `controlHeight` (28 / 32 / 36) and nothing in here
                     * is 44px, corners are 4px on controls and 8px on panels, and the type is the
                     * role ramp. Compare the two blocks side by side — that comparison is the
                     * review gate this section exists for.
                     */}
                    <DensityProvider value="compact">
                        <CataloguePassStories prefix="showcase-pass-compact" />
                    </DensityProvider>
                </Section>

                <Section id="actions" title={t('designSystem:showcase.sections.actions')}>
                    <Inline space="sm">
                        {BUTTON_VARIANTS.map((variant) => (
                            <Button
                                key={variant}
                                testID={`showcase-button-${variant}`}
                                variant={variant}
                                label={variant}
                                onPress={() => undefined}
                            />
                        ))}
                    </Inline>
                    <Inline space="sm">
                        {BUTTON_SIZES.map((size) => (
                            <Button
                                key={size}
                                testID={`showcase-button-size-${size}`}
                                size={size}
                                label={size}
                                iconEnd={<Icon name="chevronEnd" />}
                                onPress={() => undefined}
                            />
                        ))}
                    </Inline>
                    <Inline space="sm">
                        <Button
                            testID="showcase-button-loading"
                            loading
                            label="loading"
                            onPress={() => undefined}
                        />
                        <Button
                            testID="showcase-button-disabled"
                            disabled
                            label="disabled"
                            onPress={() => undefined}
                        />
                        <IconButton
                            testID="showcase-icon-button"
                            label={t('common:action.close')}
                            icon={<Icon name="close" />}
                            onPress={() => undefined}
                        />
                    </Inline>
                    {/*
                     * The emphasis order the shells now use, shown as a row so it can be judged as
                     * one. The thing to check is that the eye lands on Basket and not on Sign out
                     * — the inversion is the point, and it is only visible in company.
                     *
                     * Account and Basket lead, and the utilities follow them rather than opening
                     * the row: what a person came to do sits before what they occasionally need to
                     * change. The account control carries the person's own `displayName`, so this
                     * sample uses a name rather than "My home" — a generic label here would show
                     * the wrong shape, since a name is usually the longest item in the row.
                     */}
                    <Inline space="xs" align="center">
                        <Button
                            testID="showcase-emphasis-my-home"
                            size="sm"
                            variant="ghost"
                            label="Sam Kovacs"
                            onPress={() => undefined}
                        />
                        <Button
                            testID="showcase-emphasis-basket"
                            size="sm"
                            variant="primary"
                            label="Basket"
                            iconEnd={
                                <View className="rounded-full bg-surface-raised px-2 py-0.5">
                                    <RNText className="text-xs font-bold text-surface-brand">
                                        3
                                    </RNText>
                                </View>
                            }
                            onPress={() => undefined}
                        />
                        <Button
                            testID="showcase-emphasis-locale"
                            size="sm"
                            variant="ghost"
                            label="العربية"
                            onPress={() => undefined}
                        />
                        <Button
                            testID="showcase-emphasis-sign-out"
                            size="sm"
                            variant="quiet"
                            label="Sign out"
                            onPress={() => undefined}
                        />
                    </Inline>
                </Section>

                <Section id="forms" title={t('designSystem:showcase.sections.forms')}>
                    <TextInputField
                        testID="showcase-text-input"
                        id="showcase-text-input"
                        label={t('designSystem:showcase.sampleLabel')}
                        hint={t('designSystem:showcase.sampleHint')}
                        required
                        value={text}
                        onChangeText={setText}
                    />
                    <TextInputField
                        testID="showcase-text-input-error"
                        id="showcase-text-input-error"
                        label={t('designSystem:showcase.sampleLabel')}
                        error={t('designSystem:showcase.sampleError')}
                        value=""
                        onChangeText={() => undefined}
                    />
                    <PasswordInput
                        testID="showcase-password"
                        id="showcase-password"
                        label={t('auth:login.passwordLabel')}
                        value=""
                        onChangeText={() => undefined}
                    />
                    {/*
                     * One field, not six boxes: platform autofill hands a one-time code to a single
                     * control, and six labelled controls read as six things to do. Shown live so
                     * the Arabic pass proves an Arabic-Indic code arrives as ASCII digits.
                     */}
                    <OtpInput
                        testID="showcase-otp"
                        id="showcase-otp"
                        label={t('auth:otp.codeLabel')}
                        hint={t('auth:otp.codeHint')}
                        value={otp}
                        length={6}
                        onChangeText={setOtp}
                    />
                    {/*
                     * One picker on both platforms, an indeterminate spinner rather than a fake
                     * progress bar, and the size cap quoted from the component's own constant.
                     * Shown attached so the summary row and its remove control are in the visual
                     * baseline; the picker itself opens a system dialog, which is why the showcase
                     * does not press it.
                     */}
                    <FileUploadField
                        testID="showcase-file-upload"
                        id="showcase-file-upload"
                        label={t('b2bApplication:documents.kinds.commercial_registration')}
                        hint={t('b2bApplication:documents.description')}
                        required
                        attachment={{ name: 'commercial-registration.pdf', size: 248310 }}
                        onPick={() => undefined}
                        onRemove={() => undefined}
                    />
                    <Checkbox
                        testID="showcase-checkbox"
                        id="showcase-checkbox"
                        label={t('auth:register.acceptTerms')}
                        checked={checked}
                        onChange={setChecked}
                    />
                    <Select
                        testID="showcase-select"
                        id="showcase-select"
                        label={t('designSystem:showcase.sampleLabel')}
                        options={options}
                        value={selected}
                        onChange={setSelected}
                    />
                    <Select
                        testID="showcase-select-searchable"
                        id="showcase-select-searchable"
                        label={t('designSystem:showcase.searchableSelectLabel')}
                        hint={t('designSystem:showcase.sampleHint')}
                        options={manyOptions}
                        value={filtered}
                        onChange={setFiltered}
                        searchable
                    />
                </Section>

                <Section id="navigation" title={t('designSystem:showcase.sections.navigation')}>
                    <Breadcrumbs
                        testID="showcase-breadcrumbs"
                        items={[
                            {
                                key: 'home',
                                label: t('designSystem:showcase.breadcrumbHome'),
                                onPress: () => undefined,
                                testID: 'showcase-crumb-home',
                            },
                            {
                                key: 'meals',
                                label: t('designSystem:showcase.breadcrumbSection'),
                                onPress: () => undefined,
                                testID: 'showcase-crumb-meals',
                            },
                            {
                                key: 'meal',
                                label: t('designSystem:showcase.breadcrumbCurrent'),
                                testID: 'showcase-crumb-current',
                            },
                        ]}
                    />
                    {/*
                     * Thirty-six pages, so the window and both gaps are visible at once — a
                     * five-page example would render every page and show none of the behaviour
                     * that makes this component worth having.
                     */}
                    <Pagination
                        testID="showcase-pagination"
                        page={showcasePage}
                        totalPages={36}
                        onPageChange={setShowcasePage}
                    />
                    <Tabs
                        testID="showcase-tabs"
                        label={t('designSystem:showcase.tabsLabel')}
                        items={tabs}
                        value={tab}
                        onChange={setTab}
                    />
                    <SegmentedControl
                        testID="showcase-segments"
                        label={t('designSystem:showcase.tabsLabel')}
                        items={tabs}
                        value={segment}
                        onChange={setSegment}
                        block
                    />
                    <Stepper
                        testID="showcase-stepper"
                        label={t('designSystem:showcase.stepperLabel')}
                        current={8}
                        total={22}
                        stepLabel={t('designSystem:showcase.stepperStep')}
                    />
                </Section>

                <Section id="filters" title={t('designSystem:showcase.sections.filters')}>
                    {/*
                     * The one-row toolbar. What to check: every control shares a baseline, the
                     * count states a total rather than just a shown-count, and each active chip
                     * removes the filter it names without opening the panel.
                     */}
                    <ToolbarRow
                        testID="showcase-toolbar"
                        filtersLabel="Filters (2)"
                        filtersActive={2}
                        filtersExpanded={filterOn}
                        filtersPanelId="showcase-toolbar-panel"
                        onToggleFilters={() => {
                            setFilterOn((open) => !open);
                        }}
                        activeFilters={[
                            {
                                key: 'vegan',
                                label: 'Vegan',
                                removeLabel: 'Remove filter: Vegan',
                                onRemove: () => undefined,
                            },
                            {
                                key: 'kitchen',
                                label: 'Verdant Kitchen',
                                removeLabel: 'Remove filter: Verdant Kitchen',
                                onRemove: () => undefined,
                            },
                        ]}
                        onClearAll={() => undefined}
                        clearAllLabel="Clear filters"
                        resultSummary="Showing 6 of 40 matching meals"
                        sort={
                            <Select
                                testID="showcase-toolbar-sort"
                                id="showcase-toolbar-sort"
                                label="Order by"
                                value={selected ?? 'option-1'}
                                options={options}
                                onChange={setSelected}
                                className="min-w-[200px]"
                            />
                        }
                    />
                    {/*
                     * A real panel, not just a toggle. `aria-controls` has to name an element that
                     * exists — axe reports a dangling reference as critical — and a disclosure
                     * demo that discloses nothing is not demonstrating the disclosure anyway.
                     */}
                    <Collapse
                        open={filterOn}
                        nativeID="showcase-toolbar-panel"
                        testID="showcase-toolbar-panel"
                    >
                        <Inline space="xs" wrap>
                            {['Vegan', 'High protein', 'Under 500 kcal'].map((label) => (
                                <FilterChip
                                    key={label}
                                    testID={`showcase-toolbar-panel-${label}`}
                                    label={label}
                                    selected={label !== 'Under 500 kcal'}
                                    onChange={() => undefined}
                                />
                            ))}
                        </Inline>
                    </Collapse>
                    <Inline space="sm">
                        <Chip
                            testID="showcase-chip"
                            label={t('designSystem:showcase.chipFilter')}
                        />
                        <Chip
                            testID="showcase-chip-brand"
                            tone="brand"
                            icon="check"
                            label={t('designSystem:showcase.chipFilter')}
                            onPress={() => undefined}
                        />
                        <Chip
                            testID="showcase-chip-removable"
                            tone="warning"
                            label={t('designSystem:showcase.chipRemovable')}
                            onRemove={() => undefined}
                        />
                        <FilterChip
                            testID="showcase-filter-chip"
                            label={t('designSystem:showcase.chipFilter')}
                            selected={filterOn}
                            count={18}
                            onChange={setFilterOn}
                        />
                    </Inline>
                    <NumberStepper
                        testID="showcase-number-stepper"
                        id="showcase-number-stepper"
                        label={t('designSystem:showcase.amountLabel')}
                        value={portion}
                        min={1}
                        max={6}
                        onChange={setPortion}
                    />
                    <RangeFilter
                        testID="showcase-range"
                        id="showcase-range"
                        label={t('designSystem:showcase.rangeLabel')}
                        value={range}
                        bounds={{ min: 100, max: 1500 }}
                        step={50}
                        unit="kcal"
                        onChange={setRange}
                    />
                    {/*
                     * Both single-ended slider directions, side by side. What to check: the readout
                     * says which side of the figure is being filtered rather than printing a bare
                     * number, dragging the thumb back to the floor reads "Any" (which is how a
                     * person lifts the limit without Clear all), and on iOS or Android this same
                     * markup renders a NumberStepper instead — the platform split is the point.
                     */}
                    <SliderField
                        testID="showcase-slider-at-most"
                        id="showcase-slider-at-most"
                        label={t('designSystem:showcase.sliderAtMostLabel')}
                        direction="atMost"
                        value={ceiling}
                        min={0}
                        max={1200}
                        step={50}
                        unit="kcal"
                        readout={
                            ceiling === null
                                ? t('catalogue:filters.anyValue')
                                : t('catalogue:filters.atMost', {
                                      value: String(ceiling),
                                      unit: 'kcal',
                                  })
                        }
                        onChange={setCeiling}
                    />
                    <SliderField
                        testID="showcase-slider-at-least"
                        id="showcase-slider-at-least"
                        label={t('designSystem:showcase.sliderAtLeastLabel')}
                        direction="atLeast"
                        value={floor}
                        min={0}
                        max={100}
                        step={5}
                        unit="g"
                        readout={
                            floor === null
                                ? t('catalogue:filters.anyValue')
                                : t('catalogue:filters.atLeast', {
                                      value: String(floor),
                                      unit: 'g',
                                  })
                        }
                        onChange={setFloor}
                    />
                </Section>

                <Section id="dates" title={t('designSystem:showcase.sections.dates')}>
                    <DateField
                        testID="showcase-date"
                        id="showcase-date"
                        label={t('designSystem:showcase.dateLabel')}
                        value={startDate}
                        min="2026-01-01"
                        max="2027-12-31"
                        onChange={setStartDate}
                    />
                    <CalendarGrid
                        testID="showcase-calendar"
                        label={t('designSystem:showcase.calendarLabel')}
                        days={[
                            { key: 'mon', label: 'Monday', shortLabel: 'Mon', sublabel: '3' },
                            { key: 'tue', label: 'Tuesday', shortLabel: 'Tue', sublabel: '4' },
                            {
                                key: 'wed',
                                label: 'Wednesday',
                                shortLabel: 'Wed',
                                sublabel: '5',
                                today: true,
                            },
                        ]}
                        slots={[
                            { key: 'breakfast', label: 'Breakfast' },
                            { key: 'lunch', label: 'Lunch' },
                        ]}
                        renderCell={({ day, slot }) => (
                            <Card
                                testID={`showcase-calendar-${day.key}-${slot?.key ?? 'all'}`}
                                tone="sunken"
                                padding="sm"
                            >
                                <Text variant="caption">{slot?.label ?? day.label}</Text>
                            </Card>
                        )}
                    />
                </Section>

                <Section id="hero" title="Page hero">
                    {/*
                     * The canopy band, with the scrim that makes it legible. What to check: the
                     * title and subtitle stay readable all the way across, including over the
                     * bright end of the sweep on the trailing side, where the bare 0.62 alpha
                     * floor does not hold on its own.
                     */}
                    <PageHero
                        testID="showcase-page-hero"
                        breadcrumbs={[
                            { key: 'home', label: 'Home', onPress: () => undefined },
                            { key: 'meals', label: 'Meals' },
                        ]}
                        title="Meals"
                        subtitle="Every dish on the marketplace, filterable by kitchen, diet, allergen and six numeric axes."
                        chips={['40 meals', '6 kitchens', 'Nutrition on every card']}
                        trailing={
                            <View className="flex-row items-center gap-2 rounded-xl bg-surface-raised p-1.5 ps-4 shadow-elevation-3">
                                <Text tone="secondary" className="flex-1">
                                    Search meals
                                </Text>
                                <Button
                                    testID="showcase-hero-search"
                                    size="sm"
                                    label="Search"
                                    onPress={() => undefined}
                                />
                            </View>
                        }
                    />
                </Section>

                <Section id="listing-header" title="Listing header">
                    {/*
                     * The flat opening HealthZone gives a catalogue: a trail, a large title, the
                     * live result count where a description usually goes, and one control on the
                     * title's baseline. What to check: the trailing control sits level with the
                     * foot of the title rather than floating against its cap, and narrowing the
                     * window drops it below the title block whole rather than squeezing the
                     * heading into one word per line.
                     */}
                    <ListingHeader
                        testID="showcase-listing-header"
                        breadcrumbs={[
                            { key: 'home', label: 'Home', onPress: () => undefined },
                            { key: 'meals', label: 'Meals' },
                        ]}
                        title="Every meal on the marketplace"
                        meta="Showing 20 of 40 matching meals"
                        trailing={
                            <Select
                                testID="showcase-listing-header-sort"
                                id="showcase-listing-header-sort"
                                label="Order by"
                                value="relevance"
                                options={[
                                    { value: 'relevance', label: 'Best match' },
                                    { value: 'price', label: 'Price' },
                                    { value: 'rating', label: 'Rating' },
                                ]}
                                onChange={() => undefined}
                                className="min-w-[200px]"
                            />
                        }
                    />
                </Section>

                <Section id="browse-panel" title="Browse panel">
                    {/*
                     * HealthZone's browse opening: a live fact, a claim, and the chips that narrow
                     * the grid, all inside one card. What to check: the chip row wraps inside the
                     * panel rather than overflowing it, the headline breaks over two lines rather
                     * than running the full width of the page, and the eyebrow reads as a fact
                     * rather than as a label for the heading below it.
                     */}
                    <BrowsePanel
                        testID="showcase-browse-panel"
                        eyebrow="6 kitchens delivering right now"
                        title="Find a kitchen that cooks the way you eat."
                    >
                        <FilterChip
                            testID="showcase-browse-panel-all"
                            label="All kitchens"
                            selected
                            onChange={() => undefined}
                        />
                        {['Delivery', 'Collection', 'High protein', 'Vegan'].map((label) => (
                            <FilterChip
                                key={label}
                                testID={`showcase-browse-panel-${label.toLowerCase()}`}
                                label={label}
                                selected={false}
                                onChange={() => undefined}
                            />
                        ))}
                    </BrowsePanel>
                </Section>

                <Section id="ai" title="AI surfaces">
                    {/*
                     * The only two places violet means something. What to check: both say "AI
                     * dietitian" in words as well as in colour — origin is never carried by
                     * colour alone — and white stays legible across both sweeps without the
                     * scrim the canopy band needs, because violet is the lightest stop either
                     * gradient passes through.
                     */}
                    <AiBand
                        testID="showcase-ai-band"
                        title="Ask the AI dietitian"
                        body="Describe how you eat and it will suggest a target and a week, with every step of the arithmetic shown."
                        actionLabel="Start a session"
                        onAction={() => undefined}
                    />
                    <View className="w-full max-w-[340px]">
                        <AiRailCard
                            testID="showcase-ai-rail"
                            title="Ask the AI dietitian"
                            body="A suggestion, labelled as one. A registered dietitian can review it and override anything."
                            actionLabel="Start a session"
                            onAction={() => undefined}
                        />
                    </View>
                </Section>

                <Section id="content" title={t('designSystem:showcase.sections.content')}>
                    <Inline space="sm">
                        {CARD_TONES.map((tone) => (
                            <Card
                                key={tone}
                                testID={`showcase-card-${tone}`}
                                tone={tone}
                                padding="sm"
                            >
                                <Text variant="caption">{tone}</Text>
                            </Card>
                        ))}
                    </Inline>
                    {/*
                     * The pinned footer, shown the only way it can be judged: a row of cards whose
                     * bodies are deliberately different lengths. The three prices must sit on one
                     * line. If they go ragged, the card is not filling its cell — the classes on
                     * the cells below mirror `CardGridItem` so this behaves as the real grid does.
                     */}
                    <View className="flex-row flex-wrap gap-4">
                        {[
                            {
                                key: 'short',
                                name: 'Garden Bowl',
                                body: 'Two lines of description.',
                                price: '$14',
                                tags: [
                                    { key: 'vegan', label: 'Vegan' },
                                    { key: 'gf', label: 'Gluten free' },
                                    { key: 'raw', label: 'Raw' },
                                ],
                            },
                            {
                                key: 'long',
                                name: 'Slow-Braised Lamb',
                                body: 'A much longer description that wraps onto several lines, so this card would otherwise be the tallest in the row and drag its price down with it.',
                                price: '$26',
                                tags: [{ key: 'halal', label: 'Halal friendly' }],
                            },
                            {
                                key: 'none',
                                name: 'Sparkling Water',
                                body: '',
                                price: '$3',
                                tags: [],
                            },
                        ].map((item) => (
                            <View
                                key={item.key}
                                className="min-w-[200px] flex-1 grow basis-[220px]"
                            >
                                <BrowseCard
                                    testID={`showcase-card-baseline-${item.key}`}
                                    onPress={() => undefined}
                                    accessibilityLabel={item.name}
                                    media={
                                        <EntityImage
                                            testID={`showcase-card-baseline-${item.key}-media`}
                                            seed={`showcase-card-${item.key}`}
                                            label={item.name}
                                            aspect="card"
                                            flush
                                            overlayStart={<MediaChip label="Verdant Kitchen" />}
                                        />
                                    }
                                    title={item.name}
                                    trailing={
                                        <Rating
                                            testID={`showcase-card-baseline-${item.key}-rating`}
                                            label={`Average rating for ${item.name}`}
                                            value={4.7}
                                            size="sm"
                                            compact
                                        />
                                    }
                                    meta={item.body}
                                    tags={item.tags}
                                    maxTags={2}
                                    footer={
                                        <RNText
                                            testID={`showcase-card-baseline-${item.key}-price`}
                                            className="font-display text-2xl text-surface-brand text-start"
                                        >
                                            {item.price}
                                        </RNText>
                                    }
                                />
                            </View>
                        ))}
                    </View>

                    {/*
                     * The tag row on its own, because a card is not the only place it lands. What to
                     * check: the pills are label-sized rather than button-sized, they carry no
                     * border, and the `+N` counter names what it hides to a screen reader rather
                     * than only to the eye.
                     */}
                    <TagRow
                        testID="showcase-tags"
                        items={TAG_TONES.map((tone) => ({ key: tone, label: tone, tone }))}
                    />
                    <TagRow
                        testID="showcase-tags-capped"
                        items={[
                            { key: 'vegan', label: 'Vegan' },
                            { key: 'halal', label: 'Halal friendly' },
                            { key: 'keto', label: 'Keto' },
                            { key: 'nut-free', label: 'Nut free' },
                        ]}
                        max={2}
                    />
                    <ListItem
                        testID="showcase-list-item"
                        title="Cedar Clinic"
                        description="Hamra · Jounieh"
                        leading={<Icon name="organisation" />}
                        trailing={<Badge label="Active" tone="success" />}
                        chevron
                        onPress={() => undefined}
                    />
                    <Inline space="sm">
                        {BADGE_TONES.map((tone) => (
                            <Badge
                                key={tone}
                                testID={`showcase-badge-${tone}`}
                                tone={tone}
                                label={tone}
                            />
                        ))}
                    </Inline>
                    <Inline space="sm">
                        {NUTRITION_LEVELS.map((level) => (
                            <Badge
                                key={level}
                                testID={`showcase-nutrition-${level}`}
                                nutrition={level}
                                label={level}
                            />
                        ))}
                    </Inline>
                    <Inline space="md">
                        <Avatar
                            testID="showcase-avatar"
                            name={t('designSystem:showcase.avatarName')}
                            size="lg"
                        />
                        <Avatar testID="showcase-avatar-sm" name="Verdant Kitchen" size="sm" />
                    </Inline>
                    <ImagePlaceholder
                        testID="showcase-image-placeholder"
                        seed="showcase-meal-01"
                        label={t('designSystem:showcase.placeholderLabel')}
                    />
                    {CALLOUT_TONES.map((tone) => (
                        <Callout
                            key={tone}
                            testID={`showcase-callout-${tone}`}
                            tone={tone}
                            title={t('designSystem:showcase.calloutTitle')}
                            body={t('designSystem:showcase.calloutBody')}
                        />
                    ))}
                    {/*
                     * Every glyph in the vocabulary, iterated from the exported constant so a new
                     * one cannot be added without appearing here. Names are shown beside the marks
                     * because the point of review is whether the glyph reads as its name — a
                     * basket that reads as a bin is a defect this page is supposed to catch.
                     */}
                    <Inline space="sm" wrap testID="showcase-icons">
                        {Object.keys(ICON_GLYPHS).map((name) => (
                            <View
                                key={name}
                                testID={`showcase-icon-${name}`}
                                className="min-w-[92px] flex-row items-center gap-2 rounded-lg border border-stroke-subtle px-3 py-2"
                            >
                                <Icon name={name as IconName} />
                                <Text variant="caption" tone="secondary">
                                    {name}
                                </Text>
                            </View>
                        ))}
                    </Inline>
                    <Accordion
                        testID="showcase-accordion"
                        defaultExpandedKeys={['one']}
                        items={[
                            {
                                key: 'one',
                                title: t('designSystem:showcase.accordionOne'),
                                children: <Text>{t('designSystem:showcase.accordionBody')}</Text>,
                            },
                            {
                                key: 'two',
                                title: t('designSystem:showcase.accordionTwo'),
                                children: <Text>{t('designSystem:showcase.accordionBody')}</Text>,
                            },
                        ]}
                    />
                </Section>

                <Section id="data" title={t('designSystem:showcase.sections.data')}>
                    <Table
                        testID="showcase-table"
                        caption={t('designSystem:showcase.tableCaption')}
                        columns={columns}
                        rows={NUTRIENT_ROWS}
                        rowKey={(row) => row.key}
                    />
                    {/* The density ladder the Catalogue's S/M/L switch drives. */}
                    <Table
                        testID="showcase-table-compact"
                        rowSize="sm"
                        caption={t('designSystem:showcase.tableCompactCaption')}
                        columns={columns}
                        rows={NUTRIENT_ROWS}
                        rowKey={(row) => row.key}
                    />
                    <Table
                        testID="showcase-table-sortable"
                        caption={t('designSystem:showcase.tableSortableCaption')}
                        columns={sortableColumns}
                        rows={sortedNutrientRows}
                        rowKey={(row) => row.key}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSortChange={(key, direction) => {
                            if (isNutrientSortKey(key)) setSortKey(key);
                            setSortDirection(direction);
                        }}
                        rowAction={{
                            header: t('designSystem:showcase.tableActionHeader'),
                            render: (row) => (
                                <Button
                                    testID={`showcase-table-action-${row.key}`}
                                    size="sm"
                                    variant="ghost"
                                    label={t('designSystem:showcase.tableActionLabel')}
                                    onPress={() => undefined}
                                />
                            ),
                        }}
                    />
                    <Inline space="lg">
                        <ProgressRing
                            testID="showcase-ring"
                            label={t('designSystem:showcase.ringLabel')}
                            value={1650}
                            target={2100}
                            unit="kcal"
                            level="good"
                            caption={t('designSystem:showcase.ringCaption')}
                        />
                        <ProgressRing
                            testID="showcase-ring-excessive"
                            label={t('designSystem:showcase.ringLabel')}
                            value={2600}
                            target={2100}
                            unit="kcal"
                            level="excessive"
                            size="sm"
                        />
                    </Inline>
                    {NUTRITION_LEVELS.map((level, index) => (
                        <MeterBar
                            key={level}
                            testID={`showcase-meter-${level}`}
                            label={`${t('designSystem:showcase.meterLabel')} ${String(index + 1)}`}
                            value={20 * (index + 1)}
                            target={120}
                            unit="g"
                            level={level}
                            levelLabel={level}
                        />
                    ))}
                    <Rating
                        testID="showcase-rating"
                        label={t('designSystem:showcase.ratingLabel')}
                        value={4.6}
                        count={128}
                    />
                    <Rating
                        testID="showcase-rating-dots"
                        label={t('designSystem:showcase.ratingLabel')}
                        value={3}
                        variant="dots"
                        size="sm"
                    />
                    {/*
                     * Compact: one glyph and the figure, for a rating sharing a line with a card
                     * title. What to check: the figure is still visible text rather than something
                     * only the glyph implies, and the accessible name still announces the scale.
                     */}
                    <Rating
                        testID="showcase-rating-compact"
                        label={t('designSystem:showcase.ratingLabel')}
                        value={4.8}
                        size="sm"
                        compact
                    />
                </Section>

                <Section id="status" title={t('designSystem:showcase.sections.status')}>
                    <Inline space="md">
                        <Spinner testID="showcase-spinner" showLabel />
                        <Spinner testID="showcase-spinner-large" size="large" />
                    </Inline>
                    <Skeleton testID="showcase-skeleton" heightClassName="h-6" />
                    <Skeleton
                        testID="showcase-skeleton-shimmer"
                        variant="shimmer"
                        heightClassName="h-16"
                        rounded="md"
                    />
                    <EmptyState
                        testID="showcase-empty"
                        title={t('auth:devices.empty')}
                        body={t('auth:devices.emptyBody')}
                    />
                    <EmptyState
                        testID="showcase-prototype"
                        variant="prototype"
                        title={t('access:area.kitchen')}
                    />
                    <ErrorState
                        testID="showcase-error-retryable"
                        failure={apiFailure('network', { correlationId: 'showcase-0001' })}
                        onRetry={() => undefined}
                    />
                    <ErrorState
                        testID="showcase-error-terminal"
                        failure={validationFailure({ email: ['Already registered.'] })}
                        onRetry={() => undefined}
                    />
                    <ErrorState testID="showcase-error-rate-limit" failure={rateLimitFailure(30)} />
                    <OfflineIndicator testID="showcase-offline" state="offline" />
                    <OfflineIndicator testID="showcase-reconnecting" state="reconnecting" />
                    <OfflineIndicator testID="showcase-restored" state="restored" />
                </Section>

                <Section id="overlays" title={t('designSystem:showcase.sections.overlays')}>
                    <Inline space="sm">
                        <Button
                            testID="showcase-open-dialog"
                            label={t('designSystem:showcase.openDialog')}
                            onPress={() => {
                                setDialogOpen(true);
                            }}
                        />
                        <Button
                            testID="showcase-open-drawer"
                            variant="secondary"
                            label={t('designSystem:showcase.openDrawer')}
                            onPress={() => {
                                setDrawerOpen(true);
                            }}
                        />
                        <Button
                            testID="showcase-open-drawer-end"
                            variant="secondary"
                            label={t('designSystem:showcase.openDrawerEnd')}
                            onPress={() => {
                                setEndDrawerOpen(true);
                            }}
                        />
                        <Button
                            testID="showcase-open-action-sheet"
                            variant="secondary"
                            label={t('designSystem:showcase.openActionSheet')}
                            onPress={() => {
                                setSheetOpen(true);
                            }}
                        />
                        <Button
                            testID="showcase-show-toast"
                            variant="ghost"
                            label={t('designSystem:showcase.showToast')}
                            onPress={() => {
                                toast.show({
                                    message: t('designSystem:showcase.toastMessage'),
                                    tone: 'success',
                                    testID: 'showcase-toast',
                                });
                            }}
                        />
                    </Inline>

                    <Popover
                        testID="showcase-popover"
                        triggerLabel={t('designSystem:showcase.popoverTrigger')}
                        triggerText={t('designSystem:showcase.popoverTrigger')}
                        title={t('designSystem:showcase.popoverTitle')}
                    >
                        <Text variant="caption">{t('designSystem:showcase.popoverBody')}</Text>
                    </Popover>

                    <Dialog
                        testID="showcase-dialog"
                        open={dialogOpen}
                        onClose={() => {
                            setDialogOpen(false);
                        }}
                        title={t('designSystem:showcase.dialogTitle')}
                        description={t('designSystem:showcase.dialogBody')}
                        actions={
                            <>
                                <Button
                                    testID="showcase-dialog-cancel"
                                    variant="quiet"
                                    label={t('common:action.cancel')}
                                    onPress={() => {
                                        setDialogOpen(false);
                                    }}
                                />
                                <Button
                                    testID="showcase-dialog-confirm"
                                    variant="danger"
                                    label={t('common:action.confirm')}
                                    onPress={() => {
                                        setDialogOpen(false);
                                    }}
                                />
                            </>
                        }
                    />

                    <Drawer
                        testID="showcase-drawer"
                        open={drawerOpen}
                        onClose={() => {
                            setDrawerOpen(false);
                        }}
                        title={t('designSystem:showcase.drawerTitle')}
                    >
                        <ListItem
                            title={t('common:nav.workspace')}
                            chevron
                            onPress={() => undefined}
                        />
                        <ListItem
                            title={t('common:nav.profile')}
                            chevron
                            onPress={() => undefined}
                        />
                    </Drawer>

                    <Drawer
                        testID="showcase-drawer-end"
                        placement="end"
                        open={endDrawerOpen}
                        onClose={() => {
                            setEndDrawerOpen(false);
                        }}
                        title={t('designSystem:showcase.drawerTitle')}
                    >
                        <Text>{t('designSystem:showcase.calloutBody')}</Text>
                    </Drawer>

                    <ActionSheet
                        testID="showcase-action-sheet"
                        open={sheetOpen}
                        onClose={() => {
                            setSheetOpen(false);
                        }}
                        title={t('designSystem:showcase.actionSheetTitle')}
                        actions={[
                            {
                                key: 'duplicate',
                                label: t('designSystem:showcase.actionSheetPrimary'),
                                icon: 'prototype',
                                onPress: () => undefined,
                            },
                            {
                                key: 'share',
                                label: t('designSystem:showcase.actionSheetSecondary'),
                                icon: 'signOut',
                                onPress: () => undefined,
                            },
                            {
                                key: 'delete',
                                label: t('designSystem:showcase.actionSheetDestructive'),
                                tone: 'destructive',
                                onPress: () => undefined,
                            },
                        ]}
                    />
                </Section>

                <Section id="motion" title={t('designSystem:showcase.sections.motion')}>
                    <Button
                        testID="showcase-replay-motion"
                        size="sm"
                        variant="secondary"
                        label={t('designSystem:showcase.replay')}
                        onPress={() => {
                            setReplays((current) => current + 1);
                        }}
                    />
                    <FadeIn key={`fade-${String(replays)}`} testID="showcase-fade-in">
                        <Text>{t('designSystem:showcase.motionFade')}</Text>
                    </FadeIn>
                    <SlideIn
                        key={`slide-start-${String(replays)}`}
                        testID="showcase-slide-start"
                        edge="start"
                    >
                        <Text>{t('designSystem:showcase.motionSlideStart')}</Text>
                    </SlideIn>
                    <SlideIn
                        key={`slide-bottom-${String(replays)}`}
                        testID="showcase-slide-bottom"
                        edge="bottom"
                    >
                        <Text>{t('designSystem:showcase.motionSlideBottom')}</Text>
                    </SlideIn>
                    <Inline space="sm">
                        <Text tone="secondary">{t('designSystem:showcase.motionNumber')}</Text>
                        <AnimatedFigure value={1650 + replays * 125} />
                    </Inline>
                </Section>

                {/* English literals, like `hero` and `ai` above: the section demonstrates one
                    feature-level composition rather than a translated design-system primitive. */}
                <Section id="kitchen" title="Kitchen templates">
                    <KitchenPageHeader
                        testID="showcase-kitchen-header"
                        title="Stock"
                        subtitle="What is on hand, what the minimum is, and how tomorrow reads."
                        statusChip={<Badge tone="danger" label="1 item short" />}
                        actions={
                            <Button
                                testID="showcase-kitchen-header-action"
                                size="sm"
                                label="Receive a delivery"
                            />
                        }
                    />
                    <KitchenPageHeader
                        testID="showcase-kitchen-header-band"
                        variant="band"
                        title="Grilled Halloumi & Rocket Plate"
                        subtitle="Creating and editing share this form — leaving with unsaved changes asks first."
                        statusChip={<Badge tone="warning" label="Draft" />}
                    />
                    <View className="flex-row flex-wrap gap-3">
                        <KpiTile
                            testID="showcase-kitchen-kpi"
                            label="Spend"
                            value="$18,240"
                            size="lg"
                            hint="what arrived this month"
                        />
                        <KpiTile
                            testID="showcase-kitchen-kpi-pending"
                            label="Cost of goods"
                            value={null}
                            pending
                        />
                        <KpiTile
                            testID="showcase-kitchen-kpi-null"
                            label="Margin"
                            value={null}
                            nullCaption="The count could not be read."
                        />
                    </View>
                    <ListToolbar
                        testID="showcase-kitchen-toolbar"
                        query={kitchenQuery}
                        onQueryChange={setKitchenQuery}
                        statuses={kitchenStatuses}
                        onStatusesChange={setKitchenStatuses}
                        statusOptions={['draft', 'review_required', 'published', 'retired']}
                        resultSummary="Showing 8 of 24"
                    />
                    <View className="max-w-[360px]">
                        <GateRailCard
                            testID="showcase-kitchen-gate"
                            title="Publication gate"
                            checks={[
                                { key: 'name', label: 'Name in both languages', passed: true },
                                {
                                    key: 'description',
                                    label: 'Description in both languages',
                                    passed: false,
                                    note: 'The description is missing one of its two languages.',
                                },
                                { key: 'saved', label: 'Changes saved', passed: true },
                            ]}
                            explainer="A check is failing. The meal stays off the marketplace until every check passes."
                            action={
                                <Button
                                    testID="showcase-kitchen-gate-publish"
                                    label="Publish"
                                    disabled
                                />
                            }
                        />
                    </View>
                </Section>
            </Stack>
        </PageTransition>
    );
}
