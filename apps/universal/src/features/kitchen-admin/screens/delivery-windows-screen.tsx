import type { DeliveryWindow } from '@healthy360/api-client/contracts';
import {
    Button,
    Cascade,
    Dialog,
    EmptyState,
    ErrorState,
    FormSection,
    FormSkeleton,
    Icon,
    IssueTrayFrame,
    Text,
    useIssueTrayController,
    useToast,
} from '@healthy360/design-system';
import type { IssueCardItem, IssueTrayContent } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAdminZonesQuery,
    useArchiveDeliveryWindowMutation,
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
import { focusSection } from '../field-focus.ts';
import { displayName } from '../format.ts';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import { useNudgeOnRefusal } from '../tray-nudge.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/delivery-windows` — the kitchen's delivery slots, org-wide.
 *
 * A window is a kitchen record; a zone only chooses which windows it offers (its own Delivery
 * windows tab). So this page edits names, days, hours and whether a window is offered at all, and
 * shows — read-only — the zones that offer each one. A new window is offered in no zone.
 *
 * Save writes row by row: a new row is created, a changed row is patched, and a row nobody touched
 * is never sent. There is no delete: a window is withdrawn with Offered → No, or archived — off this
 * list and out of every zone for good, still named on the orders that used it.
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

/** The windows still on the list: an archived one is served only so past orders can name it. */
function draftsFrom(windows: readonly DeliveryWindow[]): readonly DeliveryWindowDraft[] {
    return windows
        .filter((window) => window.archivedAt === null)
        .map((window) => ({
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
    const archive = useArchiveDeliveryWindowMutation();
    /** The saved row whose archive is being confirmed. */
    const [archiving, setArchiving] = useState<DeliveryWindowDraft | null>(null);
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    // The page's issue tray; a refused save or archive opens it.
    const issueTray = useIssueTrayController();
    const { nudge: nudgeTray } = issueTray;
    useNudgeOnRefusal(save.error, nudgeTray);
    useNudgeOnRefusal(archive.error, nudgeTray);

    const [rows, setRows] = useState<readonly DeliveryWindowDraft[]>([]);
    const [rowsKey, setRowsKey] = useState<number | null>(null);
    const [dirty, setDirty] = useState(false);
    const [ordinal, setOrdinal] = useState(1);
    const [saving, setSaving] = useState(false);
    /** The row whose write the server refused — the one a field error belongs to. */
    const [failedKey, setFailedKey] = useState<string | null>(null);

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
            setFailedKey(null);
            let current = rows;
            let writing: string | null = null;
            try {
                for (const row of pending) {
                    writing = row.key;
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
                // `save.error` is the tray's card; the rows written so far stay written.
                setFailedKey(writing);
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
    /*
     * What the server refused, put on the fields of the row it was writing (BUG-06). The tray's
     * card carries whatever no field could.
     */
    const labelField = t('kitchen:windows.labelField');
    const rowId = `kitchen-windows-rows-row-${failedKey ?? ''}`;
    const server = serverFieldErrors(failedKey === null ? null : saveFailure, {
        name_en: {
            label: t('kitchen:bilingual.englishShort', { field: labelField }),
            fieldId: `${rowId}-label-en`,
        },
        name_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: labelField }),
            fieldId: `${rowId}-label-ar`,
        },
        weekdays: {
            label: t('kitchen:windows.weekdaysLabel'),
            fieldId: `${rowId}-weekdays`,
        },
        'weekdays.*': {
            label: t('kitchen:windows.weekdaysLabel'),
            fieldId: `${rowId}-weekdays`,
        },
        starts_at: {
            label: t('kitchen:windows.startsLabel'),
            fieldId: `${rowId}-starts`,
        },
        ends_at: {
            label: t('kitchen:windows.endsLabel'),
            fieldId: `${rowId}-ends`,
        },
        is_active: {
            label: t('kitchen:windows.activeLabel'),
            fieldId: `${rowId}-active`,
        },
    });

    /*
     * The page's problems, in its issue tray rather than in bands around the rows. A refused save
     * keeps the server's own words, and Fix goes to the first field it named, or to the rows; a
     * refused archive is an act that did not go through.
     */
    const firstRefused = server.items[0];
    const saveCards: IssueCardItem[] =
        saveFailure === null
            ? []
            : [
                  {
                      key: 'save-error',
                      tone: 'danger',
                      label: t('kitchen:windows.saveError'),
                      detail: server.unplaced ?? saveFailure.message,
                      action:
                          firstRefused !== undefined
                              ? { onPress: firstRefused.onPress }
                              : rows.length === 0
                                ? undefined
                                : {
                                      onPress: () => {
                                          focusSection('kitchen-windows-section');
                                      },
                                  },
                      testID: 'kitchen-windows-save-error',
                  },
              ];
    const archiveFailure = toFailure(archive.error);
    const failedCards: IssueCardItem[] =
        archiveFailure === null
            ? []
            : [
                  {
                      key: 'archive-error',
                      tone: 'danger',
                      label: t('kitchen:windows.archiveFailed'),
                      detail: archiveFailure.message,
                      testID: 'kitchen-windows-archive-error',
                  },
              ];
    const trayContent: IssueTrayContent = {
        title: t('kitchen:tray.title'),
        testID: 'kitchen-windows-tray',
        groups: [
            { key: 'save', title: t('kitchen:tray.groupSave'), items: saveCards },
            { key: 'failed', title: t('kitchen:tray.groupFailed'), items: failedCards },
        ],
    };

    return (
        <IssueTrayFrame tray={trayContent} controller={issueTray}>
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
                        nativeID="kitchen-windows-section"
                        title={title}
                        description={t('kitchen:deliveryWindows.intro')}
                    >
                        <DeliveryWindowRows
                            testID="kitchen-windows-rows"
                            rows={rows}
                            errors={rowErrors}
                            refused={
                                failedKey === null || !server.isValidation
                                    ? undefined
                                    : { key: failedKey, errorFor: server.errorFor }
                            }
                            canManage={canManage}
                            onChange={edit}
                            onAdd={addRow}
                            // Archiving writes straight away, so it waits until pending edits are saved.
                            onArchive={
                                dirty
                                    ? undefined
                                    : (row) => {
                                          archive.reset();
                                          setArchiving(row);
                                      }
                            }
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

                <Dialog
                    testID="kitchen-windows-archive-dialog"
                    open={archiving !== null}
                    onClose={() => {
                        setArchiving(null);
                    }}
                    title={t('kitchen:windows.archiveTitle')}
                    description={t('kitchen:windows.archiveBody')}
                    actions={
                        <>
                            <Button
                                testID="kitchen-windows-archive-cancel"
                                variant="quiet"
                                label={t('kitchen:common.cancel')}
                                onPress={() => {
                                    setArchiving(null);
                                }}
                            />
                            <Button
                                testID="kitchen-windows-archive-confirm"
                                variant="danger"
                                label={t('kitchen:windows.archiveConfirm')}
                                loading={archive.isPending}
                                onPress={() => {
                                    if (archiving?.id == null) return;
                                    const name = displayName(archiving.label, locale).value;
                                    archive.mutate(archiving.id, {
                                        onSuccess: () => {
                                            setArchiving(null);
                                            toast.show({
                                                testID: 'kitchen-windows-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:windows.archivedToast', {
                                                    name,
                                                }),
                                            });
                                        },
                                        onError: () => {
                                            setArchiving(null);
                                        },
                                    });
                                }}
                            />
                        </>
                    }
                />

                <EditorGuardDialogs testID="kitchen-windows-screen" guard={guard} />
            </Cascade>
        </IssueTrayFrame>
    );
}
