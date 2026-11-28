import type { SupplierContact, SupplierContactInput } from '@healthy360/api-client/contracts';
import { DataList, Stack, Text, TextInputField } from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import type { SupplierContactId } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DeskChip } from './desk-kit/desk-chip.tsx';
import { DeskRowMenu } from './desk-kit/desk-row-menu.tsx';
import { supplierContactRowTestId } from './ops-format.ts';
/**
 * The supplier contact editor (SUP1) — a set of contacts edited together and saved once.
 *
 * ## Why the whole set is one save
 *
 * A supplier's contacts are edited as a group: you add the new sales rep, promote them over the one
 * who left and delete the one who left, and any two of those three arriving at the server
 * separately leaves the supplier in a state nobody asked for. The endpoint is a set-replace for that
 * reason, and the screen therefore has exactly one **Save contacts** button. A save fired per
 * contact — or worse, on a keystroke — would send a set-replace that deletes the half-typed one
 * beside it.
 *
 * ## Why the local key is not the identifier
 *
 * A contact the person has just added has no identifier: the replace mints one on save. Every
 * contact therefore carries a locally-minted `key` used for React identity, test ids and the primary
 * flag, and `id` stays `null` until the server answers. That is also what makes the "update by id,
 * create without one" contract legible at the call site rather than inferred from a sentinel.
 *
 * ## Why there is no reorder control
 *
 * `display_order` exists so a set saved twice comes back the same way, not so a kitchen can rank its
 * contacts; the primary flag is what answers "who do I call first", and a Move-up action beside it
 * would offer a second, conflicting way to say the same thing. Position in the array is the order,
 * and the array is the order the contacts were added in.
 *
 * ## One line per contact (Buying canvas, 2026-11-15)
 *
 * A table, not a card per contact: the five fields on one line, **Main contact** inside the name's
 * own box, and Make main contact and Remove behind the row's `⋯`. What is wrong with a contact — no
 * way to reach them, or a field the server refused — is said on a line under the row, never under
 * one field: a message there would make that cell taller and move the row's other fields out of
 * line with it.
 */

export interface SupplierContactDraft {
    /** Locally minted, stable across a move or a re-render. Never the server identifier. */
    readonly key: string;
    /** The server's identifier, or `null` for a contact that has never been saved. */
    readonly id: SupplierContactId | null;
    readonly name: string;
    readonly roleTitle: string;
    readonly email: string;
    readonly phone: string;
    readonly whatsappPhone: string;
    readonly isPrimary: boolean;
}

/** A server contact as a draft. */
export function supplierContactDraft(contact: SupplierContact): SupplierContactDraft {
    return {
        key: String(contact.id),
        id: contact.id,
        name: contact.name,
        roleTitle: contact.roleTitle ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        whatsappPhone: contact.whatsappPhone ?? '',
        isPrimary: contact.isPrimary,
    };
}

/** An empty contact. `key` is the caller's — the screen mints them so they stay unique across adds. */
export function emptySupplierContact(key: string): SupplierContactDraft {
    return {
        key,
        id: null,
        name: '',
        roleTitle: '',
        email: '',
        phone: '',
        whatsappPhone: '',
        isPrimary: false,
    };
}

/** `true` once a contact can be reached at all — the rule the server refuses a set for breaking. */
export function supplierContactIsReachable(draft: SupplierContactDraft): boolean {
    return (
        draft.email.trim() !== '' || draft.phone.trim() !== '' || draft.whatsappPhone.trim() !== ''
    );
}

/**
 * `true` when every contact is named and reachable — what the Save control waits for.
 *
 * An empty set is valid: clearing a supplier's contacts is a legitimate edit, not an incomplete one.
 */
export function supplierContactsWellFormed(drafts: readonly SupplierContactDraft[]): boolean {
    return drafts.every((draft) => draft.name.trim() !== '' && supplierContactIsReachable(draft));
}

/**
 * The contacts as the replace endpoint wants them.
 *
 * `displayOrder` is the contact's position, so the order on screen is the order that comes back. An
 * emptied optional field is sent as `null` rather than as `''`: "no role title" and "a role title of
 * nothing" are not two states worth being able to tell apart.
 */
export function supplierContactInputs(
    drafts: readonly SupplierContactDraft[],
): readonly SupplierContactInput[] {
    return drafts.map((draft, index) => ({
        ...(draft.id === null ? {} : { id: draft.id }),
        name: draft.name.trim(),
        roleTitle: blankToNull(draft.roleTitle),
        email: blankToNull(draft.email),
        phone: blankToNull(draft.phone),
        whatsappPhone: blankToNull(draft.whatsappPhone),
        isPrimary: draft.isPrimary,
        displayOrder: index,
    }));
}

function blankToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** A contact's fields as the replace endpoint names them — `contacts.{n}.<field>` in a refusal. */
export type SupplierContactWireField = 'name' | 'role_title' | 'email' | 'phone' | 'whatsapp_phone';

