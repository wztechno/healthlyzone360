import { Badge, Button, Icon, Rating, cx } from '@healthy360/design-system';
import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { DietClassification } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery } from '../../data/catalogue-hooks.ts';
import { EntityImage } from '../../media/entity-image.tsx';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import { formatMoney, publishedEnergyAndProtein } from './format.ts';
import {
    dishPreviewFilter,
    kitchenInitials,
    matchedDiets,
    publishesHours,
} from './kitchen-finder.ts';
import { deliveryTerms, fastestDeliveryMinutes, hoursToday } from './storefront-facts.ts';
import { PackSuffix } from './pack-suffix.tsx';

/**
 * One kitchen in the `/kitchens` finder — HealthZone's finder card, element for element: the
 * photograph band with today's status and a match pill, the monogram overlapping its foot with the
 * rating on its baseline, name and VERIFIED, the cuisine line, the green "why" band, three
 * signature dishes, the DELIVERY / FEE / MIN row, and "View menu" beside "Plans".
 *
 * ## Why this is not `KitchenCard`
 *
 * `KitchenCard` is the compact browse card the public landing page also lists, and it is one
 * pressable from edge to edge. This card holds controls of its own — a row per dish with an Add,
 * and two buttons at its foot — so it cannot be one pressable (an axe `nested-interactive`
 * failure), and changing the shared card for one screen would redraw the landing page too.
 *
 * ## Where the design's data has no source, what stands in its place
 *
 * - **"94% MATCH".** A profile score nothing computes. The pill keeps its place for a signed-in
 *   shopper who declared diets and states the real overlap instead — "DIET MATCH 2/3" — and is
 *   absent for anyone else; see `kitchen-finder.ts`.
 * - **The "why" band.** Prose generated against the profile in the design. Here it is built from
 *   the same overlap — "Cooks high protein · vegan — 2 of your diets." — or, without a profile,
 *   from the diets the kitchen cooks for, or its own tagline. Absent when it has none of those.
 * - **Distance.** Nothing knows where the reader is. The line ends on the area the kitchen trades
 *   from instead.
 * - **"OPEN · UNTIL 21:30".** "Open" is a claim about this instant in the kitchen's time zone, which
 *   `storefront-facts.ts` explains cannot be made reliably on native. The pill states today's
 *   published window instead, and is absent for a kitchen that publishes no hours at all.
 * - **A figure the kitchen does not publish** reads "—" in its column, so every card's row of
 *   terms lines up with its neighbours'.
 */
export interface KitchenFinderCardProps {
    readonly kitchen: Kitchen;
    /** Adds one dish to the basket. Owned by the screen so the guest-entry dialog renders once. */
    readonly onAdd: (meal: MarketplaceMeal) => void;
    /** The signed-in shopper's declared diets; empty for a visitor or someone who declared none. */
    readonly profileDiets?: readonly DietClassification[] | undefined;
    readonly testID?: string | undefined;
}

/** Today's published window, `null` when closed today, `undefined` when no hours are published. */
export function todayWindow(kitchen: Kitchen) {
    return publishesHours(kitchen) ? hoursToday(kitchen) : undefined;
}

/** The status pill's text — "OPEN TODAY · 09:00–22:00" / "CLOSED TODAY". */
export function todayLabel(window: ReturnType<typeof hoursToday>, t: TFunction): string {
    return window === null
        ? t('marketplace:kitchens.finder.closedToday')
        : t('marketplace:kitchens.finder.openToday', {
              opensAt: window.opensAt,
              closesAt: window.closesAt,
          });
}

export interface KitchenTerm {
    readonly key: 'delivery' | 'fee' | 'minimum';
    /** `null` when the kitchen publishes no such figure — drawn as "—", never as a guess. */
    readonly value: string | null;
}

/**
 * Delivery time, fee and minimum order — always all three, in the design's order.
 *
 * The lowest figure across the kitchen's zones, prefixed "From" when zones differ, as the storefront
 * states it. The design's "Free over $40" clause has no source (`DeliveryZone` publishes no
 * threshold) and is not reproduced.
 */
