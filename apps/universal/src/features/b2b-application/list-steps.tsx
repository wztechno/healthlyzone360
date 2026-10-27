import { B2B_CONTACT_ROLES } from '@healthy360/api-client/contracts';
import type {
    B2BApplication,
    B2BApplicationContact,
    B2BApplicationLocation,
    B2BContactRole,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServiceAreasQuery } from '../../data/account-hooks.ts';
import { validateContacts, validateLocations } from './sections.ts';
import type { ListErrors } from './sections.ts';

/**
 * The two wizard steps that edit a list rather than a section: contacts and delivery locations.
 *
 * ## The whole list goes, every time
 *
 * Both are replaced whole on the server (`replaceContacts`, `replaceLocations`), so the form is the
 * list: what is on screen when the person saves is what the server will hold, and a row they removed
 * is a row the server removes. The draft is seeded once from the server's rows, for the reason the
 * section steps seed theirs lazily — a refetch landing mid-typing must not wipe a field.
 *
 * ## Fields this form does not draw still round-trip
 *
 * A contact's `notes`, a location's country, site contact and driver notes are carried on the row
 * and sent back untouched. A replace that dropped them would delete what somebody else — a reviewer
 * reading the application, a later version of this form — had put there.
 */

const TEST_ID = 'b2b-apply-step';

/** What the form holds per contact: every text a string, so a cleared input is `''`, not a gap. */
interface ContactRow {
    readonly role: B2BContactRole;
    readonly name: string;
    readonly title: string;
    readonly email: string;
    readonly phone: string;
    readonly notes: string;
}

interface LocationRow {
    readonly label: string;
    readonly deliveryAreaId: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string;
    readonly city: string;
    readonly countryCode: string;
    readonly contactName: string;
    readonly contactPhone: string;
    readonly deliveryNotes: string;
    readonly isPrimary: boolean;
    readonly isBillingAddress: boolean;
    readonly expectedHeadcount: number | null;
}

function contactRow(contact: B2BApplicationContact): ContactRow {
    return {
        role: contact.role,
        name: contact.name,
        title: contact.title ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        notes: contact.notes ?? '',
    };
}

function locationRow(location: B2BApplicationLocation): LocationRow {
    return {
        ...location,
        addressLine2: location.addressLine2 ?? '',
        city: location.city ?? '',
        countryCode: location.countryCode ?? '',
        contactName: location.contactName ?? '',
        contactPhone: location.contactPhone ?? '',
        deliveryNotes: location.deliveryNotes ?? '',
    };
}

const EMPTY_LOCATION: LocationRow = {
    label: '',
    deliveryAreaId: null,
    addressLine1: '',
    addressLine2: '',
    city: '',
    countryCode: '',
    contactName: '',
    contactPhone: '',
    deliveryNotes: '',
    isPrimary: false,
    isBillingAddress: false,
    expectedHeadcount: null,
};

/** Replace one row of a list immutably. */
function patched<T>(rows: readonly T[], index: number, change: Partial<T>): readonly T[] {
    return rows.map((row, at) => (at === index ? { ...row, ...change } : row));
}

function useReason() {
    const { t } = useTranslation();
    return (reason: string | undefined): string | undefined =>
        reason === undefined ? undefined : t(`b2bApplication:validation.${reason}`);
}

/* ── contacts ─────────────────────────────────────────────────────────────────────────────────── */

export interface ContactsStepProps {
    readonly application: B2BApplication;
    readonly saving: boolean;
    readonly onSave: (contacts: readonly B2BApplicationContact[]) => void;
}

