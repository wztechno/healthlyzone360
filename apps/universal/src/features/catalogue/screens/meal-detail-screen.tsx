import { HideShellTopbar, Icon, ShellDock, cx, useBreakpoint } from '@healthy360/design-system';
import type { ApiFailure, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { neutral } from '@healthy360/design-tokens';
import type { StageInkName } from '@healthy360/design-tokens';
import { MealId } from '@healthy360/domain-types';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, ScrollView, TextInput, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { BackPill } from '../../../ui/back-pill.tsx';
import { StaffReturnButton } from '../../marketplace/staff-return-button.tsx';

import { mealsFromPages, useMealQuery, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useCartQuery, useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { EntityImage } from '../../../media/entity-image.tsx';
import { PhotoCredit } from '../../../media/photo-credit.tsx';
import { useNavigateUp, usePreviousEntry } from '../../../navigation/use-return-to.ts';
import { useFailureMessage } from '../../../screens/form-helpers.ts';
import { DishChoiceFields, NO_DISH_CHOICES } from '../../../ui/dish-choices.tsx';
import type { DishChoiceValue } from '../../../ui/dish-choices.tsx';
import { useMyAllergenCodes } from '../../commerce/my-allergens.tsx';
import { ShopStateButton, ShopStateCard } from '../../../ui/shop-state.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { DeliverToMenu } from '../../marketplace/discover/deliver-to-menu.tsx';
import { formatMoney, formatPackSize } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { useShopViewOnly } from '../../marketplace/shop-view-only.tsx';
import { macroBreakdown } from '../format.ts';
import { leadTag, publishedFigure } from '../meal-readings.ts';
import { MealNutrition } from '../meal-nutrition.tsx';
// Extensionless, as `range-slider` is: Metro picks the web or the phone half.
import { StageRing } from '../stage-ring';

/**
 * `/meals/{meal}` — the accepted shop board's meal page, bound to what the meal record holds.
 *
 * ## The page, top to bottom
 *
 * **The stage** — one canopy panel: on the start side the way back, the kitchen, the name and the
 * price; in the middle the dish on a round plate with its tags around it; on the end side the four
 * figures per serving as rings. **The order bar** overlaps the stage's foot: the quantity, a note for
 * the kitchen, where and when it goes (`deliver-to-menu.tsx`), and Add with the total. Then the
 * dish's own choices when it has any, **Make it a meal** — the same kitchen's sauces and dressings
 * to tick and add with it — and three cards: allergens, ingredients and the kitchen. The full
 * nutrition facts follow, because the rings summarise them and do not replace them.
 *
 * ## Where the record is thinner than the board
 *
 * * **The tags around the plate** are the board's ingredients; the record has no ingredient list, so
 *   they are what it does hold — the dish's diets, cuisines, meal times and preparation time — and
 *   a dish with none of those wears none.
 * * **Ingredients** say the list is not published, in the board's card.
 * * **Allergens** are what the kitchen declares; the record has no "may contain".
 * * **Save** is not drawn: favourites have no backend.
 *
 * ## Make it a meal
 *
 * Ticking a side adds its price to the total on Add; pressing Add adds the meal, and once the meal
 * has landed — past any allergen or new-basket question — each ticked side, one after another. A
 * visitor who has to sign in first comes back with the meal; the sides are a choice made on this
 * page and are not carried through the sign-in.
 */
export interface MealDetailScreenProps {
    readonly mealId: string | undefined;
    /** `?returnTo=` — the kitchen record staff opened this from; see `StaffReturnButton`. */
    readonly returnTo?: string | undefined;
}

/** A ceiling on the stepper. The API refuses nothing above zero; this only stops a held button. */
const MAX_QUANTITY = 99;

/** How many sides "Make it a meal" offers. */
const SIDE_COUNT = 6;

/** How long Add wears "Added to basket". */
const ADDED_MS = 1600;

/** The catalogue a meal belongs to when nothing says otherwise. */
const MENU_PATH = '/meals';

/** A storefront (`/kitchens/{id}`) or its searchable menu (`/kitchens/{id}/menu`). */
const KITCHEN_PAGE = /^\/kitchens\/([^/]+)(\/menu)?$/;

/** The four rings, in the board's order and inks. */
const RINGS: readonly { readonly nutrientId: string; readonly ink: StageInkName }[] = [
    { nutrientId: 'energy', ink: 'orange' },
    { nutrientId: 'protein', ink: 'green' },
    { nutrientId: 'carbohydrate', ink: 'blue' },
    { nutrientId: 'fat', ink: 'yellow' },
];

/** The dot each tag around the plate wears, in turn. */
const TAG_INKS = ['bg-stage-green', 'bg-stage-orange', 'bg-stage-blue', 'bg-stage-yellow'] as const;

/**
 * The way back above the meal (browse-05): to the kitchen's storefront or menu when that is the
 * entry right below, otherwise to the menu. It goes *up* through `useNavigateUp` — Back when the
 * parent is the entry below, the listing exactly as it was, and otherwise the parent with the query
 * it was last shown with.
 */
function useMealBack(item: MarketplaceMeal | undefined): {
    readonly label: string;
    readonly onPress: () => void;
} {
    const { t } = useTranslation();
    const navigateUp = useNavigateUp();
    const previous = usePreviousEntry();
    const fromKitchen = previous === null ? null : KITCHEN_PAGE.exec(previous.pathname);
    if (previous !== null && fromKitchen?.[1] !== undefined) {
        return {
            label: t('catalogue:meal.backToKitchen', {
                kitchen: item?.kitchenName ?? t('marketplace:kitchen.loading'),
            }),
            onPress: () => {
                navigateUp(previous.pathname);
            },
        };
    }
    return {
        label: t('catalogue:meal.backToMenu'),
        onPress: () => {
            navigateUp(MENU_PATH);
        },
    };
}

export function MealDetailScreen({ mealId, returnTo }: MealDetailScreenProps) {
    const { t } = useTranslation();
    const navigateUp = useNavigateUp();

    const parsed = mealId === undefined ? null : MealId.safeParse(mealId);
    const meal = useMealQuery(parsed);
    const item = meal.data;
    const back = useMealBack(item);

    const browseAction = (
        <ShopStateButton
            testID="meal-detail-browse"
            icon="arrowForward"
            iconAfter
            label={t('catalogue:meal.browseAll')}
            onPress={() => {
                navigateUp(MENU_PATH);
            }}
        />
    );

    return (
        <View testID="meal-detail-screen" className="flex-col gap-4 pb-11">
            <StaffReturnButton returnTo={returnTo} testID="meal-detail-staff-return" />

            {/* A link carrying something that is not an identifier at all leaves the query
                disabled, and a disabled query never settles — so the not-found answer is rendered
                directly rather than behind a skeleton that would spin for ever. */}
            {parsed === null ? (
                <ShopStateCard
                    testID="meal-detail-empty"
                    icon="utensils"
                    title={t('catalogue:meal.notFoundTitle')}
                    body={t('catalogue:meal.notFoundBody')}
                    actions={browseAction}
                />
            ) : (
                <QueryStates
                    query={meal}
                    isEmpty={item === undefined}
                    emptyTitle={t('catalogue:meal.notFoundTitle')}
                    emptyBody={t('catalogue:meal.notFoundBody')}
                    emptyActions={browseAction}
                    emptyIcon="utensils"
                    // Shop · Meal page, pin 3: a meal that is gone is "not on the marketplace",
                    // not "something went wrong".
                    treatFailuresAsEmpty={['resource.not_found']}
                    skeleton="page"
                    skeletonCount={2}
                    testID="meal-detail"
                >
                    {item === undefined ? null : <MealPage item={item} back={back} />}
                </QueryStates>
            )}
        </View>
    );
}

/** The page once the meal is in hand. */
function MealPage({
    item,
    back,
}: {
    readonly item: MarketplaceMeal;
    readonly back: { readonly label: string; readonly onPress: () => void };
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const viewOnly = useShopViewOnly();
    /*
     * Shop · Meal page, phone board: no shop bar — the stage runs to the screen's edges with its
     * own back and basket on top — then the note and where it goes, and quantity with Add docked
     * to the bottom of the screen.
     */
    const phone = !useBreakpoint().atLeast('md');

    const [quantity, setQuantity] = useState(1);
    const [instructions, setInstructions] = useState('');
    const [choices, setChoices] = useState<DishChoiceValue>(NO_DISH_CHOICES);
    const [picked, setPicked] = useState<readonly string[]>([]);
    const [added, setAdded] = useState(false);

    /*
     * The grids' "add to basket", with the quantity threaded through — the mutation, the
     * confirmation, and the guest-entry dialog for somebody who is not signed in.
     */
    const basket = useBasketAdd({
        labelKey: 'catalogue:nav.meals',
        testID: 'meal-detail',
        reportsInline: true,
    });

    // The same kitchen's sauces and dressings, for "Make it a meal".
    const sidesFilter = useMemo(
        () => ({
            kitchenIds: [item.kitchenId] as readonly KitchenId[],
            itemTypes: ['sauce', 'dressing'] as const,
            limit: SIDE_COUNT + 1,
        }),
        [item.kitchenId],
    );
    const sidesQuery = useMealsQuery(sidesFilter);
    const sides = mealsFromPages(sidesQuery.data?.pages)
        .filter((candidate) => candidate.id !== item.id)
        .slice(0, SIDE_COUNT);
    const pickedSides = sides.filter((side) => picked.includes(String(side.id)));

    const options = item.options ?? [];
    const sidesAmount = pickedSides.reduce((sum, side) => sum + side.price.amount, 0);
    const total = formatMoney(formatter, {
        amount: item.price.amount * quantity + sidesAmount,
        currency: item.price.currency,
    });

    /** Each ticked side, one after another, once the one before it has landed. */
    const addSides = (queue: readonly MarketplaceMeal[]) => {
        const [next, ...rest] = queue;
        if (next === undefined) {
            setPicked([]);
            return;
        }
        basket.add(next, 1, {
            onAdded: () => {
                addSides(rest);
            },
        });
    };

    const onAdd = () => {
        basket.add(
            {
                ...item,
                choices: {
                    catalogueItemVariantId: choices.catalogueItemVariantId,
                    optionIds: choices.optionIds,
                    note: instructions,
                },
            },
            quantity,
            {
                onAdded: () => {
                    setAdded(true);
                    setTimeout(() => {
                        setAdded(false);
                    }, ADDED_MS);
                    addSides(pickedSides);
                },
            },
        );
    };

    return (
        <View className="flex-col">
            {phone ? <HideShellTopbar /> : null}
            {phone ? (
                <PhoneMealStage item={item} back={back} viewOnly={viewOnly} />
            ) : (
                <MealStage item={item} back={back} />
            )}

            <OrderBar
                item={item}
                viewOnly={viewOnly}
                quantity={quantity}
                onQuantityChange={setQuantity}
                instructions={instructions}
                onInstructionsChange={setInstructions}
                total={total}
                pending={basket.pending}
                added={added}
                failure={basket.failure}
                onAdd={onAdd}
                phone={phone}
            />

            {/* Staff view the shop and order nothing (`shop-view-only.tsx`): no choices, no sides. */}
            {/*
             * Add-ons only. A dish's "portions" are the kitchen's per-channel packs (a B2C pack, a B2B
             * pack), not a choice for a shopper, so the shop never offers them: the add goes in with
             * no variant and the server prices it for the shop.
             */}
            {viewOnly || options.length === 0 ? null : (
                <View testID="meal-detail-options" className="mt-14 flex-col gap-3">
                    <SectionHeading>{t('catalogue:meal.makeItYours')}</SectionHeading>
                    <DishChoiceFields
                        testID="meal-detail-choices"
                        options={options}
                        portions={[]}
                        value={choices}
                        onChange={setChoices}
                        formatPrice={(choice) =>
                            formatMoney(formatter, {
                                amount: choice.unitPriceMinor,
                                currency: item.price.currency,
                            })
                        }
                    />
                </View>
            )}

            {viewOnly || sides.length === 0 ? null : (
                <MakeItAMeal
                    phone={phone}
                    sides={sides}
                    picked={picked}
                    onToggle={(id) => {
                        setPicked((current) =>
                            current.includes(id)
                                ? current.filter((entry) => entry !== id)
                                : [...current, id],
                        );
                    }}
                    note={
                        pickedSides.length === 0
                            ? t('catalogue:meal.sidesNote')
                            : t('catalogue:meal.sidesAdded', {
                                  count: pickedSides.length,
                                  price: formatMoney(formatter, {
                                      amount: sidesAmount,
                                      currency: item.price.currency,
                                  }),
                              })
                    }
                />
            )}

            <FactCards item={item} />

            <MealFacts item={item} />

            {/*
             * The signed-out entry point. A real dialog rather than a redirect: Sign in and Create
             * account each keep the meal and its quantity and carry this page as the return, so
             * the add is made once the person is back here (`commerce/use-basket-add.tsx`).
             */}
            {basket.dialog}
        </View>
    );
}

/** The board's 26px section heading. */
function SectionHeading({
    children,
    phone = false,
}: {
    readonly children: string;
    readonly phone?: boolean;
}) {
    return (
        <RNText
            accessibilityRole="header"
            aria-level={2}
            className={cx(
                'font-display font-bold tracking-display text-content-primary text-start',
                phone ? 'text-xl' : 'text-2xl',
            )}
        >
            {children}
        </RNText>
    );
}

/**
 * The phone stage (Shop · Meal page, phone board): the canopy runs to the screen's edges and its
 * foot is rounded; on top, a round Back and the basket with its count; then the plate, the
 * kitchen, the name and the price, and the four figures as one row of small rings.
 */
function PhoneMealStage({
    item,
    back,
    viewOnly,
}: {
    readonly item: MarketplaceMeal;
    readonly back: { readonly label: string; readonly onPress: () => void };
    readonly viewOnly: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const kitchen = useKitchenQuery(item.kitchenId);
    const { me } = useSession();
    const cart = useCartQuery(me !== null && !viewOnly);
    const count = cart.data?.itemCount ?? 0;

    return (
        <View
            testID="meal-detail-stage"
            className="relative -mx-4 -mt-4 flex-col overflow-hidden rounded-b-[32px] bg-surface-canopy px-4 pb-[22px] pt-3"
        >
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute end-0 start-0 top-5 mx-auto h-[420px] w-[420px] rounded-full bg-stage-green opacity-10"
            />
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute end-0 start-0 top-20 mx-auto h-[300px] w-[300px] rounded-full border-[1.5px] border-dashed border-content-on-canopy/30"
            />

            <View className="z-10 flex-row items-center gap-2">
                <Pressable
                    testID="meal-detail-back"
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={back.label}
                    onPress={back.onPress}
                    className="h-11 w-11 items-center justify-center rounded-full bg-content-on-canopy/10"
                >
                    <Icon name="chevronBackward" className="text-content-on-canopy" />
                </Pressable>
                <View className="flex-1" />
                {viewOnly ? null : (
                    <Pressable
                        testID="meal-detail-basket"
                        role="link"
                        accessibilityRole="link"
                        accessibilityLabel={t('marketplace:consumer.nav.cartWithCount', {
                            label: t('marketplace:consumer.nav.cart'),
                            items: count,
                        })}
                        onPress={() => {
                            router.push('/customer/cart' as never);
                        }}
                        className="relative h-11 w-11 items-center justify-center rounded-full bg-content-on-canopy/10"
                    >
                        <Icon name="shoppingBasket" className="text-content-on-canopy" />
                        <View className="absolute -end-0.5 -top-0.5 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-stage-green px-1">
                            <RNText className="text-xs font-bold tabular-nums leading-4 text-surface-canopy">
                                {String(count)}
                            </RNText>
                        </View>
                    </Pressable>
                )}
            </View>

            <Plate item={item} />

            <View className="z-10 flex-col items-start">
                <Pressable
                    testID="meal-detail-kitchen"
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('catalogue:meal.thumbKitchen', {
                        kitchen: item.kitchenName,
                    })}
                    onPress={() => {
                        router.push(`/kitchens/${String(item.kitchenId)}` as never);
                    }}
                    className="h-8 flex-row items-center gap-2 rounded-full bg-content-on-canopy/10 pe-3 ps-1"
                >
                    <View className="h-6 w-6 overflow-hidden rounded-full">
                        <EntityImage
                            assetId={kitchen.data?.imagePlaceholderId}
                            seed={`kitchen-${String(item.kitchenId)}`}
                            label={item.kitchenName}
                            decorative
                            flush
                            className="h-6 w-6"
                        />
                    </View>
                    <RNText className="text-xs font-semibold text-content-on-canopy">
                        {item.kitchenName}
                    </RNText>
                </Pressable>
                <RNText
                    testID="meal-detail-name"
                    accessibilityRole="header"
                    aria-level={1}
                    className="mt-2.5 font-display text-3xl font-bold leading-[33px] tracking-display text-content-on-canopy text-start"
                >
                    {item.name}
                </RNText>
                <View className="mt-1.5 flex-row items-baseline gap-2">
                    <RNText
                        testID="meal-detail-price"
                        className="font-display text-2xl font-bold tabular-nums text-content-on-canopy"
                    >
                        {formatMoney(formatter, item.price)}
                    </RNText>
                    <RNText className="text-sm text-content-on-canopy-muted">
                        {item.pack === null
                            ? t('catalogue:meal.perServing')
                            : t('catalogue:meal.perPack', {
                                  size: formatPackSize(t, formatter, item.pack),
                              })}
                    </RNText>
                </View>
            </View>

            <View className="mt-4">
                <StageRings item={item} phone />
            </View>
        </View>
    );
}

/* ── the stage ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The canopy panel: who and what on the start side, the plate in the middle, the rings on the end
 * side. One column below `lg`, in that order.
 */
function MealStage({
    item,
    back,
}: {
    readonly item: MarketplaceMeal;
    readonly back: { readonly label: string; readonly onPress: () => void };
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const kitchen = useKitchenQuery(item.kitchenId);
    const tag = leadTag(item, t);

    return (
        <View
            testID="meal-detail-stage"
            className="relative mt-1 flex-col gap-8 overflow-hidden rounded-[30px] bg-surface-canopy px-6 pb-16 pt-6 lg:h-[500px] lg:flex-row lg:items-center lg:gap-6 lg:px-10 lg:pb-0 lg:pt-0"
        >
            {/* The board's soft glow and the dashed ring behind the plate. */}
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -top-12 end-0 start-0 mx-auto hidden h-[600px] w-[600px] rounded-full bg-stage-green opacity-10 lg:flex"
            />
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute end-0 start-0 top-[30px] mx-auto hidden h-[440px] w-[440px] rounded-full border-[1.5px] border-dashed border-content-on-canopy/30 lg:flex"
            />

            <View className="z-10 min-w-0 flex-col items-start lg:w-[330px]">
                <BackPill label={back.label} onPress={back.onPress} />

                <Pressable
                    testID="meal-detail-kitchen"
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('catalogue:meal.thumbKitchen', {
                        kitchen: item.kitchenName,
                    })}
                    onPress={() => {
                        router.push(`/kitchens/${String(item.kitchenId)}` as never);
                    }}
                    className="mt-[18px] h-9 flex-row items-center gap-2 rounded-full bg-content-on-canopy/10 pe-3 ps-1"
                >
                    <View className="h-7 w-7 overflow-hidden rounded-full">
                        <EntityImage
                            assetId={kitchen.data?.imagePlaceholderId}
                            seed={`kitchen-${String(item.kitchenId)}`}
                            label={item.kitchenName}
                            decorative
                            flush
                            className="h-7 w-7"
                        />
                    </View>
                    <RNText className="text-sm font-semibold text-content-on-canopy">
                        {item.kitchenName}
                    </RNText>
                </Pressable>

                {tag === null ? null : (
                    <RNText
                        testID="meal-detail-lead-diet"
                        className="mt-4 text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted"
                    >
                        {tag}
                    </RNText>
                )}

                <RNText
                    testID="meal-detail-name"
                    accessibilityRole="header"
                    aria-level={1}
                    className="mt-2 font-display text-5xl font-bold leading-tight tracking-display text-content-on-canopy text-start"
                >
                    {item.name}
                </RNText>

                <View className="mt-3.5 flex-row items-baseline gap-2.5">
                    <RNText
                        testID="meal-detail-price"
                        className="font-display text-3xl font-bold tabular-nums text-content-on-canopy"
                    >
                        {formatMoney(formatter, item.price)}
                    </RNText>
                    <RNText className="text-sm text-content-on-canopy-muted">
                        {item.pack === null
                            ? t('catalogue:meal.perServing')
                            : t('catalogue:meal.perPack', {
                                  size: formatPackSize(t, formatter, item.pack),
                              })}
                    </RNText>
                </View>

                {item.description === '' ? null : (
                    <RNText
                        numberOfLines={3}
                        className="mt-3 max-w-[330px] text-sm leading-relaxed text-content-on-canopy-muted text-start"
                    >
                        {item.description}
                    </RNText>
                )}

                <RNText
                    testID="meal-detail-rating"
                    className="mt-2 text-xs font-medium tabular-nums text-content-on-canopy-muted"
                >
                    {item.rating === null
                        ? t('catalogue:meal.notRatedYet')
                        : t('catalogue:meal.ratingSummary', {
                              rating: formatter.formatNumber(item.rating, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                              }),
                              count: item.ratingCount,
                              reviews: formatter.formatNumber(item.ratingCount),
                          })}
                </RNText>
            </View>

            <Plate item={item} />

            <StageRings item={item} />
        </View>
    );
}

/** The dish on its round plate, with what the record says about it around the rim. */
function Plate({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const tags = [
        ...item.dietClassifications
            .filter((diet) => diet !== 'omnivore')
            .map((diet) => t(`marketplace:diets.${diet}`)),
        ...item.cuisines,
        ...item.mealTypes.map((type) => t(`marketplace:mealTypes.${type}`, { defaultValue: type })),
        ...(item.preparationMinutes === null
            ? []
            : [
                  t('catalogue:meal.prepMinutes', {
                      minutes: formatter.formatNumber(item.preparationMinutes),
                  }),
              ]),
    ].slice(0, 8);

    return (
        <View className="z-10 min-w-0 flex-1 items-center justify-center">
            <View className="relative h-[300px] w-[300px] items-center justify-center lg:h-[480px] lg:w-[480px]">
                <View className="h-[220px] w-[220px] overflow-hidden rounded-full border-[11px] border-surface-raised shadow-elevation-3 lg:h-[320px] lg:w-[320px]">
                    <EntityImage
                        testID="meal-detail-image"
                        assetId={item.imagePlaceholderId}
                        photoUrl={item.photoUrl}
                        variant="detail"
                        seed={item.slug}
                        label={t('catalogue:meal.imageLabel', { meal: item.name })}
                        flush
                        className="h-full w-full"
                    />
                </View>
                {tags.map((label, index) => {
                    // An ellipse turned half a step, so no tag sits on the top or bottom edge where
                    // the order bar overlaps the stage.
                    const angle =
                        (index / tags.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / tags.length;
                    return (
                        <View
                            key={label}
                            aria-hidden
                            className="absolute h-8 -translate-x-1/2 -translate-y-1/2 flex-row items-center gap-1.5 rounded-full bg-surface-raised px-3 shadow-elevation-2"
                            style={{
                                left: `${String(50 + Math.cos(angle) * 47)}%` as DimensionValue,
                                top: `${String(47 + Math.sin(angle) * 34)}%` as DimensionValue,
                            }}
                        >
                            <View
                                className={cx(
                                    'h-2 w-2 rounded-full',
                                    TAG_INKS[index % TAG_INKS.length],
                                )}
                            />
                            <RNText
                                numberOfLines={1}
                                className="text-xs font-semibold text-content-primary"
                            >
                                {label}
                            </RNText>
                        </View>
                    );
                })}
            </View>
            {/* The credit a photograph's licence obliges — nothing for the kitchen's own upload. */}
            {item.photoUrl === undefined || item.photoUrl === null || item.photoUrl === '' ? (
                <PhotoCredit assetId={item.imagePlaceholderId} testID="meal-detail-photo-credit" />
            ) : null}
        </View>
    );
}

/**
 * The four figures per serving as rings. Calories fill their ring when published; each macro's ring
 * is its share of the serving's energy — a proportion of the dish, never of a person's target. A
 * figure the kitchen did not publish is a dash over an empty ring, never a zero.
 */
function StageRings({
    item,
    phone = false,
}: {
    readonly item: MarketplaceMeal;
    readonly phone?: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const dash = t('catalogue:card.noFigure');
    const shares = macroBreakdown(item.nutrition);

    return (
        <View testID="meal-detail-strip" className="z-10 flex-col lg:w-[250px]">
            {phone ? null : (
                <RNText
                    {...(item.nutrition.basis === 'per_100g'
                        ? { testID: 'meal-detail-strip-basis' }
                        : {})}
                    className="mb-3 text-xs font-semibold uppercase tracking-widest text-content-on-canopy-muted text-start"
                >
                    {item.nutrition.basis === 'per_100g'
                        ? t('catalogue:meal.stripPer100g')
                        : t('catalogue:meal.perServingEyebrow')}
                </RNText>
            )}
            <View className={cx('flex-row', phone ? 'gap-1.5' : 'flex-wrap gap-2.5')}>
                {RINGS.map((ring) => {
                    const figure = publishedFigure(item, ring.nutrientId);
                    const label = t(`catalogue:card.strip.${ring.nutrientId}`);
                    const value =
                        figure === null
                            ? dash
                            : ring.nutrientId === 'energy'
                              ? formatter.formatNumber(figure)
                              : t('catalogue:meal.macroValue', {
                                    grams: formatter.formatNumber(figure),
                                });
                    const share =
                        figure === null
                            ? 0
                            : ring.nutrientId === 'energy'
                              ? 1
                              : (shares.find((entry) => entry.nutrientId === ring.nutrientId)
                                    ?.percentageOfEnergy ?? 0) / 100;
                    return (
                        <View
                            key={ring.nutrientId}
                            className={
                                phone ? 'min-w-0 flex-1' : 'min-w-[110px] flex-1 basis-[45%]'
                            }
                        >
                            <StageRing
                                small={phone}
                                testID={`meal-detail-strip-${ring.nutrientId}`}
                                value={value}
                                label={label}
                                share={share}
                                ink={ring.ink}
                                accessibilityLabel={t('catalogue:meal.ringLabel', {
                                    label,
                                    value,
                                })}
                            />
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

/* ── the order bar ───────────────────────────────────────────────────────────────────────────── */

interface OrderBarProps {
    readonly item: MarketplaceMeal;
    readonly viewOnly: boolean;
    readonly quantity: number;
    readonly onQuantityChange: (next: number) => void;
    readonly instructions: string;
    readonly onInstructionsChange: (next: string) => void;
    readonly total: string;
    readonly pending: boolean;
    readonly added: boolean;
    /** Why the last add failed. A generic `server` keeps the page's own sentence. */
    readonly failure: ApiFailure | null;
    readonly onAdd: () => void;
    /** The phone board's split: note and where in the page, quantity and Add docked below. */
    readonly phone?: boolean | undefined;
}

/**
 * The white bar over the stage's foot: quantity, the note for the kitchen, where and when, and Add
 * carrying the total — which wears "Added to basket" for a moment once the add has landed.
 */
function OrderBar({
    item,
    viewOnly,
    quantity,
    onQuantityChange,
    instructions,
    onInstructionsChange,
    total,
    pending,
    added,
    failure,
    onAdd,
    phone = false,
}: OrderBarProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const failureMessage = useFailureMessage();

    const addButton = (
        <Pressable
            testID="meal-detail-add-to-basket"
            role="button"
            accessibilityRole="button"
            accessibilityLabel={
                pending
                    ? t('catalogue:meal.addingToBasket')
                    : t('catalogue:meal.addToCartLabel', { total })
            }
            accessibilityState={{ disabled: pending, busy: pending }}
            aria-disabled={pending}
            disabled={pending}
            onPress={onAdd}
            className={cx(
                'flex-row items-center justify-between rounded-2xl transition duration-normal ease-standard active:scale-[0.98]',
                phone
                    ? 'h-[54px] min-w-0 flex-1 gap-3 px-4'
                    : 'h-14 min-w-[280px] grow gap-4 px-[22px] lg:grow-0',
                added ? 'bg-content-primary' : 'bg-surface-brand hover:bg-surface-canopy',
            )}
        >
            <RNText
                numberOfLines={1}
                className={cx(
                    'shrink font-bold',
                    phone ? 'text-sm' : 'text-base',
                    added ? 'text-surface-base' : 'text-content-on-brand',
                )}
            >
                {pending
                    ? t('catalogue:meal.addingToBasket')
                    : added
                      ? t('catalogue:meal.addedShort')
                      : t('catalogue:meal.addToCart')}
            </RNText>
            <RNText
                testID="meal-detail-total"
                className={cx(
                    'font-display font-bold tabular-nums',
                    phone ? 'text-base' : 'text-lg',
                    added ? 'text-surface-base' : 'text-content-on-brand',
                )}
            >
                {total}
            </RNText>
        </Pressable>
    );

    const noteField = (
        <View
            className={cx(
                'flex-row items-center gap-2.5 px-4',
                phone
                    ? 'h-[52px] rounded-2xl border border-stroke-subtle bg-surface-raised'
                    : 'h-14 min-w-[200px] flex-1 rounded-2xl bg-surface-base',
            )}
        >
            <Icon name="pen" size="sm" className="text-content-secondary" />
            <TextInput
                testID="meal-detail-instructions-input"
                accessibilityLabel={t('catalogue:meal.instructionsLabel')}
                placeholder={t('catalogue:meal.notePlaceholder')}
                placeholderTextColor={neutral[600]}
                maxLength={200}
                value={instructions}
                onChangeText={onInstructionsChange}
                className="h-full min-w-0 flex-1 text-base text-content-primary text-start web:outline-none"
            />
        </View>
    );

    if (phone) {
        return (
            <View testID="meal-detail-actions" className="mt-5 flex-col gap-2">
                {viewOnly ? null : (
                    <>
                        {noteField}
                        <DeliverToMenu
                            testID="meal-detail-deliver"
                            row
                            kitchenId={item.kitchenId}
                        />
                    </>
                )}
                {item.pack === null ? null : (
                    <RNText
                        testID="meal-detail-pack"
                        className="px-1 text-sm tabular-nums text-content-secondary text-start"
                    >
                        {t('catalogue:meal.pricePerPack', {
                            price: formatMoney(formatter, item.price),
                            size: formatPackSize(t, formatter, item.pack),
                        })}
                    </RNText>
                )}
                {failure === null ? null : (
                    <ActionFailure failure={failure} message={failureMessage(failure)} />
                )}
                {viewOnly ? null : (
                    <ShellDock>
                        <View className="flex-row items-center gap-2.5 border-t border-stroke-subtle bg-surface-raised px-3.5 pb-2.5 pt-2 shadow-elevation-3">
                            <QuantityStepper
                                testID="meal-detail-quantity"
                                value={quantity}
                                onChange={onQuantityChange}
                            />
                            {addButton}
                        </View>
                    </ShellDock>
                )}
            </View>
        );
    }

    return (
        <View
            testID="meal-detail-actions"
            className="z-20 mx-auto -mt-9 w-full max-w-[1040px] flex-col gap-2 px-3 lg:px-0"
        >
            <View className="z-auto flex-row flex-wrap items-center gap-2.5 rounded-3xl border border-stroke-subtle bg-surface-raised p-2.5 shadow-elevation-3">
                {viewOnly ? (
                    <RNText className="px-3 font-display text-xl font-bold tabular-nums text-content-primary text-start">
                        {total}
                    </RNText>
                ) : (
                    <>
                        <QuantityStepper
                            testID="meal-detail-quantity"
                            value={quantity}
                            onChange={onQuantityChange}
                        />
                        {noteField}
                        <DeliverToMenu
                            testID="meal-detail-deliver"
                            bar
                            kitchenId={item.kitchenId}
                        />
                        {addButton}
                    </>
                )}
            </View>

            {/* What one unit buys, when it is sold by weight: the total above is per pack. */}
            {item.pack === null ? null : (
                <RNText
                    testID="meal-detail-pack"
                    className="px-2 text-sm tabular-nums text-content-secondary text-start"
                >
                    {t('catalogue:meal.pricePerPack', {
                        price: formatMoney(formatter, item.price),
                        size: formatPackSize(t, formatter, item.pack),
                    })}
                </RNText>
            )}

            {failure === null ? null : (
                <ActionFailure failure={failure} message={failureMessage(failure)} />
            )}
        </View>
    );
}

/** Shop · Meal page, pin 4: a red card with its own tile, beside the button that failed. */
function ActionFailure({
    failure,
    message,
}: {
    readonly failure: ApiFailure;
    readonly message: string | null;
}) {
    const { t } = useTranslation();
    return (
        <View
            testID="meal-detail-action-error"
            role="alert"
            className="flex-row gap-3 rounded-[18px] border border-danger-border bg-danger-subtle px-4 py-3.5 shadow-elevation-2"
        >
            <View className="h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-danger-strong">
                <Icon name="close" size="sm" className="text-danger-on-strong" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="text-base font-bold leading-[21px] text-danger-on-subtle text-start">
                    {t('catalogue:meal.actionErrorTitle')}
                </RNText>
                <RNText className="text-sm leading-5 text-danger-on-subtle text-start">
                    {failure.code === 'server'
                        ? t('catalogue:meal.actionErrorBody')
                        : (message ?? t('catalogue:meal.actionErrorBody'))}
                </RNText>
            </View>
        </View>
    );
}

interface QuantityStepperProps {
    readonly value: number;
    readonly onChange: (next: number) => void;
    readonly testID: string;
}

/**
 * The board's − 1 + on a soft well.
 *
 * Not `NumberStepper`: that is a form field, with a visible label and a text input between its
 * buttons, and here the figure only ever moves one at a time beside a button that already says what
 * it is for. The group carries the name a screen reader needs, the figure announces its changes, and
 * both buttons keep the 44px touch floor this customer surface requires.
 */
function QuantityStepper({ value, onChange, testID }: QuantityStepperProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const step = (
        id: string,
        label: string,
        icon: 'minus' | 'plus',
        disabled: boolean,
        next: number,
    ) => (
        <Pressable
            testID={`${testID}-${id}`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
                onChange(next);
            }}
            className={cx(
                'h-12 w-12 items-center justify-center rounded-[14px]',
                disabled ? 'opacity-35' : 'hover:bg-surface-raised',
            )}
        >
            <Icon name={icon} className="text-content-primary" />
        </Pressable>
    );

    return (
        <View
            testID={testID}
            role="group"
            aria-label={t('catalogue:meal.quantityLabel')}
            accessibilityLabel={t('catalogue:meal.quantityLabel')}
            className="h-14 flex-row items-center rounded-2xl bg-surface-base p-1"
        >
            {step(
                'decrement',
                t('catalogue:meal.quantityDecrease'),
                'minus',
                value <= 1,
                Math.max(1, value - 1),
            )}
            <RNText
                testID={`${testID}-value`}
                aria-live="polite"
                accessibilityLiveRegion="polite"
                className="min-w-[32px] text-center font-display text-xl font-bold tabular-nums text-content-primary"
            >
                {formatter.formatNumber(value)}
            </RNText>
            {step(
                'increment',
                t('catalogue:meal.quantityIncrease'),
                'plus',
                value >= MAX_QUANTITY,
                Math.min(MAX_QUANTITY, value + 1),
            )}
        </View>
    );
}

/* ── make it a meal ──────────────────────────────────────────────────────────────────────────── */

function MakeItAMeal({
    phone = false,
    sides,
    picked,
    onToggle,
    note,
}: {
    readonly phone?: boolean;
    readonly sides: readonly MarketplaceMeal[];
    readonly picked: readonly string[];
    readonly onToggle: (id: string) => void;
    readonly note: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View testID="meal-detail-sides" className={cx('flex-col', phone ? 'mt-6' : 'mt-14')}>
            <SectionHeading phone={phone}>{t('catalogue:meal.makeAMeal')}</SectionHeading>
            <RNText
                testID="meal-detail-sides-note"
                className="mt-1.5 text-sm text-content-secondary text-start"
            >
                {note}
            </RNText>
            <SidesRow phone={phone}>
                {sides.map((side) => {
                    const id = String(side.id);
                    const on = picked.includes(id);
                    const price = formatMoney(formatter, side.price);
                    return (
                        <Pressable
                            key={id}
                            testID={`meal-detail-side-${side.slug}`}
                            role="checkbox"
                            accessibilityRole="checkbox"
                            aria-checked={on}
                            accessibilityState={{ checked: on }}
                            accessibilityLabel={t('catalogue:meal.sideToggle', {
                                name: side.name,
                                price,
                            })}
                            onPress={() => {
                                onToggle(id);
                            }}
                            className={cx(
                                'relative flex-col items-center border-2 transition duration-normal ease-standard hover:-translate-y-0.5',
                                phone
                                    ? 'w-[116px] gap-1.5 rounded-[20px] px-2 pb-2.5 pt-3'
                                    : 'min-w-[150px] flex-1 basis-[150px] gap-2 rounded-3xl px-2.5 pb-3.5 pt-4',
                                on
                                    ? 'border-surface-brand bg-surface-brand-subtle'
                                    : 'border-stroke-subtle bg-surface-raised',
                            )}
                        >
                            <View
                                className={cx(
                                    'absolute items-center justify-center rounded-full transition duration-normal ease-emphasized',
                                    phone
                                        ? 'end-2 top-2 h-[26px] w-[26px]'
                                        : 'end-3 top-3 h-[30px] w-[30px]',
                                    on ? 'rotate-[360deg] bg-surface-brand' : 'bg-surface-base',
                                )}
                            >
                                <Icon
                                    name={on ? 'check' : 'plus'}
                                    size="sm"
                                    className={
                                        on ? 'text-content-on-brand' : 'text-content-primary'
                                    }
                                />
                            </View>
                            <View
                                className={cx(
                                    'overflow-hidden rounded-full',
                                    phone ? 'h-[72px] w-[72px]' : 'h-24 w-24',
                                )}
                            >
                                <EntityImage
                                    assetId={side.imagePlaceholderId}
                                    photoUrl={side.photoUrl}
                                    seed={side.slug}
                                    label={side.name}
                                    decorative
                                    flush
                                    className={phone ? 'h-[72px] w-[72px]' : 'h-24 w-24'}
                                />
                            </View>
                            <RNText
                                numberOfLines={2}
                                className={cx(
                                    'text-center font-semibold text-content-primary',
                                    phone
                                        ? 'h-[30px] text-xs leading-[15px]'
                                        : 'h-9 text-sm leading-snug',
                                )}
                            >
                                {side.name}
                            </RNText>
                            <RNText
                                className={cx(
                                    'font-display font-bold tabular-nums text-content-primary',
                                    phone ? 'text-sm' : 'text-base',
                                )}
                            >
                                {t('catalogue:meal.sidePrice', { price })}
                            </RNText>
                        </Pressable>
                    );
                })}
            </SidesRow>
        </View>
    );
}

/** A phone's sides scroll sideways from the screen's edge; a desk's wrap into rows. */
function SidesRow({ phone, children }: { readonly phone: boolean; readonly children: ReactNode }) {
    return phone ? (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4 mt-3"
            contentContainerClassName="flex-row gap-2.5 px-4 pb-1 pt-0.5"
        >
            {children}
        </ScrollView>
    ) : (
        <View className="mt-4 flex-row flex-wrap gap-4">{children}</View>
    );
}

/* ── the three cards ─────────────────────────────────────────────────────────────────────────── */

function FactCards({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const router = useRouter();
    const kitchen = useKitchenQuery(item.kitchenId);
    const mine = useMyAllergenCodes();

    return (
        <View className="mt-5 flex-col gap-4 lg:flex-row">
            {/*
             * Shop · Meal page, pin 1: the allergens the person declared are marked on their own
             * chip — red, with "On your allergy list" — instead of a red-dot line repeating the
             * chips. The ingredients card that only ever said "not published" folds into the foot
             * of this one; it comes back as a card when kitchens publish ingredients.
             */}
            <View
                testID="meal-detail-allergens"
                className="flex-col gap-3.5 rounded-3xl bg-warning-subtle p-5 lg:flex-[2]"
            >
                <View className="flex-row items-center gap-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-raised">
                        <Icon name="alert" size="sm" className="text-warning-on-subtle" />
                    </View>
                    <RNText className="font-display text-base font-bold text-warning-on-subtle">
                        {t('catalogue:meal.allergensTitle')}
                    </RNText>
                </View>
                <View
                    testID="meal-detail-allergen-list"
                    className="flex-row flex-wrap items-center gap-2"
                >
                    {item.allergens.length === 0 ? (
                        <RNText className="text-sm text-warning-on-subtle text-start">
                            {t('catalogue:meal.allergensNoneShort')}
                        </RNText>
                    ) : (
                        <>
                            <RNText className="min-w-[92px] text-xs font-bold text-warning-on-subtle">
                                {t('catalogue:meal.contains')}
                            </RNText>
                            {item.allergens.map((code) => {
                                const yours = mine.includes(code);
                                return (
                                    <View
                                        key={code}
                                        testID={
                                            yours ? `meal-detail-your-allergen-${code}` : undefined
                                        }
                                        className={cx(
                                            'h-[34px] flex-row items-center gap-1.5 rounded-[11px] px-3',
                                            yours
                                                ? 'bg-danger-strong shadow-elevation-2'
                                                : 'bg-surface-raised',
                                        )}
                                    >
                                        {yours ? (
                                            <Icon
                                                name="shield"
                                                size="sm"
                                                className="text-danger-on-strong"
                                            />
                                        ) : null}
                                        <RNText
                                            className={cx(
                                                'text-sm font-bold',
                                                yours
                                                    ? 'text-danger-on-strong'
                                                    : 'text-warning-on-subtle',
                                            )}
                                        >
                                            {t(`marketplace:allergens.${code}`)}
                                        </RNText>
                                        {yours ? (
                                            <RNText className="ms-0.5 border-s border-danger-on-strong/40 ps-1.5 text-xs font-semibold text-danger-on-strong opacity-90">
                                                {t('commerce:myAllergens.dialogTitle')}
                                            </RNText>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </>
                    )}
                </View>
                <View
                    testID="meal-detail-ingredients"
                    className="flex-row items-center gap-2 border-t border-warning-border pt-3"
                >
                    <Icon name="leaf" size="sm" className="text-warning-on-subtle" />
                    <RNText className="shrink text-sm text-warning-on-subtle text-start">
                        {t('catalogue:meal.ingredientsBody')}
                    </RNText>
                </View>
            </View>

            <Pressable
                testID="meal-detail-kitchen-card"
                role="link"
                accessibilityRole="link"
                onPress={() => {
                    router.push(`/kitchens/${String(item.kitchenId)}` as never);
                }}
                className="flex-row items-center gap-3.5 rounded-3xl border border-stroke-subtle bg-surface-raised p-5 hover:border-stroke lg:flex-1"
            >
                <View className="h-16 w-16 overflow-hidden rounded-[18px]">
                    <EntityImage
                        assetId={kitchen.data?.imagePlaceholderId}
                        seed={`kitchen-${String(item.kitchenId)}`}
                        label={item.kitchenName}
                        decorative
                        flush
                        className="h-16 w-16"
                    />
                </View>
                <View className="me-auto min-w-0 flex-1 flex-col">
                    <RNText
                        numberOfLines={1}
                        className="font-display text-base font-bold text-content-primary text-start"
                    >
                        {item.kitchenName}
                    </RNText>
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('catalogue:meal.visitKitchen')}
                    </RNText>
                </View>
                <Icon name="chevronForward" size="sm" className="text-content-secondary" />
            </Pressable>
        </View>
    );
}

/* ── the full record ─────────────────────────────────────────────────────────────────────────── */

/** The full nutrition facts — the rings summarise them, they do not replace them. */
function MealFacts({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID="meal-detail-record"
            className="mt-14 flex-col gap-[18px] border-t border-stroke pt-6"
        >
            <MealNutrition
                testID="meal-detail-facts"
                facts={item.nutrition}
                heading={<SectionHeading>{t('catalogue:meal.factsTitle')}</SectionHeading>}
                /*
                 * Nothing at all rather than "One serving is ." — the mapper's `UNSTATED_SERVING`
                 * carries an empty label and a null mass precisely so a screen prints nothing instead of
                 * a phrase the kitchen never wrote; a listing sold by weight is the case that shows it.
                 */
                serving={
                    item.serving.label === '' && item.serving.grams === null ? null : (
                        <View testID="meal-detail-serving" className="flex-row flex-wrap gap-x-2">
                            {item.serving.label === '' ? null : (
                                <RNText className="text-sm text-content-secondary text-start">
                                    {t('catalogue:meal.servingLabel', {
                                        serving: item.serving.label,
                                    })}
                                </RNText>
                            )}
                            {item.serving.grams === null ? null : (
                                <RNText className="text-sm text-content-secondary text-start">
                                    {t('catalogue:meal.servingGrams', {
                                        // Whole grams: a derived serving arrives at three places and the
                                        // copy says "about" — the precision belongs to the arithmetic.
                                        grams: formatter.formatNumber(item.serving.grams, {
                                            maximumFractionDigits: 0,
                                        }),
                                    })}
                                </RNText>
                            )}
                        </View>
                    )
                }
            />
        </View>
    );
}
