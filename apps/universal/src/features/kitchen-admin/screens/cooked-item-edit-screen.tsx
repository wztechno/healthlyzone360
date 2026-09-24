import { isRecipeKind } from '@healthy360/api-client/contracts';
import type {
    MealAdmin,
    ProductAdmin,
    RecipeAdmin,
    RecipeKind,
    RecipeSellerKind,
    ReferenceSeries,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    ErrorState,
    SegmentedControl,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { MealId, ProductId, RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAdminMealQuery,
    useCreateMealMutation,
    useCreateProductMutation,
    useCreateRecipeMutation,
    useProductQuery,
    useRecipeQuery,
    useUpdateMealMutation,
    useUpdateProductMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    RECIPE_MANAGE_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { MealListing } from '../meal-listing.tsx';
import { ProductEditScreen } from './product-edit-screen.tsx';
import { RecipeEditScreen } from './recipe-edit-screen.tsx';

/**
 * `/kitchen/recipes/{recipe}` and `/kitchen/recipes/new?kind=…` — one page for everything a kitchen
 * cooks, whatever sells it — and `/kitchen/recipes/item/{item}?kind=…`, the address an item is
 * known by before it is known by its recipe.
 *
 * ```
 * Kitchen workspace › Recipes › Garlic sauce
 * Garlic sauce  Draft  Restricted          [ Discard ] [ Save draft ] [ Publish ]
 * ── Description │ Production 4 │ Packaging 1 │ Costing │ Selling │ Technical sheet ──
 * ```
 *
 * ## The page is the recipe; what sells it is a tab on it
 *
 * A meal, a sauce, a dressing and a frozen meal are each cooked from a recipe and sold as a
 * catalogue item, and a preparation is a recipe nothing sells. So every one of them is this page:
 * the recipe editor, and — when something sells the recipe — a Selling tab holding that item's own
 * listing. A meal's listing is its portion, its service days and its publication (`MealListing`); a
 * packaged kind's is its packs, its channels and its publication (`ProductEditScreen` with
 * `embedded`). The recipe is read first and names its sellers (`soldAs`); each listing then reads
 * its own record, so this host reads no item at all.
 *
 * One recipe can back several articles, so a recipe sold twice draws a switch above the listing,
 * one seller at a time. Switching unmounts the listing on screen, which is why the others are
 * disabled while it holds an unsaved edit.
 *
 * Two records still save separately, each against its own lock version: nothing on Save draft writes
 * the item, and nothing in the tab writes the recipe.
 *
 * ## The kind files the page
 *
 * A saved recipe is filed by the first kind the server lists for it — a recipe sold as a meal and as
 * a sauce is filed as a meal and returns to the Meals tab — and `?kind=` is not consulted, because
 * the recipe already answers the question. While creating, `?kind=` is the only answer there is, so
 * it is validated: a cooked kind needs `catalogue.manage` as well, because saving one writes an item
 * too, and anything else creates a plain recipe.
 *
 * ## The whole form works before the first save
 *
 * That is the recipe editor's own property and the reason this page renders it rather than a form of
 * its own: yield, raw materials, the cost cascade and the technical sheet are all live on a record
 * that does not exist yet. The listing has nothing to hang from until then, so creating a cooked
 * kind writes the recipe, then the item that sells it, and lands on the recipe's own address; the
 * Selling tab appears there once the book has read the new seller back.
 *
 * ## Category is stated; sub-category is asked
 *
 * A recipe filed as a sauce cannot be filed anywhere else, so the category is drawn read-only rather
 * than as a picker whose every other option would be a mistake. What is left to choose is the
 * sub-category — the four words the v6 sheets file these rows under — stored on the recipe's own
 * `recipe_category`, the free-text column the import already writes `cooking_sauce` into. Dressings
 * and frozen meals state their category and offer no sub-category, and a meal's recipe files
 * nothing: the library has no one list of words for dishes.
 *
 * ## An item with no recipe
 *
 * The old item addresses redirect to `/kitchen/recipes/item/{item}`, and the review queue sends a
 * meal there when it has no recipe to be addressed by. An item with a recipe is replaced by the
 * recipe's page at once. One without is where the kitchen starts its formulation: the notice offers
 * it, and the listing stays editable underneath, because an imported item already has its name, its
 * packs or its service days, and pricing it is not a question its recipe has to answer first.
 *
 * For a sauce or a dressing the server writes a third record with the item: its ingredient twin,
 * carrying the same `SAC-` handle, which is what a meal's lines name when they use the sauce and the
 * shelf a batch of it lands on. Nothing here asks for it, because there is nothing to decide.
 */

/** The catalogue-item category each packaged kind files into. `ProductCategorySeeder`'s own codes. */
const ITEM_CATEGORY = {
    sauce: 'sauce',
    dressing: 'dressing',
    frozen_meal: 'frozen_meal',
} as const;

/** The heading each packaged kind files itself under. */
const CATEGORY_LABEL_KEY = {
    sauce: 'kitchen:sauces.title',
    dressing: 'kitchen:dressings.title',
    frozen_meal: 'kitchen:frozenMeals.title',
} as const;

/**
 * The reference series each kind numbers in — `SAC-0016`, `DRS-0015`, and a meal's recipe its own
 * `RC-`.
 *
 * A sauce's handle is the item's, because a cook quotes it off the sauces sheet. Meals carry no
 * series of their own — the sheets do not number them all — so a meal's create form shows the
 * recipe's.
 */
const REFERENCE_SERIES = {
    meal: 'RC-',
    sauce: 'SAC-',
    dressing: 'DRS-',
    frozen_meal: 'FRZ-',
} as const satisfies Record<RecipeSellerKind, ReferenceSeries>;

/**
 * The sub-category words, as the sauces sheet's own filter lists them.
 *
 * Values are the `recipe_category` column's — snake case, matching `cooking_sauce`, which the
 * import already writes for every SC- row. Dressings have no list of their own: the sheets file all
 * fourteen alike, so the page states the category and asks nothing further, and a frozen meal is
 * filed the same way — offering an empty select would be a control with nothing behind it.
 */
function subcategoryOptions(
    itemType: Exclude<RecipeSellerKind, 'meal'>,
    t: TFunction,
): readonly SelectOption[] {
    if (itemType !== 'sauce') return [];

    return [
        { value: 'cold_sauce_dip', label: t('kitchen:sauces.kindColdSauce') },
        { value: 'cooking_sauce', label: t('kitchen:sauces.kindCookingSauce') },
        { value: 'dessert_sauce', label: t('kitchen:sauces.kindDessertSauce') },
        { value: 'marinade_prep', label: t('kitchen:sauces.kindMarinadePrep') },
    ];
}

/** The cooked kind a value names, or `null` — for a preparation, and for anything unrecognised. */
function sellerKind(value: unknown): RecipeSellerKind | null {
    return isRecipeKind(value) && value !== 'preparation' ? value : null;
}

/* ------------------------------------------------------------------------------------------------
 * The recipe book's editor
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeBookEditScreenProps {
    /** The route parameter — a recipe id, or `new` for the create form. */
    readonly recipe?: string | undefined;
    /** `?kind=` — what a new recipe is created as. Ignored once the recipe exists. */
    readonly kind?: string | undefined;
}

export function RecipeBookEditScreen(props: RecipeBookEditScreenProps) {
    return (
        /*
         * The recipe code alone. A preparation is a recipe and nothing else, so a role that may read
         * recipes and not the catalogue still opens it; what such a reader cannot see is what sells
         * a recipe, and the server leaves that out of the answer rather than this page hiding it.
         */
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-recipe-book-editor"
        >
            <RecipeBookEditor {...props} />
        </Gate>
    );
}

function RecipeBookEditor({ recipe, kind: requested }: RecipeBookEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const canManageItems = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = recipe === undefined || recipe === 'new';
    // The cache entry the editor below reads, so naming the sellers costs no request of its own.
    const record = useRecipeQuery(isCreating ? null : RecipeId.safeParse(recipe));
    const soldAs = record.data?.soldAs ?? [];

    const kind: RecipeKind | null = isCreating
        ? isRecipeKind(requested) && (requested === 'preparation' || canManageItems)
            ? requested
            : null
        : (record.data?.kinds?.[0] ?? null);
    const cooked = sellerKind(kind);

    // The listing's unsaved state, so the page's own exits ask before dropping it.
    const [listingDirty, setListingDirty] = useState(false);
    const [chosenSeller, setChosenSeller] = useState<string | null>(null);

    const createMeal = useCreateMealMutation();
    const createItem = useCreateProductMutation();

    const classification =
        cooked === null || cooked === 'meal'
            ? undefined
            : {
                  categoryLabel: t(CATEGORY_LABEL_KEY[cooked]),
                  subcategoryLabel: t('kitchen:fields.subcategory'),
                  subcategoryPlaceholder: t('kitchen:fields.subcategoryPlaceholder'),
                  options: subcategoryOptions(cooked, t),
              };

    /*
     * The recipe is written; this writes the thing that sells it, then lands on the recipe.
     *
     * Failure here leaves a recipe with no item pointing at it, which is a real state rather than a
     * corrupt one — the recipe is in the book, and a listing can be started from there — so the
     * reader is told, and lands on the recipe all the same rather than on a form whose record
     * already exists.
     */
    const linkToCatalogue = (created: RecipeAdmin, itemType: RecipeSellerKind) => {
        const open = () => {
            router.replace(`/kitchen/recipes/${String(created.id)}` as never);
        };
        const keepRecipe = () => {
            toast.show({
                testID: 'kitchen-cooked-item-listing-failed-toast',
                tone: 'warning',
                message: t('kitchen:recipes.listingFailedToast'),
            });
            open();
        };

        if (itemType === 'meal') {
            createMeal.mutate(
                { name: created.name, description: created.description, recipeId: created.id },
                { onSuccess: open, onError: keepRecipe },
            );
            return;
        }

        createItem.mutate(
            {
                name: created.name,
                description: created.description,
                categoryCode: ITEM_CATEGORY[itemType],
                itemType,
                recipeId: created.id,
            },
            { onSuccess: open, onError: keepRecipe },
        );
    };

    const seller = soldAs.find((entry) => entry.id === chosenSeller) ?? soldAs[0];

    /** The seller's own listing, inside this page — a meal's, or a packaged kind's. */
    const listing =
        seller === undefined ? null : seller.itemType === 'meal' ? (
            <MealListing
                key={seller.id}
                meal={MealId.unsafe(seller.id)}
                onDirtyChange={setListingDirty}
            />
        ) : (
            <ProductEditScreen
                key={seller.id}
                product={seller.id}
                itemType={seller.itemType}
                routeBase="/kitchen/recipes"
                embedded
                onDirtyChange={setListingDirty}
            />
        );

    return (
        <RecipeEditScreen
            recipe={recipe}
            backTo={kind === null ? '/kitchen/recipes' : `/kitchen/recipes?kind=${kind}`}
            classification={classification}
            referenceSeries={cooked === null ? undefined : REFERENCE_SERIES[cooked]}
            onCreated={
                cooked === null
                    ? undefined
                    : (created) => {
                          linkToCatalogue(created, cooked);
                      }
            }
            sellsAs={
                seller === undefined
                    ? undefined
                    : {
                          label: t('kitchen:recipes.tabSelling'),
                          content:
                              soldAs.length < 2 ? (
                                  listing
                              ) : (
                                  <View className="z-auto flex-col gap-base">
                                      <SegmentedControl
                                          testID="kitchen-recipe-selling-seller"
                                          label={t('kitchen:recipes.sellerLabel')}
                                          items={soldAs.map((entry) => ({
                                              value: entry.id,
                                              label: entry.reference ?? entry.slug,
                                              testID: `kitchen-recipe-selling-seller-${entry.id}`,
                                              disabled: listingDirty && entry.id !== seller.id,
                                          }))}
                                          value={seller.id}
                                          onChange={setChosenSeller}
                                      />
                                      {listing}
                                  </View>
                              ),
                          isDirty: listingDirty,
                      }
            }
        />
    );
}

/* ------------------------------------------------------------------------------------------------
 * An item, before it is known by its recipe
 * ---------------------------------------------------------------------------------------------- */

export interface CookedItemEditScreenProps {
    /** The route parameter — a catalogue item id. */
    readonly item?: string | undefined;
    /** `?kind=` — which cooked kind the id names; a meal and a packaged kind are read apart. */
    readonly kind?: string | undefined;
}

export function CookedItemEditScreen(props: CookedItemEditScreenProps) {
    return (
        /*
         * Both codes, because this page writes both records.
         *
         * A cooked item is a catalogue item *and* a recipe, and the two halves are gated separately
         * on the server: `GET/POST /catalogue/recipes` wants `recipe.*`, the item wants `catalogue.*`.
         * Asking for only one of them let somebody through a form whose save was always going to 403
         * on the half they lacked — and it 403s after the recipe has already been written, which is
         * the worst place to discover it.
         */
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION, RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-cooked-item-editor"
        >
            <CookedItemEditor {...props} />
        </Gate>
    );
}

function CookedItemEditor({ item: routeItem, kind }: CookedItemEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    // Both halves again — see the gate above. The recipe is written first, so a member holding
    // only `catalogue.manage` must not be offered the start at all.
    //
    // Two statements rather than one `&&`: the short-circuit would skip the second hook on a render
    // where the first came back false, and a hook that is sometimes called is a hook order that
    // sometimes changes.
    const canManageItem = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canManageRecipe = useCan(RECIPE_MANAGE_PERMISSION);
    const canManage = canManageItem && canManageRecipe;

    const itemType = sellerKind(kind);
    const isMeal = itemType === 'meal';

    /*
     * Both reads, always, with the one this kind does not use given no id — hooks are called in the
     * same order on every render, and a query with no id never runs.
     */
    const mealId = isMeal ? MealId.safeParse(routeItem) : null;
    const productId = itemType === null || isMeal ? null : ProductId.safeParse(routeItem);
    const mealRecord = useAdminMealQuery(mealId);
    const productRecord = useProductQuery(productId);
    const record = isMeal ? mealRecord : productRecord;
    const parsed = isMeal ? mealId : productId;

    const createRecipe = useCreateRecipeMutation();
    const linkMeal = useUpdateMealMutation();
    const linkProduct = useUpdateProductMutation();

    /*
     * An item with a recipe is edited on the recipe's page, so this one hands over at once — and
     * again the moment a formulation started below links one, because the link's write effect puts
     * the item back in the cache carrying its `recipeId`. Once: the ref keeps StrictMode's second
     * effect and every later render from replacing again.
     */
    const recipeId = record.data?.recipeId ?? null;
    const replaced = useRef(false);
    useEffect(() => {
        if (recipeId === null || replaced.current) return;
        replaced.current = true;
        router.replace(`/kitchen/recipes/${String(recipeId)}` as never);
    }, [recipeId, router]);

    if (itemType === null || parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-cooked-item-screen">
                <Callout
                    testID="kitchen-cooked-item-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:products.notFoundTitle')}
                    body={t('kitchen:products.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-cooked-item-not-found-back"
                            variant="quiet"
                            label={t('kitchen:recipes.backToList')}
                            onPress={() => {
                                router.push(
                                    (itemType === null
                                        ? '/kitchen/recipes'
                                        : `/kitchen/recipes?kind=${itemType}`) as never,
                                );
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    // Still reading, or already on the way to the recipe: the skeleton is the honest frame for both.
    if (record.isPending || recipeId !== null) {
        return (
            <Stack space="md" testID="kitchen-cooked-item-loading">
                <Skeleton testID="kitchen-cooked-item-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-cooked-item-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-cooked-item-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-cooked-item-screen">
                <ErrorState
                    testID="kitchen-cooked-item-load-error"
                    failure={loadFailure}
                    title={t('kitchen:products.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const item: MealAdmin | ProductAdmin | undefined = record.data;

    /** The item's own listing, inside this page — a meal's, or a packaged kind's. */
    const listing =
        item === undefined ? null : itemType === 'meal' ? (
            <MealListing meal={MealId.unsafe(String(item.id))} />
        ) : (
            <ProductEditScreen
                product={String(item.id)}
                itemType={itemType}
                routeBase="/kitchen/recipes"
                embedded
            />
        );

    /*
     * Saved as an item, with nothing made yet.
     *
     * Every row the v6 import wrote was in this state: the sheets said "Source: Recipe Library",
     * there was no library, and each row carries `recipe_library_unlinked` instead of a link. What
     * the notice starts is a formulation for *this* item, and the page it lands on is the recipe's.
     */
    const startFailure = toFailure(createRecipe.error ?? linkMeal.error ?? linkProduct.error);
    const starting = createRecipe.isPending || linkMeal.isPending || linkProduct.isPending;

    /*
     * Write the recipe, then link it to *this* item — not to a new one. Stops at the first failure
     * rather than reporting success: a recipe nothing points at is invisible from here, and a second
     * press would write another. The link carries `recipeId` and the lock version alone;
     * `CatalogueItemService::update` reads its payload key by key, so the packs, the channels, the
     * portion and the filing are not in the request and cannot be cleared by it. Nothing routes from
     * here: the effect above carries the reader to the recipe once the link has answered.
     */
    const startFormulation = () => {
        if (item === undefined) return;

        const started = {
            onSuccess: () => {
                toast.show({
                    testID: 'kitchen-cooked-item-formulation-started-toast',
                    tone: 'success',
                    message: t('kitchen:products.formulationStartedToast', {
                        name: displayName(item.name, locale).value,
                    }),
                });
            },
        };

        createRecipe.mutate(
            {
                name: item.name,
                description: item.description,
                yieldQuantity: 1,
                yieldUnit: 'kg',
            },
            {
                onSuccess: (created) => {
                    const request = { lockVersion: item.meta.lockVersion, recipeId: created.id };
                    if (isMeal) {
                        linkMeal.mutate(
                            { mealId: MealId.unsafe(String(item.id)), request },
                            started,
                        );
                    } else {
                        linkProduct.mutate(
                            { productId: ProductId.unsafe(String(item.id)), request },
                            started,
                        );
                    }
                },
            },
        );
    };

    return (
        <Stack space="md" testID="kitchen-cooked-item-screen">
            <Callout
                testID="kitchen-cooked-item-recipe-missing"
                role="note"
                tone="info"
                title={t('kitchen:products.recipeMissingTitle')}
                body={t('kitchen:products.recipeMissingBody')}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-cooked-item-formulation-start"
                            label={t('kitchen:products.formulationStart')}
                            loading={starting}
                            disabled={starting}
                            onPress={startFormulation}
                        />
                    ) : undefined
                }
            />

            {startFailure === null ? null : (
                <Text testID="kitchen-cooked-item-formulation-error" tone="danger">
                    {startFailure.message}
                </Text>
            )}

            {/*
             * The listing is editable before there is a formulation: an imported item already has its
             * name, its packs or its service days, and pricing it or putting it on sale is not a
             * question its recipe has to answer first.
             */}
            {listing}
        </Stack>
    );
}