export function ContactsStep({ application, saving, onSave }: ContactsStepProps) {
    const { t } = useTranslation();
    const reason = useReason();

    const [rows, setRows] = useState<readonly ContactRow[]>(() =>
        application.contacts.length === 0
            ? // An empty list starts with the one row the step asks for, already the primary.
              [{ role: 'primary', name: '', title: '', email: '', phone: '', notes: '' }]
            : application.contacts.map(contactRow),
    );
    const [errors, setErrors] = useState<ListErrors | null>(null);

    // One contact per role is the server's rule, so the four roles are also the most rows there
    // can be. A new row takes the first role nobody holds yet.
    const freeRole = B2B_CONTACT_ROLES.find((role) => !rows.some((row) => row.role === role));
    const roleOptions = B2B_CONTACT_ROLES.map((role) => ({
        value: role,
        label: t(`b2bApplication:contacts.roles.${role}`),
    }));

    return (
        <Stack space="md" testID={`${TEST_ID}-contacts`}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-heading`}>
                    {t('b2bApplication:contacts.title')}
                </Heading>
                <Text tone="secondary">{t('b2bApplication:contacts.description')}</Text>
            </Stack>

            {errors === null || errors.list === null ? null : (
                <Callout
                    testID={`${TEST_ID}-contacts-list-error`}
                    tone="danger"
                    role="alert"
                    title={t(`b2bApplication:validation.${errors.list}`)}
                />
            )}

            {rows.map((row, index) => {
                const rowID = `${TEST_ID}-contact-${String(index)}`;
                const rowErrors = errors?.rows[index] ?? {};
                const set = (change: Partial<ContactRow>) => {
                    setRows((previous) => patched(previous, index, change));
                };
                const error = (field: string) => {
                    const message = reason(rowErrors[field]);
                    return message === undefined ? {} : { error: message };
                };

                return (
                    <Card
                        key={index}
                        testID={rowID}
                        title={t('b2bApplication:contacts.rowTitle', { position: index + 1 })}
                    >
                        <Stack space="sm">
                            <Select
                                testID={`${rowID}-role`}
                                id={`${rowID}-role`}
                                label={t('b2bApplication:contacts.fields.role')}
                                hint={t('b2bApplication:contacts.roleHint')}
                                required
                                options={roleOptions}
                                value={row.role}
                                onChange={(role) => {
                                    set({ role });
                                }}
                                {...error('role')}
                            />
                            <TextInputField
                                testID={`${rowID}-name`}
                                id={`${rowID}-name`}
                                label={t('b2bApplication:contacts.fields.name')}
                                placeholder={t('b2bApplication:fields.signatoryNamePlaceholder')}
                                required
                                value={row.name}
                                onChangeText={(name) => {
                                    set({ name });
                                }}
                                {...error('name')}
                            />
                            <TextInputField
                                testID={`${rowID}-title`}
                                id={`${rowID}-title`}
                                label={t('b2bApplication:contacts.fields.title')}
                                placeholder={t('b2bApplication:fields.signatoryTitlePlaceholder')}
                                value={row.title}
                                onChangeText={(title) => {
                                    set({ title });
                                }}
                                {...error('title')}
                            />
                            <TextInputField
                                testID={`${rowID}-email`}
                                id={`${rowID}-email`}
                                label={t('b2bApplication:contacts.fields.email')}
                                placeholder={t('b2bApplication:fields.signatoryEmailPlaceholder')}
                                hint={t('b2bApplication:contacts.reachHint')}
                                inputMode="email"
                                value={row.email}
                                onChangeText={(email) => {
                                    set({ email });
                                }}
                                {...error('email')}
                            />
                            <TextInputField
                                testID={`${rowID}-phone`}
                                id={`${rowID}-phone`}
                                label={t('b2bApplication:contacts.fields.phone')}
                                placeholder={t('b2bApplication:fields.signatoryPhonePlaceholder')}
                                inputMode="tel"
                                value={row.phone}
                                onChangeText={(phone) => {
                                    set({ phone });
                                }}
                                {...error('phone')}
                            />
                            <Button
                                testID={`${rowID}-remove`}
                                variant="ghost"
                                size="sm"
                                label={t('b2bApplication:contacts.remove')}
                                onPress={() => {
                                    setRows((previous) => previous.filter((_, at) => at !== index));
                                    setErrors(null);
                                }}
                            />
                        </Stack>
                    </Card>
                );
            })}

            {rows.length === 0 ? (
                <Text testID={`${TEST_ID}-contacts-empty`} tone="secondary">
                    {t('b2bApplication:contacts.empty')}
                </Text>
            ) : null}

            {freeRole === undefined ? null : (
                <Button
                    testID={`${TEST_ID}-contacts-add`}
                    variant="secondary"
                    label={t('b2bApplication:contacts.add')}
                    onPress={() => {
                        setRows((previous) => [
                            ...previous,
                            {
                                role: freeRole,
                                name: '',
                                title: '',
                                email: '',
                                phone: '',
                                notes: '',
                            },
                        ]);
                    }}
                />
            )}

            <Button
                testID={`${TEST_ID}-save`}
                label={t('b2bApplication:wizard.save')}
                loading={saving}
                onPress={() => {
                    const result = validateContacts(rows);
                    if (!result.ok) {
                        setErrors(result.errors);
                        return;
                    }
                    setErrors(null);
                    onSave(result.value);
                }}
            />
        </Stack>
    );
}

/* ── locations ────────────────────────────────────────────────────────────────────────────────── */

export interface LocationsStepProps {
    readonly application: B2BApplication;
    readonly saving: boolean;
    readonly onSave: (locations: readonly B2BApplicationLocation[]) => void;
}

export function LocationsStep({ application, saving, onSave }: LocationsStepProps) {
    const { t } = useTranslation();
    const reason = useReason();
    const areas = useServiceAreasQuery();

    const [rows, setRows] = useState<readonly LocationRow[]>(() =>
        application.locations.length === 0
            ? [{ ...EMPTY_LOCATION, isPrimary: true }]
            : application.locations.map(locationRow),
    );
    const [errors, setErrors] = useState<ListErrors | null>(null);

    const areaOptions = (areas.data ?? []).map((area) => ({ value: area.id, label: area.name }));

    return (
        <Stack space="md" testID={`${TEST_ID}-locations`}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-heading`}>
                    {t('b2bApplication:locations.title')}
                </Heading>
                <Text tone="secondary">{t('b2bApplication:locations.description')}</Text>
            </Stack>

            {errors === null || errors.list === null ? null : (
                <Callout
                    testID={`${TEST_ID}-locations-list-error`}
                    tone="danger"
                    role="alert"
                    title={t(`b2bApplication:validation.${errors.list}`)}
                />
            )}

            {rows.map((row, index) => {
                const rowID = `${TEST_ID}-location-${String(index)}`;
                const rowErrors = errors?.rows[index] ?? {};
                const set = (change: Partial<LocationRow>) => {
                    setRows((previous) => patched(previous, index, change));
                };
                const error = (field: string) => {
                    const message = reason(rowErrors[field]);
                    return message === undefined ? {} : { error: message };
                };

                return (
                    <Card
                        key={index}
                        testID={rowID}
                        title={t('b2bApplication:locations.rowTitle', { position: index + 1 })}
                    >
                        <Stack space="sm">
                            <TextInputField
                                testID={`${rowID}-label`}
                                id={`${rowID}-label`}
                                label={t('b2bApplication:locations.fields.label')}
                                placeholder={t('b2bApplication:locations.fields.labelPlaceholder')}
                                required
                                value={row.label}
                                onChangeText={(label) => {
                                    set({ label });
                                }}
                                {...error('label')}
                            />
                            <Select
                                testID={`${rowID}-area`}
                                id={`${rowID}-area`}
                                label={t('b2bApplication:locations.fields.deliveryArea')}
                                placeholder={t(
                                    'b2bApplication:locations.fields.deliveryAreaPlaceholder',
                                )}
                                loading={areas.isPending}
                                searchable
                                options={areaOptions}
                                value={row.deliveryAreaId}
                                onChange={(deliveryAreaId) => {
                                    set({ deliveryAreaId });
                                }}
                                {...error('deliveryAreaId')}
                            />
                            <TextInputField
                                testID={`${rowID}-line1`}
                                id={`${rowID}-line1`}
                                label={t('b2bApplication:locations.fields.addressLine1')}
                                placeholder={t(
                                    'b2bApplication:locations.fields.addressLine1Placeholder',
                                )}
                                required
                                value={row.addressLine1}
                                onChangeText={(addressLine1) => {
                                    set({ addressLine1 });
                                }}
                                {...error('addressLine1')}
                            />
                            <TextInputField
                                testID={`${rowID}-line2`}
                                id={`${rowID}-line2`}
                                label={t('b2bApplication:locations.fields.addressLine2')}
                                placeholder={t(
                                    'b2bApplication:locations.fields.addressLine2Placeholder',
                                )}
                                value={row.addressLine2}
                                onChangeText={(addressLine2) => {
                                    set({ addressLine2 });
                                }}
                                {...error('addressLine2')}
                            />
                            <TextInputField
                                testID={`${rowID}-city`}
                                id={`${rowID}-city`}
                                label={t('b2bApplication:locations.fields.city')}
                                placeholder={t('b2bApplication:locations.fields.cityPlaceholder')}
                                value={row.city}
                                onChangeText={(city) => {
                                    set({ city });
                                }}
                                {...error('city')}
                            />
                            <TextInputField
                                testID={`${rowID}-headcount`}
                                id={`${rowID}-headcount`}
                                label={t('b2bApplication:locations.fields.expectedHeadcount')}
                                placeholder={t(
                                    'b2bApplication:locations.fields.expectedHeadcountPlaceholder',
                                )}
                                inputMode="numeric"
                                value={
                                    row.expectedHeadcount === null
                                        ? ''
                                        : String(row.expectedHeadcount)
                                }
                                onChangeText={(next) => {
                                    const digits = next.replace(/\D/gu, '');
                                    set({
                                        expectedHeadcount:
                                            digits.length === 0 ? null : Number(digits),
                                    });
                                }}
                                {...error('expectedHeadcount')}
                            />
                            <Checkbox
                                testID={`${rowID}-primary`}
                                id={`${rowID}-primary`}
                                label={t('b2bApplication:locations.fields.isPrimary')}
                                checked={row.isPrimary}
                                onChange={(isPrimary) => {
                                    set({ isPrimary });
                                }}
                            />
                            <Checkbox
                                testID={`${rowID}-billing`}
                                id={`${rowID}-billing`}
                                label={t('b2bApplication:locations.fields.isBillingAddress')}
                                checked={row.isBillingAddress}
                                onChange={(isBillingAddress) => {
                                    set({ isBillingAddress });
                                }}
                            />
                            <Button
                                testID={`${rowID}-remove`}
                                variant="ghost"
                                size="sm"
                                label={t('b2bApplication:locations.remove')}
                                onPress={() => {
                                    setRows((previous) => previous.filter((_, at) => at !== index));
                                    setErrors(null);
                                }}
                            />
                        </Stack>
                    </Card>
                );
            })}

            {rows.length === 0 ? (
                <Text testID={`${TEST_ID}-locations-empty`} tone="secondary">
                    {t('b2bApplication:locations.empty')}
                </Text>
            ) : null}

            <Button
                testID={`${TEST_ID}-locations-add`}
                variant="secondary"
                label={t('b2bApplication:locations.add')}
                onPress={() => {
                    setRows((previous) => [...previous, EMPTY_LOCATION]);
                }}
            />

            <Button
                testID={`${TEST_ID}-save`}
                label={t('b2bApplication:wizard.save')}
                loading={saving}
                onPress={() => {
                    const result = validateLocations(rows);
                    if (!result.ok) {
                        setErrors(result.errors);
                        return;
                    }
                    setErrors(null);
                    onSave(result.value);
                }}
            />
        </Stack>
    );
}
