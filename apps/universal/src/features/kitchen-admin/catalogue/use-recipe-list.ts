import type {
    AllergenClass,
    ApiFailure,
    PublishableStatus,
    RecipeAdminSummary,
    RecipeKind,
    RecipeSoldAs,
} from '@healthy360/api-client/contracts';
import { isRecipeKind } from '@healthy360/api-client/contracts';
import { MealId, ProductId } from '@healthy360/domain-types';
import type { AllergenCode, RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useAllergenClassesQuery,
    useArchiveProductMutation,
    useOpenRecipeDraftMutation,
    useRecipePageQuery,
    useRetireMealMutation,
    useRetireRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';
import { missingPack, onSaleStatus, recipeHandle } from './recipe-columns.tsx';
import { useCatalogueFilters } from './use-catalogue-filters.ts';
import { useDestructiveRow } from './use-destructive-row.ts';

/**
 * Everything `/kitchen/recipes` knows that is not a pixel — the recipe book's list state.
 *
 * The split is the same one `use-ingredient-list.ts` makes and is worth just as much here: the
 * list's *behaviour* lives here and the screen only draws it. So the filter shape the query key is
 * built from, the client-side sort, the page reset, the retire and withdraw sequences with the lock
 * versions they carry, and the draft-opening sequence with the version number its toast quotes are
 * all in this file.
 *
 * ## The kind lives in the URL, and nowhere else
 *
 * `?kind=` is parsed on every render and never copied into state, so a tab is an address a reader
 * can link to and the old `/kitchen/sauces` redirects land on it. Setting it is `router.setParams`;
 * clearing it writes an empty value (the `meal-filters.tsx` precedent), which parses as no kind.
 *
 * `kind` and `sellingStatus` are only ever sent for a reader who can see the catalogue. The server
 * refuses both with a 403 for anyone else, so for that reader a `?kind=` in the address is ignored
 * rather than turned into a refusal.
 *
 * ## Sorting is client-side, and that is stated rather than hidden
 *
 * `RecipeAdminFilter` publishes no sort parameter, so the list sorts the rows it has — within the
 * page. Same limitation, same wording, as the ingredient list, and a real `?sort=` on the listing
 * endpoint makes it a server concern and this paragraph goes away. Id orders by the handle the
 * column draws, digits as numbers, so `SAC-9` comes before `SAC-10`.
 *
 * Kind, Category, Allergens, On sale and the seller tracks do not sort. Kind is the strip's, and
 * Category, Allergens and On sale narrow through the request instead — a page-local order over a
 * set-valued cell answers nothing the filter does not, and only for the rows that happened to load.
 *
 * ## The counts are over the loaded page, deliberately
 *
 * On sale, Draft, Awaiting review and No pack are all counted over the page in hand, which is the
 * only set this screen has. That difference is why Shown reads "18 of 306" rather than claiming
 * the three beside it are catalogue-wide.
 *
 * ## Withdraw is the seller's, and quotes the seller's lock version
 *
 * Withdrawing takes the *item* off sale — a meal is retired, a packaged item archived, which for a
 * catalogue item is the same state — and leaves the recipe in the book. So the request names the
 * seller's id and its own `lockVersion`, never the recipe's: the two move independently, and a
 * precondition quoting the wrong one would be refused. It is offered only while exactly one item
 * sells the recipe and that item is live, the old meal list's rule; with several sellers the choice
 * of which to withdraw belongs to the editor's Selling tab.
 */

/**
 * The columns a header can order by.
 *
 * Version orders by `currentVersionNumber` — numerically, since lexically v11 sorts between v1 and
 * v2. Kitchen compares the id rather than the name the cell prints; every row of one kitchen's book
 * shares it, which is why the column sits on the lowest rung.
 */
export type RecipeSortKey = 'reference' | 'name' | 'kitchen' | 'version' | 'status' | 'updatedAt';
export type RecipeSortDirection = 'asc' | 'desc';

export interface RecipeListState {
    /** The rows for the current page, sorted. Never undefined — empty while pending. */
    readonly rows: readonly RecipeAdminSummary[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    /** Whether the reader may see the catalogue — and so what sells each recipe. */
    readonly sells: boolean;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    /** `''` when nothing is being searched for. The value the filter is built from. */
    readonly trimmed: string;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (statuses: readonly PublishableStatus[]) => void;
    /** The tab — `null` is All. Read from `?kind=`, and always `null` without `sells`. */
    readonly kind: RecipeKind | null;
    readonly setKind: (kind: RecipeKind | null) => void;
    /** The recipe's own filing word the list is narrowed to — `cold_sauce_dip` — or `null`. */
    readonly category: string | null;
    readonly setCategory: (category: string | null) => void;
    /** Only recipes with a seller in this state, or `null`. Sent only with `sells`. */
    readonly sellingStatus: PublishableStatus | null;
    readonly setSellingStatus: (status: PublishableStatus | null) => void;
    /**
     * The allergen class the list is narrowed to, or `null`.
     *
     * One class, not a set, and narrowed by the server — the same shape the ingredient list uses.
     * The column's own label is derived per row from the current version, so a client-side pass
     * could only have filtered the page in hand while the stat cards and every page after it went
     * on describing the unfiltered book. `RecipeIndexController` matches against the same version
     * `pickCurrentRecipeVersion` names, so the filter and the column cannot disagree.
     */
    readonly allergen: AllergenCode | null;
    readonly setAllergen: (allergen: AllergenCode | null) => void;
    /** Every class the platform declares — the column filter's value list. */
    readonly allergenClasses: readonly AllergenClass[];
    /** True when no filter of any kind is in force, the tab included — the empty state branches on it. */
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;

    readonly sortKey: RecipeSortKey;
    readonly sortDirection: RecipeSortDirection;
    readonly setSort: (key: RecipeSortKey, direction: RecipeSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    readonly draftCount: number;
    /** Rows the store quarantined — a published allergen label a change has since contradicted. */
    readonly reviewCount: number;
    /** Rows something sells that a shopper can buy right now. */
    readonly onSaleCount: number;
    /** Rows sold as a sauce, dressing or frozen meal that has no pack to sell in. */
    readonly noPackCount: number;

    readonly openEditor: (recipeId: string) => void;
    /** Opens the create form for one kind — a preparation is a plain recipe. */
    readonly createNew: (kind: RecipeKind) => void;

    /**
     * The record the read-only View panel is showing, or `null`.
     *
     * The summary rather than its id, matching the ingredient list: the row carries everything the
     * panel draws, the version state, the derived label and the sellers included.
     */
    readonly viewing: RecipeAdminSummary | null;
    readonly openView: (row: RecipeAdminSummary) => void;
    readonly closeView: () => void;

    /**
     * True when this row's current version cannot be edited in place, so the only way to change it
     * is to open its successor.
     */
    readonly isImmutable: (row: RecipeAdminSummary) => boolean;
    readonly startDraft: (row: RecipeAdminSummary, onOpened: (version: number) => void) => void;
    readonly draftOpeningFor: RecipeId | null;

    readonly archiving: RecipeAdminSummary | null;
    readonly askToArchive: (row: RecipeAdminSummary) => void;
    readonly cancelArchive: () => void;
    /** Runs the retire at the version the list was showing. `onArchived` carries the row's name. */
    readonly confirmArchive: (onArchived: (name: string) => void) => void;
    readonly isArchivePending: boolean;
    readonly archiveFailure: ApiFailure | null;

    /** Exactly one item sells the recipe, and it is live. The permission is the screen's. */
    readonly isWithdrawable: (row: RecipeAdminSummary) => boolean;
    /** The item the withdraw dialog is open for, or `null`. */
    readonly withdrawing: RecipeSoldAs | null;
    readonly askToWithdraw: (row: RecipeAdminSummary) => void;
    readonly cancelWithdraw: () => void;
    /** Takes the item off sale at its own lock version. `onDone` carries the item's name. */
    readonly confirmWithdraw: (onDone: (name: string) => void) => void;
    readonly isWithdrawPending: boolean;
    readonly withdrawFailure: ApiFailure | null;
}

export function useRecipeList(): RecipeListState {
    const router = useRouter();
    const { locale } = useLocale();
    const sells = useCan(CATALOGUE_VIEW_PERMISSION);
    const requested = useLocalSearchParams<{ kind?: string }>().kind;
    const kind = sells && isRecipeKind(requested) ? requested : null;

    const {
        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        isUnfiltered: searchAndStatusUnset,
        clear: clearSearchAndStatus,
    } = useCatalogueFilters();
    const [allergen, setAllergen] = useState<AllergenCode | null>(null);
    const [category, setCategory] = useState<string | null>(null);
    const [sellingStatus, setSellingStatus] = useState<PublishableStatus | null>(null);
    // Reference ascending, which is the order the codes were issued in and so the order a
    // kitchen already knows the library by. Sorting by name instead put the list in an order
    // that changes with the language.
    const [sortKey, setSortKey] = useState<RecipeSortKey>('reference');
    const [sortDirection, setSortDirection] = useState<RecipeSortDirection>('asc');
    const [viewing, setViewing] = useState<RecipeAdminSummary | null>(null);
    const [draftOpeningFor, setDraftOpeningFor] = useState<RecipeId | null>(null);

    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(allergen === null ? {} : { allergenCodes: [allergen] }),
            ...(category === null ? {} : { category }),
            // `kind` is already `null` without `sells`; `sellingStatus` is guarded the same way.
            ...(kind === null ? {} : { kind }),
            ...(sells && sellingStatus !== null ? { sellingStatus } : {}),
        }),
        [trimmed, statuses, allergen, category, kind, sells, sellingStatus],
    );

    const [page, setPage] = useListPage(filter);
    const recipes = useRecipePageQuery(filter, page);
    const allergenClasses = useAllergenClassesQuery();
    const retire = useDestructiveRow(useRetireRecipeMutation(), (row: RecipeAdminSummary) => ({
        recipeId: row.id,
        request: { lockVersion: row.meta.lockVersion },
    }));
    // Two flows because the contract has two verbs; the dialog is one, and only one is ever open.
    const retireMeal = useDestructiveRow(useRetireMealMutation(), (seller: RecipeSoldAs) => ({
        mealId: MealId.unsafe(seller.id),
        request: { lockVersion: seller.lockVersion },
    }));
    const archiveItem = useDestructiveRow(useArchiveProductMutation(), (seller: RecipeSoldAs) => ({
        productId: ProductId.unsafe(seller.id),
        request: { lockVersion: seller.lockVersion },
    }));
    const openDraft = useOpenRecipeDraftMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on every
    // render, which would re-run the sort below whether or not the data changed.
    const rows = recipes.data?.items;
    const total = recipes.data?.totalCount ?? null;
    const totalPages = pagesInResult(recipes.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'reference') {
                return (
                    factor *
                    recipeHandle(left).localeCompare(recipeHandle(right), undefined, {
                        numeric: true,
                    })
                );
            }
            if (sortKey === 'kitchen') {
                return factor * String(left.kitchenId).localeCompare(String(right.kitchenId));
            }
            if (sortKey === 'version') {
                // Numeric, not lexical — the spec's `sortType: 'number'`.
                return factor * (left.currentVersionNumber - right.currentVersionNumber);
            }
            if (sortKey === 'status') {
                return factor * left.meta.status.localeCompare(right.meta.status);
            }
            if (sortKey === 'updatedAt') {
                return factor * left.meta.updatedAt.localeCompare(right.meta.updatedAt);
            }
            return (
                factor *
                displayName(left.name, locale).value.localeCompare(
                    displayName(right.name, locale).value,
                    locale,
                )
            );
        });
    }, [rows, sortKey, sortDirection, locale]);

    const draftCount = sorted.filter((row) => row.meta.status === 'draft').length;
    const reviewCount = sorted.filter((row) => row.meta.status === 'review_required').length;
    const onSaleCount = sorted.filter((row) => onSaleStatus(row) === 'published').length;
    const noPackCount = sorted.filter((row) => (row.soldAs ?? []).some(missingPack)).length;

    const openEditor = (recipeId: string) => {
        router.push(`/kitchen/recipes/${recipeId}` as never);
    };
    const setKind = (next: RecipeKind | null) => {
        router.setParams({ kind: next ?? '' });
    };

    return {
        rows: sorted,
        isPending: recipes.isPending,
        isFetching: recipes.isFetching,
        failure: toFailure(recipes.error),
        refetch: () => {
            void recipes.refetch();
        },

        sells,

        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        kind,
        setKind,
        category,
        setCategory,
        sellingStatus,
        setSellingStatus,
        allergen,
        setAllergen,
        allergenClasses: allergenClasses.data ?? [],
        isUnfiltered:
            searchAndStatusUnset &&
            allergen === null &&
            category === null &&
            sellingStatus === null &&
            kind === null,
        clearFilters: () => {
            clearSearchAndStatus();
            setAllergen(null);
            setCategory(null);
            setSellingStatus(null);
            // Only when there is one: an unconditional write would stamp `?kind=` on a clean URL.
            if (kind !== null) setKind(null);
        },

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        page,
        setPage,
        totalPages,
        total,
        shown: sorted.length,
        draftCount,
        reviewCount,
        onSaleCount,
        noPackCount,

        openEditor,
        createNew: (next) => {
            router.push(`/kitchen/recipes/new?kind=${next}` as never);
        },

        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },

        // A published or retired version is frozen by the contract, so the only way to change it is
        // to open its successor. Offering New draft against a draft that is already open would
        // open a second draft beside it.
        isImmutable: (row) =>
            row.currentVersionStatus === 'published' || row.currentVersionStatus === 'retired',
        // Copies `currentVersionNumber`, which on a row that offers New draft is the published
        // version: the row must be live, so a retired current version never gets here.
        startDraft: (row, onOpened) => {
            setDraftOpeningFor(row.id);
            openDraft.mutate(
                { recipeId: row.id, copyFromVersion: row.currentVersionNumber },
                {
                    onSuccess: (updated) => {
                        onOpened(updated.currentVersion.versionNumber);
                        openEditor(String(row.id));
                    },
                    onSettled: () => {
                        setDraftOpeningFor(null);
                    },
                },
            );
        },
        draftOpeningFor,

        archiving: retire.target,
        askToArchive: retire.ask,
        cancelArchive: retire.cancel,
        // Retiring *is* the archive: the contract has no `archiveRecipe`, and nothing is deleted
        // because meals, products and cost snapshots still point at the version.
        confirmArchive: retire.confirm,
        isArchivePending: retire.isPending,
        archiveFailure: retire.failure,

        isWithdrawable: (row) => {
            const sellers = row.soldAs ?? [];
            const only = sellers[0];
            return (
                sellers.length === 1 &&
                only !== undefined &&
                (only.status === 'published' || only.status === 'review_required')
            );
        },
        withdrawing: retireMeal.target ?? archiveItem.target,
        askToWithdraw: (row) => {
            const seller = row.soldAs?.[0];
            if (seller === undefined) return;
            (seller.itemType === 'meal' ? retireMeal : archiveItem).ask(seller);
        },
        cancelWithdraw: () => {
            retireMeal.cancel();
            archiveItem.cancel();
        },
        // Each flow does nothing without a target of its own, so calling both runs the open one.
        confirmWithdraw: (onDone) => {
            retireMeal.confirm(onDone);
            archiveItem.confirm(onDone);
        },
        isWithdrawPending: retireMeal.isPending || archiveItem.isPending,
        withdrawFailure: retireMeal.target === null ? archiveItem.failure : retireMeal.failure,
    };
}
