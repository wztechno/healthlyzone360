import type { LocalisedText, SupplierDetail } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { SupplierId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useArchiveSupplierMutation,
    useCreateSupplierMutation,
    useReplaceSupplierContactsMutation,
    useRestoreSupplierMutation,
    useSupplierQuery,
    useUpdateSupplierMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { INVENTORY_MANAGE_PERMISSION, INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { OpsRecordFrame } from '../ops-record-frame.tsx';
import {
    SupplierContactCard,
    emptySupplierContact,
    supplierContactDraft,
    supplierContactInputs,
    supplierContactsWellFormed,
} from '../supplier-contact-editor.tsx';
import type { SupplierContactDraft } from '../supplier-contact-editor.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/suppliers/{supplier}` and `/kitchen/suppliers/new` — the supplier record (SUP1).
 *
 * ## Two section-level saves, not one page save
 *
 * The record and the contact set are written by two different endpoints, and the screen says so:
 * the frame's Save writes the details, and Contacts carries its own **Save contacts**. That is the
 * plan's rule (§3.2) rather than a layout preference — the contact endpoint is a *set-replace*, so a
 * page-level save that fired it alongside every details edit would delete a contact card the person
 * was halfway through adding. Each section tracks its own dirty flag and the frame's unsaved guard
 * is the union of them, so leaving with either half unsaved still prompts.
 *
 * ## Why {@link OpsRecordFrame} rather than `EditorFrame`
 *
 * A supplier carries no `updatedAt`, no `updatedByName`, no status and no lock version. `EditorFrame`
 * renders a `draft` status badge and the words "never saved" for a null meta — on a supplier the
 * kitchen has bought from for two years, that would be a false Draft badge on a live record.
 *
 * ## Archived is read-only, and stays visible
 *
 * An archived supplier is not hidden: a receipt posted last month names it, and the screen
 * explaining that receipt needs the record. So the page renders in full, every field is locked, and
 * the only write offered is **Restore**. Editing an archived record and discovering on save that it
 * was refused would be worse than not offering the edit.
 *
 * ## Where slice 2 goes
 *
 * Supplied items are a third section below Contacts. Nothing is stubbed for it here — an empty
 * "Supplied items" heading today would promise a feature that does not exist — but the two sections
 * are independent cards with their own dirty flags and their own saves, so a third is an addition
 * rather than a restructure.
 */

export interface SupplierDetailScreenProps {
    /** The route parameter. `undefined` or `'new'` opens the create form. */
    readonly supplier?: string | undefined;
}

export function SupplierDetailScreen({ supplier }: SupplierDetailScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-supplier"
        >
            <SupplierDetailEditor supplier={supplier} />
        </Gate>
    );
}

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly code: string;
    readonly contactEmail: string;
    readonly contactPhone: string;
    readonly address: string;
    readonly paymentTerms: string;
    readonly leadTimeDays: string;
    readonly notes: string;
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    code: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    paymentTerms: '',
    leadTimeDays: '',
    notes: '',
};

function detailsFrom(record: SupplierDetail): DetailsDraft {
    return {
        name: record.name,
        code: record.code,
        contactEmail: record.contactEmail ?? '',
        contactPhone: record.contactPhone ?? '',
        address: record.address ?? '',
        paymentTerms: record.paymentTerms ?? '',
        leadTimeDays: record.leadTimeDays === null ? '' : String(record.leadTimeDays),
        notes: record.notes ?? '',
    };
}

function blankToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/**
 * The lead time as the wire wants it, or `undefined` when it cannot be read as one.
 *
 * A plain `TextInputField` with a numeric keyboard rather than a `NumberStepper`: the stepper's
 * `clampToStep` rounds what it is given, and a lead time typed as `10` becoming something else on
 * blur is the kind of silent correction a purchasing screen must not do. Anything unparseable is
 * `undefined`, which the caller turns into a validation refusal rather than a `null` that would
 * quietly clear a value the person meant to keep.
 */
function parseLeadTime(value: string): number | null | undefined {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return parsed > 365 ? undefined : parsed;
}

