import type { OrderDeskCustomer, ServiceArea } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
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
} from '@healthy360/design-system';
import { fieldWidth } from '@healthy360/design-tokens';
import { useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../../data/hooks.ts';
import { useServiceAreasQuery } from '../../../data/kitchen-admin-hooks.ts';
import {
    CUSTOMER_SEARCH_MIN_LENGTH,
    useAddOrderDeskCustomerAddressMutation,
    useCreateOrderDeskCustomerMutation,
    useOrderDeskCustomerSearchQuery,
} from '../../../data/order-desk-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { displayName } from '../format.ts';
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

export function CustomerSection({
    customerAccountId,
    onChoose,
}: {
    /** The chosen account, from the sale's state. `null` opens the search. */
    readonly customerAccountId: string | null;
    readonly onChoose: (customer: OrderDeskCustomer) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    /** The record behind `customerAccountId`, held so the folded card can name them. */
    const [chosen, setChosen] = useState<OrderDeskCustomer | null>(null);
    const [changing, setChanging] = useState(false);

    const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    const search = useOrderDeskCustomerSearchQuery(debounced);
    const create = useCreateOrderDeskCustomerMutation();

    const searchFailure = toFailure(search.error);
    const createFailure = toFailure(create.error);
    const tooShort = debounced.length > 0 && debounced.length < CUSTOMER_SEARCH_MIN_LENGTH;
    const rows = search.data?.rows ?? [];
    const answered =
        customerAccountId !== null && chosen !== null && chosen.id === customerAccountId;
    const folded = answered && !changing;

    function choose(customer: OrderDeskCustomer) {
        setChosen(customer);
        setChanging(false);
        setCreating(false);
        onChoose(customer);
    }

    return (
        <FormSection
            variant="card"
            testID="kitchen-order-desk-sale-customer"
            title={t('kitchen:desk.sale.customerTitle')}
            actions={
                folded ? (
                    <Button
                        testID="kitchen-order-desk-sale-customer-change"
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
            {folded && chosen !== null ? (
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
                                    hint={t('kitchen:desk.sale.customerNameHint')}
                                    size="sm"
                                    required
                                    value={name}
                                    onChangeText={setName}
                                />
                                <TextInputField
                                    testID="kitchen-order-desk-sale-customer-phone"
                                    id="kitchen-order-desk-sale-customer-phone"
                                    label={t('kitchen:desk.sale.customerPhoneLabel')}
                                    hint={t('kitchen:desk.sale.customerPhoneHint')}
                                    placeholder="+9613000111"
                                    size="sm"
                                    required
                                    value={phone}
                                    onChangeText={setPhone}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    inputMode="tel"
                                />
                            </FormGrid>

                            {createFailure === null ? null : (
                                <Text
                                    tone="danger"
                                    testID="kitchen-order-desk-sale-customer-create-error"
                                >
                                    {createFailure.message}
                                </Text>
                            )}

                            {create.data === undefined ||
                            create.data.possibleDuplicates.length === 0 ? null : (
                                <Callout
                                    testID="kitchen-order-desk-sale-customer-duplicates"
                                    tone="warning"
                                    role="status"
                                    title={t('kitchen:desk.sale.customerDuplicatesTitle')}
                                    body={t('kitchen:desk.sale.customerDuplicatesBody')}
                                >
                                    <View className="flex-col gap-hair">
                                        {create.data.possibleDuplicates.map((duplicate) => (
                                            <Inline
                                                key={duplicate.id}
                                                space="sm"
                                                align="center"
                                                wrap
                                                testID={`kitchen-order-desk-sale-customer-duplicate-${duplicate.id}`}
                                            >
                                                <Text variant="caption">
                                                    {`${
                                                        duplicate.displayName ??
                                                        t('kitchen:desk.sale.customerUnnamed')
                                                    } · ${duplicate.phone ?? EM_DASH}`}
                                                </Text>
                                                <Button
                                                    testID={`kitchen-order-desk-sale-customer-duplicate-${duplicate.id}-choose`}
                                                    size="sm"
                                                    variant="secondary"
                                                    label={t(
                                                        'kitchen:desk.sale.customerUseInstead',
                                                    )}
                                                    onPress={() => {
                                                        choose(duplicate);
                                                    }}
                                                />
                                            </Inline>
                                        ))}
                                    </View>
                                </Callout>
                            )}

                            <Inline space="xs" wrap>
                                <Button
                                    testID="kitchen-order-desk-sale-customer-create"
                                    size="sm"
                                    label={t('kitchen:desk.sale.customerCreate')}
                                    loading={create.isPending}
                                    disabled={name.trim() === '' || phone.trim() === ''}
                                    onPress={() => {
                                        create.mutate(
                                            { displayName: name.trim(), phone: phone.trim() },
                                            {
                                                onSuccess: (result) => {
                                                    // Chosen at once: the agent just typed this
                                                    // person in. The duplicate warning, if any,
                                                    // is the thing to read before moving on.
                                                    if (result.possibleDuplicates.length === 0) {
                                                        choose(result.customer);
                                                    } else {
                                                        // Held open, so the possible duplicates
                                                        // stay on screen to be read.
                                                        setChanging(true);
                                                        setChosen(result.customer);
                                                        onChoose(result.customer);
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

/**
 * The country whose gazetteer this desk may write addresses in, from the session.
 *
 * The area table spans every market the platform has opened, and an unscoped picker would offer an
 * agent hundreds of places their kitchen can never deliver to. Read from `me()`'s membership exactly
 * as the delivery-zone editor reads it.
 */
function useOrganisationCountry(): string | null {
    const access = useAccessState();
    const { me } = useSession();
    const membershipId = access.organisation?.membershipId;

    return useMemo(() => {
        if (membershipId === undefined) return null;
        const membership = me?.memberships.find((candidate) => candidate.id === membershipId);
        return membership?.organisation.countryCode ?? null;
    }, [me, membershipId]);
}

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
    const country = useOrganisationCountry();
    const gazetteer = useServiceAreasQuery(country);
    const save = useAddOrderDeskCustomerAddressMutation();

    const [areaId, setAreaId] = useState<string | null>(null);
    const [lineOne, setLineOne] = useState('');
    const [lineTwo, setLineTwo] = useState('');
    const [building, setBuilding] = useState('');
    const [directions, setDirections] = useState('');
    const [changing, setChanging] = useState(false);

    const saveFailure = toFailure(save.error);
    const saved = save.data ?? null;
    // Folded only while the saved address is still the sale's — a new customer clears it.
    const folded = saved !== null && saved.id === customerAddressId && !changing;

    const options = useMemo(
        () =>
            (gazetteer.data?.areas ?? []).map((area: ServiceArea) => ({
                value: String(area.id),
                label: displayName(area.name, locale).value,
                // The governorate under the name, because two districts share a name often enough
                // that the picker has to say which one it means.
                ...(area.parentName === null
                    ? {}
                    : { description: displayName(area.parentName, locale).value }),
            })),
        [gazetteer.data, locale],
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
            {folded && saved !== null ? (
                <View className="flex-col gap-tight">
                    <Text variant="label" testID="kitchen-order-desk-sale-address-saved">
                        {[saved.lineOne, saved.lineTwo]
                            .filter((part) => part !== null && part !== '')
                            .join(' · ')}
                    </Text>
                    {saved.isDeliverable ? null : (
                        // A warning rather than a block: the address is real and saved, and whether
                        // a zone covers it is the *quote's* answer — `area_not_served`, with the
                        // sentence the agent reads out.
                        <Callout
                            testID="kitchen-order-desk-sale-address-undeliverable"
                            tone="warning"
                            role="alert"
                            title={t('kitchen:desk.sale.addressUndeliverableTitle')}
                            body={t('kitchen:desk.sale.addressUndeliverableBody')}
                        />
                    )}
                </View>
            ) : (
                <View className="z-auto flex-col gap-snug">
                    <FormGrid columns={3}>
                        <Select
                            testID="kitchen-order-desk-sale-address-area"
                            label={t('kitchen:desk.sale.areaLabel')}
                            placeholder={t('kitchen:desk.sale.areaPlaceholder')}
                            searchable
                            required
                            disabled={gazetteer.isPending || options.length === 0}
                            value={areaId}
                            options={options}
                            onChange={setAreaId}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-line-one"
                            id="kitchen-order-desk-sale-address-line-one"
                            label={t('kitchen:desk.sale.lineOneLabel')}
                            size="sm"
                            required
                            value={lineOne}
                            onChangeText={setLineOne}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-line-two"
                            id="kitchen-order-desk-sale-address-line-two"
                            label={t('kitchen:desk.sale.lineTwoLabel')}
                            size="sm"
                            value={lineTwo}
                            onChangeText={setLineTwo}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-building"
                            id="kitchen-order-desk-sale-address-building"
                            label={t('kitchen:desk.sale.buildingLabel')}
                            size="sm"
                            value={building}
                            onChangeText={setBuilding}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-address-directions"
                            id="kitchen-order-desk-sale-address-directions"
                            label={t('kitchen:desk.sale.directionsLabel')}
                            size="sm"
                            span={2}
                            multiline
                            value={directions}
                            onChangeText={setDirections}
                        />
                    </FormGrid>

                    {saveFailure === null ? null : (
                        <Text tone="danger" testID="kitchen-order-desk-sale-address-error">
                            {saveFailure.message}
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
                                        ...(lineTwo.trim() === ''
                                            ? {}
                                            : { lineTwo: lineTwo.trim() }),
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
