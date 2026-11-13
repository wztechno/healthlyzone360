import type {
    AccountServiceArea,
    CustomerAddress,
    SaveAddressRequest,
} from '@healthy360/api-client/contracts';
import {
    Callout,
    EmptyState,
    Button,
    Icon,
    TextInputField,
    cx,
    useToast,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ServiceAreaId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, TextInput, View } from 'react-native';

import {
    toFailure,
    useAddAddressMutation,
    useAddressesQuery,
    useContactPointsQuery,
    useServiceAreasQuery,
    useUpdateAddressMutation,
} from '../../../data/account-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useUnsavedGuard } from '../../../navigation/use-unsaved-guard.ts';
import { ShopSwitch } from '../../../ui/shop-switch.tsx';
import { UnsavedChangesDialog } from '../../../ui/unsaved-changes-dialog.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ACCOUNT_CARD } from '../account-card.tsx';
import { AddressMap } from '../address-map';
import { currentPhone } from '../account-profile-panel.tsx';

/**
 * `/customer/account/addresses/{address}` — one address, added or amended, as the accepted Account
 * board's address pane draws it: "Save it as" Home / Work / Other, the area picker, the street, the
 * building / floor / more-detail row, the driver's directions, the contact number, "Use as my
 * default", and beside it a preview card of the address as it will read.
 *
 * `{address}` is the identifier, or the literal `new`. One route rather than a `new.tsx` beside a
 * `[address].tsx`, because the two differ in exactly one thing — whether the fields start empty.
 *
 * ## The label is a choice first, and a name only when it is "Other"
 *
 * Most addresses are home or work, so those are two tiles; "Other" asks for a name. The label is
 * still the free text the contract stores: Home and Work save their word in the reader's language,
 * and an existing label that is neither reads as Other with its own name.
 *
 * ## The area is a foreign key, so it is a list and never a text field
 *
 * `CustomerAddress.areaId` points at the platform's service areas, and the store refuses an area it
 * does not know rather than guessing from a typed name — matching "Jumeirah" against a delivery zone
 * by string is how an order gets accepted for somewhere nobody drives to. So the control is the
 * board's searchable list over the closed set, opened in place under its field.
 *
 * ## Coverage is a note, never a gate
 *
 * An area being on the list means the platform serves it, not that every kitchen does: coverage is a
 * property of a kitchen's zones, read at checkout against a basket that does not exist yet. So the
 * preview says the area is served and that kitchens are matched when ordering, and the save is
 * never blocked on it.
 *
 * ## Validation is the fields the server requires, and no more
 *
 * A label, an area and a street. Building, floor and the directions are optional in the contract
 * and optional here — a form that demanded a floor from somebody in a villa would be inventing a
 * requirement to look thorough.
 *
 * ## Saving goes back to whoever sent the person here
 *
 * Checkout and plan setup open this with `?returnTo=` and get the person back the moment the address
 * is saved, with it chosen (`?address=`). Opened from the account, it returns to the address list.
 * Either way it is a `dismissTo`, so Back afterwards never reopens the submitted form.
 */

const TEST_ID = 'address-editor';

/** The literal that means "this is a new address" in the route parameter. */
export const NEW_ADDRESS_PARAM = 'new';

/** Where the editor returns when nothing sent it: the account's address list. */
export const ADDRESSES_HOME = '/customer/account?section=addresses';

export interface AddressEditorScreenProps {
    /** The route's `{address}` — an identifier, or `new`. */
    readonly addressId?: string | undefined;
    /** The route's `?returnTo=` — the page to go back to once the address is saved. */
    readonly returnTo?: string | undefined;
}

type LabelKind = 'home' | 'work' | 'other';

const LABEL_KINDS: readonly { readonly kind: LabelKind; readonly icon: IconName }[] = [
    { kind: 'home', icon: 'house' },
    { kind: 'work', icon: 'briefcase' },
    { kind: 'other', icon: 'plus' },
];

interface Draft {
    readonly kind: LabelKind;
    /** The typed name; read only when the kind is "other". */
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
    kind: 'home',
    label: '',
    areaId: null,
    line1: '',
    line2: '',
    building: '',
    floor: '',
    notes: '',
    makeDefault: false,
};