function SupplierDetailEditor({ supplier }: SupplierDetailScreenProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();
    const canManage = useCan(INVENTORY_MANAGE_PERMISSION);

    const isCreating = supplier === undefined || supplier === 'new';
    const parsed = isCreating ? null : SupplierId.safeParse(supplier);

    const record = useSupplierQuery(parsed);
    const create = useCreateSupplierMutation();
    const update = useUpdateSupplierMutation();
    const archive = useArchiveSupplierMutation();
    const restore = useRestoreSupplierMutation();
    const saveContacts = useReplaceSupplierContactsMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [contacts, setContacts] = useState<readonly SupplierContactDraft[]>([]);
    const [contactsKey, setContactsKey] = useState<string | null>(null);
    const [contactsDirty, setContactsDirty] = useState(false);
    const [ordinal, setOrdinal] = useState(1);

    const [showArchive, setShowArchive] = useState(false);

    const data = record.data;
    // No lock version to key on, so the identifier plus the archive timestamp is what changes when
    // the server hands back a different record — enough to reseed the form after an archive or a
    // restore without stamping over an edit in progress.
    const serverKey = data === undefined ? null : `${String(data.id)}:${data.archivedAt ?? ''}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's values still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== contactsKey && !contactsDirty) {
        setContactsKey(serverKey);
        setContacts(data.contacts.map(supplierContactDraft));
    }

    const isArchived = data?.archivedAt != null;
    const editable = canManage && !isArchived;

    const takeKey = (): string => {
        const key = `new-${String(ordinal)}`;
        setOrdinal(ordinal + 1);
        return key;
    };

    const settle = (next: { readonly details?: boolean; readonly contacts?: boolean }) => {
        const after = {
            details: next.details ?? detailsDirty,
            contacts: next.contacts ?? contactsDirty,
        };
        setDetailsDirty(after.details);
        setContactsDirty(after.contacts);
        if (!after.details && !after.contacts) guard.markClean();
    };

    const editDetails = (next: DetailsDraft) => {
        setDetails(next);
        setDetailsDirty(true);
        guard.markDirty();
    };

    const editContacts = (next: readonly SupplierContactDraft[]) => {
        setContacts(next);
        setContactsDirty(true);
        guard.markDirty();
    };

    const leadTime = parseLeadTime(details.leadTimeDays);
    const nameMissing = details.name.en.trim() === '';
    const detailsBlocked = nameMissing || leadTime === undefined;

    function saveDetails() {
        if (!editable || detailsBlocked || leadTime === undefined) return;

        const fields = {
            nameEn: details.name.en.trim(),
            nameAr: blankToNull(details.name.ar),
            contactEmail: blankToNull(details.contactEmail),
            contactPhone: blankToNull(details.contactPhone),
            address: blankToNull(details.address),
            paymentTerms: blankToNull(details.paymentTerms),
            leadTimeDays: leadTime,
            notes: blankToNull(details.notes),
        };

        if (isCreating) {
            create.mutate(
                // An omitted code is what asks the server to mint one from the name.
                { ...fields, code: blankToNull(details.code) },
                {
                    onSuccess: (created) => {
                        settle({ details: false });
                        toast.show({
                            testID: 'kitchen-supplier-saved-toast',
                            tone: 'success',
                            message: t('kitchen:ops.suppliers.createdToast'),
                        });
                        router.replace(`/kitchen/suppliers/${String(created.id)}` as never);
                    },
                },
            );
            return;
        }

        if (parsed === null) return;

        update.mutate(
            // `code` is required on update — the server refuses an empty one — so a cleared box is
            // left alone rather than sent as a blank that would 422.
            {
                supplierId: parsed,
                request: {
                    ...fields,
                    ...(details.code.trim() === '' ? {} : { code: details.code.trim() }),
                },
            },
            {
                onSuccess: () => {
                    settle({ details: false });
                    toast.show({
                        testID: 'kitchen-supplier-saved-toast',
                        tone: 'success',
                        message: t('kitchen:ops.suppliers.savedToast'),
                    });
                },
            },
        );
    }

    function submitContacts() {
        if (!editable || parsed === null || !supplierContactsWellFormed(contacts)) return;

        saveContacts.mutate(
            { supplierId: parsed, request: { contacts: supplierContactInputs(contacts) } },
            {
                onSuccess: (saved) => {
                    // Reseeded from the response so freshly created cards pick up their server
                    // identifiers — without it a second save would create duplicates rather than
                    // updating the rows it just wrote.
                    setContacts(saved.map(supplierContactDraft));
                    settle({ contacts: false });
                    toast.show({
                        testID: 'kitchen-supplier-contacts-saved-toast',
                        tone: 'success',
                        message: t('kitchen:ops.suppliers.contactsSavedToast'),
                    });
                },
            },
        );
    }

    /* ── not found, loading and load failure ─────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-supplier-screen">
                <Callout
                    testID="kitchen-supplier-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:ops.suppliers.notFoundTitle')}
                    body={t('kitchen:ops.suppliers.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-supplier-not-found-back"
                            variant="quiet"
                            label={t('kitchen:ops.suppliers.backToList')}
                            onPress={() => {
                                router.push('/kitchen/suppliers' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-supplier-loading">
                <Skeleton testID="kitchen-supplier-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-supplier-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-supplier-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-supplier-screen">
                <ErrorState
                    testID="kitchen-supplier-load-error"
                    failure={loadFailure}
                    title={t('kitchen:ops.suppliers.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    const contactsFailure = toFailure(saveContacts.error);
    const contactsBlocked = !supplierContactsWellFormed(contacts);

    return (
        <OpsRecordFrame
            testID="kitchen-supplier-screen"
            title={
                isCreating
                    ? t('kitchen:ops.suppliers.createTitle')
                    : data === undefined
                      ? t('kitchen:ops.suppliers.editTitle')
                      : displayName(data.name, locale).value
            }
            guard={guard}
            onSave={saveDetails}
            saveLabel={t('kitchen:ops.suppliers.saveDetails')}
            saving={create.isPending || update.isPending}
            saveDisabled={!editable || detailsBlocked}
            hideSave={!canManage || isArchived}
            backLabel={t('kitchen:ops.suppliers.backToList')}
            onBack={() => {
                router.push('/kitchen/suppliers' as never);
            }}
            primaryAction={
                isCreating || !canManage ? null : isArchived ? (
                    <Button
                        testID="kitchen-supplier-restore"
                        variant="secondary"
                        label={t('kitchen:ops.suppliers.restore')}
                        loading={restore.isPending}
                        onPress={() => {
                            if (parsed === null) return;
                            restore.mutate(parsed, {
                                onSuccess: () => {
                                    toast.show({
                                        testID: 'kitchen-supplier-restored-toast',
                                        tone: 'success',
                                        message: t('kitchen:ops.suppliers.restoredToast'),
                                    });
                                },
                            });
                        }}
                    />
                ) : (
                    <Button
                        testID="kitchen-supplier-archive"
                        variant="secondary"
                        label={t('kitchen:list.archive')}
                        onPress={() => {
                            setShowArchive(true);
                        }}
                    />
                )
            }
            banner={
                <Stack space="sm">
                    {isArchived ? (
                        <Callout
                            testID="kitchen-supplier-archived"
                            role="note"
                            tone="info"
                            title={t('kitchen:ops.suppliers.archivedTitle')}
                            body={t('kitchen:ops.suppliers.archivedBody')}
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-supplier-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            <Stack space="lg">
                {/* ── 1. the record ────────────────────────────────────────────────────────── */}
                <Card testID="kitchen-supplier-details" padding="md">
                    <Stack space="md">
                        <Heading level={2}>{t('kitchen:ops.suppliers.sectionDetails')}</Heading>

                        <BilingualField
                            testID="kitchen-supplier-name"
                            fieldLabel={t('kitchen:ops.suppliers.fieldName')}
                            value={details.name}
                            requiredEnglish
                            disabled={!editable}
                            onChange={(name) => {
                                editDetails({ ...details, name });
                            }}
                            {...(nameMissing && detailsDirty
                                ? { englishError: t('kitchen:ops.suppliers.nameRequired') }
                                : {})}
                        />

                        <TextInputField
                            testID="kitchen-supplier-code"
                            label={t('kitchen:ops.suppliers.fieldCode')}
                            hint={
                                isCreating
                                    ? t('kitchen:ops.suppliers.codeMintHint')
                                    : t('kitchen:ops.suppliers.codeEditHint')
                            }
                            value={details.code}
                            autoCapitalize="characters"
                            disabled={!editable}
                            onChangeText={(code) => {
                                editDetails({ ...details, code });
                            }}
                        />

                        {/*
                         * Displayed, never picked. Every price in this system is booked in one
                         * currency (there is no exchange rate — `MixedIngredientCostCurrency`), so a
                         * picker here would offer a choice the receipt path then refuses.
                         */}
                        <Stack space="none" testID="kitchen-supplier-currency">
                            <Text variant="label">{t('kitchen:ops.suppliers.fieldCurrency')}</Text>
                            <Text testID="kitchen-supplier-currency-value">
                                {data?.currencyCode ?? t('kitchen:ops.suppliers.noCurrency')}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:ops.suppliers.currencyHint')}
                            </Text>
                        </Stack>

                        <TextInputField
                            testID="kitchen-supplier-email"
                            label={t('kitchen:ops.suppliers.fieldEmail')}
                            hint={t('kitchen:ops.suppliers.generalContactHint')}
                            value={details.contactEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            disabled={!editable}
                            onChangeText={(contactEmail) => {
                                editDetails({ ...details, contactEmail });
                            }}
                        />

                        <TextInputField
                            testID="kitchen-supplier-phone"
                            label={t('kitchen:ops.suppliers.fieldPhone')}
                            hint={t('kitchen:ops.suppliers.generalContactHint')}
                            value={details.contactPhone}
                            keyboardType="phone-pad"
                            disabled={!editable}
                            onChangeText={(contactPhone) => {
                                editDetails({ ...details, contactPhone });
                            }}
                        />

                        <TextInputField
                            testID="kitchen-supplier-address"
                            label={t('kitchen:ops.suppliers.fieldAddress')}
                            hint={t('kitchen:ops.suppliers.addressHint')}
                            value={details.address}
                            multiline
                            numberOfLines={3}
                            disabled={!editable}
                            onChangeText={(address) => {
                                editDetails({ ...details, address });
                            }}
                        />

                        <TextInputField
                            testID="kitchen-supplier-payment-terms"
                            label={t('kitchen:ops.suppliers.fieldPaymentTerms')}
                            hint={t('kitchen:ops.suppliers.paymentTermsHint')}
                            value={details.paymentTerms}
                            disabled={!editable}
                            onChangeText={(paymentTerms) => {
                                editDetails({ ...details, paymentTerms });
                            }}
                        />

                        <TextInputField
                            testID="kitchen-supplier-lead-time"
                            label={t('kitchen:ops.suppliers.fieldLeadTime')}
                            hint={t('kitchen:ops.suppliers.leadTimeHint')}
                            value={details.leadTimeDays}
                            keyboardType="number-pad"
                            disabled={!editable}
                            onChangeText={(leadTimeDays) => {
                                editDetails({ ...details, leadTimeDays });
                            }}
                            {...(leadTime === undefined
                                ? { error: t('kitchen:ops.suppliers.leadTimeInvalid') }
                                : {})}
                        />

                        <TextInputField
                            testID="kitchen-supplier-notes"
                            label={t('kitchen:ops.suppliers.fieldNotes')}
                            value={details.notes}
                            multiline
                            numberOfLines={3}
                            disabled={!editable}
                            onChangeText={(notes) => {
                                editDetails({ ...details, notes });
                            }}
                        />
                    </Stack>
                </Card>

                {/* ── 2. named contacts ────────────────────────────────────────────────────── */}
                {isCreating ? (
                    <Callout
                        testID="kitchen-supplier-contacts-after-save"
                        role="note"
                        tone="info"
                        title={t('kitchen:ops.suppliers.contactsAfterSaveTitle')}
                        body={t('kitchen:ops.suppliers.contactsAfterSaveBody')}
                    />
                ) : (
                    <Card testID="kitchen-supplier-contacts" padding="md">
                        <Stack space="md">
                            <Inline space="sm" align="center" justify="between" wrap>
                                <Heading level={2}>
                                    {t('kitchen:ops.suppliers.sectionContacts')}
                                </Heading>
                                {editable ? (
                                    <Button
                                        testID="kitchen-supplier-contacts-add"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:ops.suppliers.addContact')}
                                        onPress={() => {
                                            editContacts([
                                                ...contacts,
                                                emptySupplierContact(takeKey()),
                                            ]);
                                        }}
                                    />
                                ) : null}
                            </Inline>

                            <Text tone="secondary" variant="caption">
                                {t('kitchen:ops.suppliers.contactsHint')}
                            </Text>

                            {contactsFailure === null ? null : (
                                <Callout
                                    testID="kitchen-supplier-contacts-error"
                                    role="alert"
                                    tone="danger"
                                    title={t('kitchen:editor.saveError')}
                                    body={contactsFailure.message}
                                />
                            )}

                            {contacts.length === 0 ? (
                                <Text testID="kitchen-supplier-contacts-empty" tone="secondary">
                                    {t('kitchen:ops.suppliers.noContacts')}
                                </Text>
                            ) : (
                                <Stack space="sm">
                                    {contacts.map((draft, index) => (
                                        <SupplierContactCard
                                            key={draft.key}
                                            draft={draft}
                                            position={index + 1}
                                            total={contacts.length}
                                            canManage={editable}
                                            onChange={(next) => {
                                                editContacts(
                                                    contacts.map((candidate) =>
                                                        candidate.key === draft.key
                                                            ? next
                                                            : candidate,
                                                    ),
                                                );
                                            }}
                                            onRemove={() => {
                                                editContacts(
                                                    contacts.filter(
                                                        (candidate) => candidate.key !== draft.key,
                                                    ),
                                                );
                                            }}
                                            onMakePrimary={() => {
                                                // Cleared everywhere else in the same edit: the
                                                // server refuses a set with two primaries, and the
                                                // screen must not be able to build one.
                                                editContacts(
                                                    contacts.map((candidate) => ({
                                                        ...candidate,
                                                        isPrimary: candidate.key === draft.key,
                                                    })),
                                                );
                                            }}
                                        />
                                    ))}
                                </Stack>
                            )}

                            {/*
                             * One save for the whole section (§3.2). Deliberately not per card: the
                             * endpoint is a set-replace, so a save fired by one card would delete
                             * the card beside it that is still being typed.
                             */}
                            {editable ? (
                                <Inline space="sm" justify="end" wrap>
                                    <Button
                                        testID="kitchen-supplier-contacts-save"
                                        label={t('kitchen:ops.suppliers.saveContacts')}
                                        loading={saveContacts.isPending}
                                        disabled={contactsBlocked || saveContacts.isPending}
                                        onPress={submitContacts}
                                    />
                                </Inline>
                            ) : null}
                        </Stack>
                    </Card>
                )}
            </Stack>

            {/* ── archive ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-supplier-archive-dialog"
                open={showArchive}
                onClose={() => {
                    setShowArchive(false);
                }}
                title={t('kitchen:ops.suppliers.archiveTitle')}
                description={t('kitchen:ops.suppliers.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-supplier-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowArchive(false);
                            }}
                        />
                        <Button
                            testID="kitchen-supplier-archive-confirm"
                            variant="danger"
                            label={t('kitchen:ops.suppliers.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                if (parsed === null) return;
                                archive.mutate(parsed, {
                                    onSuccess: () => {
                                        setShowArchive(false);
                                        toast.show({
                                            testID: 'kitchen-supplier-archived-toast',
                                            tone: 'success',
                                            message: t('kitchen:ops.suppliers.archivedToast'),
                                        });
                                    },
                                });
                            }}
                        />
                    </>
                }
            >
                <Text testID="kitchen-supplier-archive-consequence">
                    {t('kitchen:ops.suppliers.archiveConsequence')}
                </Text>
            </Dialog>
        </OpsRecordFrame>
    );
}
