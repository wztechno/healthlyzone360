import type {
    LocalisedText,
    MealAdmin,
    ProductAdmin,
    RecipeAdmin,
    ReferenceSeries,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    ErrorState,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { MealId, ProductId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAdminMealQuery,
    useCreateMealMutation,
    useCreateProductMutation,
    useCreateRecipeMutation,
    useProductQuery,
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
 * `/kitchen/meals/{item}`, `/kitchen/sauces/{item}` and `/kitchen/dressings/{item}` — one page for
 * everything a kitchen cooks and sells.
 *
 * ```
 * Kitchen workspace › Sauces & marinations › Garlic sauce
 * Garlic sauce  Draft  Restricted          [ Discard ] [ Save draft ] [ Publish ]
 * RC-0104 · yields 2 kg · 4 raw materials · 6.66 / kg
 * ── Description │ Production 4 │ Packaging 1 │ Costing │ Selling │ Technical sheet ──
 * ```
 *
 * ## The page is the recipe; the listing is a tab on it
 *
 * A meal, a sauce and a dressing are each cooked from a recipe and sold as a catalogue item. They
 * used to be three editor shapes — a meal editor with a recipe picker, a sauce page that was only the
 * recipe, and a product form sauces could not reach. Now each is this page: the recipe editor, and on
 * its Selling tab the item's own listing. A meal's listing is its portion, its place in the day, its
 * service days and its publication (`MealListing`); a sauce's is its packs, its channels and its
 * publication (`ProductEditScreen` with `embedded`). The recipe library at `/kitchen/recipes` stays
 * what it was, the formulations that are not sold on their own.
 *
 * Two records still save separately, each against its own lock version: nothing on Save draft writes
 * the item, and nothing in the tab writes the recipe.
 *
 * ## The whole form works before the first save
 *
 * That is the recipe editor's own property and the reason these routes render it rather than a form
 * of their own: yield, raw materials, the cost cascade and the technical sheet are all live on a
 * record that does not exist yet, and one Save draft writes the recipe, its lines and its prices
 * together. The listing has nothing to hang from until then, so the Selling tab appears with the
 * first save — which also writes the item, and lands on its address.
 *
 * ## Category is stated; sub-category is asked
 *
 * A form reached through Sauces & marinations cannot be filed anywhere else, so the category is
 * drawn read-only rather than as a picker whose every other option would be a mistake. What is left
 * to choose is the sub-category — the four words the v6 sheets file these rows under — and it is
 * stored on the recipe's own `recipe_category`, the free-text column the import already writes
 * `cooking_sauce` into. Dressings state their category and offer no sub-category, and a meal's recipe
 * files nothing: the library has no one list of words for dishes.
 *
 * ## Two records, and which one the route parameter is
 *
 * The list is the item, so `{item}` is the item's id, and this page resolves it to the recipe before
 * handing over. Creating goes the other way: the recipe is what the form fills in, so it is written
 * first, and `onCreated` writes the item that sells it — same name, linked — then routes to it, so
 * something created here is in the list it was created from.
 *
 * For a sauce or a dressing the server writes a third record with the item: its ingredient twin,
 * carrying the same `SAC-` handle, which is what a meal's lines name when they use the sauce and the
 * shelf a batch of it lands on. Nothing here asks for it, because there is nothing to decide.
 */

type CookedKind = 'meal' | 'sauce' | 'dressing' | 'frozen_meal';

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
} as const satisfies Record<CookedKind, ReferenceSeries>;

/**
 * The sub-category words, as the sauces sheet's own filter lists them.
 *
 * Values are the `recipe_category` column's — snake case, matching `cooking_sauce`, which the
 * import already writes for every SC- row. Dressings have no list of their own: the sheets file all
 * fourteen alike, so the route states the category and asks nothing further, and a frozen meal is
 * filed the same way — offering an empty select would be a control with nothing behind it.
 */
function subcategoryOptions(
    itemType: Exclude<CookedKind, 'meal'>,
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

export type CookedItemEditScreenProps =
    | {
          /** The route parameter — a catalogue item id, or `new` for the create form. */
          readonly item: string | undefined;
          readonly itemType: 'meal';
          readonly routeBase: '/kitchen/meals';
      }
    | {
          readonly item: string | undefined;
          readonly itemType: 'sauce';
          readonly routeBase: '/kitchen/sauces';
      }
    | {
          readonly item: string | undefined;
          readonly itemType: 'dressing';
          readonly routeBase: '/kitchen/dressings';
      }
    | {
          readonly item: string | undefined;
          readonly itemType: 'frozen_meal';
          readonly routeBase: '/kitchen/frozen-meals';
      };

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

/** `/kitchen/meals/{meal}` — a meal is a cooked item like any other. */
export function MealEditScreen({ meal }: { readonly meal: string | undefined }) {
    return <CookedItemEditScreen item={meal} itemType="meal" routeBase="/kitchen/meals" />;
}

function CookedItemEditor(props: CookedItemEditScreenProps) {
    const { item: routeItem, itemType, routeBase } = props;
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    // Both halves again — see the gate above. The recipe is written first, so a member holding
    // only `catalogue.manage` must not be offered a save at all.
    //
    // Two statements rather than one `&&`: the short-circuit would skip the second hook on a render
    // where the first came back false, and a hook that is sometimes called is a hook order that
    // sometimes changes.
    const canManageItem = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canManageRecipe = useCan(RECIPE_MANAGE_PERMISSION);
    const canManage = canManageItem && canManageRecipe;

    const isCreating = routeItem === undefined || routeItem === 'new';
    const isMeal = itemType === 'meal';

    /*
     * Both reads, always, with the one this kind does not use given no id — hooks are called in the
     * same order on every render, and a query with no id never runs.
     */
    const mealId = isCreating || !isMeal ? null : MealId.safeParse(routeItem);
    const productId = isCreating || isMeal ? null : ProductId.safeParse(routeItem);
    const mealRecord = useAdminMealQuery(mealId);
    const productRecord = useProductQuery(productId);
    const record = isMeal ? mealRecord : productRecord;
    const parsed = isMeal ? mealId : productId;

    // The listing's unsaved state, so the page's own exits ask before dropping it.
    const [listingDirty, setListingDirty] = useState(false);

    const createMeal = useCreateMealMutation();
    const createItem = useCreateProductMutation();
    const createRecipe = useCreateRecipeMutation();
    const linkMeal = useUpdateMealMutation();
    const linkProduct = useUpdateProductMutation();

    const classification =
        props.itemType === 'meal'
            ? undefined
            : {
                  categoryLabel: t(CATEGORY_LABEL_KEY[props.itemType]),
                  subcategoryLabel: t('kitchen:fields.subcategory'),
                  subcategoryPlaceholder: t('kitchen:fields.subcategoryPlaceholder'),
                  options: subcategoryOptions(props.itemType, t),
              };

    /*
     * The recipe is written; this writes the thing that sells it.
     *
     * Failure here leaves a recipe with no item pointing at it, which is a real state rather than a
     * corrupt one — the recipe is in the library and a listing can be started from there — so the
     * reader is told, and sent to the recipe rather than left on a form whose record already exists.
     */
    const linkToCatalogue = (
        created: RecipeAdmin,
        listing: { readonly description: LocalisedText },
    ) => {
        const open = (id: string) => {
            router.replace(`${routeBase}/${id}` as never);
        };
        const keepRecipe = () => {
            toast.show({
                testID: 'kitchen-cooked-item-listing-failed-toast',
                tone: 'warning',
                message: t('kitchen:recipes.listingFailedToast'),
            });
            router.replace(`/kitchen/recipes/${String(created.id)}` as never);
        };

        if (props.itemType === 'meal') {
            createMeal.mutate(
                { name: created.name, description: listing.description, recipeId: created.id },
                {
                    onSuccess: (made) => {
                        open(String(made.id));
                    },
                    onError: keepRecipe,
                },
            );
            return;
        }

        createItem.mutate(
            {
                name: created.name,
                // The form's own draft, both languages: the recipe keeps one language of notes, so
                // reading the description back off it would drop the Arabic.
                description: listing.description,
                categoryCode: ITEM_CATEGORY[props.itemType],
                itemType: props.itemType,
                recipeId: created.id,
            },
            {
                onSuccess: (made) => {
                    open(String(made.id));
                },
                onError: keepRecipe,
            },
        );
    };

    if (isCreating) {
        return (
            <RecipeEditScreen
                recipe="new"
                backTo={routeBase}
                classification={classification}
                referenceSeries={REFERENCE_SERIES[itemType]}
                onCreated={linkToCatalogue}
            />
        );
    }

    if (parsed === null) {
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
                            label={t('kitchen:products.backToList')}
                            onPress={() => {
                                router.push(routeBase as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (record.isPending) {
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
        item === undefined ? null : props.itemType === 'meal' ? (
            <MealListing meal={MealId.unsafe(String(item.id))} onDirtyChange={setListingDirty} />
        ) : (
            <ProductEditScreen
                product={String(item.id)}
                itemType={props.itemType}
                routeBase={props.routeBase}
                embedded
                onDirtyChange={setListingDirty}
            />
        );

    if (item !== undefined && item.recipeId !== null) {
        return (
            <RecipeEditScreen
                recipe={String(item.recipeId)}
                backTo={routeBase}
                classification={classification}
                referenceSeries={REFERENCE_SERIES[itemType]}
                sellsAs={{
                    label: t('kitchen:recipes.tabSelling'),
                    content: listing,
                    isDirty: listingDirty,
                }}
            />
        );
    }

    /*
     * Saved as an item, with nothing made yet.
     *
     * Every row the v6 import wrote is in this state: the sheets said "Source: Recipe Library",
     * there was no library, and each row carries `recipe_library_unlinked` instead of a link. The
     * create form is the same editor, so it is where the notice sends a reader — what it writes is a
     * formulation, and the item it makes alongside is the one this record should have been.
     */
    const startFailure = toFailure(createRecipe.error ?? linkMeal.error ?? linkProduct.error);
    const starting = createRecipe.isPending || linkMeal.isPending || linkProduct.isPending;

    /*
     * Write the recipe, then link it to *this* item — not to a new one. Stops at the first failure
     * rather than reporting success: a recipe nothing points at is invisible from here, and a second
     * press would write another. The link carries `recipeId` and the lock version alone;
     * `CatalogueItemService::update` reads its payload key by key, so the packs, the channels, the
     * portion and the filing are not in the request and cannot be cleared by it.
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
