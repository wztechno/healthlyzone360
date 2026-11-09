import type {
    CookingTemperature,
    TemperatureReading,
    TemperatureSlot,
    TemperatureUnit,
    TemperatureUnitDraft,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Dialog,
    EmptyState,
    ErrorState,
    Icon,
    Select,
    Stack,
    TableSkeleton,
    Tabs,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useRecordCookingTemperatureMutation,
    useRecordTemperatureMutation,
    useSaveTemperatureUnitMutation,
    useTemperatureLogQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useProductionOrdersQuery } from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { listPrintJob, useListPrint } from '../catalogue/list-print.ts';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
    ORDER_PREPARE_PERMISSION,
} from '../entity-registry.ts';

/**
 * `/kitchen/temperature-logs`: what an inspector asks to see. Fridge and freezer readings twice a
 * day, and the core temperature of each cooked batch, a month at a time, on paper through the list
 * print the stock page uses. A reading is written once and stamped by the server with who and when,
 * which is what makes the page worth showing anybody.
 */
export function TemperatureLogsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-temperature-logs"
        >
            <TemperatureLogs />
        </Gate>
    );
}

type Tab = 'readings' | 'cooking' | 'units';

const MEDIUM_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const NO_READINGS: readonly TemperatureReading[] = [];
const NO_COOKING: readonly CookingTemperature[] = [];
const NO_UNITS: readonly TemperatureUnit[] = [];

/** This month and the eleven before it, as `YYYY-MM`. */
function recentMonths(): readonly string[] {
    const now = new Date();
    return Array.from({ length: 12 }, (_, back) => {
        const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return month.toISOString().slice(0, 7);
    });
}

