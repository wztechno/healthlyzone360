import type { SupplierContact, SupplierContactInput } from '@healthy360/api-client/contracts';
import { Badge, Button, Stack, Text, TextInputField } from '@healthy360/design-system';
import type { SupplierContactId } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';

import { supplierContactRowTestId } from './ops-format.ts';
import { RowShell } from './row-editor-shell.tsx';

/**
 * The supplier contact editor (SUP1) — a set of cards edited together and saved once.
 *
 * ## Why the whole set is one save
 *
 * A supplier's contacts are edited as a group: you add the new sales rep, promote them over the one
 * who left and delete the one who left, and any two of those three arriving at the server
 * separately leaves the supplier in a state nobody asked for. The endpoint is a set-replace for that
 * reason, and the screen therefore has exactly one **Save contacts** button. A save fired per card —
 * or worse, on a keystroke — would send a set-replace that deletes the half-typed card beside it.
 *
 * ## Why the local key is not the identifier
 *
 * A card the person has just added has no identifier: the replace mints one on save. Every card
 * therefore carries a locally-minted `key` used for React identity, test ids and the primary radio,
 * and `id` stays `null` until the server answers. That is also what makes the "update by id, create
 * without one" contract legible at the call site rather than inferred from a sentinel.
 *
 * ## Why there is no reorder control
 *
 * `RowShell` is used **without `onMove`**. `display_order` exists so a set saved twice comes back
 * the same way, not so a kitchen can rank its contacts; the primary flag is what answers "who do I
 * call first", and a Move-up button beside it would offer a second, conflicting way to say the same
 * thing. Position in the array is the order, and the array is the order the cards were added in.
 */

export interface SupplierContactDraft {
    /** Locally minted, stable across a move or a re-render. Never the server identifier. */
    readonly key: string;
    /** The server's identifier, or `null` for a card that has never been saved. */
    readonly id: SupplierContactId | null;
    readonly name: string;
    readonly roleTitle: string;
    readonly email: string;
    readonly phone: string;
    readonly whatsappPhone: string;
    readonly isPrimary: boolean;
}

/** A server contact as a draft card. */
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

/** An empty card. `key` is the caller's — the screen mints them so they stay unique across adds. */
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

/** `true` once a card can be reached at all — the rule the server refuses a set for breaking. */
export function supplierContactIsReachable(draft: SupplierContactDraft): boolean {
    return (
        draft.email.trim() !== '' || draft.phone.trim() !== '' || draft.whatsappPhone.trim() !== ''
    );
}

/**
 * `true` when every card is named and reachable — what the Save control waits for.
 *
 * An empty set is valid: clearing a supplier's contacts is a legitimate edit, not an incomplete one.
 */
export function supplierContactsWellFormed(drafts: readonly SupplierContactDraft[]): boolean {
    return drafts.every((draft) => draft.name.trim() !== '' && supplierContactIsReachable(draft));
}

/**
 * The cards as the replace endpoint wants them.
 *
 * `displayOrder` is the card's position, so the order on screen is the order that comes back. An
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

export interface SupplierContactCardProps {
    readonly draft: SupplierContactDraft;
    readonly position: number;
    readonly total: number;
    readonly canManage: boolean;
    readonly onChange: (next: SupplierContactDraft) => void;
    readonly onRemove: () => void;
    /** Makes this card the primary one and clears the flag everywhere else. */
    readonly onMakePrimary: () => void;
}

export function SupplierContactCard({
    draft,
    position,
    total,
    canManage,
    onChange,
    onRemove,
    onMakePrimary,
}: SupplierContactCardProps) {
    const { t } = useTranslation();
    const testID = supplierContactRowTestId(draft.key);
    const unreachable = !supplierContactIsReachable(draft);

    return (
        <RowShell
            testID={testID}
            title={t('kitchen:ops.suppliers.contactPosition', { position })}
            position={position}
            total={total}
            canManage={canManage}
            onRemove={onRemove}
            badge={
                draft.isPrimary ? (
                    <Badge
                        testID={`${testID}-primary-badge`}
                        tone="info"
                        label={t('kitchen:ops.suppliers.primaryContact')}
                    />
                ) : null
            }
        >
            <Stack space="sm">
                <TextInputField
                    testID={`${testID}-name`}
                    label={t('kitchen:ops.suppliers.fieldContactName')}
                    value={draft.name}
                    required
                    disabled={!canManage}
                    onChangeText={(value) => {
                        onChange({ ...draft, name: value });
                    }}
                />

                <TextInputField
                    testID={`${testID}-role`}
                    label={t('kitchen:ops.suppliers.fieldContactRole')}
                    value={draft.roleTitle}
                    disabled={!canManage}
                    onChangeText={(value) => {
                        onChange({ ...draft, roleTitle: value });
                    }}
                />

                <TextInputField
                    testID={`${testID}-email`}
                    label={t('kitchen:ops.suppliers.fieldContactEmail')}
                    value={draft.email}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    disabled={!canManage}
                    onChangeText={(value) => {
                        onChange({ ...draft, email: value });
                    }}
                />

                <TextInputField
                    testID={`${testID}-phone`}
                    label={t('kitchen:ops.suppliers.fieldContactPhone')}
                    value={draft.phone}
                    keyboardType="phone-pad"
                    disabled={!canManage}
                    onChangeText={(value) => {
                        onChange({ ...draft, phone: value });
                    }}
                />

                <TextInputField
                    testID={`${testID}-whatsapp`}
                    label={t('kitchen:ops.suppliers.fieldContactWhatsapp')}
                    hint={t('kitchen:ops.suppliers.whatsappHint')}
                    value={draft.whatsappPhone}
                    keyboardType="phone-pad"
                    disabled={!canManage}
                    onChangeText={(value) => {
                        onChange({ ...draft, whatsappPhone: value });
                    }}
                />

                {/*
                 * A refusal stated where it can still be acted on, rather than after a failed save.
                 * The server enforces the same rule with a 422; this is the same sentence, earlier.
                 */}
                {unreachable ? (
                    <Text testID={`${testID}-error`} role="alert" tone="danger" variant="caption">
                        {t('kitchen:ops.suppliers.contactNeedsChannel')}
                    </Text>
                ) : null}

                {canManage && !draft.isPrimary ? (
                    <Button
                        testID={`${testID}-make-primary`}
                        size="sm"
                        variant="ghost"
                        label={t('kitchen:ops.suppliers.makePrimary')}
                        onPress={onMakePrimary}
                    />
                ) : null}
            </Stack>
        </RowShell>
    );
}