export interface SupplierContactRowsProps {
    readonly rows: readonly SupplierContactDraft[];
    readonly canManage: boolean;
    readonly onChange: (next: SupplierContactDraft) => void;
    readonly onRemove: (draft: SupplierContactDraft) => void;
    /** Makes this contact the primary one and clears the flag everywhere else. */
    readonly onMakePrimary: (draft: SupplierContactDraft) => void;
    /** The server's message for one of a contact's fields, by its position and wire name (BUG-06). */
    readonly serverError?:
        ((index: number, field: SupplierContactWireField) => string | undefined) | undefined;
    readonly testID: string;
}

type ContactField = readonly [SupplierContactWireField, string, string];

/** Each field: its wire name, the id suffix every suite finds it by, and its label. */
const NAME_FIELD: ContactField = ['name', 'name', 'kitchen:ops.suppliers.fieldContactName'];
const ROLE_FIELD: ContactField = ['role_title', 'role', 'kitchen:ops.suppliers.fieldContactRole'];
const EMAIL_FIELD: ContactField = ['email', 'email', 'kitchen:ops.suppliers.fieldContactEmail'];
const PHONE_FIELD: ContactField = ['phone', 'phone', 'kitchen:ops.suppliers.fieldContactPhone'];
const WHATSAPP_FIELD: ContactField = [
    'whatsapp_phone',
    'whatsapp',
    'kitchen:ops.suppliers.fieldContactWhatsapp',
];
const FIELDS: readonly ContactField[] = [
    NAME_FIELD,
    ROLE_FIELD,
    EMAIL_FIELD,
    PHONE_FIELD,
    WHATSAPP_FIELD,
];

function valueOf(draft: SupplierContactDraft, field: SupplierContactWireField): string {
    switch (field) {
        case 'name':
            return draft.name;
        case 'role_title':
            return draft.roleTitle;
        case 'email':
            return draft.email;
        case 'phone':
            return draft.phone;
        case 'whatsapp_phone':
            return draft.whatsappPhone;
    }
}

function withValue(
    draft: SupplierContactDraft,
    field: SupplierContactWireField,
    value: string,
): SupplierContactDraft {
    switch (field) {
        case 'name':
            return { ...draft, name: value };
        case 'role_title':
            return { ...draft, roleTitle: value };
        case 'email':
            return { ...draft, email: value };
        case 'phone':
            return { ...draft, phone: value };
        case 'whatsapp_phone':
            return { ...draft, whatsappPhone: value };
    }
}

/**
 * The named contacts as one table.
 *
 * ```
 * NAME                           ROLE            EMAIL               TELEPHONE        WHATSAPP     ⋯
 * [Samir Haddad  (Main contact)] [Sales manager] [name@supplier.com] [+961 3 111 222] [+961 3 1…]  ⋯
 * [Karim Nassar                ] [Driver       ] [                 ] [              ] [         ]  ⋯
 *   Give this person an email address, a telephone number or a WhatsApp number.  <- the row's note
 * ```
 *
 * Every contact keeps the id it had as a card (`kitchen-supplier-contact-{key}`), and each field,
 * action and message keeps its suffix — `-name`, `-make-primary`, `-remove`, `-error`,
 * `-phone-error` — so what a suite presses is the same control, drawn on one line.
 */
