import type { IsoDateTime } from '@healthy360/domain-types';

/**
 * The kitchen's customer book — a read-only reference list of who this kitchen sells to, and one
 * customer's record.
 *
 * Deliberately not a branch of `orderDesk`. The desk's customer shape is the narrowest disclosure
 * that lets an agent pick the right caller (a name and a number); this one is the reference page,
 * carrying email, every saved address, the account number and a corporate buyer's company record.
 * Both sit behind `order.view_customer_contact_organisation`, whose label says so.
 *
 * Order figures are always the asking kitchen's own. A person ordering from four kitchens holds one
 * account, and nothing here tells one kitchen about another's trade.
 */

export const KITCHEN_CUSTOMER_TYPES = ['b2c', 'b2b', 'guest'] as const;
export type KitchenCustomerType = (typeof KITCHEN_CUSTOMER_TYPES)[number];

export interface KitchenCustomer {
    readonly id: string;
    readonly accountNumber: string;
    readonly type: KitchenCustomerType;
    /** Null on an anonymised account. */
    readonly displayName: string | null;
    readonly status: string;
    readonly primaryPhone: string | null;
    readonly primaryEmail: string | null;
    readonly orderCount: number;
    readonly lastOrderedAt: IsoDateTime | null;
}

export interface KitchenCustomerContact {
    readonly channel: 'phone' | 'email';
    readonly value: string;
    readonly label: string | null;
    readonly isPrimary: boolean;
    readonly verified: boolean;
}

export interface KitchenCustomerAddress {
    readonly id: string;
    readonly type: 'delivery' | 'billing';
    readonly label: string | null;
    readonly lineOne: string | null;
    readonly lineTwo: string | null;
    readonly building: string | null;
    readonly floor: string | null;
    readonly apartment: string | null;
    readonly directions: string | null;
    readonly postalCode: string | null;
    readonly isDefault: boolean;
    readonly areaName: { readonly en: string | null; readonly ar: string | null };
}

export interface KitchenCustomerCompanyContact {
    readonly role: 'primary' | 'billing' | 'operations' | 'signatory';
    readonly name: string;
    readonly title: string | null;
    readonly email: string | null;
    readonly phone: string | null;
}

/** The buying organisation, and its approved application's company record when there is one. */
export interface KitchenCustomerCompany {
    readonly organisationName: string | null;
    readonly legalName: string | null;
    readonly legalNameAr: string | null;
    readonly tradingName: string | null;
    readonly businessType: string | null;
    readonly commercialRegistrationNumber: string | null;
    readonly taxRegistrationNumber: string | null;
    readonly signatory: {
        readonly name: string | null;
        readonly title: string | null;
        readonly email: string | null;
        readonly phone: string | null;
    };
    readonly contacts: readonly KitchenCustomerCompanyContact[];
}

export interface KitchenCustomerDetail extends KitchenCustomer {
    readonly origin: string;
    readonly preferredLanguageCode: string | null;
    readonly createdAt: IsoDateTime | null;
    readonly contacts: readonly KitchenCustomerContact[];
    readonly addresses: readonly KitchenCustomerAddress[];
    readonly company: KitchenCustomerCompany | null;
}

export interface KitchenCustomerFilter {
    /** A name fragment, or a full telephone number in E.164. */
    readonly query?: string;
    readonly type?: KitchenCustomerType;
}

/**
 * One page of the book. `total` is every match, `rows` at most the server's cap; `truncated` says
 * the difference is real so a screen can ask for a narrower search instead of implying completeness.
 */
export interface KitchenCustomerList {
    readonly rows: readonly KitchenCustomer[];
    readonly total: number;
    readonly truncated: boolean;
}

export interface KitchenCustomersRepository {
    listCustomers(filter: KitchenCustomerFilter): Promise<KitchenCustomerList>;
    /** `resource.not_found` for an account outside this kitchen's book. */
    getCustomer(customerId: string): Promise<KitchenCustomerDetail>;
}