export function kitchenTerms(kitchen: Kitchen, formatter: Formatter, t: TFunction): KitchenTerm[] {
    const terms = deliveryTerms(kitchen);
    const minutes = fastestDeliveryMinutes(kitchen);
    const money = (value: NonNullable<typeof terms.deliveryFee>) => {
        const amount = formatMoney(formatter, value);
        return terms.varies ? t('marketplace:kitchens.finder.from', { amount }) : amount;
    };

    return [
        {
            key: 'delivery',
            value:
                minutes === null
                    ? null
                    : t('marketplace:kitchens.finder.minutes', {
                          minutes: formatter.formatNumber(minutes),
                      }),
        },
        {
            key: 'fee',
            value:
                terms.deliveryFee === null
                    ? null
                    : terms.deliveryFee.amount === 0 && !terms.varies
                      ? t('marketplace:kitchens.finder.free')
                      : money(terms.deliveryFee),
        },
        {
            key: 'minimum',
            value: terms.minimumOrder === null ? null : money(terms.minimumOrder),
        },
    ];
}

/** The line under the name: cuisines (else the tagline), then the area it trades from. */
export function kitchenSummary(kitchen: Kitchen, t: TFunction): string {
    const separator = t('marketplace:kitchens.areaSeparator');
    const what =
        kitchen.cuisines.length > 0 ? kitchen.cuisines.join(separator) : kitchen.tagline.trim();
    const area = kitchen.branches.find((branch) => branch.isActive && branch.area !== '')?.area;
    return [what, area ?? ''].filter((part) => part !== '').join(separator);
}

/** Diet labels as a run of prose — "high protein · vegan". */
function dietRun(diets: readonly DietClassification[], t: TFunction): string {
    return diets
        .map((diet) => t(`marketplace:diets.${diet}`).toLocaleLowerCase())
        .join(t('marketplace:kitchens.areaSeparator'));
}

/**
 * The green band's sentence, or `null` when there is nothing true to put in it.
 *
 * Against the profile when the kitchen cooks for any declared diet; otherwise the kitchen's own
 * diets; otherwise its tagline.
 */
export function kitchenWhy(
    kitchen: Kitchen,
    profileDiets: readonly DietClassification[],
    t: TFunction,
): string | null {
    const matched = matchedDiets(kitchen, profileDiets);
    if (matched.length > 0) {
        return t('marketplace:kitchens.finder.whyMatch', { diets: dietRun(matched, t) });
    }
    if (kitchen.dietClassifications.length > 0) {
        return t('marketplace:kitchens.finder.whyDiets', {
            diets: dietRun(kitchen.dietClassifications, t),
        });
    }
    const tagline = kitchen.tagline.trim();
    return tagline === '' ? null : tagline;
}

