import type { IsoDateTime } from '@healthy360/domain-types';

import type {
    KitchenCustomer,
    KitchenCustomerDetail,
    KitchenCustomerFilter,
    KitchenCustomerList,
    KitchenCustomersRepository,
} from '../contracts/kitchen-customers.ts';
import type {
    KitchenCustomer as WireKitchenCustomer,
    KitchenCustomerDetail as WireKitchenCustomerDetail,
    KitchenCustomersEnvelope,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * The kitchen's customer book over `/catalogue/customers`. `requestEnvelope` on the list, because
 * `total` and `truncated` live in the meta and the screen needs both.
 */
export function createApiKitchenCustomersRepository(
    transport: Transport,
): KitchenCustomersRepository {
    return {
        async listCustomers(filter: KitchenCustomerFilter): Promise<KitchenCustomerList> {
            const search = new URLSearchParams();
            const query = filter.query?.trim() ?? '';
            if (query !== '') search.set('query', query);
            if (filter.type !== undefined) search.set('type', filter.type);
            const suffix = search.size === 0 ? '' : `?${search.toString()}`;

            const envelope = await transport.requestEnvelope<readonly WireKitchenCustomer[]>({
                method: 'GET',
                path: `/catalogue/customers${suffix}`,
            });

            const meta = envelope.meta as KitchenCustomersEnvelope['meta'];
            return {
                rows: envelope.data.map(mapKitchenCustomer),
                total: meta.total,
                truncated: meta.truncated,
            };
        },

        async getCustomer(customerId: string): Promise<KitchenCustomerDetail> {
            const wire = await transport.request<WireKitchenCustomerDetail>({
                method: 'GET',
                path: `/catalogue/customers/${encodeURIComponent(customerId)}`,
            });
            return mapKitchenCustomerDetail(wire);
        },
    };
}

export function mapKitchenCustomer(wire: WireKitchenCustomer): KitchenCustomer {
    return {
        id: wire.id,
        accountNumber: wire.account_number,
        type: wire.account_type,
        displayName: wire.display_name,
        status: wire.status,
        primaryPhone: wire.primary_phone,
        primaryEmail: wire.primary_email,
        orderCount: wire.order_count,
        lastOrderedAt: (wire.last_ordered_at ?? null) as IsoDateTime | null,
    };
}

export function mapKitchenCustomerDetail(wire: WireKitchenCustomerDetail): KitchenCustomerDetail {
    const company = wire.company;
    return {
        ...mapKitchenCustomer(wire),
        origin: wire.origin,
        preferredLanguageCode: wire.preferred_language_code,
        createdAt: (wire.created_at ?? null) as IsoDateTime | null,
        contacts: wire.contacts.map((contact) => ({
            channel: contact.channel,
            value: contact.value,
            label: contact.label,
            isPrimary: contact.is_primary,
            verified: contact.verified,
        })),
        addresses: wire.addresses.map((address) => ({
            id: address.id,
            type: address.address_type,
            label: address.label,
            lineOne: address.line_one,
            lineTwo: address.line_two,
            building: address.building,
            floor: address.floor,
            apartment: address.apartment,
            directions: address.directions,
            postalCode: address.postal_code,
            isDefault: address.is_default,
            areaName: { en: address.area_name_en, ar: address.area_name_ar },
        })),
        company:
            company === null
                ? null
                : {
                      organisationName: company.organisation_name,
                      legalName: company.legal_name,
                      legalNameAr: company.legal_name_ar,
                      tradingName: company.trading_name,
                      businessType: company.business_type,
                      commercialRegistrationNumber: company.commercial_registration_number,
                      taxRegistrationNumber: company.tax_registration_number,
                      signatory: {
                          name: company.signatory_name,
                          title: company.signatory_title,
                          email: company.signatory_email,
                          phone: company.signatory_phone,
                      },
                      contacts: company.contacts.map((contact) => ({
                          role: contact.role,
                          name: contact.name,
                          title: contact.title,
                          email: contact.email,
                          phone: contact.phone,
                      })),
                  },
    };
}
