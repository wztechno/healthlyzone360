import type {
    AddCartItemRequest,
    CatalogueFilter,
    CatalogueItem,
    Cart,
    CorporateProgramme,
    CursorPage,
    Quotation,
    QuotationFilter,
    RequestQuotationRequest,
} from '@healthy360/api-client/contracts';
import type { CorporateProgrammeId, MealId, QuotationId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useAddCartItemMutation } from './catalogue-hooks.ts';
import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * Corporate programmes, negotiated catalogues and quotations.
 *
 * Same rules as every other hook module here — one hook per repository operation, the `enabled`
 * guards and the invalidation written once, and no screen ever holding a repository. Three things
 * are specific to the business surfaces and each one is a decision rather than a style.
 *
 * ## Nothing under this root may be persisted, and nothing outside it may hold a contract price
 *
 * `PERSISTABLE_QUERY_ROOTS` in `./query-keys.ts` admits `reference` and `catalogue` only. A
 * negotiated price is the single most confidential figure the prototype carries; writing one to disk
 * so that a shared laptop can restore it after a restart would defeat the whole privacy story that
 * `contracts/business.ts` is built around. Equally, every read here is keyed under `business` —
 * a contract price cached under `catalogue.meal(...)` would be a consumer-visible cache entry.
 *
 * ## Programmes are listed for the organisation
 *
 * `BusinessRepository.listCorporateProgrammes()` is the discovery path (B2).
 * Membership is also mirrored on `/me`'s active context; the list endpoint is
 * what the corporate dashboard reads so a programme with no quotations yet is
 * still visible.
 *
 * ## The quotation request is a real mutation
 *
 * `requestQuotation` exists on the contract *and* the prototype store honours it: it validates every
 * line against its minimum order quantity, allocates a reference, and files a `submitted` quotation
 * carrying no price at all (pricing is the account manager's act). So it is wired as a mutation
 * rather than as a `usePrototypeAction`, per the rule in `src/prototype/prototype-action.ts` — the
 * prototype notice is for capabilities that are genuinely absent, and accepting, declining and
 * exporting a quotation are the ones that actually are.
 */

export { toFailure } from './hooks.ts';

/** Wholesale channel code for corporate buyer carts. Matches the demo `B2bCheckoutWorld`. */
export const B2B_CART_CHANNEL_CODE = 'wholesale';

/**
 * Adds a negotiated catalogue line to the corporate buyer's wholesale basket.
 *
 * Uses the same `CommerceRepository` surface as the consumer storefront, but opens the cart on the
 * B2B channel so agreement pricing applies at placement.
 */
export function useB2bAddToCartMutation(): UseMutationResult<Cart, unknown, AddCartItemRequest> {
    return useAddCartItemMutation(B2B_CART_CHANNEL_CODE);
}

export interface B2bAddCatalogueItemVariables {
    readonly mealId: MealId;
    readonly quantity: number;
}

/** Adds a catalogue line to the wholesale basket at an explicit quantity. */
export function useB2bAddCatalogueItemMutation(): UseMutationResult<
    Cart,
    unknown,
    B2bAddCatalogueItemVariables
> {
    const addToCart = useB2bAddToCartMutation();

    return useMutation({
        mutationFn: ({ mealId, quantity }: B2bAddCatalogueItemVariables) =>
            addToCart.mutateAsync({ mealId, quantity }),
    });
}

/* ── programmes ──────────────────────────────────────────────────────────────────────────────── */

/** One corporate programme. Nullable identifier for the routing race every detail screen has. */
export function useCorporateProgrammeQuery(
    programmeId: CorporateProgrammeId | null,
): UseQueryResult<CorporateProgramme> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.programme(programmeId ?? ('' as CorporateProgrammeId)),
        enabled: repositories !== null && programmeId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (programmeId === null) throw new Error('No programme identifier.');
            return repositories.business.getCorporateProgramme(programmeId);
        },
    });
}

/**
 * Every programme this session can reach.
 *
 * Served by `BusinessRepository.listCorporateProgrammes()` (B2) — one request,
 * no derivation from quotation history.
 */
export function useCorporateProgrammesQuery(): UseQueryResult<readonly CorporateProgramme[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.programmes(),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly CorporateProgramme[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.business.listCorporateProgrammes();
        },
    });
}

/* ── the negotiated catalogue ────────────────────────────────────────────────────────────────── */

/**
 * One programme's negotiated lines.
 *
 * `null` disables it: there is no such thing as "the catalogue" without a programme, because a
 * catalogue *is* the paperwork between one buyer and this business.
 */
