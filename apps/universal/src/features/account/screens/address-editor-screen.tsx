import type { CustomerAddress, SaveAddressRequest } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Checkbox,
    EmptyState,
    Heading,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useAddAddressMutation,
    useAddressesQuery,
    useServiceAreasQuery,
    useUpdateAddressMutation,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';

/**
 * `/customer/account/addresses/{address}` — one address, added or amended.
 *
 * `{address}` is the identifier, or the literal `new`. One route rather than a `new.tsx` beside a
 * `[address].tsx`, because the two screens differ in exactly one thing — whether the fields start
 * empty — and a second file would be a copy of this one with a different mutation at the bottom.
 *
 * ## The area is a foreign key, so it is a list and never a text field
 *
 * `CustomerAddress.areaId` points at the platform's service areas, and the store refuses an area it
 * does not know rather than guessing from a typed name. That refusal is the whole point: matching
 * "Jumeirah" against a delivery zone by string is how an order gets accepted for somewhere nobody
 * drives to. So the control is a searchable {@link Select} over the closed list — twenty-four
 * entries across two markets, which is exactly the size where a type-ahead earns its place and a
 * free-text box would be a liability.
 *
 * ## The out-of-zone notice is a warning, and warnings here do not block
 *
 * An area being on the platform's list means the platform serves it. It does **not** mean every
 * kitchen delivers to it, and this screen cannot know which ones do: coverage is a property of a
 * kitchen's delivery zones, which are read at checkout against a basket that does not exist yet.
 * Blocking a save on a question the screen cannot answer would strand somebody with a perfectly
 * valid address; saying nothing would let them discover it at checkout. So it says so, and saves.
 *
 * ## Validation is the two fields the server requires, and no more
 *
 * `SaveAddressRequest` requires a label, an area and a first line. Building, floor and the driver's
 * directions are optional in the contract and are optional here — a form that demanded a floor
 * number from somebody in a villa would be inventing a requirement to look thorough.
 */

const TEST_ID = 'address-editor';

/** The literal that means "this is a new address" in the route parameter. */
export const NEW_ADDRESS_PARAM = 'new';

export interface AddressEditorScreenProps {
    /** The route's `{address}` — an identifier, or `new`. */
    readonly addressId?: string | undefined;
}

interface Draft {
    readonly label: string;
    readonly areaId: string | null;
    readonly line1: string;
    readonly line2: string;
    readonly building: string;
    readonly floor: string;
    readonly notes: string;
    readonly makeDefault: boolean;
}

const EMPTY_DRAFT: Draft = {
    label: '',
    areaId: null,
    line1: '',
    line2: '',
    building: '',
    floor: '',
    notes: '',
    makeDefault: false,
};

function draftFrom(address: CustomerAddress): Draft {
    return {
        label: address.label,
        areaId: address.areaId,
        line1: address.line1,
        line2: address.line2 ?? '',
        building: address.building ?? '',
        floor: address.floor ?? '',
        notes: address.notes ?? '',
        makeDefault: address.isDefault,
    };
}

/** Empty optional fields are omitted rather than sent as `''` — the contract's optionals are absent. */
function toRequest(draft: Draft): SaveAddressRequest | null {
    if (draft.areaId === null) return null;
    const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
    return {
        label: draft.label.trim(),
        areaId: draft.areaId as ServiceAreaId,
        line1: draft.line1.trim(),
        ...(optional(draft.line2) === undefined ? {} : { line2: optional(draft.line2) }),
        ...(optional(draft.building) === undefined ? {} : { building: optional(draft.building) }),
        ...(optional(draft.floor) === undefined ? {} : { floor: optional(draft.floor) }),
        ...(optional(draft.notes) === undefined ? {} : { notes: optional(draft.notes) }),
        makeDefault: draft.makeDefault,
    };
}