export function SupplierContactRows({
    rows,
    canManage,
    onChange,
    onRemove,
    onMakePrimary,
    serverError,
    testID,
}: SupplierContactRowsProps) {
    const { t } = useTranslation();

    const placeholder: Readonly<Record<SupplierContactWireField, string>> = {
        name: t('kitchen:ops.suppliers.contactNamePlaceholder'),
        role_title: t('kitchen:ops.suppliers.contactRolePlaceholder'),
        email: t('kitchen:ops.suppliers.contactEmailPlaceholder'),
        phone: t('kitchen:ops.suppliers.phonePlaceholder'),
        whatsapp_phone: t('kitchen:ops.suppliers.contactWhatsappPlaceholder'),
    };

    const fieldColumn = (
        [field, suffix, labelKey]: ContactField,
        width: number,
        priority: number,
    ): DataListColumn<SupplierContactDraft> => ({
        key: suffix,
        label: t(labelKey),
        width,
        priority,
        ...(field === 'name' ? { fill: true } : { grow: false }),
        render: (draft) => {
            const id = `${supplierContactRowTestId(draft.key)}-${suffix}`;
            return (
                <View className="w-full py-tight">
                    <TextInputField
                        testID={id}
                        id={id}
                        size="sm"
                        label={t(labelKey)}
                        labelHidden
                        placeholder={placeholder[field]}
                        value={valueOf(draft, field)}
                        required={field === 'name'}
                        {...(field === 'email'
                            ? {
                                  keyboardType: 'email-address' as const,
                                  autoCapitalize: 'none' as const,
                              }
                            : field === 'phone' || field === 'whatsapp_phone'
                              ? { keyboardType: 'phone-pad' as const }
                              : {})}
                        disabled={!canManage}
                        // The main contact is said inside the name's own box, so the row stays
                        // one line tall.
                        trailing={
                            field === 'name' && draft.isPrimary ? (
                                <DeskChip
                                    testID={`${supplierContactRowTestId(draft.key)}-primary-badge`}
                                    tone="success"
                                    size="sm"
                                    label={t('kitchen:ops.suppliers.primaryContact')}
                                />
                            ) : undefined
                        }
                        onChangeText={(value) => {
                            onChange(withValue(draft, field, value));
                        }}
                    />
                </View>
            );
        },
    });

    const columns: readonly DataListColumn<SupplierContactDraft>[] = [
        fieldColumn(NAME_FIELD, NAME_TRACK, 100),
        fieldColumn(ROLE_FIELD, ROLE_TRACK, 99),
        fieldColumn(EMAIL_FIELD, EMAIL_TRACK, 98),
        fieldColumn(PHONE_FIELD, PHONE_TRACK, 97),
        fieldColumn(WHATSAPP_FIELD, PHONE_TRACK, 96),
        ...(canManage
            ? [
                  {
                      key: 'actions',
                      label: t('kitchen:list.actionHeader'),
                      // The ⋯ needs no visible heading in a 48px track; its name stays for a reader.
                      renderHeader: () => (
                          <View accessibilityLabel={t('kitchen:list.actionHeader')} />
                      ),
                      width: MENU_TRACK,
                      priority: 95,
                      grow: false,
                      align: 'end',
                      render: (draft: SupplierContactDraft) => {
                          const id = supplierContactRowTestId(draft.key);
                          return (
                              <DeskRowMenu
                                  testID={`${id}-menu`}
                                  label={t('kitchen:list.rowActions')}
                                  actions={[
                                      ...(draft.isPrimary
                                          ? []
                                          : [
                                                {
                                                    key: 'make-primary',
                                                    label: t('kitchen:ops.suppliers.makePrimary'),
                                                    icon: 'star' as const,
                                                    testID: `${id}-make-primary`,
                                                    onSelect: () => {
                                                        onMakePrimary(draft);
                                                    },
                                                },
                                            ]),
                                      {
                                          key: 'remove',
                                          label: t('kitchen:rows.remove'),
                                          icon: 'trash',
                                          tone: 'danger',
                                          testID: `${id}-remove`,
                                          onSelect: () => {
                                              onRemove(draft);
                                          },
                                      },
                                  ]}
                              />
                          );
                      },
                  } satisfies DataListColumn<SupplierContactDraft>,
              ]
            : []),
    ];

    return (
        <DataList<SupplierContactDraft>
            testID={testID}
            label={t('kitchen:ops.suppliers.sectionContacts')}
            columns={columns}
            rows={rows}
            rowKey={(draft) => draft.key}
            density="sm"
            framed
            rowNote={(draft) => {
                const id = supplierContactRowTestId(draft.key);
                const index = rows.findIndex((entry) => entry.key === draft.key);
                const refused = FIELDS.flatMap(([field, suffix, labelKey]) => {
                    const message = serverError?.(index, field);
                    return message === undefined ? [] : [{ suffix, labelKey, message }];
                });
                const unreachable = !supplierContactIsReachable(draft);
                if (!unreachable && refused.length === 0) return null;
                return (
                    <Stack space="none">
                        {/*
                         * A refusal stated where it can still be acted on, rather than after a
                         * failed save. The server enforces the same rule with a 422; this is the
                         * same sentence, earlier.
                         */}
                        {unreachable ? (
                            <Text
                                testID={`${id}-error`}
                                role="alert"
                                tone="danger"
                                variant="caption"
                            >
                                {t('kitchen:ops.suppliers.contactNeedsChannel')}
                            </Text>
                        ) : null}
                        {refused.map(({ suffix, labelKey, message }) => (
                            <Text
                                key={suffix}
                                testID={`${id}-${suffix}-error`}
                                role="alert"
                                tone="danger"
                                variant="caption"
                            >
                                {`${t(labelKey)}: ${message}`}
                            </Text>
                        ))}
                    </Stack>
                );
            }}
        />
    );
}

/**
 * The tracks: each box's width plus the cell's own `px-control-sm` (8 + 8). The name takes the
 * row's slack; at their floor the six fit an 1100px panel.
 */
const CELL_PADDING = 16;
const NAME_TRACK = 220;
const ROLE_TRACK = 160 + CELL_PADDING;
const EMAIL_TRACK = 200 + CELL_PADDING;
const PHONE_TRACK = 150 + CELL_PADDING;
/** The `⋯`'s 28px target and the cell's padding. */
const MENU_TRACK = 48;
