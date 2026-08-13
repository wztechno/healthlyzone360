import { AllergenCode, ServiceAreaId } from '@healthy360/domain-types';

import type { AccountServiceArea } from '../contracts/account.ts';
import type { AllergenClass, ServiceArea, ServiceAreaFilter } from '../contracts/kitchen-admin.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    PublicAllergenClass as WireAllergenClass,
    PublicDeliveryArea as WireDeliveryArea,
    PublicDeliveryAreasEnvelope,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Platform reference data, served for real.
 *
 * Two families, both anonymous, both read-only from every client: the allergen gazetteer under
 * `GET /reference/allergen-classes` and the delivery-area gazetteer under
 * `GET /reference/delivery-areas`. They were `prototype.not_implemented` stubs on
 * `KitchenAdminRepository` until this wave; both endpoints exist, so both entries have left the
 * ledger.
 *
 * ## Why one file serves two contracts
 *
 * The same delivery-area rows are read by two audiences with two shapes. A kitchen manager building
 * a zone gets `ServiceArea` — localised names, a parent, an activation flag — through
 * `KitchenAdminRepository.listServiceAreas`. A person adding a home address gets
 * `AccountServiceArea`, which is an identifier and a name and nothing else
 * (`AccountRepository.listServiceAreas`). One endpoint, two projections, and the projection is the
 * only difference: duplicating the request would mean two caches of the same gazetteer that could
 * disagree about which areas exist.
 *
 * ## `LocalisedText` from a server that chose a language
 *
 * The admin contracts carry `{ en, ar }` for names because a management screen edits both. The
 * public endpoints send **one** name, already chosen from `Accept-Language` (§4.8), and this file
 * puts it in both slots rather than leaving one empty. That is a documented deviation, not a
 * mapping accident: an empty `ar` would render as a blank label in an Arabic build, which is worse
 * than showing the same string twice. The `locale` the server used is on the envelope's `meta`, so
 * the day a management screen needs the other language it asks for it explicitly.
 */

/**
 * Which markets regulate a class, reconstructed from the two labelling-regime flags.
 *
 * The wire carries `is_eu_14` and `is_us_big_9` — two booleans — where `AllergenClass.markets` is a
 * list of market codes. Building the list from the flags rather than inventing a `markets` field
 * server-side keeps the contract's promise intact: a class a market does not regulate appears with
 * that market absent, which is exactly what a `false` flag means. `GCC` is deliberately **not**
 * emitted: no flag on this endpoint says anything about it, and a market code nobody sent would be
 * a regulatory claim the platform never made.
 */
function readMarkets(wire: WireAllergenClass): readonly string[] {
    const markets: string[] = [];
    if (wire.is_eu_14) markets.push('EU');
    if (wire.is_us_big_9 || wire.us_declaration_required) markets.push('US');
    return markets;
}

/**
 * The threshold, in the unit the wire states it in.
 *
 * `us_threshold_ppm` is the only threshold the endpoint publishes and it is parts per million, so
 * the unit is written out rather than left to a caller to assume. Absent means "any detectable
 * amount", which the contract spells `null`.
 */
function readThreshold(
    wire: WireAllergenClass,
): { readonly value: number; readonly unit: string } | null {
    const ppm = wire.us_threshold_ppm;
    return typeof ppm === 'number' ? { value: ppm, unit: 'ppm' } : null;
}

export function mapAllergenClass(wire: WireAllergenClass): AllergenClass {
    const name = wire.name;
    const description = wire.description ?? '';

    return {
        code: AllergenCode.unsafe(wire.code),
        name: { en: name, ar: name },
        description: { en: description, ar: description },
        markets: readMarkets(wire),
        declarationThreshold: readThreshold(wire),
        regulatoryReference: wire.regulatory_ref,
        // The field this switch was waiting for. It is a *presentation* default — which classes a
        // declaration form pre-marks as serious — and the endpoint now says so per class, so the
        // client no longer has to carry a hard-coded list of seven codes that would drift the day
        // a regulator moved one.
        severeByDefault: wire.severe_by_default === true,
        // The public projection lists live classes only; a deactivated one is absent rather than
        // present-and-false. Answering `true` is therefore a statement about what was served, not
        // an assumption about what exists.
        isActive: true,
    };
}

export function mapServiceArea(wire: WireDeliveryArea): ServiceArea {
    const region = wire.region;

    return {
        id: ServiceAreaId.unsafe(wire.id),
        name: { en: wire.name, ar: wire.name },
        countryCode: wire.country_code,
        parentName: region === null ? null : { en: region, ar: region },
        isActive: true,
    };
}

