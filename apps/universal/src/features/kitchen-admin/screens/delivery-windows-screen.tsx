import type { DeliveryWindow } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    FormSection,
    FormSkeleton,
    Icon,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAdminZonesQuery,
    useDeliveryWindowsQuery,
    useSaveDeliveryWindowMutation,
    zonesFromPages,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    changedWindows,
    emptyWindow,
    windowDraft,
    windowErrors,
    windowWrite,
} from '../delivery-model.ts';
import type { DeliveryWindowDraft } from '../delivery-model.ts';
import { DeliveryWindowRows } from '../delivery-row-editors.tsx';
import { CATALOGUE_VIEW_PERMISSION, DELIVERY_ZONE_MANAGE_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/delivery-windows` — the kitchen's delivery slots, org-wide.
 *
 * A window is a kitchen record; a zone only chooses which windows it offers (its own Delivery
 * windows tab). So this page edits names, days, hours and whether a window is offered at all, and
 * shows — read-only — the zones that offer each one. A new window is offered in no zone.
 *
 * Save writes row by row: a new row is created, a changed row is patched, and a row nobody touched
 * is never sent. There is no delete; a window is withdrawn with Offered → No.
 */
export function DeliveryWindowsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-windows"
        >
            <DeliveryWindowsEditor />
        </Gate>
    );
}

function draftsFrom(windows: readonly DeliveryWindow[]): readonly DeliveryWindowDraft[] {
    return windows.map((window) => ({
        ...windowDraft(window, 0),
        key: `window-${String(window.id)}`,
    }));
}

function DeliveryWindowsEditor() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(DELIVERY_ZONE_MANAGE_PERMISSION);

    const windows = useDeliveryWindowsQuery();
    const zones = useAdminZonesQuery({ limit: 100 });
    const save = useSaveDeliveryWindowMutation();
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [rows, setRows] = useState<readonly DeliveryWindowDraft[]>([]);
    const [rowsKey, setRowsKey] = useState<number | null>(null);
    const [dirty, setDirty] = useState(false);
    const [ordinal, setOrdinal] = useState(1);
    const [saving, setSaving] = useState(false);

    const data = windows.data;
    // Re-seeded from every fresh read while nothing is being edited — after a save, the refetch the
    // mutation's invalidation triggers is what brings the server's copy back.
    if (data !== undefined && windows.dataUpdatedAt !== rowsKey && !dirty) {
        setRowsKey(windows.dataUpdatedAt);
        setRows(draftsFrom(data));
    }

    const zoneNames = useMemo(
        () =>
            new Map(
                zonesFromPages(zones.data?.pages).map((zone) => [
                    String(zone.id),
                    displayName(zone.name, locale).value,
                ]),
            ),
        [zones.data, locale],
    );
    const savedById = useMemo(
        () => new Map((data ?? []).map((window) => [String(window.id), window])),
        [data],
    );

    const rowErrors = useMemo(
        () =>
            windowErrors(rows, {
                labelRequired: t('kitchen:windows.labelRequired'),
                weekdaysRequired: t('kitchen:windows.weekdaysRequired'),
                startInvalid: t('kitchen:windows.startInvalid'),
                endInvalid: t('kitchen:windows.endInvalid'),
                endBeforeStart: t('kitchen:windows.endBeforeStart'),
            }),
        [rows, t],
    );

    const edit = (next: readonly DeliveryWindowDraft[]) => {
        setRows(next);
        setDirty(true);
        guard.markDirty();
    };

    const addRow = () => {
        edit([...rows, emptyWindow(`window-new-${String(ordinal)}`)]);
        setOrdinal(ordinal + 1);
    };

    const saveAll = () => {
        if (data === undefined || rowErrors.size > 0) return;
        const pending = changedWindows(rows, data);

        void (async () => {
            setSaving(true);
            let current = rows;
            try {
                for (const row of pending) {
                    const request = windowWrite(row);
                    const written =
                        row.id === null
                            ? await save.mutateAsync({ id: null, request })
                            : await save.mutateAsync({ id: row.id, request });
                    // A created row keeps the server's identifier, so pressing Save again after a
                    // later row fails patches it rather than creating it twice.
                    current = current.map((candidate) =>
                        candidate.key === row.key ? { ...candidate, id: written.id } : candidate,
                    );
                    setRows(current);
                }
                setDirty(false);
                guard.markClean();
                toast.show({
                    testID: 'kitchen-windows-saved-toast',
                    tone: 'success',
                    message: t('kitchen:windows.savedToast', { count: pending.length }),
                });
            } catch {
                // `save.error` renders the callout; the rows written so far stay written.
            } finally {
                setSaving(false);
            }
        })();
    };

    const title = t('kitchen:deliveryWindows.title');

    if (windows.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-windows-loading"
                partTestID="kitchen-windows"
                heading={false}
                sections={1}
                tabs={0}
            />
        );
    }

    const loadFailure = toFailure(windows.error);
    if (loadFailure !== null) {
        return (
            <Cascade space="md" testID="kitchen-windows-screen">
                <ErrorState
                    testID="kitchen-windows-load-error"
                    failure={loadFailure}
                    title={t('kitchen:deliveryWindows.loadErrorTitle')}
                    onRetry={() => {
                        void windows.refetch();
                    }}
                    retrying={windows.isFetching}
                />
            </Cascade>
        );
    }

    const saveFailure = toFailure(save.error);

    return (
        <Cascade space="md" testID="kitchen-windows-screen">
            <RecordFormOpening
                testID="kitchen-windows-screen"
                title={title}
                dirty={guard.isDirty}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-windows-save"
                            label={t('kitchen:windows.save')}
                            loading={saving}
                            disabled={!dirty || rowErrors.size > 0 || saving}
                            onPress={saveAll}
                        />
                    ) : undefined
                }
            />

            {saveFailure === null ? null : (
                <Callout
                    testID="kitchen-windows-save-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:windows.saveError')}
                    body={saveFailure.message}
                />
            )}

            {rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-windows-empty"
                    title={t('kitchen:deliveryWindows.emptyTitle')}
                    body={t('kitchen:deliveryWindows.emptyBody')}
                    actions={
                        canManage ? (
                            <Button
                                testID="kitchen-windows-empty-add"
                                variant="secondary"
                                iconStart={<Icon name="plus" />}
                                label={t('kitchen:windows.add')}
                                onPress={addRow}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-windows-section"
                    title={title}
                    aside={
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:deliveryWindows.intro')}
                        </Text>
                    }
                >
                    <DeliveryWindowRows
                        testID="kitchen-windows-rows"
                        rows={rows}
                        errors={rowErrors}
                        canManage={canManage}
                        onChange={edit}
                        onAdd={addRow}
                        zonesCell={(row) => {
                            const zoneIds =
                                row.id === null
                                    ? []
                                    : (savedById.get(String(row.id))?.zoneIds ?? []);
                            return zoneIds.length === 0 ? (
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:deliveryWindows.noZones')}
                                </Text>
                            ) : (
                                <Text variant="caption" numberOfLines={2}>
                                    {zoneIds
                                        .map(
                                            (id) =>
                                                zoneNames.get(String(id)) ??
                                                t('kitchen:deliveryWindows.unknownZone'),
                                        )
                                        .join(t('kitchen:common.listSeparator'))}
                                </Text>
                            );
                        }}
                    />
                </FormSection>
            )}

            <EditorGuardDialogs testID="kitchen-windows-screen" guard={guard} />
        </Cascade>
    );
}