function TemperatureLogs() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const months = useMemo(() => recentMonths(), []);
    const [tab, setTab] = useState<Tab>('readings');
    const [month, setMonth] = useState(months[0] ?? '');
    const log = useTemperatureLogQuery(month);
    const failure = toFailure(log.error);
    const canRecord = useCan([ORDER_PREPARE_PERMISSION, INVENTORY_MANAGE_PERMISSION], 'any');
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);
    const print = useListPrint();

    const units = log.data?.units ?? NO_UNITS;
    const readings = log.data?.readings ?? NO_READINGS;
    const cooking = log.data?.cooking ?? NO_COOKING;

    const celsius = (value: string) =>
        t('kitchen:temperature.celsius', { value: formatter.formatNumber(Number(value)) });

    const readingColumns: readonly CatalogueColumn<TemperatureReading>[] = [
        {
            key: 'date',
            role: 'title',
            label: t('kitchen:temperature.columnDate'),
            width: 130,
            priority: 100,
            value: (row) => formatter.formatDate(row.readingDate, MEDIUM_DATE),
            render: (row) => <Text>{formatter.formatDate(row.readingDate, MEDIUM_DATE)}</Text>,
        },
        {
            key: 'slot',
            role: 'meta',
            label: t('kitchen:temperature.columnSlot'),
            width: 100,
            priority: 90,
            value: (row) => t(`kitchen:temperature.slot.${row.slot}`),
            render: (row) => (
                <Text tone="secondary">{t(`kitchen:temperature.slot.${row.slot}`)}</Text>
            ),
        },
        {
            key: 'unit',
            role: 'meta',
            label: t('kitchen:temperature.columnUnit'),
            width: 180,
            priority: 95,
            value: (row) => row.unitName,
            render: (row) => <Text>{row.unitName}</Text>,
        },
        {
            key: 'reading',
            role: 'meta',
            label: t('kitchen:temperature.columnReading'),
            width: 100,
            priority: 95,
            value: (row) => celsius(row.celsius),
            render: (row) => <Text>{celsius(row.celsius)}</Text>,
        },
        {
            key: 'state',
            role: 'status',
            label: t('kitchen:temperature.columnState'),
            width: 130,
            priority: 90,
            value: (row) =>
                t(
                    row.outOfRange
                        ? 'kitchen:temperature.outOfRange'
                        : 'kitchen:temperature.inRange',
                ),
            render: (row) => (
                <Badge
                    icon={null}
                    tone={row.outOfRange ? 'danger' : 'success'}
                    label={t(
                        row.outOfRange
                            ? 'kitchen:temperature.outOfRange'
                            : 'kitchen:temperature.inRange',
                    )}
                />
            ),
        },
        {
            key: 'by',
            role: 'meta',
            label: t('kitchen:temperature.columnBy'),
            width: 160,
            priority: 70,
            value: (row) => row.recordedByName ?? t('kitchen:common.notRecorded'),
            render: (row) => (
                <Text tone="secondary">
                    {row.recordedByName ?? t('kitchen:common.notRecorded')}
                </Text>
            ),
        },
        {
            key: 'note',
            role: 'meta',
            label: t('kitchen:temperature.columnNote'),
            width: 200,
            priority: 60,
            value: (row) => row.note ?? '',
            render: (row) => <Text tone="secondary">{row.note ?? ''}</Text>,
        },
    ];

    const cookingColumns: readonly CatalogueColumn<CookingTemperature>[] = [
        {
            key: 'when',
            role: 'title',
            label: t('kitchen:temperature.columnWhen'),
            width: 170,
            priority: 100,
            value: (row) => formatter.formatDate(row.recordedAt, WHEN),
            render: (row) => <Text>{formatter.formatDate(row.recordedAt, WHEN)}</Text>,
        },
        {
            key: 'batch',
            role: 'meta',
            label: t('kitchen:temperature.columnBatch'),
            width: 220,
            priority: 95,
            value: (row) => [row.batchLabel, row.recipe].filter(Boolean).join(' · '),
            render: (row) => (
                <Text>{[row.batchLabel, row.recipe].filter(Boolean).join(' · ')}</Text>
            ),
        },
        {
            key: 'reading',
            role: 'meta',
            label: t('kitchen:temperature.columnCore'),
            width: 110,
            priority: 95,
            value: (row) => celsius(row.celsius),
            render: (row) => <Text>{celsius(row.celsius)}</Text>,
        },
        {
            key: 'by',
            role: 'meta',
            label: t('kitchen:temperature.columnBy'),
            width: 160,
            priority: 70,
            value: (row) => row.recordedByName ?? t('kitchen:common.notRecorded'),
            render: (row) => (
                <Text tone="secondary">
                    {row.recordedByName ?? t('kitchen:common.notRecorded')}
                </Text>
            ),
        },
    ];

    const unitColumns: readonly CatalogueColumn<TemperatureUnit>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('kitchen:temperature.columnUnit'),
            width: 220,
            priority: 100,
            value: (row) => row.name,
            render: (row) => <Text>{row.name}</Text>,
        },
        {
            key: 'kind',
            role: 'meta',
            label: t('kitchen:temperature.fieldKind'),
            width: 120,
            priority: 80,
            value: (row) => t(`kitchen:temperature.kind.${row.kind}`),
            render: (row) => (
                <Text tone="secondary">{t(`kitchen:temperature.kind.${row.kind}`)}</Text>
            ),
        },
        {
            key: 'range',
            role: 'meta',
            label: t('kitchen:temperature.fieldRange'),
            width: 160,
            priority: 90,
            value: (row) => `${celsius(row.minC)} – ${celsius(row.maxC)}`,
            render: (row) => <Text>{`${celsius(row.minC)} – ${celsius(row.maxC)}`}</Text>,
        },
        {
            key: 'state',
            role: 'status',
            label: t('kitchen:temperature.columnState'),
            width: 110,
            priority: 70,
            value: (row) =>
                t(row.active ? 'kitchen:temperature.active' : 'kitchen:temperature.retired'),
            render: (row) => (
                <Badge
                    icon={null}
                    tone={row.active ? 'success' : 'neutral'}
                    label={t(
                        row.active ? 'kitchen:temperature.active' : 'kitchen:temperature.retired',
                    )}
                />
            ),
        },
    ];

    const [recording, setRecording] = useState(false);
    const [recordingBatch, setRecordingBatch] = useState(false);
    const [editing, setEditing] = useState<TemperatureUnit | 'new' | null>(null);

    const body = () => {
        if (log.isPending) return <TableSkeleton testID="kitchen-temperature-loading" />;
        if (failure !== null) {
            return (
                <ErrorState
                    testID="kitchen-temperature-error"
                    title={t('kitchen:temperature.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void log.refetch();
                    }}
                    retrying={log.isFetching}
                />
            );
        }
        if (tab === 'readings') {
            return readings.length === 0 ? (
                <EmptyState
                    testID="kitchen-temperature-empty"
                    title={t('kitchen:temperature.emptyTitle')}
                    body={t('kitchen:temperature.emptyBody')}
                />
            ) : (
                <CatalogueList<TemperatureReading>
                    testID="kitchen-temperature-readings"
                    label={t('kitchen:temperature.tabReadings')}
                    columns={readingColumns}
                    rows={readings}
                    rowKey={(row) => row.id}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            );
        }
        if (tab === 'cooking') {
            return cooking.length === 0 ? (
                <EmptyState
                    testID="kitchen-temperature-cooking-empty"
                    title={t('kitchen:temperature.cookingEmptyTitle')}
                    body={t('kitchen:temperature.cookingEmptyBody')}
                />
            ) : (
                <CatalogueList<CookingTemperature>
                    testID="kitchen-temperature-cooking"
                    label={t('kitchen:temperature.tabCooking')}
                    columns={cookingColumns}
                    rows={cooking}
                    rowKey={(row) => row.id}
                    rowActionsLabel={t('kitchen:list.rowActions')}
                />
            );
        }
        return units.length === 0 ? (
            <EmptyState
                testID="kitchen-temperature-units-empty"
                title={t('kitchen:temperature.unitsEmptyTitle')}
                body={t('kitchen:temperature.unitsEmptyBody')}
            />
        ) : (
            <CatalogueList<TemperatureUnit>
                testID="kitchen-temperature-units"
                label={t('kitchen:temperature.tabUnits')}
                columns={unitColumns}
                rows={units}
                rowKey={(row) => row.id}
                rowActionsLabel={t('kitchen:list.rowActions')}
                {...(canManage ? { onRowPress: setEditing } : {})}
            />
        );
    };

    return (
        <Stack space="md" testID="kitchen-temperature-screen">
            <Tabs<Tab>
                label={t('kitchen:families.temperatureLogs.name')}
                value={tab}
                onChange={setTab}
                items={[
                    { value: 'readings', label: t('kitchen:temperature.tabReadings') },
                    { value: 'cooking', label: t('kitchen:temperature.tabCooking') },
                    { value: 'units', label: t('kitchen:temperature.tabUnits') },
                ]}
            />

            <View className="flex-row flex-wrap items-end gap-tight">
                {tab === 'units' ? null : (
                    <View className="w-40">
                        <Select
                            testID="kitchen-temperature-month"
                            label={t('kitchen:temperature.month')}
                            size="sm"
                            value={month}
                            options={months.map((value) => ({
                                value,
                                label: formatter.formatDate(`${value}-01`, {
                                    month: 'long',
                                    year: 'numeric',
                                }),
                            }))}
                            onChange={setMonth}
                        />
                    </View>
                )}
                {tab !== 'readings' || !canRecord ? null : (
                    <Button
                        testID="kitchen-temperature-record"
                        label={t('kitchen:temperature.record')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => {
                            setRecording(true);
                        }}
                    />
                )}
                {tab !== 'cooking' || !canRecord ? null : (
                    <Button
                        testID="kitchen-temperature-record-batch"
                        label={t('kitchen:temperature.recordBatch')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => {
                            setRecordingBatch(true);
                        }}
                    />
                )}
                {tab !== 'units' || !canManage ? null : (
                    <Button
                        testID="kitchen-temperature-unit-add"
                        label={t('kitchen:temperature.addUnit')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => {
                            setEditing('new');
                        }}
                    />
                )}
                {tab === 'units' ? null : (
                    <Button
                        testID="kitchen-temperature-print"
                        variant="secondary"
                        label={t('kitchen:temperature.print')}
                        onPress={() => {
                            print.start(
                                tab === 'readings'
                                    ? listPrintJob({
                                          resource: 'temperature-logs',
                                          title: t('kitchen:temperature.printReadings', { month }),
                                          columns: readingColumns,
                                          rows: readings,
                                      })
                                    : listPrintJob({
                                          resource: 'temperature-logs',
                                          title: t('kitchen:temperature.printCooking', { month }),
                                          columns: cookingColumns,
                                          rows: cooking,
                                      }),
                            );
                        }}
                    />
                )}
            </View>

            {body()}

            {!recording ? null : (
                <ReadingDialog
                    units={units.filter((unit) => unit.active)}
                    onClose={() => {
                        setRecording(false);
                    }}
                />
            )}
            {!recordingBatch ? null : (
                <BatchDialog
                    onClose={() => {
                        setRecordingBatch(false);
                    }}
                />
            )}
            {editing === null ? null : (
                <UnitDialog
                    unit={editing === 'new' ? null : editing}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            )}
        </Stack>
    );
}

