import type {
    KitchenCustomerAddress,
    KitchenCustomerCompany,
    KitchenCustomerContact,
    KitchenCustomerDetail,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    ErrorState,
    Inline,
    RecordWindowFieldGrid,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone, RecordWindowField } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useKitchenCustomerQuery } from '../../../data/kitchen-customers-hooks.ts';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { ORDER_VIEW_CUSTOMER_CONTACT_PERMISSION } from '../entity-registry.ts';
import { prefersArabic } from '../format.ts';
import { customerName, customerTypeKey, customerTypeTone } from './customers-screen.tsx';

/**
 * `/kitchen/customers/{customer}` — one customer in the kitchen's book: their contacts, every saved
 * address, and for a corporate buyer the company record and named contacts. Read-only; correcting a
 * caller stays at the order desk, which the note says.
 *
 * An account outside this kitchen's book answers `resource.not_found` from the server, drawn here as
 * the same not-found state a hand-typed link gets.
 */

export interface CustomerDetailScreenProps {
    readonly customer: string | undefined;
}

export function CustomerDetailScreen({ customer }: CustomerDetailScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_CUSTOMER_CONTACT_PERMISSION] }}
            testID="kitchen-customer"
        >
            <CustomerRecord customer={customer} />
        </Gate>
    );
}

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
    active: 'success',
    provisional: 'warning',
    suspended: 'danger',
    closed: 'neutral',
};

function statusLabel(status: string, t: TFunction): string {
    switch (status) {
        case 'active':
            return t('kitchen:ops.customers.statusActive');
        case 'provisional':
            return t('kitchen:ops.customers.statusProvisional');
        case 'suspended':
            return t('kitchen:ops.customers.statusSuspended');
        default:
            return t('kitchen:ops.customers.statusClosed');
    }
}

