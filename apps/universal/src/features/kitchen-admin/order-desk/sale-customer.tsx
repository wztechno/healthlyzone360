import type { OrderDeskCustomer, ServiceArea } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    FormGrid,
    FormSection,
    Icon,
    Inline,
    SearchInput,
    Select,
    Skeleton,
    Text,
    TextInputField,
    useIssueGroup,
    useIssueTrayController,
} from '@healthy360/design-system';
import type { IssueCardItem } from '@healthy360/design-system';
import { fieldWidth } from '@healthy360/design-tokens';
import { useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../../data/hooks.ts';
import {
    CUSTOMER_SEARCH_MIN_LENGTH,
    useAddOrderDeskCustomerAddressMutation,
    useCreateOrderDeskCustomerMutation,
    useOrderDeskCustomerSearchQuery,
    useOrderDeskDeliveryAreasQuery,
    useUpdateOrderDeskCustomerMutation,
} from '../../../data/order-desk-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { focusField } from '../field-focus.ts';
import { displayName } from '../format.ts';
import { serverFieldErrors } from '../server-field-errors.ts';
import { checkDeskPhone, dialFor, isBlankPhone, normaliseDeskPhone } from './desk-phone.ts';
import { useDebouncedValue } from './use-debounced-value.ts';

/**
 * Who a collection or a delivery is for, and where a delivery goes — the two cards the sale page
 * opens above the menu when the kind of sale needs them.
 *
 * Each card is a `FormSection variant="card"`, the record editors' section, so its title sits a
 * step above everything in it. Once answered, a card folds to one line — the name and number, or the
 * street — with a Change button in its header, so the menu below it moves back up the page instead of
 * staying under a search the agent has finished with.
 *
 * ## Addresses are written, never chosen
 *
 * There is no operation on this surface that *lists* a customer's addresses — the desk may add one
 * and nothing else. So a delivery taken here writes the destination down as the caller gives it,
 * every time, and a returning customer gets a second copy of their own street. That is the wire's
 * shape rather than a choice made here, and the card says so before anybody types.
 *
 * ## Their warnings are the page's tray's
 *
 * A number somebody else already has and an address nobody delivers to are said as cards in the sale
 * page's issue tray (`useIssueGroup`), not as callouts inside the cards — each clearing itself once
 * the sale is no longer for that record, and each with its way out: the other record, the address.
 *
 * ## The a11y rule the rows follow
 *
 * A customer row holds a Choose button, so the row itself takes no press: nested interactive content
 * is a serious axe violation.
 */

/** The wait before a customer search is asked — a request per keystroke otherwise. */
const SEARCH_DEBOUNCE_MS = 300;

const EM_DASH = '—';

/* ------------------------------------------------------------------------------------------------
 * The customer
 * ---------------------------------------------------------------------------------------------- */

/**
 * The kitchen's dialling code, from its country on the session's membership — what the phone field
 * opens with, so the agent types only the number the caller reads out.
 */
function useKitchenDial(): string | null {
    const access = useAccessState();
    const { me } = useSession();
    const membershipId = access.organisation?.membershipId;

    return useMemo(() => {
        if (membershipId === undefined) return null;
        const membership = me?.memberships.find((candidate) => candidate.id === membershipId);
        return dialFor(membership?.organisation.countryCode ?? null);
    }, [me, membershipId]);
}

export function CustomerSection({
    customerAccountId,
    onChoose,
}: {
    /** The chosen account, from the sale's state. `null` opens the search. */
    readonly customerAccountId: string | null;
    readonly onChoose: (customer: OrderDeskCustomer) => void;
}) {
    const { t } = useTranslation();
    const dial = useKitchenDial();
    const { nudge: nudgeTray } = useIssueTrayController();
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    /** Set by the first Create press: the number is judged once the agent says they are done. */
    const [createAttempted, setCreateAttempted] = useState(false);
    const [editAttempted, setEditAttempted] = useState(false);
    /** The record behind `customerAccountId`, held so the folded card can name them. */
    const [chosen, setChosen] = useState<OrderDeskCustomer | null>(null);
    const [changing, setChanging] = useState(false);
    /** Correcting the chosen customer's name or number in place, rather than writing them twice. */
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');

    const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    const search = useOrderDeskCustomerSearchQuery(debounced);
    const create = useCreateOrderDeskCustomerMutation();
    const update = useUpdateOrderDeskCustomerMutation();
    const updateFailure = toFailure(update.error);

    const searchFailure = toFailure(search.error);
    const createFailure = toFailure(create.error);

    // What the server refused, on the field it named (BUG-06).
    const customerFields = (form: 'customer' | 'customer-edit') => ({
        display_name: {
            label: t('kitchen:desk.sale.customerNameLabel'),
            fieldId: `kitchen-order-desk-sale-${form}-name`,
        },
        phone: {
            label: t('kitchen:desk.sale.customerPhoneLabel'),
            fieldId: `kitchen-order-desk-sale-${form}-phone`,
        },
    });
    const createServer = serverFieldErrors(createFailure, customerFields('customer'));
    const updateServer = serverFieldErrors(updateFailure, customerFields('customer-edit'));
    const createPhoneProblem = checkDeskPhone(phone, dial);
    const editPhoneProblem = checkDeskPhone(editPhone, dial);
    const createPhoneError =
        createAttempted && createPhoneProblem !== null
            ? t(createPhoneProblem.key, createPhoneProblem.params)
            : createServer.errorFor('phone');
    const editPhoneError =
        editAttempted && editPhoneProblem !== null
            ? t(editPhoneProblem.key, editPhoneProblem.params)
            : updateServer.errorFor('phone');
    const tooShort = debounced.length > 0 && debounced.length < CUSTOMER_SEARCH_MIN_LENGTH;
    const rows = search.data?.rows ?? [];
    const answered =
        customerAccountId !== null && chosen !== null && chosen.id === customerAccountId;
    const folded = answered && !changing;

    function choose(customer: OrderDeskCustomer) {
        setChosen(customer);
        setChanging(false);
        setCreating(false);
        setEditing(false);
        onChoose(customer);
    }

    function startEditing(customer: OrderDeskCustomer) {
        update.reset();
        setEditAttempted(false);
        setEditName(customer.displayName ?? '');
        setEditPhone(customer.phone ?? '');
        setEditing(true);
    }

    /** Only what changed is sent, so a correction to the name never re-sends the number. */
    function saveEdit(customer: OrderDeskCustomer) {
        setEditAttempted(true);
        const nextName = editName.trim();
        const nextPhone = normaliseDeskPhone(editPhone);
        if (nextPhone !== (customer.phone ?? '') && editPhoneProblem !== null) return;
        update.mutate(
            {
                customerId: customer.id,
                ...(nextName === (customer.displayName ?? '') ? {} : { displayName: nextName }),
                ...(nextPhone === (customer.phone ?? '') ? {} : { phone: nextPhone }),
            },
            {
                onSuccess: (result) => {
                    setChosen(result.customer);
                    onChoose(result.customer);
                    // Held open while somebody else shares the new number; the tray says who.
                    if (result.possibleDuplicates.length === 0) setEditing(false);
                    else nudgeTray();
                },
            },
        );
    }

    const editUnchanged =
        chosen !== null &&
        editName.trim() === (chosen.displayName ?? '') &&
        normaliseDeskPhone(editPhone) === (chosen.phone ?? '');

    /*
     * Somebody else has the number — a warning, never a refusal: a household or an office shares
     * one line. Said while the sale is still for the record that shares it; the one just created
     * offers each other record one press away, so the order can join that history instead.
     */
    const duplicateName = (duplicate: OrderDeskCustomer) =>
        `${duplicate.displayName ?? t('kitchen:desk.sale.customerUnnamed')} · ${
            duplicate.phone ?? EM_DASH
        }`;
    const created = create.data;
    const edited = update.data;
    const duplicateCards: IssueCardItem[] = [
        ...(created === undefined || created.customer.id !== customerAccountId
            ? []
            : created.possibleDuplicates.map((duplicate) => ({
                  key: `duplicate-${duplicate.id}`,
                  tone: 'warning' as const,
                  label: t('kitchen:desk.sale.customerDuplicatesTitle'),
                  detail: duplicateName(duplicate),
                  action: {
                      label: t('kitchen:desk.sale.customerUseInstead'),
                      onPress: () => {
                          choose(duplicate);
                      },
                      testID: `kitchen-order-desk-sale-customer-duplicate-${duplicate.id}-choose`,
                  },
                  testID: `kitchen-order-desk-sale-customer-duplicate-${duplicate.id}`,
              }))),
        ...(edited === undefined ||
        edited.customer.id !== customerAccountId ||
        edited.possibleDuplicates.length === 0
            ? []
            : [
                  {
                      key: 'edit-duplicates',
                      tone: 'warning' as const,
                      label: t('kitchen:desk.sale.customerEditDuplicatesTitle'),
                      detail: edited.possibleDuplicates
                          .map(duplicateName)
                          .join(t('kitchen:common.listSeparator')),
                      testID: 'kitchen-order-desk-sale-customer-edit-duplicates',
                  },
              ]),
    ];
    useIssueGroup({ key: 'check', title: t('kitchen:tray.groupCheck'), items: duplicateCards });

    return (
        <FormSection
            variant="card"
            testID="kitchen-order-desk-sale-customer"
            title={t('kitchen:desk.sale.customerTitle')}
            actions={
                folded && !editing ? (
                    <Inline space="xs">
                        <Button
                            testID="kitchen-order-desk-sale-customer-edit"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:desk.sale.customerEdit')}
                            onPress={() => {
                                if (chosen !== null) startEditing(chosen);
                            }}
                        />
                        <Button
                            testID="kitchen-order-desk-sale-customer-change"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:desk.sale.change')}
                            onPress={() => {
                                setChanging(true);
                            }}
                        />
                    </Inline>
                ) : undefined
            }
        >
            {folded && chosen !== null && editing ? (
                <View
                    testID="kitchen-order-desk-sale-customer-edit-form"
                    className="flex-col gap-tight"
                >
                    <FormGrid columns={2}>
                        <TextInputField
                            testID="kitchen-order-desk-sale-customer-edit-name"
                            id="kitchen-order-desk-sale-customer-edit-name"
                            label={t('kitchen:desk.sale.customerNameLabel')}
                            size="sm"
                            required
                            {...updateServer.flag('display_name')}
                            value={editName}
                            onChangeText={setEditName}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-customer-edit-phone"
                            id="kitchen-order-desk-sale-customer-edit-phone"
                            label={t('kitchen:desk.sale.customerPhoneLabel')}
                            hint={t('kitchen:desk.sale.customerPhoneHint')}
                            size="sm"
                            required
                            {...(editPhoneError === undefined ? {} : { error: editPhoneError })}
                            value={editPhone}
                            onChangeText={setEditPhone}
                            autoCapitalize="none"
                            autoCorrect={false}
                            inputMode="tel"
                        />
                    </FormGrid>

                    {updateFailure === null ||
                    (updateServer.isValidation && updateServer.unplaced === null) ? null : (
                        <Text tone="danger" testID="kitchen-order-desk-sale-customer-edit-error">
                            {updateServer.unplaced ?? updateFailure.message}
                        </Text>
                    )}

                    <Inline space="xs" wrap>
                        <Button
                            testID="kitchen-order-desk-sale-customer-edit-save"
                            size="sm"
                            label={t('kitchen:desk.sale.customerEditSave')}
                            loading={update.isPending}
                            disabled={
                                editUnchanged ||
                                editName.trim() === '' ||
                                isBlankPhone(editPhone, dial)
                            }
                            onPress={() => {
                                saveEdit(chosen);
                            }}
                        />
                        <Button
                            testID="kitchen-order-desk-sale-customer-edit-cancel"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:desk.sale.customerCancelCreate')}
                            onPress={() => {
                                setEditing(false);
                            }}
                        />
                    </Inline>
                </View>
            ) : folded && chosen !== null ? (
                <View
                    testID="kitchen-order-desk-sale-customer-chosen"
                    className="flex-row flex-wrap items-center gap-tight"
                >
                    <Text variant="label">
                        {chosen.displayName ?? t('kitchen:desk.sale.customerUnnamed')}
                    </Text>
                    <Text variant="mono" tone="secondary">
                        {chosen.phone ?? EM_DASH}
                    </Text>
                    {chosen.hasOrdersWithOrg ? (
                        <Badge
                            tone="success"
                            icon={null}
                            label={t('kitchen:desk.sale.customerRegular')}
                        />
                    ) : null}
                </View>
            ) : (
                <View className="z-auto flex-col gap-tight">
                    <View style={{ width: fieldWidth }}>
                        <SearchInput
                            testID="kitchen-order-desk-sale-customer-search"
                            label={t('kitchen:desk.sale.customerSearchLabel')}
                            placeholder={t('kitchen:desk.sale.customerSearchPlaceholder')}
                            value={query}
                            onChangeText={setQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>

                    {tooShort ? (
                        // A hint, not an error: the first two letters of a name are somebody
                        // typing. The server would answer 422; this never asks.
                        <Text
                            variant="caption"
                            tone="secondary"
                            role="status"
                            testID="kitchen-order-desk-sale-customer-too-short"
                        >
                            {t('kitchen:desk.sale.customerSearchTooShort', {
                                count: CUSTOMER_SEARCH_MIN_LENGTH,
                            })}
                        </Text>
                    ) : null}

                    {search.isFetching ? (
                        <Skeleton
                            testID="kitchen-order-desk-sale-customer-loading"
                            heightClassName="h-row-md"
                        />
                    ) : searchFailure !== null ? (
                        <ErrorState
                            testID="kitchen-order-desk-sale-customer-error"
                            title={t('kitchen:desk.sale.customerSearchErrorTitle')}
                            failure={searchFailure}
                            onRetry={() => {
                                void search.refetch();
                            }}
                            retrying={search.isFetching}
                        />
                    ) : rows.length > 0 ? (
                        <View
                            testID="kitchen-order-desk-sale-customer-results"
                            className="flex-col border-t border-stroke"
                        >
                            {rows.map((row) => (
                                <View
                                    key={row.id}
                                    testID={`kitchen-order-desk-sale-customer-${row.id}`}
                                    className={
                                        customerAccountId === row.id
                                            ? 'min-h-row-md flex-row flex-wrap items-center gap-tight border-b border-stroke-subtle bg-surface-brand-subtle px-control-sm'
                                            : 'min-h-row-md flex-row flex-wrap items-center gap-tight border-b border-stroke-subtle px-control-sm'
                                    }
                                >
                                    {/* eslint-disable-next-line no-restricted-syntax -- the name is the row's filler. */}
                                    <View className="min-w-0 flex-1">
                                        <Text variant="label">
                                            {row.displayName ??
                                                t('kitchen:desk.sale.customerUnnamed')}
                                        </Text>
                                    </View>
                                    <Text variant="mono" tone="secondary">
                                        {row.phone ?? EM_DASH}
                                    </Text>
                                    {row.hasOrdersWithOrg ? (
                                        <Badge
                                            tone="success"
                                            icon={null}
                                            label={t('kitchen:desk.sale.customerRegular')}
                                        />
                                    ) : null}
                                    <Button
                                        testID={`kitchen-order-desk-sale-customer-${row.id}-choose`}
                                        size="sm"
                                        variant="quiet"
                                        label={t('kitchen:desk.sale.customerChoose')}
                                        onPress={() => {
                                            choose(row);
                                        }}
                                    />
                                </View>
                            ))}
                            {rows.length >= (search.data?.limit ?? Number.POSITIVE_INFINITY) ? (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-order-desk-sale-customer-capped"
                                >
                                    {t('kitchen:desk.sale.customerCapped', {
                                        limit: search.data?.limit ?? 0,
                                    })}
                                </Text>
                            ) : null}
                        </View>
                    ) : debounced.length >= CUSTOMER_SEARCH_MIN_LENGTH ? (
                        <EmptyState
                            testID="kitchen-order-desk-sale-customer-empty"
                            title={t('kitchen:desk.sale.customerNoneTitle')}
                            body={t('kitchen:desk.sale.customerNoneBody')}
                        />
                    ) : null}

                    {creating ? (
                        <View
                            testID="kitchen-order-desk-sale-customer-form"
                            className="flex-col gap-tight border-t border-stroke-subtle pt-tight"
                        >
                            <Text variant="strong" accessibilityRole="header">
                                {t('kitchen:desk.sale.customerCreateTitle')}
                            </Text>
                            <FormGrid columns={2}>
                                <TextInputField
                                    testID="kitchen-order-desk-sale-customer-name"
                                    id="kitchen-order-desk-sale-customer-name"
                                    label={t('kitchen:desk.sale.customerNameLabel')}
                                    placeholder={t('kitchen:desk.sale.customerNamePlaceholder')}
                                    size="sm"
                                    required
                                    {...createServer.flag('display_name')}
                                    value={name}
                                    onChangeText={setName}
                                />
                                <TextInputField
                                    testID="kitchen-order-desk-sale-customer-phone"
                                    id="kitchen-order-desk-sale-customer-phone"
                                    label={t('kitchen:desk.sale.customerPhoneLabel')}
                                    hint={t('kitchen:desk.sale.customerPhoneHint')}
                                    size="sm"
                                    required
                                    {...(createPhoneError === undefined
                                        ? {}
                                        : { error: createPhoneError })}
                                    value={phone}
                                    onChangeText={setPhone}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    inputMode="tel"
                                />
                            </FormGrid>

                            {createFailure === null ||
                            (createServer.isValidation && createServer.unplaced === null) ? null : (
                                <Text
                                    tone="danger"
                                    testID="kitchen-order-desk-sale-customer-create-error"
                                >
                                    {createServer.unplaced ?? createFailure.message}
                                </Text>
                            )}

                            <Inline space="xs" wrap>
                                <Button
                                    testID="kitchen-order-desk-sale-customer-create"
                                    size="sm"
                                    label={t('kitchen:desk.sale.customerCreate')}
                                    loading={create.isPending}
                                    disabled={name.trim() === '' || isBlankPhone(phone, dial)}
                                    onPress={() => {
                                        setCreateAttempted(true);
                                        if (createPhoneProblem !== null) return;
                                        create.mutate(
                                            {
                                                displayName: name.trim(),
                                                phone: normaliseDeskPhone(phone),
                                            },
                                            {
                                                onSuccess: (result) => {
                                                    // Chosen at once: the agent just typed this
                                                    // person in. The duplicate warning, if any,
                                                    // is the thing to read before moving on.
                                                    if (result.possibleDuplicates.length === 0) {
                                                        choose(result.customer);
                                                    } else {
                                                        // Held open, and the tray opened on the
                                                        // possible duplicates, so they are read.
                                                        setChanging(true);
                                                        setChosen(result.customer);
                                                        onChoose(result.customer);
                                                        nudgeTray();
                                                    }
                                                },
                                            },
                                        );
                                    }}
                                />
                                <Button
                                    testID="kitchen-order-desk-sale-customer-cancel"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:desk.sale.customerCancelCreate')}
                                    onPress={() => {
                                        setCreating(false);
                                    }}
                                />
                            </Inline>
                        </View>
                    ) : (
                        <Inline space="xs">
                            <Button
                                testID="kitchen-order-desk-sale-customer-new"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:desk.sale.customerNew')}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={() => {
                                    setCreating(true);
                                    setCreateAttempted(false);
                                    // Opens on the kitchen's own code; the agent types the rest.
                                    if (phone === '' && dial !== null) setPhone(`${dial} `);
                                }}
                            />
                        </Inline>
                    )}
                </View>
            )}
        </FormSection>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The address
 * ---------------------------------------------------------------------------------------------- */

export function AddressSection({
    customerAccountId,
    customerAddressId,
    onSaved,
}: {
    readonly customerAccountId: string | null;
    readonly customerAddressId: string | null;
    readonly onSaved: (addressId: string) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    // Only the areas this kitchen's own map serves — the whole gazetteer would offer places the save
    // then refuses with `area_not_served`.
    const deliveryAreas = useOrderDeskDeliveryAreasQuery();
    const save = useAddOrderDeskCustomerAddressMutation();
    const { nudge: nudgeTray } = useIssueTrayController();

    const [areaId, setAreaId] = useState<string | null>(null);
    const [lineOne, setLineOne] = useState('');
    const [building, setBuilding] = useState('');
    const [directions, setDirections] = useState('');
    const [changing, setChanging] = useState(false);

    const saveFailure = toFailure(save.error);
    const server = serverFieldErrors(saveFailure, {
        delivery_area_id: {
            label: t('kitchen:desk.sale.areaLabel'),
            fieldId: 'kitchen-order-desk-sale-address-area',
        },
        line_one: {
            label: t('kitchen:desk.sale.lineOneLabel'),
            fieldId: 'kitchen-order-desk-sale-address-line-one',
        },
        building: {
            label: t('kitchen:desk.sale.buildingLabel'),
            fieldId: 'kitchen-order-desk-sale-address-building',
        },
        directions: {
            label: t('kitchen:desk.sale.directionsLabel'),
            fieldId: 'kitchen-order-desk-sale-address-directions',
        },
    });
    const saved = save.data ?? null;
    // Folded only while the saved address is still the sale's — a new customer clears it.
    const isTheSales = saved !== null && saved.id === customerAddressId;
    const folded = isTheSales && !changing;

    /*
     * A warning rather than a block: the address is real and saved, and whether a zone covers it is
     * the *quote's* answer — `area_not_served`, with the sentence the agent reads out. Said while it
     * is still the sale's address, whether or not the card is open to change it; Fix opens it.
     */
    useIssueGroup({
        key: 'check',
        title: t('kitchen:tray.groupCheck'),
        items:
            !isTheSales || saved.isDeliverable
                ? []
                : [
                      {
                          key: 'undeliverable',
                          tone: 'warning',
                          label: t('kitchen:desk.sale.addressUndeliverableTitle'),
                          detail: saved.lineOne,
                          action: {
                              onPress: () => {
                                  setChanging(true);
                                  focusField('kitchen-order-desk-sale-address-area');
                              },
                          },
                          testID: 'kitchen-order-desk-sale-address-undeliverable',
                      },
                  ],
    });

    const options = useMemo(
        () =>
            (deliveryAreas.data ?? []).map((area: ServiceArea) => ({
                value: String(area.id),
                label: displayName(area.name, locale).value,
                // The governorate under the name, because two districts share a name often enough
                // that the picker has to say which one it means.
                ...(area.parentName === null
                    ? {}
                    : { description: displayName(area.parentName, locale).value }),
            })),
        [deliveryAreas.data, locale],
    );

    return (
        <FormSection
            variant="card"
            testID="kitchen-order-desk-sale-address"
            title={t('kitchen:desk.sale.addressTitle')}
            description={folded ? undefined : t('kitchen:desk.sale.addressNoteBody')}
            actions={
                folded ? (
                    <Button
                        testID="kitchen-order-desk-sale-address-change"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:desk.sale.change')}
                        onPress={() => {
                            setChanging(true);
                        }}
                    />
                ) : undefined
            }
        >
            {folded ? (
                <Text variant="label" testID="kitchen-order-desk-sale-address-saved">
                    {saved.lineOne}
                </Text>
            ) : (
                <View className="z-auto flex-col gap-snug">
                    <FormGrid columns={3}>
                        <Select
                            testID="kitchen-order-desk-sale-address-area"
                            id="kitchen-order-desk-sale-address-area"
                            {...server.flag('delivery_area_id')}
                            label={t('kitchen:desk.sale.areaLabel')}
                            placeholder={
                                deliveryAreas.isSuccess && options.length === 0
                                    ? t('kitchen:desk.sale.areaPlaceholderNone')
                                    : t('kitchen:desk.sale.areaPlaceholder')
                            }
                            searchable
                            required
                            disabled={deliveryAreas.isPending || options.length === 0}
                            value={areaId}
                            options={options}
                            onChange={setAreaId}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-line-one"
                            id="kitchen-order-desk-sale-address-line-one"
                            {...server.flag('line_one')}
                            label={t('kitchen:desk.sale.lineOneLabel')}
                            placeholder={t('kitchen:desk.sale.lineOnePlaceholder')}
                            size="sm"
                            required
                            value={lineOne}
                            onChangeText={setLineOne}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-building"
                            id="kitchen-order-desk-sale-address-building"
                            {...server.flag('building')}
                            label={t('kitchen:desk.sale.buildingLabel')}
                            placeholder={t('kitchen:desk.sale.buildingPlaceholder')}
                            size="sm"
                            value={building}
                            onChangeText={setBuilding}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-directions"
                            id="kitchen-order-desk-sale-address-directions"
                            {...server.flag('directions')}
                            label={t('kitchen:desk.sale.directionsLabel')}
                            placeholder={t('kitchen:desk.sale.directionsPlaceholder')}
                            size="sm"
                            span={2}
                            multiline
                            value={directions}
                            onChangeText={setDirections}
                        />
                    </FormGrid>

                    {saveFailure === null ||
                    (server.isValidation && server.unplaced === null) ? null : (
                        <Text tone="danger" testID="kitchen-order-desk-sale-address-error">
                            {server.unplaced ?? saveFailure.message}
                        </Text>
                    )}

                    <Inline space="xs">
                        <Button
                            testID="kitchen-order-desk-sale-address-save"
                            size="sm"
                            label={t('kitchen:desk.sale.addressSave')}
                            loading={save.isPending}
                            disabled={
                                areaId === null ||
                                lineOne.trim() === '' ||
                                customerAccountId === null
                            }
                            onPress={() => {
                                if (areaId === null || customerAccountId === null) return;
                                save.mutate(
                                    {
                                        customerAccountId,
                                        deliveryAreaId: areaId,
                                        lineOne: lineOne.trim(),
                                        ...(building.trim() === ''
                                            ? {}
                                            : { building: building.trim() }),
                                        ...(directions.trim() === ''
                                            ? {}
                                            : { directions: directions.trim() }),
                                    },
                                    {
                                        onSuccess: (address) => {
                                            setChanging(false);
                                            onSaved(address.id);
                                            if (!address.isDeliverable) nudgeTray();
                                        },
                                    },
                                );
                            }}
                        />
                        {customerAccountId === null ? (
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:desk.sale.addressNeedsCustomer')}
                            </Text>
                        ) : null}
                    </Inline>
                </View>
            )}
        </FormSection>
    );
}