export function KitchenFinderCard({
    kitchen,
    onAdd,
    profileDiets = [],
    testID,
}: KitchenFinderCardProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const id = testID ?? `kitchen-card-${kitchen.slug}`;
    const kitchenId = String(kitchen.id);

    const openProfile = () => {
        router.push(`/kitchens/${kitchenId}` as never);
    };

    const summary = kitchenSummary(kitchen, t);
    const why = kitchenWhy(kitchen, profileDiets, t);
    const terms = kitchenTerms(kitchen, formatter, t);
    const today = todayWindow(kitchen);
    const closedToday = today === null;

    return (
        <View
            testID={id}
            className="flex-1 overflow-hidden rounded-xl border border-stroke bg-surface-raised hover:border-stroke-strong"
        >
            {/*
             * The photograph opens the profile for a pointer, as the design's does, but is not a
             * second stop for the keyboard or a screen reader: the kitchen's name below is the
             * link, and two links to one place in one card is one too many to tab through.
             */}
            <View className="relative h-[160px]">
                <Pressable
                    testID={`${id}-media`}
                    onPress={openProfile}
                    focusable={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    className="h-full"
                >
                    <EntityImage
                        testID={`${id}-image`}
                        assetId={kitchen.imagePlaceholderId}
                        variant="card"
                        seed={kitchen.slug}
                        label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                        decorative
                        flush
                        className="h-full"
                    />
                </Pressable>
                {/*
                 * The pills sit over the photograph but outside the hidden pressable: they are
                 * information a screen reader needs, not decoration.
                 */}
                {today === undefined ? null : (
                    <View
                        pointerEvents="none"
                        className={cx(
                            'absolute start-2.5 top-2.5 rounded-full px-2.5 py-1',
                            closedToday ? 'bg-surface-sunken' : 'bg-surface-raised',
                        )}
                    >
                        <RNText
                            testID={`${id}-today`}
                            numberOfLines={1}
                            className={cx(
                                'text-xs font-semibold uppercase tracking-wider tabular-nums',
                                closedToday ? 'text-content-secondary' : 'text-success-on-subtle',
                            )}
                        >
                            {todayLabel(today, t)}
                        </RNText>
                    </View>
                )}
                {/*
                 * The design's match pill, true to a one-diet profile: it says the kitchen cooks the
                 * shopper's diet, and is absent when it does not — a "0/1" tells nobody anything.
                 */}
                {matchedDiets(kitchen, profileDiets).length === 0 ? null : (
                    <View
                        pointerEvents="none"
                        className="absolute end-2.5 top-2.5 rounded-full bg-surface-brand-subtle px-2.5 py-1"
                    >
                        <RNText
                            testID={`${id}-match`}
                            numberOfLines={1}
                            className="text-xs font-semibold uppercase tracking-wider text-content-on-brand-subtle"
                        >
                            {t('marketplace:kitchens.finder.dietMatch')}
                        </RNText>
                    </View>
                )}
            </View>

            <View className="flex-1 flex-col gap-2.5 px-4 pb-4">
                {/* The mark overlaps the photograph's foot; the rating sits on its baseline. */}
                <View className="-mt-6 flex-row items-end gap-3">
                    <View
                        aria-hidden
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className={cx(
                            'h-[52px] w-[52px] items-center justify-center rounded-panel rounded-es-sm border-[3px] border-surface-raised',
                            closedToday ? 'bg-surface-sunken' : 'bg-surface-canopy',
                        )}
                    >
                        <RNText
                            className={cx(
                                'font-display text-lg font-bold tracking-display',
                                closedToday ? 'text-content-secondary' : 'text-content-on-canopy',
                            )}
                        >
                            {kitchenInitials(kitchen.name)}
                        </RNText>
                    </View>
                    <View className="min-w-0 flex-1 flex-row justify-end pb-0.5">
                        {kitchen.rating === null ? (
                            <RNText
                                testID={`${id}-unrated`}
                                className="text-sm text-content-secondary text-end"
                            >
                                {t('marketplace:kitchens.notRatedYet')}
                            </RNText>
                        ) : (
                            <Rating
                                testID={`${id}-rating`}
                                label={t('marketplace:kitchens.ratingLabel', {
                                    kitchen: kitchen.name,
                                })}
                                value={kitchen.rating}
                                count={kitchen.ratingCount}
                                size="sm"
                                compact
                            />
                        )}
                    </View>
                </View>

                <Pressable
                    testID={`${id}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('marketplace:kitchens.cardLabel', {
                        kitchen: kitchen.name,
                    })}
                    onPress={openProfile}
                    className="min-h-touch flex-col justify-center"
                >
                    <View className="flex-row flex-wrap items-center gap-2">
                        <RNText
                            accessibilityRole="header"
                            aria-level={3}
                            className="shrink font-display text-lg font-bold tracking-display text-content-primary text-start"
                        >
                            {kitchen.name}
                        </RNText>
                        {kitchen.isVerified ? (
                            <Badge
                                testID={`${id}-verified`}
                                tone="info"
                                label={t('marketplace:kitchens.verified')}
                            />
                        ) : null}
                    </View>
                    {summary === '' ? null : (
                        <RNText
                            testID={`${id}-summary`}
                            numberOfLines={1}
                            className="mt-0.5 text-sm text-content-secondary text-start"
                        >
                            {summary}
                        </RNText>
                    )}
                </Pressable>

                {why === null ? null : (
                    <View className="rounded bg-surface-brand-subtle px-3 py-2">
                        <RNText
                            testID={`${id}-why`}
                            className="text-xs leading-5 text-content-on-brand-subtle text-start"
                        >
                            {why}
                        </RNText>
                    </View>
                )}

                <DishPreview kitchen={kitchen} onAdd={onAdd} testID={`${id}-dishes`} />

                {/* `mt-auto` pins the terms and the actions to the foot, so a row ends on one line. */}
                <View
                    testID={`${id}-terms`}
                    className="mt-auto flex-row gap-2 border-t border-stroke-subtle pt-3"
                >
                    {terms.map((term) => (
                        <View key={term.key} className="min-w-0 flex-1 flex-col gap-0.5">
                            <Eyebrow>{t(`marketplace:kitchens.finder.term.${term.key}`)}</Eyebrow>
                            <RNText
                                testID={`${id}-term-${term.key}`}
                                numberOfLines={1}
                                className="text-sm font-semibold tabular-nums text-content-primary text-start"
                            >
                                {term.value ?? t('marketplace:kitchens.finder.noFigure')}
                            </RNText>
                        </View>
                    ))}
                </View>

                <View className="flex-row gap-2">
                    <Button
                        testID={`${id}-menu`}
                        size="sm"
                        label={t('marketplace:kitchens.finder.viewMenu')}
                        onPress={() => {
                            router.push(`/kitchens/${kitchenId}/menu` as never);
                        }}
                        className="flex-1"
                    />
                    {kitchen.channels.subscription ? (
                        <Button
                            testID={`${id}-plans`}
                            size="sm"
                            variant="secondary"
                            label={t('marketplace:kitchens.finder.plans')}
                            onPress={() => {
                                router.push(`/plans?kitchen=${kitchenId}` as never);
                            }}
                        />
                    ) : (
                        /*
                         * Drawn, disabled, as the design draws it — a dashed outline in the faint ink —
                         * rather than removed: a row where some cards have the button and some do not
                         * reads as a layout fault, and "No plans" is itself the answer.
                         */
                        <Pressable
                            testID={`${id}-plans`}
                            role="button"
                            accessibilityRole="button"
                            disabled
                            aria-disabled
                            accessibilityState={{ disabled: true }}
                            className="min-h-touch items-center justify-center rounded-lg border border-dashed border-stroke px-3.5"
                        >
                            <RNText className="text-sm font-medium text-content-disabled">
                                {t('marketplace:kitchens.finder.noPlans')}
                            </RNText>
                        </Pressable>
                    )}
                </View>
            </View>
        </View>
    );
}

/**
 * The kitchen's three highest-rated dishes, each one press from its record and one from the basket.
 *
 * Silent while loading — a skeleton in six cards at once is more motion than information — and an
 * honest line once a kitchen turns out to have nothing on its menu, so the card keeps its shape.
 */
function DishPreview({
    kitchen,
    onAdd,
    testID,
}: {
    readonly kitchen: Kitchen;
    readonly onAdd: (meal: MarketplaceMeal) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const query = useMealsQuery(dishPreviewFilter(kitchen.id));
    const dishes = mealsFromPages(query.data?.pages).slice(0, 3);

    if (query.data === undefined) return null;

    return (
        <View testID={testID} className="flex-col gap-2 border-t border-stroke-subtle pt-3">
            <Eyebrow>{t('marketplace:kitchens.finder.signatureDishes')}</Eyebrow>
            {dishes.length === 0 ? (
                <RNText
                    testID={`${testID}-empty`}
                    className="text-sm text-content-secondary text-start"
                >
                    {t('marketplace:kitchens.finder.noDishes')}
                </RNText>
            ) : null}
            {dishes.map((meal) => {
                const figures = publishedEnergyAndProtein(meal.nutrition);
                return (
                    <View key={meal.id} className="flex-row items-center gap-2.5">
                        <Pressable
                            testID={`${testID}-${meal.slug}`}
                            role="link"
                            accessibilityRole="link"
                            accessibilityLabel={t('marketplace:kitchens.finder.openDish', {
                                meal: meal.name,
                            })}
                            onPress={() => {
                                router.push(`/meals/${String(meal.id)}` as never);
                            }}
                            className="min-h-touch min-w-0 flex-1 flex-row items-center gap-2.5"
                        >
                            <View className="h-10 w-10 overflow-hidden rounded">
                                <EntityImage
                                    assetId={meal.imagePlaceholderId}
                                    seed={meal.slug}
                                    label={meal.name}
                                    aspect="square"
                                    decorative
                                    flush
                                />
                            </View>
                            <View className="min-w-0 flex-1 flex-col">
                                <RNText
                                    numberOfLines={1}
                                    className="text-sm font-semibold text-content-primary text-start"
                                >
                                    {meal.name}
                                </RNText>
                                {figures === null ? null : (
                                    <Eyebrow className="tabular-nums">
                                        {t('marketplace:kitchens.finder.dishFigures', {
                                            energy: formatter.formatNumber(figures.energy),
                                            protein: formatter.formatNumber(figures.protein),
                                        })}
                                    </Eyebrow>
                                )}
                            </View>
                            <RNText className="text-sm font-semibold tabular-nums text-content-primary text-end">
                                {formatMoney(formatter, meal.price)}
                                <PackSuffix pack={meal.pack} />
                            </RNText>
                        </Pressable>
                        {/*
                         * The design's 30px "+" square, drawn at 32px inside a 44px hit area — the
                         * customer surfaces keep the touch floor even where the glyph is small.
                         */}
                        <Pressable
                            testID={`${testID}-${meal.slug}-add`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('marketplace:kitchens.finder.addDish', {
                                meal: meal.name,
                            })}
                            onPress={() => {
                                onAdd(meal);
                            }}
                            className="min-h-touch min-w-touch items-center justify-center"
                        >
                            <View className="h-8 w-8 items-center justify-center rounded border border-stroke-strong bg-surface-raised">
                                <Icon name="plus" size="sm" className="text-content-primary" />
                            </View>
                        </Pressable>
                    </View>
                );
            })}
        </View>
    );
}