function CustomerRecord({ customer }: CustomerDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const record = useKitchenCustomerQuery(customer);
    const failure = toFailure(record.error);

    const backToList = () => {
        router.push('/kitchen/customers' as never);
    };

    if (customer === undefined || customer === '' || failure?.code === 'resource.not_found') {
        return (
            <Stack space="lg" testID="kitchen-customer-screen">
                <Callout
                    testID="kitchen-customer-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:ops.customers.notFoundTitle')}
                    body={t('kitchen:ops.customers.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-customer-not-found-back"
                            variant="quiet"
                            label={t('kitchen:ops.customers.backToList')}
                            onPress={backToList}
                        />
                    }
                />
            </Stack>
        );
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-customer-error"
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }

    if (record.data === undefined) {
        return <TableSkeleton testID="kitchen-customer-loading" partTestID="kitchen-customer" />;
    }

    return <CustomerView detail={record.data} onBack={backToList} />;
}

function CustomerView({
    detail,
    onBack,
}: {
    readonly detail: KitchenCustomerDetail;
    readonly onBack: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const fields: RecordWindowField[] = [
        {
            key: 'accountNumber',
            label: t('kitchen:ops.customers.fieldAccountNumber'),
            value: detail.accountNumber,
            mono: true,
        },
        {
            key: 'type',
            label: t('kitchen:ops.customers.fieldType'),
            value: t(customerTypeKey(detail.type)),
        },
        {
            key: 'orders',
            label: t('kitchen:ops.customers.fieldOrders'),
            value: String(detail.orderCount),
            mono: true,
        },
        {
            key: 'lastOrder',
            label: t('kitchen:ops.customers.fieldLastOrder'),
            value:
                detail.lastOrderedAt === null
                    ? t('kitchen:ops.customers.neverOrdered')
                    : formatter.formatDate(detail.lastOrderedAt),
        },
        {
            key: 'since',
            label: t('kitchen:ops.customers.fieldCustomerSince'),
            value:
                detail.createdAt === null
                    ? t('kitchen:common.notRecorded')
                    : formatter.formatDate(detail.createdAt),
        },
    ];

    return (
        <RecordViewPage
            testID="kitchen-customer-view"
            title={customerName(detail, t)}
            kind={t('kitchen:ops.customers.viewKind')}
            reference={detail.accountNumber}
            titleAside={
                <Badge
                    tone={customerTypeTone(detail.type)}
                    label={t(customerTypeKey(detail.type))}
                />
            }
            status={{
                label: statusLabel(detail.status, t),
                tone: STATUS_TONE[detail.status] ?? 'neutral',
            }}
            onBack={onBack}
            note={t('kitchen:ops.customers.readOnlyNote')}
            fields={fields}
            sections={[
                {
                    key: 'contacts',
                    title: t('kitchen:ops.customers.sectionContacts'),
                    content: <ContactList contacts={detail.contacts} />,
                },
                {
                    key: 'addresses',
                    title: t('kitchen:ops.customers.sectionAddresses'),
                    content: <AddressList addresses={detail.addresses} />,
                },
                ...(detail.company === null
                    ? []
                    : [
                          {
                              key: 'company',
                              title: t('kitchen:ops.customers.sectionCompany'),
                              content: <CompanyRecord company={detail.company} />,
                          },
                      ]),
            ]}
        />
    );
}

function ContactList({ contacts }: { readonly contacts: readonly KitchenCustomerContact[] }) {
    const { t } = useTranslation();

    if (contacts.length === 0) {
        return <Text tone="secondary">{t('kitchen:ops.customers.noContacts')}</Text>;
    }

    return (
        <Stack space="sm" testID="kitchen-customer-contacts">
            {contacts.map((contact, index) => (
                <Inline key={`${contact.channel}-${contact.value}-${String(index)}`} space="sm">
                    <Text tone="secondary">
                        {contact.channel === 'phone'
                            ? t('kitchen:ops.customers.channelPhone')
                            : t('kitchen:ops.customers.channelEmail')}
                    </Text>
                    <Text variant="mono" testID={`kitchen-customer-contact-${String(index)}`}>
                        {contact.value}
                    </Text>
                    {contact.label === null ? null : <Text tone="secondary">{contact.label}</Text>}
                    {contact.isPrimary ? (
                        <Badge tone="brand" label={t('kitchen:ops.customers.contactPrimary')} />
                    ) : null}
                    {contact.verified ? (
                        <Badge tone="success" label={t('kitchen:ops.customers.contactVerified')} />
                    ) : null}
                </Inline>
            ))}
        </Stack>
    );
}

function addressLine(address: KitchenCustomerAddress, locale: string, t: TFunction): string {
    const area = prefersArabic(locale)
        ? (address.areaName.ar ?? address.areaName.en)
        : (address.areaName.en ?? address.areaName.ar);
    return [
        address.lineOne,
        address.lineTwo,
        address.building === null
            ? null
            : t('kitchen:ops.customers.addressBuilding', { value: address.building }),
        address.floor === null
            ? null
            : t('kitchen:ops.customers.addressFloor', { value: address.floor }),
        address.apartment === null
            ? null
            : t('kitchen:ops.customers.addressApartment', { value: address.apartment }),
        area,
        address.postalCode,
    ]
        .filter((part): part is string => part !== null && part !== '')
        .join(' · ');
}

function AddressList({ addresses }: { readonly addresses: readonly KitchenCustomerAddress[] }) {
    const { t } = useTranslation();
    const { locale } = useLocale();

    if (addresses.length === 0) {
        return <Text tone="secondary">{t('kitchen:ops.customers.noAddresses')}</Text>;
    }

    return (
        <Stack space="md" testID="kitchen-customer-addresses">
            {addresses.map((address) => (
                <View key={address.id} testID={`kitchen-customer-address-${address.id}`}>
                    <Inline space="sm">
                        <Text variant="strong">
                            {address.label ??
                                (address.type === 'billing'
                                    ? t('kitchen:ops.customers.addressBilling')
                                    : t('kitchen:ops.customers.addressDelivery'))}
                        </Text>
                        {address.isDefault ? (
                            <Badge tone="brand" label={t('kitchen:ops.customers.addressDefault')} />
                        ) : null}
                    </Inline>
                    <Text>{addressLine(address, locale, t)}</Text>
                    {address.directions === null ? null : (
                        <Text tone="secondary">{address.directions}</Text>
                    )}
                </View>
            ))}
        </Stack>
    );
}

function roleKey(role: KitchenCustomerCompany['contacts'][number]['role']): string {
    switch (role) {
        case 'billing':
            return 'kitchen:ops.customers.roleBilling';
        case 'operations':
            return 'kitchen:ops.customers.roleOperations';
        case 'signatory':
            return 'kitchen:ops.customers.roleSignatory';
        case 'primary':
            return 'kitchen:ops.customers.rolePrimary';
    }
}

function CompanyRecord({ company }: { readonly company: KitchenCustomerCompany }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const none = t('kitchen:common.notRecorded');

    const legalName = prefersArabic(locale)
        ? (company.legalNameAr ?? company.legalName)
        : company.legalName;
    const signatory = [
        company.signatory.name,
        company.signatory.title,
        company.signatory.phone,
        company.signatory.email,
    ]
        .filter((part): part is string => part !== null && part !== '')
        .join(' · ');
    const hasApplication =
        company.legalName !== null || company.commercialRegistrationNumber !== null;

    const fields: RecordWindowField[] = [
        {
            key: 'organisation',
            label: t('kitchen:ops.customers.companyOrganisation'),
            value: company.organisationName ?? none,
        },
        ...(hasApplication
            ? [
                  {
                      key: 'legalName',
                      label: t('kitchen:ops.customers.companyLegalName'),
                      value: legalName ?? none,
                  },
                  {
                      key: 'tradingName',
                      label: t('kitchen:ops.customers.companyTradingName'),
                      value: company.tradingName ?? none,
                  },
                  {
                      key: 'businessType',
                      label: t('kitchen:ops.customers.companyBusinessType'),
                      value: company.businessType ?? none,
                  },
                  {
                      key: 'cr',
                      label: t('kitchen:ops.customers.companyCr'),
                      value: company.commercialRegistrationNumber ?? none,
                      mono: company.commercialRegistrationNumber !== null,
                  },
                  {
                      key: 'vat',
                      label: t('kitchen:ops.customers.companyVat'),
                      value: company.taxRegistrationNumber ?? none,
                      mono: company.taxRegistrationNumber !== null,
                  },
                  {
                      key: 'signatory',
                      label: t('kitchen:ops.customers.companySignatory'),
                      value: signatory === '' ? none : signatory,
                  },
              ]
            : []),
    ];

    return (
        <Stack space="md" testID="kitchen-customer-company">
            <RecordWindowFieldGrid fields={fields} />
            {hasApplication ? null : (
                <Text tone="secondary">{t('kitchen:ops.customers.noCompanyRecord')}</Text>
            )}
            {company.contacts.length === 0 ? null : (
                <Stack space="sm">
                    <Text variant="strong">
                        {t('kitchen:ops.customers.sectionCompanyContacts')}
                    </Text>
                    {company.contacts.map((contact) => (
                        <Inline
                            key={contact.role}
                            space="sm"
                            testID={`kitchen-customer-company-contact-${contact.role}`}
                        >
                            <Text tone="secondary">{t(roleKey(contact.role))}</Text>
                            <Text variant="strong">{contact.name}</Text>
                            {contact.title === null ? null : (
                                <Text tone="secondary">{contact.title}</Text>
                            )}
                            {contact.phone === null ? null : (
                                <Text variant="mono">{contact.phone}</Text>
                            )}
                            {contact.email === null ? null : <Text>{contact.email}</Text>}
                        </Inline>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
