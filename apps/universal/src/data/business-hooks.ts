import type {
    CatalogueFilter,
    CatalogueItem,
    CorporateProgramme,
    CursorPage,
    Quotation,
    QuotationFilter,
    RequestQuotationRequest,
} from '@healthy360/api-client/contracts';
import type { CorporateProgrammeId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

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
 * ## Which programmes the caller can see is a contract gap, probed rather than invented
 *
 * `BusinessRepository` publishes `getCorporateProgramme(programmeId)` and no way to *discover* a
 * programme identifier: there is no `listCorporateProgrammes()`, and `GET /api/v1/me` carries no
 * programme membership. So {@link useCorporateProgrammesQuery} discovers them the only way the
 * contract allows — from the quotation history, which does carry `programmeId` — and then resolves
 * each one. That is honest and uses only the interface; it is also wrong in an obvious way, because
 * a programme nobody has raised a quotation against is invisible. A real backend should publish
 * `GET /api/v1/business/programmes` scoped to the session's organisation, at which point this
 * derivation collapses into one request. The screens say so where a person can see it.
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
 * Every programme this session can reach, resolved end to end in one query.
 *
 * Two steps, folded into a single `queryFn` for the same reason `useConsumerDayQuery` folds its
 * three (`./marketplace-hooks.ts`): the second step's inputs are the first step's output, so as two
 * hooks it would be a query that is `enabled` only after another settles, and every screen would
 * have to render the intermediate pending state itself. One query has one pending state, one error
 * and one `refetch`, which is exactly what `QueryStates` needs.
 *
 * Step one derives the identifiers from the quotation history, because the contract publishes no
 * listing (see the module note). Step two resolves them in parallel.
 */
export function useCorporateProgrammesQuery(): UseQueryResult<readonly CorporateProgramme[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.business.quotations({ derive: 'programmes' }),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly CorporateProgramme[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');

            const page = await repositories.business.listQuotations();
            const seen = new Set<string>();
            const ids: CorporateProgrammeId[] = [];
            for (const quotation of page.items) {
                if (seen.has(quotation.programmeId)) continue;
                seen.add(quotation.programmeId);
                ids.push(quotation.programmeId);
            }

            return Promise.all(
                ids.map((programmeId) => repositories.business.getCorporateProgramme(programmeId)),
            );
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
