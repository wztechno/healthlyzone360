import {
    Breadcrumbs,
    Button,
    Callout,
    EmptyState,
    Icon,
    IconButton,
    TextInputField,
} from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealQuery, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { PhotoCredit } from '../../../media/photo-credit.tsx';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { formatMoney, formatPackSize } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { leadTag, publishedFigure } from '../meal-readings.ts';
import { MenuGrid } from '../menu-grid.tsx';
import { RelatedMealCard } from '../menu-meal-card.tsx';
import { NutritionFactsPanel } from '../nutrition-facts-panel.tsx';

/**
 * `/meals/{meal}` — HealthZone's `§isMeal`, bound to what the meal record holds.
 *
 * ## The design's page, top to bottom
 *
 * A trail. Then the 1.1 : 1 split: on the left a 460px photograph over a row of three 110px
 * frames; on the right the tag and rating, the 42px name, the description, the four-cell nutrition
 * strip, `INGREDIENTS` with the warning-toned allergen bar under it, a rule, `MAKE IT YOURS` with
 * the special-instructions box, and the quantity stepper beside a full-width "Add to cart" carrying
 * the total — pinned to the foot of the scroll port while the column runs past it. Then, full
 * width, the four smaller cards.
 *
 * ## Where the record is thinner than the design
 *
 * * **Thumbnails.** A meal carries one photograph. The first frame is that photograph, the second
 *   is the app's empty image slot rather than an invented "ingredients" shot, and the third is the
 *   kitchen's own photograph — the design's "in kitchen" frame — which also opens the kitchen, the
 *   one place this page now links to it.
 * * **Ingredients.** The public meal record has no list; the slot says so in the design's place.
 * * **Make it yours.** The API has no modifiers, so the option list is the design's row stating
 *   that, not four invented add-ons with invented prices. The special-instructions box is drawn as
 *   designed; `AddCartItemRequest` carries no note, so a note typed into it is reported through the
 *   prototype notice when the meal is added, rather than silently dropped.
 * * **"Pairs well with".** Nothing curates pairings. The row is the same kitchen's other meals and
 *   its heading says exactly that.
 *
 * ## Below the design's sections
 *
 * Two things the design does not draw are obligations, not decoration, and follow the related row
 * in the design's own section language (a rule, a 24px heading): the full **nutrition facts** with
 * their basis, serving and provenance — the strip's four figures are a summary of them, not a
 * replacement — and the standing **medical disclaimer**. The macro rings, the availability chips,
 * the dietary tag list, the sales-channel badges and the preparation-time chip are gone: the strip
 * and the tag carry the first and third, and the rest were the record's bookkeeping rather than a
 * shopper's question. No business price was ever shown, and with the channel badges gone there is
 * not even the sentence about one.
 */
export interface MealDetailScreenProps {
    readonly mealId: string | undefined;
}

/** A ceiling on the stepper. The API refuses nothing above zero; this only stops a held button. */
const MAX_QUANTITY = 99;

/** The other meals from the kitchen, fetched one past what is shown so this meal can drop out. */
const RELATED_COUNT = 4;

