import { apiFailure, rateLimitFailure, validationFailure } from '@healthy360/api-client';
import {
    Accordion,
    ActionSheet,
    Avatar,
    BADGE_TONES,
    BUTTON_SIZES,
    BUTTON_VARIANTS,
    Badge,
    Breadcrumbs,
    Button,
    CALLOUT_TONES,
    CARD_TONES,
    CalendarGrid,
    Callout,
    Card,
    Checkbox,
    Chip,
    Collapse,
    DateField,
    Dialog,
    Drawer,
    EmptyState,
    ErrorState,
    FadeIn,
    FileUploadField,
    FilterChip,
    Heading,
    ICON_GLYPHS,
    Icon,
    IconButton,
    ImagePlaceholder,
    Inline,
    ListItem,
    MeterBar,
    NUTRITION_LEVELS,
    NumberStepper,
    OfflineIndicator,
    OtpInput,
    PageTransition,
    Pagination,
    PasswordInput,
    Popover,
    ProgressRing,
    RangeFilter,
    Rating,
    SegmentedControl,
    Select,
    Skeleton,
    SlideIn,
    Spinner,
    Stack,
    Stepper,
    Table,
    Tabs,
    Text,
    TextInputField,
    useAnimatedNumber,
    useToast,
} from '@healthy360/design-system';
import type { IconName, RangeValue, TableColumn } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'nativewind';
import { Text as RNText, View } from 'react-native';

import { EntityImage, MediaChip } from '../media/entity-image.tsx';
import type { PublishableStatus } from '@healthy360/api-client/contracts';
import { GateRailCard } from '../features/kitchen-admin/gate-rail-card.tsx';
import { KitchenPageHeader } from '../features/kitchen-admin/kitchen-page-header.tsx';
import { KpiTile } from '../features/kitchen-admin/kpi-tile.tsx';
import { ListToolbar } from '../features/kitchen-admin/list-toolbar.tsx';
import { ToolbarRow } from '../features/marketplace/toolbar-row.tsx';
import { AiBand, AiRailCard } from '../ui/ai-surface.tsx';
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
                     */}
                    <Inline space="xs" align="center">
                        <Button
                            testID="showcase-emphasis-locale"
                            size="sm"
                            variant="ghost"
                            label="العربية"
                            onPress={() => undefined}
                        />
                        <Button
                            testID="showcase-emphasis-my-home"
                            size="sm"
                            variant="ghost"
                            label="My home"
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
                            },
                            {
                                key: 'long',
                                name: 'Slow-Braised Lamb',
                                body: 'A much longer description that wraps onto several lines, so this card would otherwise be the tallest in the row and drag its price down with it.',
                                price: '$26',
                            },
                            {
                                key: 'none',
                                name: 'Sparkling Water',
                                body: '',
                                price: '$3',
                            },
                        ].map((item) => (
                            <View
                                key={item.key}
                                className="min-w-[200px] flex-1 grow basis-[220px]"
                            >
                                <Card
                                    testID={`showcase-card-baseline-${item.key}`}
                                    padding="none"
                                    tone="raised"
                                    interactive
                                    onPress={() => undefined}
                                    accessibilityLabel={item.name}
                                    footer={
                                        <View className="border-t border-stroke-subtle px-4 pb-4 pt-3">
                                            <RNText
                                                testID={`showcase-card-baseline-${item.key}-price`}
                                                className="font-display text-2xl text-surface-brand text-start"
                                            >
                                                {item.price}
                                            </RNText>
                                        </View>
                                    }
                                >
                                    <EntityImage
                                        testID={`showcase-card-baseline-${item.key}-media`}
                                        seed={`showcase-card-${item.key}`}
                                        label={item.name}
                                        aspect="card"
                                        flush
                                        overlayStart={<MediaChip label="Verdant Kitchen" />}
                                    />
                                    <Stack space="xs" className="px-4 pt-4">
                                        <RNText className="font-display text-lg text-content-primary text-start">
                                            {item.name}
                                        </RNText>
                                        <Text tone="secondary" variant="caption">
                                            {item.body}
                                        </Text>
                                    </Stack>
                                </Card>
                            </View>
                        ))}
                    </View>
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
