import type { RecipeAdmin, ReferenceSeries } from '@healthy360/api-client/contracts';
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
import { ProductId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreateProductMutation,
    useCreateRecipeMutation,
    useProductQuery,
    useUpdateProductMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { RecipeEditScreen } from './recipe-edit-screen.tsx';

/**
 * `/kitchen/sauces/{item}` and `/kitchen/dressings/{item}` — the recipe editor, filed as a sauce.
 *
 * ```
 * Kitchen workspace › Sauces & marinations › New recipe
 * New recipe  Draft  Restricted             [ Discard ] [ Save draft ]
 * yields 1 kg · 0 raw materials · 0.00 / kg
 * ── Description │ Production 0 │ Costing │ Technical sheet ──────────────────────
 *
 * IDENTITY   Designation and classification
 * [ Designation (EN) * ] [ Designation (AR) ] [ Ref. ] [ Category ] [ Sub-category ]
 * ```
 *
 * ## The whole form works before the first save
 *
 * That is the recipe editor's own property and the reason these routes render it rather than a form
 * of their own: yield, raw materials, the cost cascade and the technical sheet are all live on a
 * record that does not exist yet, and one Save draft writes the recipe, its lines and its prices
 * together. A create form that showed three locked tabs until something was saved would be asking a
 * chef to write the formulation twice.
 *
 * **Four tabs, not five.** `withoutPackaging` drops the recipe's Packaging tab: that tab lists the
 * consumables one batch eats, and how a sauce is packed for sale is its catalogue item's pack
 * variants, on the products form.
 *
 * ## Category is stated; sub-category is asked
 *
 * A form reached through Sauces & marinations cannot be filed anywhere else, so the category is
 * drawn read-only rather than as a picker whose every other option would be a mistake. What is left
 * to choose is the sub-category — the four words the v6 sheets file these rows under — and it is
 * stored on the recipe's own `recipe_category`, the free-text column the import already writes
 * `cooking_sauce` into.
 *
 * Dressings state their category and offer no sub-category: the sheets file every one of them the
 * same way, and a picker with one option is a label wearing a chevron.
 *
 * ## Two records, and which one the route parameter is
 *
 * A sauce is sold as a catalogue item and made as a recipe. The list is the item, so `{item}` is a
 * `ProductId`, and this screen resolves it to `recipeId` before handing over. Creating goes the
 * other way: the recipe is what the form fills in, so it is written first, and `onCreated` writes
 * the item that sells it — same name, category `sauce` or `dressing`, linked — then routes to it,
 * so a sauce created here is in the list it was created from.
 */

/** The catalogue-item category each route files into. `ProductCategorySeeder`'s own codes. */
const ITEM_CATEGORY = {
    sauce: 'sauce',
    dressing: 'dressing',
} as const;

/**
 * The reference series each kind numbers in — `SAC-0016`, `DRS-0015`.
 *
 * Separate from the recipe library's `RC-`, because a cook reads these off different sheets and
 * quotes them by different handles. The server owns the number; this only names which column of
 * the kitchen's own filing it comes from.
 */
const REFERENCE_SERIES = {
    sauce: 'SAC-',
    dressing: 'DRS-',
} as const satisfies Record<'sauce' | 'dressing', ReferenceSeries>;

/**
 * The sub-category words, as the sauces sheet's own filter lists them.
 *
 * Values are the `recipe_category` column's — snake case, matching `cooking_sauce`, which the
 * import already writes for every SC- row. Dressings have no list of their own: the sheets file all
 * fourteen alike, so the route states the category and asks nothing further.
 */
function subcategoryOptions(itemType: 'sauce' | 'dressing', t: TFunction): readonly SelectOption[] {
    if (itemType === 'dressing') return [];

    return [
        { value: 'cold_sauce_dip', label: t('kitchen:sauces.kindColdSauce') },
        { value: 'cooking_sauce', label: t('kitchen:sauces.kindCookingSauce') },
        { value: 'dessert_sauce', label: t('kitchen:sauces.kindDessertSauce') },
        { value: 'marinade_prep', label: t('kitchen:sauces.kindMarinadePrep') },
    ];
}

export interface CookedItemEditScreenProps {
    /** The route parameter — a catalogue item id, or `new` for the create form. */
    readonly product: string | undefined;
    readonly itemType: 'sauce' | 'dressing';
    readonly routeBase: '/kitchen/sauces' | '/kitchen/dressings';
}

export function CookedItemEditScreen({ product, itemType, routeBase }: CookedItemEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-sauce-editor"
        >
            <CookedItemEditor product={product} itemType={itemType} routeBase={routeBase} />
        </Gate>
    );
}