export function MealDetailScreen({ mealId }: MealDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const runPrototype = usePrototypeAction();

    const parsed = mealId === undefined ? null : MealId.safeParse(mealId);
    const meal = useMealQuery(parsed);
    const item = meal.data;

    const [quantity, setQuantity] = useState(1);
    const [instructions, setInstructions] = useState('');

    /*
     * The grids' "add to basket", with the quantity threaded through — the mutation, the
     * confirmation, and the guest-entry dialog for somebody who is not signed in.
     */
    const basket = useBasketAdd({ labelKey: 'catalogue:nav.meals', testID: 'meal-detail' });

    const relatedFilter = useMemo(
        () => ({
            kitchenIds: (item === undefined ? [] : [item.kitchenId]) as readonly KitchenId[],
            itemTypes: ['meal'] as const,
            limit: RELATED_COUNT + 1,
        }),
        [item],
    );
    const related = useMealsQuery(relatedFilter, item !== undefined);
    const relatedMeals =
        item === undefined
            ? []
            : mealsFromPages(related.data?.pages)
                  .filter((candidate) => candidate.id !== item.id)
                  .slice(0, RELATED_COUNT);

    const browseAction = (
        <Button
            testID="meal-detail-browse"
            variant="secondary"
            label={t('catalogue:meal.browseAll')}
            onPress={() => {
                router.push('/meals');
            }}
        />
    );

    return (
        <View testID="meal-detail-screen" className="flex-col gap-4">
            <Breadcrumbs
                testID="meal-detail-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    {
                        key: 'meals',
                        label: t('catalogue:meals.title'),
                        onPress: () => {
                            router.push('/meals');
                        },
                    },
                    { key: 'meal', label: item?.name ?? t('catalogue:meal.loading') },
                ]}
            />

            {/* A link carrying something that is not an identifier at all leaves the query
                disabled, and a disabled query never settles — so the not-found answer is rendered
                directly rather than behind a skeleton that would spin for ever. */}
            {parsed === null ? (
                <EmptyState
                    testID="meal-detail-empty"
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
                    skeletonCount={2}
                    testID="meal-detail"
                >
                    {item === undefined ? null : (
                        <View className="flex-col">
                            {/* The design's `1.1fr 1fr` with a 36px gap from `lg` up; one column
                                below it, photographs first. */}
                            <View className="flex-col gap-8 lg:flex-row lg:items-start lg:gap-9">
                                <MealGallery item={item} />

                                <MealInfoColumn
                                    item={item}
                                    quantity={quantity}
                                    onQuantityChange={setQuantity}
                                    instructions={instructions}
                                    onInstructionsChange={setInstructions}
                                    pending={basket.pending}
                                    errored={basket.errored}
                                    onAdd={() => {
                                        basket.add(item, quantity);
                                        if (instructions.trim() !== '') {
                                            runPrototype({
                                                contract:
                                                    'POST /api/v1/carts/{cart}/items — instructions',
                                                message: t('catalogue:meal.instructionsNotSent'),
                                            });
                                        }
                                    }}
                                />
                            </View>

                            {relatedMeals.length === 0 ? null : (
                                <View
                                    testID="meal-detail-related"
                                    className="mt-12 flex-col gap-[18px] border-t border-stroke pt-6"
                                >
                                    <SectionHeading>
                                        {t('catalogue:meal.moreFromKitchen', {
                                            kitchen: item.kitchenName,
                                        })}
                                    </SectionHeading>
                                    <MenuGrid testID="meal-detail-related-grid">
                                        {relatedMeals.map((other) => (
                                            <RelatedMealCard
                                                key={other.id}
                                                meal={other}
                                                onOpen={() => {
                                                    router.push(
                                                        `/meals/${String(other.id)}` as never,
                                                    );
                                                }}
                                            />
                                        ))}
                                    </MenuGrid>
                                </View>
                            )}

                            <MealFacts item={item} />
                        </View>
                    )}
                </QueryStates>
            )}

            {/*
             * The guest entry point. A real dialog rather than a redirect: "continue as a guest"
             * puts the meal in the basket and opens `/guest-checkout`, "sign in instead" records the
             * page so somebody who signs in lands back on it.
             */}
            {basket.dialog}
        </View>
    );
}

/** The design's 24px section heading — "Pairs well with", and the facts below it. */
function SectionHeading({ children }: { readonly children: string }) {
    return (
        <RNText
            accessibilityRole="header"
            aria-level={2}
            className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
        >
            {children}
        </RNText>
    );
}

/* ── the photographs ─────────────────────────────────────────────────────────────────────────── */

/**
 * The 460px photograph over three 110px frames.
 *
 * Only real images: the meal's own photograph, the app's empty image slot, and the kitchen's
 * photograph. The first two frames are decorative — one repeats the picture above it, the other
 * holds nothing — so they are hidden from assistive technology; the third is the link to the kitchen
 * and is named as one.
 */