export function mapAccountServiceArea(wire: WireDeliveryArea): AccountServiceArea {
    return { id: ServiceAreaId.unsafe(wire.id), name: wire.name };
}

/** The two reference reads, over the transport, shared by the account and kitchen surfaces. */
export interface ApiReferenceReads {
    listAllergenClasses(): Promise<readonly AllergenClass[]>;
    listServiceAreas(filter?: ServiceAreaFilter): Promise<CursorPage<ServiceArea>>;
    /** The consumer projection: an identifier and a name, for an address editor's area select. */
    listAccountServiceAreas(): Promise<readonly AccountServiceArea[]>;
}

/**
 * Every page of the gazetteer an address select needs — it is a closed list, not a feed.
 *
 * 100, not more: the endpoint rejects any `limit` above `CursorPage`'s cap with
 * `request.invalid` (400), and a directory whose first page 400s resolves every address's
 * area name to `''`. The walk below follows `has_more`, so page size is throughput, not reach.
 */
const AREA_PAGE_LIMIT = 100;

export function createApiReferenceReads(transport: Transport): ApiReferenceReads {
    function areaQuery(filter?: ServiceAreaFilter): string {
        const search = new URLSearchParams();
        // `country_code` became optional on this endpoint in the backend wave that unblocked the
        // switch. Before that it was required, which is why the client could not call it at all
        // without knowing a market the consumer surfaces never ask about.
        if (filter?.countryCode !== undefined) search.set('country_code', filter.countryCode);
        if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
        if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
        const rendered = search.toString();
        return rendered === '' ? '' : `?${rendered}`;
    }

    /**
     * `query` is applied here rather than sent.
     *
     * The endpoint takes no text filter, and a `?query=` it ignores would silently return the whole
     * gazetteer to a screen that believes it searched. Filtering the page the server did return is
     * the honest reading of `ServiceAreaFilter.query` against this endpoint — and it is correct for
     * the one caller that uses it, a picker over a closed list of a few hundred rows.
     */
    function matches(area: ServiceArea, query: string | undefined): boolean {
        if (query === undefined || query.trim() === '') return true;
        const needle = query.trim().toLowerCase();
        return (
            area.name.en.toLowerCase().includes(needle) ||
            area.name.ar.toLowerCase().includes(needle)
        );
    }

    return {
        async listAllergenClasses(): Promise<readonly AllergenClass[]> {
            const wire = await transport.request<WireAllergenClass[]>({
                method: 'GET',
                anonymous: true,
                path: '/reference/allergen-classes',
            });
            return wire.map(mapAllergenClass);
        },

        async listServiceAreas(filter?: ServiceAreaFilter): Promise<CursorPage<ServiceArea>> {
            const envelope = await transport.requestEnvelope<WireDeliveryArea[]>({
                method: 'GET',
                anonymous: true,
                path: `/reference/delivery-areas${areaQuery(filter)}`,
            });

            const meta = envelope.meta as PublicDeliveryAreasEnvelope['meta'];
            const items = envelope.data
                .map(mapServiceArea)
                .filter((area) => matches(area, filter?.query));

            return {
                items,
                nextCursor: meta.next_cursor,
                hasMore: meta.has_more,
                // A keyset page cannot state a total without a second count that would disagree
                // with the page under concurrent writes; the contract reserves `null` for that.
                totalCount: null,
            };
        },

        async listAccountServiceAreas(): Promise<readonly AccountServiceArea[]> {
            const areas: AccountServiceArea[] = [];
            let cursor: string | undefined;

            // The whole gazetteer, followed to the end. An address select is a closed list — a
            // person must be able to find their own area — so a first page with `has_more` set
            // would be a picker that silently cannot offer half the country.
            do {
                const envelope = await transport.requestEnvelope<WireDeliveryArea[]>({
                    method: 'GET',
                    anonymous: true,
                    path: `/reference/delivery-areas?limit=${AREA_PAGE_LIMIT}${
                        cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`
                    }`,
                });

                for (const wire of envelope.data) areas.push(mapAccountServiceArea(wire));

                const meta = envelope.meta as PublicDeliveryAreasEnvelope['meta'];
                cursor = meta.has_more && meta.next_cursor !== null ? meta.next_cursor : undefined;
            } while (cursor !== undefined);

            return areas;
        },
    };
}