function ReadingDialog({
    units,
    onClose,
}: {
    readonly units: readonly TemperatureUnit[];
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const record = useRecordTemperatureMutation();
    const [unitId, setUnitId] = useState<string | null>(units[0]?.id ?? null);
    const [slot, setSlot] = useState<TemperatureSlot>(new Date().getHours() < 14 ? 'am' : 'pm');
    const [celsius, setCelsius] = useState('');
    const [note, setNote] = useState('');
    const failure = toFailure(record.error);
    const readable = celsius.trim() !== '' && Number.isFinite(Number(celsius));

    return (
        <Dialog
            testID="kitchen-temperature-dialog"
            open
            onClose={onClose}
            title={t('kitchen:temperature.record')}
            actions={
                <Button
                    testID="kitchen-temperature-save"
                    label={t('kitchen:temperature.save')}
                    loading={record.isPending}
                    disabled={record.isPending || unitId === null || !readable}
                    onPress={() => {
                        if (unitId === null) return;
                        record.mutate(
                            {
                                unitId,
                                slot,
                                celsius: celsius.trim(),
                                note: note.trim() === '' ? null : note.trim(),
                            },
                            {
                                onSuccess: (reading) => {
                                    onClose();
                                    toast.show({
                                        testID: 'kitchen-temperature-toast',
                                        tone: reading.outOfRange ? 'warning' : 'success',
                                        message: t(
                                            reading.outOfRange
                                                ? 'kitchen:temperature.savedOutOfRange'
                                                : 'kitchen:temperature.saved',
                                        ),
                                    });
                                },
                            },
                        );
                    }}
                />
            }
        >
            <Stack space="sm">
                <Select
                    testID="kitchen-temperature-unit"
                    label={t('kitchen:temperature.columnUnit')}
                    size="sm"
                    value={unitId}
                    options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
                    onChange={setUnitId}
                />
                <Select<TemperatureSlot>
                    testID="kitchen-temperature-slot"
                    label={t('kitchen:temperature.columnSlot')}
                    size="sm"
                    value={slot}
                    options={[
                        { value: 'am', label: t('kitchen:temperature.slot.am') },
                        { value: 'pm', label: t('kitchen:temperature.slot.pm') },
                    ]}
                    onChange={setSlot}
                />
                <TextInputField
                    testID="kitchen-temperature-celsius"
                    id="kitchen-temperature-celsius"
                    label={t('kitchen:temperature.fieldCelsius')}
                    size="sm"
                    inputMode="decimal"
                    value={celsius}
                    onChangeText={setCelsius}
                />
                <TextInputField
                    testID="kitchen-temperature-note"
                    id="kitchen-temperature-note"
                    label={t('kitchen:temperature.columnNote')}
                    size="sm"
                    maxLength={200}
                    value={note}
                    onChangeText={setNote}
                />
                {failure === null ? null : (
                    <Text variant="caption" tone="danger" testID="kitchen-temperature-save-error">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}

function BatchDialog({ onClose }: { readonly onClose: () => void }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;
    const branchFilter = branchId === null ? {} : { branchId };
    const open = useProductionOrdersQuery(branchFilter);
    const done = useProductionOrdersQuery({ ...branchFilter, status: 'completed' });
    const record = useRecordCookingTemperatureMutation();
    const [batchId, setBatchId] = useState<string | null>(null);
    const [celsius, setCelsius] = useState('');
    const failure = toFailure(record.error);
    const readable = celsius.trim() !== '' && Number.isFinite(Number(celsius));
    const batches = [...(open.data?.orders ?? []), ...(done.data?.orders ?? [])].slice(0, 60);

    return (
        <Dialog
            testID="kitchen-temperature-batch-dialog"
            open
            onClose={onClose}
            title={t('kitchen:temperature.recordBatch')}
            actions={
                <Button
                    testID="kitchen-temperature-batch-save"
                    label={t('kitchen:temperature.save')}
                    loading={record.isPending}
                    disabled={record.isPending || batchId === null || !readable}
                    onPress={() => {
                        if (batchId === null) return;
                        record.mutate(
                            { productionOrderId: batchId, celsius: celsius.trim() },
                            {
                                onSuccess: () => {
                                    onClose();
                                    toast.show({
                                        testID: 'kitchen-temperature-toast',
                                        tone: 'success',
                                        message: t('kitchen:temperature.saved'),
                                    });
                                },
                            },
                        );
                    }}
                />
            }
        >
            <Stack space="sm">
                <Select
                    testID="kitchen-temperature-batch"
                    label={t('kitchen:temperature.columnBatch')}
                    size="sm"
                    searchable
                    value={batchId}
                    loading={open.isPending || done.isPending}
                    options={batches.map((batch) => ({
                        value: String(batch.id),
                        label: [
                            batch.reference ?? batch.batchReference,
                            locale.startsWith('ar') ? null : batch.productionItemNameEn,
                        ]
                            .filter(Boolean)
                            .join(' · '),
                    }))}
                    onChange={setBatchId}
                />
                <TextInputField
                    testID="kitchen-temperature-batch-celsius"
                    id="kitchen-temperature-batch-celsius"
                    label={t('kitchen:temperature.columnCore')}
                    size="sm"
                    inputMode="decimal"
                    value={celsius}
                    onChangeText={setCelsius}
                />
                {failure === null ? null : (
                    <Text variant="caption" tone="danger" testID="kitchen-temperature-batch-error">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}

function UnitDialog({
    unit,
    onClose,
}: {
    readonly unit: TemperatureUnit | null;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const save = useSaveTemperatureUnitMutation();
    const [draft, setDraft] = useState<TemperatureUnitDraft>({
        id: unit?.id ?? null,
        name: unit?.name ?? '',
        kind: unit?.kind ?? 'fridge',
        minC: unit?.minC ?? '0',
        maxC: unit?.maxC ?? '5',
        active: unit?.active ?? true,
    });
    const failure = toFailure(save.error);
    const readable =
        draft.name.trim() !== '' &&
        Number.isFinite(Number(draft.minC)) &&
        Number.isFinite(Number(draft.maxC)) &&
        Number(draft.minC) < Number(draft.maxC);

    return (
        <Dialog
            testID="kitchen-temperature-unit-dialog"
            open
            onClose={onClose}
            title={t(
                unit === null ? 'kitchen:temperature.addUnit' : 'kitchen:temperature.editUnit',
            )}
            actions={
                <Button
                    testID="kitchen-temperature-unit-save"
                    label={t('kitchen:temperature.save')}
                    loading={save.isPending}
                    disabled={save.isPending || !readable}
                    onPress={() => {
                        save.mutate(draft, { onSuccess: onClose });
                    }}
                />
            }
        >
            <Stack space="sm">
                <TextInputField
                    testID="kitchen-temperature-unit-name"
                    id="kitchen-temperature-unit-name"
                    label={t('kitchen:temperature.columnUnit')}
                    size="sm"
                    value={draft.name}
                    onChangeText={(name) => {
                        setDraft({ ...draft, name });
                    }}
                />
                <Select
                    testID="kitchen-temperature-unit-kind"
                    label={t('kitchen:temperature.fieldKind')}
                    size="sm"
                    value={draft.kind}
                    options={[
                        { value: 'fridge', label: t('kitchen:temperature.kind.fridge') },
                        { value: 'freezer', label: t('kitchen:temperature.kind.freezer') },
                    ]}
                    onChange={(kind) => {
                        setDraft({ ...draft, kind });
                    }}
                />
                <TextInputField
                    testID="kitchen-temperature-unit-min"
                    id="kitchen-temperature-unit-min"
                    label={t('kitchen:temperature.fieldMin')}
                    size="sm"
                    inputMode="decimal"
                    value={draft.minC}
                    onChangeText={(minC) => {
                        setDraft({ ...draft, minC });
                    }}
                />
                <TextInputField
                    testID="kitchen-temperature-unit-max"
                    id="kitchen-temperature-unit-max"
                    label={t('kitchen:temperature.fieldMax')}
                    size="sm"
                    inputMode="decimal"
                    value={draft.maxC}
                    onChangeText={(maxC) => {
                        setDraft({ ...draft, maxC });
                    }}
                />
                {unit === null ? null : (
                    <Select<'active' | 'retired'>
                        testID="kitchen-temperature-unit-state"
                        label={t('kitchen:temperature.columnState')}
                        size="sm"
                        value={draft.active ? 'active' : 'retired'}
                        options={[
                            { value: 'active', label: t('kitchen:temperature.active') },
                            { value: 'retired', label: t('kitchen:temperature.retired') },
                        ]}
                        onChange={(state) => {
                            setDraft({ ...draft, active: state === 'active' });
                        }}
                    />
                )}
                {failure === null ? null : (
                    <Text variant="caption" tone="danger" testID="kitchen-temperature-unit-error">
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