function MealGallery({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const router = useRouter();
    const kitchen = useKitchenQuery(item.kitchenId);

    return (
        <View
            testID="meal-detail-gallery"
            className="w-full flex-col gap-2.5 lg:w-auto lg:flex-[1.1]"
        >
            <View className="h-[300px] overflow-hidden rounded-xl lg:h-[460px]">
                <EntityImage
                    testID="meal-detail-image"
                    assetId={item.imagePlaceholderId}
                    variant="detail"
                    seed={item.slug}
                    label={t('catalogue:meal.imageLabel', { meal: item.name })}
                    aspect="wide"
                    flush
                    className="h-full"
                />
            </View>

            <View className="flex-row gap-2.5">
                <View
                    testID="meal-detail-thumb-meal"
                    className="h-[110px] min-w-0 flex-1 overflow-hidden rounded-lg"
                >
                    <EntityImage
                        assetId={item.imagePlaceholderId}
                        variant="card"
                        seed={item.slug}
                        label={t('catalogue:meal.imageLabel', { meal: item.name })}
                        aspect="wide"
                        flush
                        decorative
                        className="h-full"
                    />
                </View>
                <View
                    testID="meal-detail-thumb-empty"
                    className="h-[110px] min-w-0 flex-1 overflow-hidden rounded-lg"
                >
                    <EntityImage
                        seed={`${item.slug}-detail`}
                        label={t('catalogue:meal.thumbEmpty')}
                        aspect="wide"
                        flush
                        decorative
                        className="h-full"
                    />
                </View>
                <Pressable
                    testID="meal-detail-thumb-kitchen"
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('catalogue:meal.thumbKitchen', {
                        kitchen: item.kitchenName,
                    })}
                    onPress={() => {
                        router.push(`/kitchens/${String(item.kitchenId)}` as never);
                    }}
                    className="h-[110px] min-w-0 flex-1 overflow-hidden rounded-lg"
                >
                    <EntityImage
                        assetId={kitchen.data?.imagePlaceholderId}
                        variant="card"
                        seed={`kitchen-${String(item.kitchenId)}`}
                        label={t('catalogue:meal.thumbKitchen', { kitchen: item.kitchenName })}
                        aspect="wide"
                        flush
                        decorative
                        className="h-full"
                    />
                </Pressable>
            </View>

            {/* The credit a photograph's licence obliges, under the photograph it belongs to —
                nothing at all for one that obliges none. */}
            <PhotoCredit assetId={item.imagePlaceholderId} testID="meal-detail-photo-credit" />
        </View>
    );
}

/* ── the information column ──────────────────────────────────────────────────────────────────── */

interface MealInfoColumnProps {
    readonly item: MarketplaceMeal;
    readonly quantity: number;
    readonly onQuantityChange: (next: number) => void;
    readonly instructions: string;
    readonly onInstructionsChange: (next: string) => void;
    readonly pending: boolean;
    readonly errored: boolean;
    readonly onAdd: () => void;
}

