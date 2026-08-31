import {
    Badge,
    Breadcrumbs,
    Button,
    Card,
    Stack,
    TagRow,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { KitchenId, MEAL_TYPES } from '@healthy360/domain-types';
import type { MealType, Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    mealsFromPages,
    useAddCartItemMutation,
    useMealsQuery,
} from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { formatMoney } from '../format.ts';
import { QueryStates } from '../query-states.tsx';
import { SectionHeader } from '../section-header.tsx';
import {
    activeBranches,
    deliveryTerms,
    fastestDeliveryMinutes,
    hoursToday,
    pickupBranches,
} from '../storefront-facts.ts';
import { StorefrontMenuRow } from '../storefront-menu-row.tsx';

/**
 * One kitchen's storefront — HealthZone `§isStorefront` (`HealthZone.dc.html` lines 809–869).
 *
 * ## What this replaced, and what was given up with it
 *
 * The previous screen was a *record*: the kitchen's photograph, its channels and cuisines, a card
 * pointing at the menu, then an accordion of branches carrying opening hours and delivery zones in
 * full. Its argument — doc 17 (SUB-02) — was that a marketplace which only reveals at checkout that
 * it cannot reach you has wasted your time, so the zones belonged on the page.
 *
 * HealthZone answers the same question in a different place. The order panel states the delivery
 * minimum, the fee and the fastest advertised estimate before anything is added to a basket, and
 * the pill states today's hours. What is genuinely gone is the *per-zone* breakdown — which named
 * area costs what — and the week's full schedule. Both are a tap away in the checkout preview,
 * which is where a real address turns them from a table into an answer.
 *
 * ## Two figures in the design have no source and are not shown
 *
 * The design's panel carries a "next slot" time and a "free over $45" clause. Nothing answers slot
 * availability ahead of checkout, and `DeliveryZone` publishes no free-delivery threshold. Both are
 * dropped rather than filled — see `storefront-facts.ts` for the full note.
 *
 * ## The menu is on the storefront now, not only behind a link
 *
 * The design lists the kitchen's dishes in sections under the hero, so the page answers "what do
 * they cook" without a navigation. `/kitchens/{id}/menu` still exists and still owns the filtered,
 * paged, searchable view — "Start an order" goes there — but the storefront no longer opens with a
 * card whose only content is a button pointing at it.
 */
export interface KitchenProfileScreenProps {
    /** Raw route parameter. `undefined` on the first frame of a deep link. */
    readonly kitchenId: string | undefined;
}

export function KitchenProfileScreen({ kitchenId }: KitchenProfileScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const parsed = kitchenId === undefined ? null : KitchenId.safeParse(kitchenId);
    const query = useKitchenQuery(parsed);
    const kitchen = query.data;

    return (
        <Stack space="xl" testID="kitchen-profile-screen">
            <Breadcrumbs
                testID="kitchen-breadcrumbs"
                items={[
                    {
                        key: 'kitchens',
                        label: t('marketplace:nav.kitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    },
                    { key: 'kitchen', label: kitchen?.name ?? t('marketplace:kitchen.loading') },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={query.data === undefined && !query.isPending}
                emptyTitle={t('marketplace:kitchen.notFoundTitle')}
                emptyBody={t('marketplace:kitchen.notFoundBody')}
                skeletonCount={2}
                testID="kitchen"
            >
                {kitchen === undefined ? null : <Storefront kitchen={kitchen} />}
            </QueryStates>
        </Stack>
    );
}

/** Which way an order leaves the kitchen. Drives the figures the order panel states. */
type StorefrontMode = 'delivery' | 'pickup';

function Storefront({ kitchen }: { readonly kitchen: Kitchen }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter: Formatter = useFormatter();
    const { me } = useSession();
    const toast = useToast();
    const signedIn = me !== null;

    const branches = activeBranches(kitchen);
    const pickup = pickupBranches(kitchen);
    const terms = deliveryTerms(kitchen);
    const minutes = fastestDeliveryMinutes(kitchen);
    const today = hoursToday(kitchen);

    const modes: readonly StorefrontMode[] = [
        ...(kitchen.channels.delivery ? (['delivery'] as const) : []),
        ...(pickup.length > 0 ? (['pickup'] as const) : []),
    ];
    const [mode, setMode] = useState<StorefrontMode>(() => modes[0] ?? 'delivery');

    /*
     * The whole menu, unfiltered and unpaged — the storefront lists what this kitchen cooks, and
     * `/kitchens/{id}/menu` owns the filtered view. Only the first page is read: a storefront is a
     * shop window, and an infinite scroll of every product sheet is what the menu screen is for.
     */
    const menu = useMealsQuery({ kitchenIds: [kitchen.id] });
    const meals = mealsFromPages(menu.data?.pages);
    const addToBasket = useAddCartItemMutation();

    const sections = useMemo(() => groupIntoSections(meals), [meals]);

    /*
     * Add is offered to signed-in people only, and for the reason `discover-screen.tsx` gives: an
     * anonymous visitor has to pass the guest-entry dialog that `meal-detail-screen.tsx` owns
     * before anything reaches a basket, and a visible Add that opened a dialog it could not finish
     * would be worse than not offering it. Everyone else still reaches the dish one tap away.
     */
    const addMeal = (meal: MarketplaceMeal) => {
        addToBasket.mutate(
            { mealId: meal.id, quantity: 1 },
            {
                onSuccess: (cart) => {
                    toast.show({
                        testID: 'basket-added',
                        tone: 'success',
                        message: t('catalogue:meal.addedToBasket', { items: cart.itemCount }),
                    });
                },
            },
        );
    };

    const fact = (key: string, label: string, value: string) => (
        <View key={key} testID={`kitchen-fact-${key}`}>
            <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                {label}
            </RNText>
            <RNText className="mt-1 font-display text-lg leading-tight text-content-primary text-start">
                {value}
            </RNText>
        </View>
    );

    const facts = [
        kitchen.rating === null
            ? null
            : fact(
                  'rating',
                  t('marketplace:storefront.factRating'),
                  formatter.formatNumber(kitchen.rating),
              ),
        minutes === null
            ? null
            : fact(
                  'delivery',
                  t('marketplace:storefront.factDelivery'),
                  t('marketplace:storefront.factDeliveryValue', {
                      minutes: formatter.formatNumber(minutes),
                  }),
              ),
        kitchen.cuisines.length === 0
            ? null
            : fact(
                  'cuisine',
                  t('marketplace:storefront.factCuisine'),
                  kitchen.cuisines.join(t('marketplace:common.listSeparator')),
              ),
        branches.length === 0
            ? null
            : fact(
                  'branches',
                  t('marketplace:storefront.factBranches'),
                  formatter.formatNumber(branches.length),
              ),
    ].filter((node) => node !== null);

    /** One label/value line in the order panel. */
    const term = (key: string, label: string, value: string) => (
        <View
            key={key}
            testID={`kitchen-order-${key}`}
            className="flex-row items-baseline justify-between gap-3"
        >
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <RNText className="shrink text-sm font-semibold text-content-primary text-end">
                {value}
            </RNText>
        </View>
    );

    const amount = (value: Money) =>
        terms.varies
            ? t('marketplace:storefront.fromAmount', {
                  amount: formatMoney(formatter, value),
              })
            : formatMoney(formatter, value);

    const orderTerms =
        mode === 'pickup'
            ? [
                  pickup.length === 0
                      ? null
                      : term(
                            'collect',
                            t('marketplace:storefront.collectFrom'),
                            pickup
                                .map((branch) => branch.area)
                                .join(t('marketplace:common.listSeparator')),
                        ),
              ]
            : [
                  minutes === null
                      ? null
                      : term(
                            'eta',
                            t('marketplace:storefront.factDelivery'),
                            t('marketplace:storefront.factDeliveryValue', {
                                minutes: formatter.formatNumber(minutes),
                            }),
                        ),
                  terms.minimumOrder === null
                      ? null
                      : term(
                            'minimum',
                            t('marketplace:storefront.minimum'),
                            amount(terms.minimumOrder),
                        ),
                  terms.deliveryFee === null
                      ? null
                      : term('fee', t('marketplace:storefront.fee'), amount(terms.deliveryFee)),
              ];

    return (
        <Stack space="lg">
            {/*
             * The cover. A fixed band rather than an aspect box: the design pins it at 280 so the
             * fold lands in the same place whatever shape the photograph is, and `EntityImage`'s
             * own ratio would otherwise make a wide picture two hundred units taller than a square
             * one on the same page.
             */}
            <View className="h-[280px] overflow-hidden rounded-xl">
                <EntityImage
                    testID="kitchen-image"
                    assetId={kitchen.imagePlaceholderId}
                    variant="detail"
                    seed={kitchen.slug}
                    label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                    aspect="wide"
                    flush
                    className="h-full"
                />
            </View>

            {/*
             * The claim and the order panel: one row from `lg` up, stacked below it. The panel is
             * fixed at the design's 320 rather than sharing the row proportionally — it holds a
             * column of label/value pairs, and a panel that grows with the viewport puts the label
             * and its figure at opposite ends of a very wide line.
             */}
            <View className="flex-col gap-6 lg:flex-row lg:items-start">
                <View className="min-w-0 flex-1 flex-col gap-4">
                    <View className="flex-row flex-wrap items-center gap-3">
                        <RNText
                            accessibilityRole="header"
                            aria-level={1}
                            testID="kitchen-name"
                            className="font-display text-3xl leading-tight tracking-display text-content-primary text-start"
                        >
                            {kitchen.name}
                        </RNText>
                        {/*
                         * Today's published window, not "open now" — the live claim needs the
                         * kitchen's time zone resolved through `Intl`, which Hermes does not carry
                         * reliably on Android. `storefront-facts.ts` has the full note.
                         */}
                        <Badge
                            testID="kitchen-hours-today"
                            tone={today === null ? 'neutral' : 'success'}
                            label={
                                today === null
                                    ? t('marketplace:storefront.closedToday')
                                    : t('marketplace:storefront.openToday', {
                                          opensAt: today.opensAt,
                                          closesAt: today.closesAt,
                                      })
                            }
                        />
                        {kitchen.isVerified ? (
                            <Badge
                                testID="kitchen-verified"
                                tone="info"
                                label={t('marketplace:kitchens.verified')}
                            />
                        ) : null}
                    </View>

                    <Text tone="secondary" testID="kitchen-description" className="max-w-[62ch]">
                        {kitchen.description}
                    </Text>

                    {/*
                     * Every diet the kitchen cooks for, in full and uncapped.
                     *
                     * The directory card shows three of them and collapses the rest into a `+8`,
                     * which is the right trade in a grid cell but leaves the reader with a count
                     * and no way to resolve it — the card is one press target, so the pill cannot
                     * be its own control without becoming a `nested-interactive` failure. This is
                     * where that press lands, so this is where the eight have to be. Uncapped
                     * deliberately: a storefront has the width, and a second `+N` here would be
                     * the same dead end one page further on.
                     */}
                    {kitchen.dietClassifications.length === 0 ? null : (
                        <View className="flex-col gap-2" testID="kitchen-diets">
                            <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                                {t('marketplace:storefront.dietsEyebrow')}
                            </RNText>
                            <TagRow
                                testID="kitchen-diets-tags"
                                items={kitchen.dietClassifications.map((diet) => ({
                                    key: diet,
                                    label: t(`marketplace:diets.${diet}`),
                                }))}
                            />
                        </View>
                    )}

                    {facts.length === 0 ? null : (
                        <View className="flex-row flex-wrap gap-x-8 gap-y-4" testID="kitchen-facts">
                            {facts}
                        </View>
                    )}
                </View>

                <Card
                    testID="kitchen-order-panel"
                    padding="md"
                    tone="raised"
                    className="w-full lg:w-[320px] lg:shrink-0"
                >
                    <Stack space="sm">
                        <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                            {t('marketplace:storefront.orderEyebrow')}
                        </RNText>

                        {/*
                         * The mode switch appears only when there is a choice. A kitchen that
                         * delivers and does not collect has one option, and a segmented control
                         * with a single segment is a label wearing a control's chrome.
                         */}
                        {modes.length > 1 ? (
                            <View className="flex-row gap-2" testID="kitchen-order-modes">
                                {modes.map((option) => (
                                    <Button
                                        key={option}
                                        testID={`kitchen-order-mode-${option}`}
                                        size="sm"
                                        variant={option === mode ? 'primary' : 'secondary'}
                                        label={t(`marketplace:channels.${option}`)}
                                        onPress={() => {
                                            setMode(option);
                                        }}
                                    />
                                ))}
                            </View>
                        ) : null}

                        {orderTerms.filter((node) => node !== null)}

                        <Button
                            testID="kitchen-view-menu"
                            block
                            label={t('marketplace:storefront.startOrder')}
                            onPress={() => {
                                router.push(`/kitchens/${String(kitchen.id)}/menu` as never);
                            }}
                        />
                        {kitchen.channels.subscription ? (
                            <Button
                                testID="kitchen-see-plans"
                                block
                                variant="secondary"
                                label={t('marketplace:storefront.seePlans')}
                                onPress={() => {
                                    router.push('/plans');
                                }}
                            />
                        ) : null}
                    </Stack>
                </Card>
            </View>

            <QueryStates
                query={menu}
                isEmpty={meals.length === 0}
                emptyTitle={t('marketplace:storefront.emptyTitle')}
                emptyBody={t('marketplace:storefront.emptyBody')}
                testID="kitchen-menu"
            >
                <Stack space="lg" testID="kitchen-sections">
                    {sections.map((section) => (
                        <Stack
                            key={section.key}
                            space="sm"
                            testID={`kitchen-section-${section.key}`}
                        >
                            <SectionHeader
                                title={
                                    section.key === 'product'
                                        ? t('marketplace:storefront.productsTitle')
                                        : t(`marketplace:mealTypes.${section.key}`)
                                }
                                meta={t('marketplace:storefront.sectionNote', {
                                    count: section.meals.length,
                                })}
                                testID={`kitchen-section-${section.key}-header`}
                            />
                            {/*
                             * Two across, one below. `basis-[45%]` rather than a fixed column
                             * count: two cells plus the gap fit a row and three cannot, so the grid
                             * folds to one column on a narrow viewport without a breakpoint.
                             */}
                            <View className="flex-row flex-wrap gap-3">
                                {section.meals.map((meal) => (
                                    <View
                                        key={meal.id}
                                        className="min-w-[280px] flex-1 grow basis-[45%]"
                                    >
                                        <StorefrontMenuRow
                                            meal={meal}
                                            onPress={() => {
                                                router.push(`/meals/${String(meal.id)}` as never);
                                            }}
                                            onAdd={
                                                signedIn
                                                    ? () => {
                                                          addMeal(meal);
                                                      }
                                                    : undefined
                                            }
                                        />
                                    </View>
                                ))}
                            </View>
                        </Stack>
                    ))}
                </Stack>
            </QueryStates>
        </Stack>
    );
}

interface MenuSection {
    /** A `MealType`, or `product` for the sellable-goods section. */
    readonly key: MealType | 'product';
    readonly meals: readonly MarketplaceMeal[];
}

/**
 * The kitchen's catalogue as the design's named sections.
 *
 * A meal joins the section of the **first** meal type it declares rather than every one of them: a
 * dish listed as both lunch and dinner appearing twice on one page reads as two dishes, and the
 * storefront is a menu rather than a filtered result. Products carry no meal type at all and get a
 * section of their own at the end, which is also where a meal declaring none lands.
 *
 * Sections keep `MEAL_TYPES` order — breakfast before dinner — rather than the order the endpoint
 * happened to answer in, and an empty one is omitted.
 */
function groupIntoSections(meals: readonly MarketplaceMeal[]): readonly MenuSection[] {
    const buckets = new Map<MealType | 'product', MarketplaceMeal[]>();

    for (const meal of meals) {
        const key: MealType | 'product' =
            meal.itemType === 'product' ? 'product' : (meal.mealTypes[0] ?? 'product');
        const bucket = buckets.get(key);
        if (bucket === undefined) {
            buckets.set(key, [meal]);
        } else {
            bucket.push(meal);
        }
    }

    const order: readonly (MealType | 'product')[] = [...MEAL_TYPES, 'product'];
    return order
        .map((key) => ({ key, meals: buckets.get(key) ?? [] }))
        .filter((section) => section.meals.length > 0);
}