export function AddressEditorScreen({ addressId, returnTo }: AddressEditorScreenProps) {
    const { t } = useTranslation();
    const toast = useToast();
    const router = useRouter();
    const back = useReturnTo(returnTo, ADDRESSES_HOME);
    const guard = useUnsavedGuard({ message: t('common:unsaved.browserPrompt') });

    const creating = addressId === undefined || addressId === NEW_ADDRESS_PARAM;

    const addresses = useAddressesQuery(!creating);
    const areas = useServiceAreasQuery();
    const contacts = useContactPointsQuery();
    const add = useAddAddressMutation();
    const update = useUpdateAddressMutation();

    const existing = creating
        ? undefined
        : (addresses.data ?? []).find((candidate) => candidate.id === addressId);

    /** The label each tile saves — its word, in the reader's language. */
    const kindLabel = (kind: Exclude<LabelKind, 'other'>) => t(`account:addresses.board.${kind}`);

    const draftFrom = (address: CustomerAddress): Draft => {
        const label = address.label.trim();
        const kind: LabelKind =
            label.toLowerCase() === kindLabel('home').toLowerCase()
                ? 'home'
                : label.toLowerCase() === kindLabel('work').toLowerCase()
                  ? 'work'
                  : 'other';
        return {
            kind,
            label: kind === 'other' ? address.label : '',
            areaId: address.areaId,
            line1: address.line1,
            line2: address.line2 ?? '',
            building: address.building ?? '',
            floor: address.floor ?? '',
            notes: address.notes ?? '',
            makeDefault: address.isDefault,
        };
    };

    /**
     * The draft, seeded from the loaded address the first time it arrives — held with the identifier
     * it was seeded from so the seeding is derived rather than pushed by an effect, which would
     * re-run on the refetch after a save and overwrite whatever had been typed since.
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
    const [areaOpen, setAreaOpen] = useState(false);
    const [areaSearch, setAreaSearch] = useState('');

    const set = (patch: Partial<Draft>) => {
        guard.markDirty();
        setEdited({ draft: { ...draft, ...patch }, from: seededFrom });
    };

    const label = draft.kind === 'other' ? draft.label.trim() : kindLabel(draft.kind);
    const missing = {
        label: label === '',
        areaId: draft.areaId === null,
        line1: draft.line1.trim() === '',
    };
    const invalid = missing.label || missing.areaId || missing.line1;
    const errorFor = (field: keyof typeof missing) =>
        submitted && missing[field] ? t('account:addresses.requiredField') : undefined;

    const saveFailure = toFailure(add.error) ?? toFailure(update.error);
    const saving = add.isPending || update.isPending;

    const areaList: readonly AccountServiceArea[] = areas.data ?? [];
    const chosenArea = areaList.find((area) => area.id === draft.areaId);
    const phone = currentPhone(contacts.data ?? []);

    const save = () => {
        setSubmitted(true);
        if (invalid || draft.areaId === null) return;
        const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
        const request: SaveAddressRequest = {
            label,
            areaId: draft.areaId as ServiceAreaId,
            line1: draft.line1.trim(),
            ...(optional(draft.line2) === undefined ? {} : { line2: optional(draft.line2) }),
            ...(optional(draft.building) === undefined
                ? {}
                : { building: optional(draft.building) }),
            ...(optional(draft.floor) === undefined ? {} : { floor: optional(draft.floor) }),
            ...(optional(draft.notes) === undefined ? {} : { notes: optional(draft.notes) }),
            makeDefault: draft.makeDefault,
        };

        const onSuccess = (saved: CustomerAddress) => {
            guard.markClean();
            toast.show({
                testID: `${TEST_ID}-saved`,
                tone: 'success',
                message: t('account:addresses.savedToast'),
            });
            back.finish({ address: saved.id });
        };

        if (creating) {
            add.mutate(request, { onSuccess });
        } else if (addressId !== undefined) {
            update.mutate({ addressId, request }, { onSuccess });
        }
    };

    /**
     * An identifier that names nothing — a stale link, a bookmark, an address deleted in another
     * tab. Without this the screen would draw an empty add form under "Edit address" and then fail
     * the save with `resource.not_found`.
     */
    const missingAddress = !creating && !addresses.isPending && existing === undefined;

    const title = creating ? t('account:addresses.add') : t('account:addresses.edit');
    const backLabel =
        back.returnTo === null
            ? t('account:nav.addresses')
            : t(`common:destination.${back.destination}`);

    const query = areaSearch.trim().toLowerCase();
    const shownAreas =
        query === ''
            ? areaList
            : areaList.filter((area) => area.name.toLowerCase().includes(query));

    const previewLine = [draft.line1, draft.building, draft.floor]
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .join(t('account:addresses.partSeparator'));

    return (
        <View testID={TEST_ID} className={`${ACCOUNT_CARD} p-6`}>
            {/* The board's pane head: a round way back — named for a screen reader by where it
                goes, the addresses or the step that sent the person here — and the title. */}
            <View className="mb-[18px] flex-row items-center gap-3">
                <Pressable
                    testID={`${TEST_ID}-trail-up`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={backLabel}
                    onPress={() => {
                        guard.intercept(back.up);
                    }}
                    className="h-11 w-11 items-center justify-center rounded-full border border-stroke-subtle bg-surface-raised hover:bg-surface-brand-subtle"
                >
                    <Icon name="chevronBackward" size="md" className="text-content-primary" />
                </Pressable>
                <RNText
                    testID={`${TEST_ID}-title`}
                    accessibilityRole="header"
                    aria-level={2}
                    className="min-w-0 flex-1 font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {title}
                </RNText>
            </View>

            {missingAddress ? (
                <EmptyState
                    testID={`${TEST_ID}-missing`}
                    title={t('account:addresses.missingTitle')}
                    body={t('account:addresses.missingBody')}
                    actions={
                        <Button
                            testID={`${TEST_ID}-missing-back`}
                            label={
                                back.returnTo === null
                                    ? t('account:addresses.backToList')
                                    : t(`common:returnTo.${back.destination}`)
                            }
                            onPress={back.up}
                        />
                    }
                />
            ) : (
                <QueryStates
                    skeleton="form"
                    query={areas}
                    isEmpty={areaList.length === 0}
                    emptyTitle={t('account:addresses.noAreasTitle')}
                    emptyBody={t('account:addresses.noAreasBody')}
                    skeletonCount={1}
                    testID={`${TEST_ID}-areas`}
                >
                    <View className="flex-col gap-6 lg:flex-row lg:items-start">
                        {/* ── the form ─────────────────────────────────────────────────── */}
                        <View className="min-w-0 flex-col lg:flex-1">
                            {saveFailure === null ? null : (
                                <View className="mb-4">
                                    <Callout
                                        testID={`${TEST_ID}-error`}
                                        role="alert"
                                        tone="danger"
                                        title={saveFailure.message}
                                    />
                                </View>
                            )}

                            <Eyebrow>{t('account:addresses.board.saveAs')}</Eyebrow>
                            <View
                                role="radiogroup"
                                aria-label={t('account:addresses.board.saveAs')}
                                className="flex-row flex-wrap gap-2"
                            >
                                {LABEL_KINDS.map(({ kind, icon }) => {
                                    const on = draft.kind === kind;
                                    return (
                                        <Pressable
                                            key={kind}
                                            testID={`${TEST_ID}-label-${kind}`}
                                            role="radio"
                                            aria-checked={on}
                                            accessibilityState={{ checked: on }}
                                            onPress={() => {
                                                set({ kind });
                                            }}
                                            className={cx(
                                                'h-12 flex-row items-center gap-2.5 rounded-[14px] border-[1.5px] pe-4 ps-2',
                                                on
                                                    ? 'border-surface-brand bg-surface-brand-subtle'
                                                    : 'border-stroke bg-surface-raised hover:border-surface-brand',
                                            )}
                                        >
                                            <View
                                                className={cx(
                                                    'h-8 w-8 items-center justify-center rounded-[10px]',
                                                    on ? 'bg-surface-brand' : 'bg-surface-base',
                                                )}
                                            >
                                                <Icon
                                                    name={icon}
                                                    size="sm"
                                                    className={
                                                        on
                                                            ? 'text-content-on-brand'
                                                            : 'text-content-primary'
                                                    }
                                                />
                                            </View>
                                            <RNText
                                                className={cx(
                                                    'text-sm font-semibold',
                                                    on
                                                        ? 'text-content-on-brand-subtle'
                                                        : 'text-content-primary',
                                                )}
                                            >
                                                {t(`account:addresses.board.${kind}`)}
                                            </RNText>
                                        </Pressable>
                                    );
                                })}
                            </View>

                            {draft.kind === 'other' ? (
                                <View className="mt-4">
                                    <TextInputField
                                        testID={`${TEST_ID}-label`}
                                        label={t('account:addresses.board.nameIt')}
                                        placeholder={t('account:addresses.board.nameItPlaceholder')}
                                        value={draft.label}
                                        required
                                        onChangeText={(text: string) => {
                                            set({ label: text });
                                        }}
                                        {...(errorFor('label') === undefined
                                            ? {}
                                            : { error: errorFor('label') })}
                                    />
                                </View>
                            ) : null}

                            {/* ── the area, opened in place ─────────────────────────────── */}
                            <View className="mt-4">
                                <FieldLabel required>{t('account:addresses.areaLabel')}</FieldLabel>
                                <Pressable
                                    testID={`${TEST_ID}-area-trigger`}
                                    role="button"
                                    accessibilityRole="button"
                                    aria-expanded={areaOpen}
                                    accessibilityState={{ expanded: areaOpen }}
                                    accessibilityLabel={`${t('account:addresses.areaLabel')}: ${
                                        chosenArea?.name ?? t('account:addresses.areaPlaceholder')
                                    }`}
                                    onPress={() => {
                                        setAreaOpen((open) => !open);
                                    }}
                                    className={cx(
                                        'h-[50px] flex-row items-center gap-2.5 rounded-[14px] border-[1.5px] bg-surface-raised px-3.5',
                                        areaOpen
                                            ? 'border-surface-brand'
                                            : errorFor('areaId') === undefined
                                              ? 'border-stroke'
                                              : 'border-danger-border',
                                    )}
                                >
                                    <Icon
                                        name="mapPin"
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                    <RNText
                                        className={cx(
                                            'min-w-0 flex-1 text-base text-start',
                                            chosenArea === undefined
                                                ? 'text-content-secondary'
                                                : 'font-semibold text-content-primary',
                                        )}
                                        numberOfLines={1}
                                    >
                                        {chosenArea?.name ?? t('account:addresses.areaPlaceholder')}
                                    </RNText>
                                    <Icon
                                        name={areaOpen ? 'chevronUp' : 'chevronDown'}
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                </Pressable>
                                {errorFor('areaId') === undefined ? null : (
                                    <RNText
                                        testID={`${TEST_ID}-area-error`}
                                        className="mt-1.5 text-sm text-danger-on-subtle text-start"
                                    >
                                        {errorFor('areaId')}
                                    </RNText>
                                )}
                                {areaOpen ? (
                                    <View className="mt-2 rounded-[18px] border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-3">
                                        <View className="h-11 flex-row items-center gap-2 rounded-xl bg-surface-base px-3">
                                            <Icon
                                                name="searchLens"
                                                size="sm"
                                                className="text-content-secondary"
                                            />
                                            <TextInput
                                                testID={`${TEST_ID}-area-search`}
                                                value={areaSearch}
                                                onChangeText={setAreaSearch}
                                                placeholder={t(
                                                    'account:addresses.board.searchAreas',
                                                    { count: areaList.length },
                                                )}
                                                accessibilityLabel={t(
                                                    'account:addresses.board.searchAreasLabel',
                                                )}
                                                className="h-10 min-w-0 flex-1 text-sm text-content-primary web:outline-none"
                                            />
                                        </View>
                                        <View
                                            role="list"
                                            aria-label={t('account:addresses.areaLabel')}
                                            className="mt-1.5 max-h-[220px] flex-row flex-wrap overflow-y-auto"
                                        >
                                            {shownAreas.map((area) => {
                                                const on = area.id === draft.areaId;
                                                return (
                                                    <View key={area.id} className="w-1/2 p-0.5">
                                                        <Pressable
                                                            testID={`${TEST_ID}-area-option-${area.id}`}
                                                            role="option"
                                                            aria-selected={on}
                                                            accessibilityState={{
                                                                selected: on,
                                                            }}
                                                            onPress={() => {
                                                                set({ areaId: area.id });
                                                                setAreaOpen(false);
                                                                setAreaSearch('');
                                                            }}
                                                            className={cx(
                                                                'h-11 flex-row items-center gap-2 rounded-[11px] px-3',
                                                                on
                                                                    ? 'bg-surface-brand-subtle'
                                                                    : 'hover:bg-surface-base',
                                                            )}
                                                        >
                                                            <RNText
                                                                numberOfLines={1}
                                                                className={cx(
                                                                    'min-w-0 flex-1 text-sm text-start',
                                                                    on
                                                                        ? 'font-bold text-content-on-brand-subtle'
                                                                        : 'text-content-primary',
                                                                )}
                                                            >
                                                                {area.name}
                                                            </RNText>
                                                            {on ? (
                                                                <Icon
                                                                    name="check"
                                                                    size="sm"
                                                                    className="text-content-on-brand-subtle"
                                                                />
                                                            ) : null}
                                                        </Pressable>
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    </View>
                                ) : null}
                            </View>

                            <View className="mt-4">
                                <TextInputField
                                    testID={`${TEST_ID}-line1`}
                                    label={t('account:addresses.board.line1Label')}
                                    placeholder={t('account:addresses.board.line1Placeholder')}
                                    value={draft.line1}
                                    required
                                    onChangeText={(line1: string) => {
                                        set({ line1 });
                                    }}
                                    {...(errorFor('line1') === undefined
                                        ? {}
                                        : { error: errorFor('line1') })}
                                />
                            </View>

                            <View className="mt-4 flex-col gap-4 sm:flex-row sm:gap-2.5">
                                <View className="min-w-0 sm:flex-1">
                                    <TextInputField
                                        testID={`${TEST_ID}-building`}
                                        label={t('account:addresses.buildingLabel')}
                                        placeholder={t('account:addresses.buildingPlaceholder')}
                                        value={draft.building}
                                        onChangeText={(building: string) => {
                                            set({ building });
                                        }}
                                    />
                                </View>
                                <View className="min-w-0 sm:flex-1">
                                    <TextInputField
                                        testID={`${TEST_ID}-floor`}
                                        label={t('account:addresses.floorLabel')}
                                        placeholder={t('account:addresses.floorPlaceholder')}
                                        value={draft.floor}
                                        onChangeText={(floor: string) => {
                                            set({ floor });
                                        }}
                                    />
                                </View>
                            </View>

                            <View className="mt-4">
                                <TextInputField
                                    testID={`${TEST_ID}-line2`}
                                    label={t('account:addresses.line2Label')}
                                    placeholder={t('account:addresses.line2Placeholder')}
                                    value={draft.line2}
                                    onChangeText={(line2: string) => {
                                        set({ line2 });
                                    }}
                                />
                            </View>

                            <View className="mt-4">
                                <TextInputField
                                    testID={`${TEST_ID}-notes`}
                                    label={t('account:addresses.notesLabel')}
                                    placeholder={t('account:addresses.board.notesPlaceholder')}
                                    value={draft.notes}
                                    multiline
                                    onChangeText={(notes: string) => {
                                        set({ notes });
                                    }}
                                />
                            </View>

                            {/* The number the driver calls — the account's own, changed on
                                    the phone screen where a new one is confirmed with a code. */}
                            <View className="mt-4">
                                <FieldLabel>{t('account:addresses.board.contact')}</FieldLabel>
                                <View
                                    testID={`${TEST_ID}-phone`}
                                    className="h-[50px] flex-row items-center gap-2.5 rounded-[14px] border-[1.5px] border-stroke bg-surface-base px-3.5"
                                >
                                    <Icon
                                        name="smartphone"
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                    <RNText
                                        numberOfLines={1}
                                        className={cx(
                                            'min-w-0 flex-1 text-base text-start',
                                            phone === null
                                                ? 'text-content-secondary'
                                                : 'text-content-primary',
                                        )}
                                    >
                                        {phone === null
                                            ? t('account:profile.noPhone')
                                            : phone.maskedValue}
                                    </RNText>
                                    <Pressable
                                        testID={`${TEST_ID}-phone-open`}
                                        role="link"
                                        accessibilityRole="link"
                                        onPress={() => {
                                            guard.intercept(() => {
                                                router.push('/customer/account/phone' as never);
                                            });
                                        }}
                                        className="min-h-touch justify-center"
                                    >
                                        <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                            {phone === null
                                                ? t('account:profile.phoneAdd')
                                                : t('account:profile.phoneChange')}
                                        </RNText>
                                    </Pressable>
                                </View>
                            </View>

                            <View className="mt-4 flex-row items-center gap-3 rounded-2xl bg-surface-base p-3.5">
                                <RNText className="flex-1 text-base font-bold text-content-primary text-start">
                                    {t('account:addresses.board.useDefault')}
                                </RNText>
                                <ShopSwitch
                                    testID={`${TEST_ID}-default`}
                                    label={t('account:addresses.board.useDefault')}
                                    checked={draft.makeDefault}
                                    onChange={(makeDefault) => {
                                        set({ makeDefault });
                                    }}
                                />
                            </View>

                            <View className="mt-5 flex-row flex-wrap gap-2">
                                <Pressable
                                    testID={`${TEST_ID}-save`}
                                    role="button"
                                    accessibilityRole="button"
                                    disabled={saving}
                                    aria-busy={saving}
                                    accessibilityState={{ busy: saving, disabled: saving }}
                                    onPress={save}
                                    className="h-12 flex-row items-center gap-2 rounded-[14px] bg-surface-brand px-5 hover:opacity-90"
                                >
                                    {saving ? (
                                        <ActivityIndicator size="small" />
                                    ) : (
                                        <Icon
                                            name="check"
                                            size="sm"
                                            className="text-content-on-brand"
                                        />
                                    )}
                                    <RNText className="text-sm font-bold text-content-on-brand">
                                        {t('account:addresses.save')}
                                    </RNText>
                                </Pressable>
                                <Pressable
                                    testID={`${TEST_ID}-cancel`}
                                    role="button"
                                    accessibilityRole="button"
                                    onPress={() => {
                                        guard.intercept(back.leave);
                                    }}
                                    className="h-12 flex-row items-center rounded-[14px] border border-stroke bg-surface-raised px-[18px] hover:bg-surface-brand-subtle"
                                >
                                    <RNText className="text-sm font-semibold text-content-primary">
                                        {t('common:action.cancel')}
                                    </RNText>
                                </Pressable>
                            </View>
                        </View>

                        {/* ── the preview ──────────────────────────────────────────────── */}
                        <View
                            testID={`${TEST_ID}-preview`}
                            aria-label={t('account:addresses.board.preview')}
                            className="overflow-hidden rounded-3xl bg-surface-canopy lg:w-[340px] web:lg:sticky web:lg:top-6"
                        >
                            <AddressMap testID={`${TEST_ID}-map`} />
                            <View className="flex-col gap-1.5 px-5 pb-5 pt-[18px]">
                                <View className="h-7 justify-center self-start rounded-full bg-content-on-canopy/15 px-2.5">
                                    <RNText className="text-xs font-bold text-content-on-canopy">
                                        {label === '' ? t('account:addresses.board.other') : label}
                                    </RNText>
                                </View>
                                <RNText className="font-display text-2xl font-bold text-content-on-canopy text-start">
                                    {chosenArea?.name ?? t('account:addresses.board.yourArea')}
                                </RNText>
                                {previewLine === '' ? null : (
                                    <RNText className="text-sm text-content-on-canopy-muted text-start">
                                        {previewLine}
                                    </RNText>
                                )}
                                {chosenArea === undefined ? (
                                    <View className="mt-2 flex-row items-center gap-2.5 rounded-[14px] bg-content-on-canopy/10 p-3">
                                        <View className="h-7 w-7 items-center justify-center rounded-full bg-content-on-canopy/20">
                                            <Icon
                                                name="infoCircle"
                                                size="sm"
                                                className="text-content-on-canopy"
                                            />
                                        </View>
                                        <RNText className="flex-1 text-sm font-semibold text-content-on-canopy-muted text-start">
                                            {t('account:addresses.board.pickArea')}
                                        </RNText>
                                    </View>
                                ) : (
                                    <View
                                        testID={`${TEST_ID}-coverage`}
                                        className="mt-2 flex-row items-center gap-2.5 rounded-[14px] bg-stage-green/15 p-3"
                                    >
                                        <View className="h-7 w-7 items-center justify-center rounded-full bg-stage-green">
                                            <Icon
                                                name="check"
                                                size="sm"
                                                className="text-content-primary"
                                            />
                                        </View>
                                        <RNText className="flex-1 text-sm font-semibold text-content-on-canopy text-start">
                                            {t('account:addresses.board.coverage', {
                                                area: chosenArea.name,
                                            })}
                                        </RNText>
                                    </View>
                                )}
                            </View>
                        </View>
                    </View>
                </QueryStates>
            )}
            <UnsavedChangesDialog look="shop" guard={guard} testID={`${TEST_ID}-unsaved`} />
        </View>
    );
}

/** The board's small upper-case section label. */
function Eyebrow({ children }: { readonly children: string }) {
    return (
        <RNText className="mb-2.5 text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
            {children}
        </RNText>
    );
}

/**
 * A field's label for the controls that are not a `TextInputField` — the area, the phone — drawn as
 * the design system's own field label is, so the form reads as one.
 */
function FieldLabel({
    children,
    required = false,
}: {
    readonly children: string;
    readonly required?: boolean;
}) {
    return (
        <RNText className="mb-1.5 text-sm font-medium text-content-primary text-start">
            {children}
            {required ? <RNText className="text-danger-strong"> *</RNText> : null}
        </RNText>
    );
}