function MealInfoColumn({
    item,
    quantity,
    onQuantityChange,
    instructions,
    onInstructionsChange,
    pending,
    errored,
    onAdd,
}: MealInfoColumnProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const tag = leadTag(item, t);
    const total = formatMoney(formatter, {
        amount: item.price.amount * quantity,
        currency: item.price.currency,
    });
    const allergens =
        item.allergens.length === 0
            ? t('catalogue:meal.allergensNoneShort')
            : t('catalogue:meal.allergensValue', {
                  list: item.allergens
                      .map((code) => t(`marketplace:allergens.${code}`))
                      .join(t('marketplace:common.listSeparator')),
              });

    return (
        <View className="min-w-0 flex-col lg:flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
                {tag === null ? null : (
                    <View className="rounded-full border border-success-border bg-success-subtle px-3 py-1">
                        <RNText
                            testID="meal-detail-lead-diet"
                            className="text-xs font-medium uppercase tracking-wide text-content-primary"
                        >
                            {tag}
                        </RNText>
                    </View>
                )}
                <RNText
                    testID="meal-detail-rating"
                    className="text-xs font-medium tracking-wide tabular-nums text-content-secondary"
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

            {/*
             * `text-4xl` (36px) for the design's 42 — the same step and tracking `ListingHeader`
             * gives the menu's title, so the catalogue and the record it opens set their names
             * alike.
             */}
            <RNText
                testID="meal-detail-name"
                accessibilityRole="header"
                aria-level={1}
                className="mb-3 mt-[14px] text-4xl leading-[1.05] tracking-display text-content-primary text-start"
            >
                {item.name}
            </RNText>
            <RNText className="mb-[22px] max-w-[480px] text-base leading-relaxed text-content-primary text-start">
                {item.description}
            </RNText>

            <NutritionStrip item={item} />

            <View testID="meal-detail-ingredients" className="mt-[26px] flex-col">
                <Eyebrow>{t('catalogue:meal.ingredientsLabel')}</Eyebrow>
                <RNText className="mt-2 text-base leading-relaxed text-content-secondary text-start">
                    {t('catalogue:meal.ingredientsBody')}
                </RNText>
                <View
                    testID="meal-detail-allergens"
                    className="mt-3 flex-row flex-wrap items-center gap-2 rounded border border-warning-border bg-warning-subtle px-3 py-2.5"
                >
                    <RNText className="text-xs font-semibold text-warning-on-subtle">
                        {t('catalogue:meal.allergensTitle')}
                    </RNText>
                    <RNText
                        testID="meal-detail-allergen-list"
                        className="min-w-0 flex-1 text-sm text-warning-on-subtle text-start"
                    >
                        {allergens}
                    </RNText>
                </View>
            </View>

            <View
                testID="meal-detail-options"
                className="mt-[26px] flex-col border-t border-stroke pt-[22px]"
            >
                <Eyebrow className="mb-3">{t('catalogue:meal.makeItYours')}</Eyebrow>
                <View className="min-h-touch flex-row items-center gap-3 rounded-lg border border-stroke bg-surface-raised px-4 py-3">
                    <RNText
                        testID="meal-detail-options-none"
                        className="min-w-0 flex-1 text-sm text-content-secondary text-start"
                    >
                        {t('catalogue:meal.optionsNone')}
                    </RNText>
                </View>
                <TextInputField
                    testID="meal-detail-instructions"
                    id="meal-detail-instructions"
                    label={t('catalogue:meal.instructionsLabel')}
                    labelHidden
                    placeholder={t('catalogue:meal.instructionsPlaceholder')}
                    multiline
                    numberOfLines={3}
                    value={instructions}
                    onChangeText={onInstructionsChange}
                    className="mt-2.5"
                />
            </View>

            {/*
             * The purchase bar, pinned to the foot of the scroll port while the column runs past it
             * — the design's `position: sticky; bottom: 16px`. `web:` because only the web can
             * honour it; native keeps it in the flow, where it already sits. The containing block is
             * this column, so the bar never rides over the sections below, and the page fill behind
             * it keeps the column's text from showing through.
             */}
            <View
                testID="meal-detail-actions"
                className="mt-6 flex-col gap-2 bg-surface-base py-2.5 web:sticky web:bottom-4"
            >
                <View className="flex-row items-center gap-3">
                    <QuantityStepper
                        testID="meal-detail-quantity"
                        value={quantity}
                        onChange={onQuantityChange}
                    />
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
                        className="min-h-touch flex-1 flex-row items-center justify-between gap-3 rounded bg-surface-brand px-5 py-4 hover:bg-surface-canopy"
                    >
                        <RNText className="text-base font-semibold text-content-on-brand">
                            {pending
                                ? t('catalogue:meal.addingToBasket')
                                : t('catalogue:meal.addToCart')}
                        </RNText>
                        <RNText
                            testID="meal-detail-price"
                            className="text-base font-semibold tabular-nums text-content-on-brand"
                        >
                            {total}
                        </RNText>
                    </Pressable>
                </View>

                {/* What one unit buys, when it is sold by weight: the total above is per pack. */}
                {item.pack === null ? null : (
                    <RNText
                        testID="meal-detail-pack"
                        className="text-sm tabular-nums text-content-secondary text-start"
                    >
                        {t('catalogue:meal.pricePerPack', {
                            price: formatMoney(formatter, item.price),
                            size: formatPackSize(t, formatter, item.pack),
                        })}
                    </RNText>
                )}

                {errored ? (
                    <Callout
                        testID="meal-detail-action-error"
                        role="alert"
                        tone="danger"
                        title={t('catalogue:meal.actionErrorTitle')}
                        body={t('catalogue:meal.actionErrorBody')}
                    />
                ) : null}
            </View>
        </View>
    );
}

/**
 * The design's four-cell strip: calories and the three macronutrients, figure over name.
 *
 * Every cell is drawn, and a nutrient the kitchen did not publish reads "—" rather than the zero
 * `nutrientValue` would say — "0 g fat" is a claim about the food, not an absence of one. A listing
 * sold by weight states its basis under the strip, because per-100 g figures describe no portion
 * anybody is sold.
 */