export function AddressEditorScreen({ addressId }: AddressEditorScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const creating = addressId === undefined || addressId === NEW_ADDRESS_PARAM;

    const addresses = useAddressesQuery(!creating);
    const areas = useServiceAreasQuery();
    const add = useAddAddressMutation();
    const update = useUpdateAddressMutation();

    const existing = creating
        ? undefined
        : (addresses.data ?? []).find((candidate) => candidate.id === addressId);

    /**
     * The draft, seeded from the loaded address the first time it arrives.
     *
     * Held together with the identifier it was seeded from so the seeding is *derived* rather than
     * pushed by an effect. An effect would re-run on the refetch that follows a save and would
     * overwrite whatever the person had typed since.
     */
    const [edited, setEdited] = useState<{ readonly draft: Draft; readonly from: string } | null>(
        null,
    );
    const seededFrom = existing?.id ?? NEW_ADDRESS_PARAM;
    const draft =
        edited !== null && edited.from === seededFrom
            ? edited.draft
            : existing === undefined
              ? EMPTY_DRAFT
              : draftFrom(existing);

    const [submitted, setSubmitted] = useState(false);

    const set = (patch: Partial<Draft>) => {
        setEdited({ draft: { ...draft, ...patch }, from: seededFrom });
    };

    const missing = {
        label: draft.label.trim() === '',
        areaId: draft.areaId === null,
        line1: draft.line1.trim() === '',
    };
    const invalid = missing.label || missing.areaId || missing.line1;
    const errorFor = (field: keyof typeof missing) =>
        submitted && missing[field] ? t('account:addresses.requiredField') : undefined;

    const saveFailure = toFailure(add.error) ?? toFailure(update.error);
    const saving = add.isPending || update.isPending;

    const chosenArea = (areas.data ?? []).find((area) => area.id === draft.areaId);

    const save = () => {
        setSubmitted(true);
        const request = toRequest(draft);
        if (invalid || request === null) return;

        const onSuccess = () => {
            router.push('/customer/account/addresses' as never);
        };

        if (creating) {
            add.mutate(request, { onSuccess });
        } else if (addressId !== undefined) {
            update.mutate({ addressId, request }, { onSuccess });
        }
    };

    /**
     * An identifier that names nothing.
     *
     * Reached by a stale link, a bookmark, or an address deleted in another tab. Without this the
     * screen would draw an empty *add* form under an "Edit address" heading and then fail the save
     * with `resource.not_found` — a person would have filled seven fields before being told the
     * thing they were editing is gone.
     */
    const missingAddress = !creating && !addresses.isPending && existing === undefined;

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {creating ? t('account:addresses.add') : t('account:addresses.edit')}
                </Heading>
                <Text tone="secondary">{t('account:addresses.subtitle')}</Text>
            </Stack>

            {missingAddress ? (
                <EmptyState
                    testID={`${TEST_ID}-missing`}
                    title={t('account:addresses.missingTitle')}
                    body={t('account:addresses.missingBody')}
                    actions={
                        <Button
                            testID={`${TEST_ID}-missing-back`}
                            label={t('account:addresses.backToList')}
                            onPress={() => {
                                router.push('/customer/account/addresses' as never);
                            }}
                        />
                    }
                />
            ) : null}

            {saveFailure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={saveFailure.message}
                />
            )}

            {missingAddress ? null : (
                <QueryStates
                    query={areas}
                    isEmpty={(areas.data ?? []).length === 0}
                    emptyTitle={t('account:addresses.noAreasTitle')}
                    emptyBody={t('account:addresses.noAreasBody')}
                    skeletonCount={1}
                    testID={`${TEST_ID}-areas`}
                >
                    <Card padding="md">
                        <Stack space="sm">
                            <TextInputField
                                testID={`${TEST_ID}-label`}
                                label={t('account:addresses.labelLabel')}
                                placeholder={t('account:addresses.labelPlaceholder')}
                                value={draft.label}
                                required
                                onChangeText={(label: string) => {
                                    set({ label });
                                }}
                                {...(errorFor('label') === undefined
                                    ? {}
                                    : { error: errorFor('label') })}
                            />

                            <Select
                                testID={`${TEST_ID}-area`}
                                label={t('account:addresses.areaLabel')}
                                hint={t('account:addresses.areaHint')}
                                placeholder={t('account:addresses.areaPlaceholder')}
                                searchable
                                required
                                value={draft.areaId}
                                options={(areas.data ?? []).map((area) => ({
                                    value: String(area.id),
                                    label: area.name,
                                }))}
                                onChange={(areaId) => {
                                    set({ areaId });
                                }}
                                {...(errorFor('areaId') === undefined
                                    ? {}
                                    : { error: errorFor('areaId') })}
                            />

                            {chosenArea === undefined ? null : (
                                <Callout
                                    testID={`${TEST_ID}-coverage`}
                                    role="note"
                                    tone="info"
                                    title={t('account:addresses.coverageTitle')}
                                    body={t('account:addresses.coverageBody', {
                                        area: chosenArea.name,
                                    })}
                                />
                            )}

                            <TextInputField
                                testID={`${TEST_ID}-line1`}
                                label={t('account:addresses.line1Label')}
                                value={draft.line1}
                                required
                                onChangeText={(line1: string) => {
                                    set({ line1 });
                                }}
                                {...(errorFor('line1') === undefined
                                    ? {}
                                    : { error: errorFor('line1') })}
                            />

                            <TextInputField
                                testID={`${TEST_ID}-line2`}
                                label={t('account:addresses.line2Label')}
                                value={draft.line2}
                                onChangeText={(line2: string) => {
                                    set({ line2 });
                                }}
                            />

                            <TextInputField
                                testID={`${TEST_ID}-building`}
                                label={t('account:addresses.buildingLabel')}
                                value={draft.building}
                                onChangeText={(building: string) => {
                                    set({ building });
                                }}
                            />

                            <TextInputField
                                testID={`${TEST_ID}-floor`}
                                label={t('account:addresses.floorLabel')}
                                value={draft.floor}
                                onChangeText={(floor: string) => {
                                    set({ floor });
                                }}
                            />

                            <TextInputField
                                testID={`${TEST_ID}-notes`}
                                label={t('account:addresses.notesLabel')}
                                hint={t('account:addresses.notesHint')}
                                value={draft.notes}
                                multiline
                                onChangeText={(notes: string) => {
                                    set({ notes });
                                }}
                            />

                            <Checkbox
                                testID={`${TEST_ID}-default`}
                                label={t('account:addresses.makeDefault')}
                                checked={draft.makeDefault}
                                onChange={(makeDefault) => {
                                    set({ makeDefault });
                                }}
                            />

                            <Inline space="sm">
                                <Button
                                    testID={`${TEST_ID}-save`}
                                    label={t('account:addresses.save')}
                                    loading={saving}
                                    onPress={save}
                                />
                                <Button
                                    testID={`${TEST_ID}-cancel`}
                                    variant="secondary"
                                    label={t('common:action.cancel')}
                                    onPress={() => {
                                        router.push('/customer/account/addresses' as never);
                                    }}
                                />
                            </Inline>
                        </Stack>
                    </Card>
                </QueryStates>
            )}
        </Stack>
    );
}