function CookedItemEditor({ product, itemType, routeBase }: CookedItemEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = product === undefined || product === 'new';
    const parsed = isCreating ? null : ProductId.safeParse(product);

    const record = useProductQuery(parsed);
    const createItem = useCreateProductMutation();
    const createRecipe = useCreateRecipeMutation();
    const linkRecipe = useUpdateProductMutation();

    const classification = {
        categoryLabel: t(itemType === 'sauce' ? 'kitchen:sauces.title' : 'kitchen:dressings.title'),
        subcategoryLabel: t('kitchen:fields.subcategory'),
        subcategoryPlaceholder: t('kitchen:fields.subcategoryPlaceholder'),
        options: subcategoryOptions(itemType, t),
    };

    /*
     * The recipe is written; this writes the thing that sells it.
     *
     * Failure here leaves a recipe with no item pointing at it, which is a real state rather than a
     * corrupt one — the recipe is in the library and the link can be made later — so the reader is
     * sent to the recipe rather than left on a form whose record already exists.
     */
    const linkToCatalogue = (created: RecipeAdmin) => {
        createItem.mutate(
            {
                name: created.name,
                description: created.description,
                categoryCode: ITEM_CATEGORY[itemType],
                itemType,
                recipeId: created.id,
            },
            {
                onSuccess: (item) => {
                    router.replace(`${routeBase}/${String(item.id)}` as never);
                },
                onError: () => {
                    router.replace(`/kitchen/recipes/${String(created.id)}` as never);
                },
            },
        );
    };

    if (isCreating) {
        return (
            <RecipeEditScreen
                recipe="new"
                withoutPackaging
                backTo={routeBase}
                classification={classification}
                referenceSeries={REFERENCE_SERIES[itemType]}
                onCreated={linkToCatalogue}
            />
        );
    }

    if (parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-sauce-editor-screen">
                <Callout
                    testID="kitchen-sauce-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:products.notFoundTitle')}
                    body={t('kitchen:products.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-sauce-not-found-back"
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
            <Stack space="md" testID="kitchen-sauce-editor-loading">
                <Skeleton testID="kitchen-sauce-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-sauce-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-sauce-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-sauce-editor-screen">
                <ErrorState
                    testID="kitchen-sauce-load-error"
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

    const item = record.data;

    if (item !== undefined && item.recipeId !== null) {
        return (
            <RecipeEditScreen
                recipe={String(item.recipeId)}
                withoutPackaging
                backTo={routeBase}
                classification={classification}
                referenceSeries={REFERENCE_SERIES[itemType]}
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
    const startFailure = toFailure(createRecipe.error ?? linkRecipe.error);
    const starting = createRecipe.isPending || linkRecipe.isPending;

    /*
     * Write the recipe, then link it to *this* item — not to a new one. Stops at the first failure
     * rather than reporting success: a recipe nothing points at is invisible from here, and a second
     * press would write another. The link carries `recipeId` and the lock version alone;
     * `CatalogueItemService::update` reads its payload key by key, so the packs, the channels and
     * the filing are not in the request and cannot be cleared by it.
     */
    const startFormulation = () => {
        if (item === undefined) return;

        createRecipe.mutate(
            {
                name: item.name,
                description: item.description,
                yieldQuantity: 1,
                yieldUnit: 'kg',
            },
            {
                onSuccess: (created) => {
                    linkRecipe.mutate(
                        {
                            productId: item.id,
                            request: {
                                lockVersion: item.meta.lockVersion,
                                recipeId: created.id,
                            },
                        },
                        {
                            onSuccess: () => {
                                toast.show({
                                    testID: 'kitchen-sauce-formulation-started-toast',
                                    tone: 'success',
                                    message: t('kitchen:products.formulationStartedToast', {
                                        name: displayName(created.name, locale).value,
                                    }),
                                });
                            },
                        },
                    );
                },
            },
        );
    };

    return (
        <Stack space="md" testID="kitchen-sauce-editor-screen">
            <Callout
                testID="kitchen-sauce-recipe-missing"
                role="note"
                tone="info"
                title={t('kitchen:products.recipeMissingTitle')}
                body={t('kitchen:products.recipeMissingBody')}
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-sauce-formulation-start"
                            label={t('kitchen:products.formulationStart')}
                            loading={starting}
                            disabled={starting}
                            onPress={startFormulation}
                        />
                    ) : undefined
                }
            />

            {startFailure === null ? null : (
                <Text testID="kitchen-sauce-formulation-error" tone="danger">
                    {startFailure.message}
                </Text>
            )}
        </Stack>
    );
}