function NutritionStrip({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const dash = t('catalogue:card.noFigure');

    const cells = (['energy', 'protein', 'carbohydrate', 'fat'] as const).map((nutrientId) => {
        const figure = publishedFigure(item, nutrientId);
        const value = figure === null ? dash : formatter.formatNumber(figure);
        return {
            key: nutrientId,
            value:
                figure === null || nutrientId === 'energy'
                    ? value
                    : t('catalogue:meal.macroValue', { grams: value }),
            label: t(`catalogue:meal.strip.${nutrientId}`),
        };
    });

    return (
        <View testID="meal-detail-strip" className="flex-col gap-1.5">
            <View className="flex-row overflow-hidden rounded-lg border border-stroke bg-surface-raised">
                {cells.map((cell, index) => (
                    <View
                        key={cell.key}
                        testID={`meal-detail-strip-${cell.key}`}
                        className={
                            index === cells.length - 1
                                ? 'min-w-0 flex-1 flex-col gap-0.5 p-[14px]'
                                : 'min-w-0 flex-1 flex-col gap-0.5 border-e border-stroke-subtle p-[14px]'
                        }
                    >
                        <RNText
                            numberOfLines={1}
                            className="font-display text-xl font-bold tabular-nums tracking-display text-content-primary text-start"
                        >
                            {cell.value}
                        </RNText>
                        <Eyebrow>{cell.label}</Eyebrow>
                    </View>
                ))}
            </View>
            {item.nutrition.basis === 'per_100g' ? (
                <RNText
                    testID="meal-detail-strip-basis"
                    className="text-xs text-content-secondary text-start"
                >
                    {t('catalogue:meal.stripPer100g')}
                </RNText>
            ) : null}
        </View>
    );
}

interface QuantityStepperProps {
    readonly value: number;
    readonly onChange: (next: number) => void;
    readonly testID: string;
}

/**
 * The design's compact − 1 + beside Add.
 *
 * Not `NumberStepper`: that is a form field, with a visible label and a text input between its
 * buttons, and here the figure only ever moves one at a time beside a button that already says what
 * it is for. The group carries the name a screen reader needs, the figure announces its changes, and
 * both buttons keep the 44px touch floor this customer surface requires.
 */
function QuantityStepper({ value, onChange, testID }: QuantityStepperProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            role="group"
            aria-label={t('catalogue:meal.quantityLabel')}
            accessibilityLabel={t('catalogue:meal.quantityLabel')}
            className="flex-row items-center rounded border border-stroke-strong bg-surface-raised"
        >
            <IconButton
                testID={`${testID}-decrement`}
                label={t('catalogue:meal.quantityDecrease')}
                icon={<Icon name="minus" />}
                disabled={value <= 1}
                onPress={() => {
                    onChange(Math.max(1, value - 1));
                }}
            />
            <RNText
                testID={`${testID}-value`}
                aria-live="polite"
                accessibilityLiveRegion="polite"
                className="min-w-[26px] text-center text-base font-semibold tabular-nums text-content-primary"
            >
                {formatter.formatNumber(value)}
            </RNText>
            <IconButton
                testID={`${testID}-increment`}
                label={t('catalogue:meal.quantityIncrease')}
                icon={<Icon name="plus" />}
                disabled={value >= MAX_QUANTITY}
                onPress={() => {
                    onChange(Math.min(MAX_QUANTITY, value + 1));
                }}
            />
        </View>
    );
}

/* ── below the design's sections ─────────────────────────────────────────────────────────────── */

/**
 * The full nutrition facts and the medical disclaimer — the two obligations the design does not
 * draw — in its section language: a rule, a 24px heading, then the record.
 */
function MealFacts({ item }: { readonly item: MarketplaceMeal }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID="meal-detail-record"
            className="mt-12 flex-col gap-[18px] border-t border-stroke pt-6"
        >
            <SectionHeading>{t('catalogue:meal.factsTitle')}</SectionHeading>

            {/*
             * Nothing at all rather than "One serving is ." — the mapper's `UNSTATED_SERVING`
             * carries an empty label and a null mass precisely so a screen prints nothing instead of
             * a phrase the kitchen never wrote; a listing sold by weight is the case that shows it.
             */}
            {item.serving.label === '' && item.serving.grams === null ? null : (
                <View testID="meal-detail-serving" className="flex-row flex-wrap gap-x-2">
                    {item.serving.label === '' ? null : (
                        <RNText className="text-sm text-content-secondary text-start">
                            {t('catalogue:meal.servingLabel', { serving: item.serving.label })}
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
            )}

            <NutritionFactsPanel
                testID="meal-detail-facts"
                facts={item.nutrition}
                title={t('catalogue:meal.factsPanelTitle')}
            />

            <MedicalDisclaimer />
        </View>
    );
}
