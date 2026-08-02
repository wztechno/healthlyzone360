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
    DateField,
    Dialog,
    Drawer,
    EmptyState,
    ErrorState,
    FadeIn,
    FilterChip,
    Heading,
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
import type { RangeValue, TableColumn } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'nativewind';

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
    const [segment, setSegment] = useState('overview');
    const [portion, setPortion] = useState<number | null>(2);
    const [range, setRange] = useState<RangeValue>({ min: 300, max: 700 });
    const [filterOn, setFilterOn] = useState(true);
    const [startDate, setStartDate] = useState<string | null>('2026-08-03');
    const [replays, setReplays] = useState(0);

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
                                    variant="secondary"
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
            </Stack>
        </PageTransition>
    );
}