export function useCorporateCatalogueQuery(
    filter: CatalogueFilter | null,
): UseQueryResult<CursorPage<CatalogueItem>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.catalogue(filter ?? {}),
        enabled: repositories !== null && filter !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (filter === null) throw new Error('No programme to list a catalogue for.');
            return repositories.business.listCatalogue(filter);
        },
    });
}

export function useCatalogueItemQuery(itemId: string | null): UseQueryResult<CatalogueItem> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.catalogueItem(itemId ?? ''),
        enabled: repositories !== null && itemId !== null && itemId !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (itemId === null) throw new Error('No catalogue item identifier.');
            return repositories.business.getCatalogueItem(itemId);
        },
    });
}

/* ── the supplier's side ─────────────────────────────────────────────────────────────────────── */

/**
 * One thing a supplier has been asked to make: a quotation line, with the catalogue line behind it.
 *
 * Deliberately carries no price. The negotiated rate belongs to the buyer's programme, and the
 * partner surfaces plan against quantity, lead time and delivery days — see
 * `features/business/screens/partner-commitments-screen.tsx` for why that is a decision rather than
 * an omission.
 */
export interface SupplyCommitment {
    /** Stable within a render: the quotation reference and the catalogue line it commits. */
    readonly key: string;
    readonly quotation: Quotation;
    readonly item: CatalogueItem;
    readonly quantity: number;
}

/**
 * Everything currently committed, resolved end to end in one query.
 *
 * `BusinessRepository` publishes no supplier-side resource at all — no orders, no production
 * schedule, no fulfilment. What it does publish is quotations, whose lines carry a catalogue item
 * and a quantity, and catalogue items, which carry the lead time and the delivery weekdays. So a
 * commitment is exactly that join and nothing is invented on top of it.
 *
 * The join is one query rather than one query per line for the same reason as above: the item
 * identifiers are only known once the quotations have arrived. The cost is that the partner screens
 * do not share `business.catalogueItem(id)` cache entries with the corporate item screen; a real
 * `GET /api/v1/partner/commitments` would remove both the join and the duplication.
 */
export function useSupplyCommitmentsQuery(): UseQueryResult<readonly SupplyCommitment[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.quotations({ derive: 'commitments' }),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly SupplyCommitment[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');

            const page = await repositories.business.listQuotations();
            const itemIds = [
                ...new Set(
                    page.items.flatMap((quotation) =>
                        quotation.lines.map((line) => line.catalogueItemId),
                    ),
                ),
            ];
            const items = await Promise.all(
                itemIds.map((itemId) => repositories.business.getCatalogueItem(itemId)),
            );
            const byId = new Map(items.map((item) => [item.id, item]));

            return page.items.flatMap((quotation) =>
                quotation.lines.flatMap((line) => {
                    const item = byId.get(line.catalogueItemId);
                    if (item === undefined) return [];
                    return [
                        {
                            key: `${quotation.reference}-${line.catalogueItemId}`,
                            quotation,
                            item,
                            quantity: line.quantity,
                        },
                    ];
                }),
            );
        },
    });
}

/* ── quotations ──────────────────────────────────────────────────────────────────────────────── */

export function useQuotationsQuery(
    filter?: QuotationFilter,
): UseQueryResult<CursorPage<Quotation>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.quotations(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.business.listQuotations(filter);
        },
    });
}

/**
 * Submits a quotation request.
 *
 * A real mutation with a real result: the store validates the minimum order quantity on every line,
 * files a `submitted` quotation and hands back its reference. It invalidates the whole `business`
 * root rather than the quotation list alone, because the programme-identifier derivation above is
 * itself read out of the quotation history — a request against a programme that had none before
 * makes that programme visible, and a narrower invalidation would leave it hidden until a reload.
 */
export function useRequestQuotationMutation(): UseMutationResult<
    Quotation,
    unknown,
    RequestQuotationRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: RequestQuotationRequest) =>
            repositories.business.requestQuotation(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.business.all() });
        },
    });
}

export function useAcceptQuotationMutation(): UseMutationResult<Quotation, unknown, QuotationId> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (quotationId: QuotationId) =>
            repositories.business.acceptQuotation(quotationId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.business.all() });
        },
    });
}

export function useDeclineQuotationMutation(): UseMutationResult<
    Quotation,
    unknown,
    { readonly quotationId: QuotationId; readonly reason?: string }
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ quotationId, reason }) =>
            repositories.business.declineQuotation(quotationId, reason),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.business.all() });
        },
    });
}
