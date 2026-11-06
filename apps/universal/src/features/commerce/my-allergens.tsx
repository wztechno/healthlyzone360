import { Icon, cx } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDietaryProfileQuery } from '../../data/account-hooks.ts';
import { EntityImage } from '../../media/entity-image.tsx';
import { withReturnTo } from '../../navigation/return-to.ts';
import { useSession } from '../../session/session-provider.tsx';

/** Where the allergy list is edited. Every notice below links here and comes back. */
export const ALLERGY_LIST_HREF = '/customer/account/allergies';

/**
 * The person's own declared allergies, and where a meal crosses them.
 *
 * Three surfaces ask the same question — the card, the meal page, and Add — so it is answered once.
 * Every severity counts and every containment counts: the server's rule (`MealSafety`, which
 * subscription generation enforces and checkout re-checks at placement) does not grade risk, and a
 * badge that stayed quiet about an "intolerance" the server then refused would teach the person
 * the badge is not to be trusted.
 *
 * This is the early warning, read from the cached profile. The answer that decides is the server's,
 * at checkout and at placement — a profile changed on another device is caught there.
 */
export function useMyAllergenCodes(): readonly string[] {
    const { phase } = useSession();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    const profile = useDietaryProfileQuery(signedIn);
    const declared = profile.data?.allergens;

    // One array per profile read, so a caller may use it as a memo dependency.
    return useMemo(
        () =>
            !signedIn || declared === undefined
                ? NONE
                : declared.map((declaration) => declaration.allergenCode),
        [signedIn, declared],
    );
}

const NONE: readonly string[] = [];

/** The meal's allergens that the person has declared, in the meal's order. */
export function clashingAllergens(
    mealAllergens: readonly string[] | undefined,
    mine: readonly string[],
): readonly string[] {
    if (mealAllergens === undefined || mine.length === 0) return NONE;
    return mealAllergens.filter((code) => mine.includes(code));
}

/** The allergens as the person reads them, joined the way the meal card joins them. */
export function useAllergenNames(): (codes: readonly string[]) => string {
    const { t } = useTranslation();
    return (codes) =>
        codes
            .map((code) => t(`marketplace:allergens.${code}`))
            .join(t('marketplace:common.listSeparator'));
}

export interface YourAllergensProps {
    readonly allergens: readonly string[] | undefined;
    readonly testID: string;
    /** Spacing from what sits above it — applied only when the line is drawn. */
    readonly className?: string | undefined;
    /**
     * `line` is the dot and sentence; `badge` the amber pill the Allergen board lays over a card's
     * photo ("Contains Milk"); `tag` the small amber pill it puts under a basket line's name.
     */
    readonly variant?: 'line' | 'badge' | 'tag' | undefined;
}

/** The meals of a set that cross the person's declarations, each with what it carries. */
export function clashingMeals(
    meals: readonly MarketplaceMeal[],
    mine: readonly string[],
): readonly { readonly meal: MarketplaceMeal; readonly allergens: readonly string[] }[] {
    return meals
        .map((meal) => ({ meal, allergens: clashingAllergens(meal.allergens, mine) }))
        .filter((entry) => entry.allergens.length > 0);
}

export interface PlanAllergyNoticeProps {
    /** The plan's dishes to check — its sample week, or what the run has picked so far. */
    readonly meals: readonly MarketplaceMeal[];
    /** False while the dishes are still loading, so an empty list is not read as "nothing clashes". */
    readonly checked: boolean;
    /** Where the allergy editor returns to. */
    readonly returnTo: string;
    /**
     * When a clashing dish was picked — "Wed 11 Nov · 3 days". Without it the dish is "On this
     * plan's menu", which is what the plan page and the subscription show.
     */
    readonly whenOf?: ((meal: MarketplaceMeal) => string | undefined) | undefined;
    /** "Change meal" on each clashing dish: back to the step where it was picked. */
    readonly onChangeMeal?: ((meal: MarketplaceMeal) => void) | undefined;
    readonly testID: string;
}

/**
 * The person's allergy list beside what a plan would do with it — one card wherever a plan is
 * shown (Shop · Plan setup pins 1 and 4, Weekly plans pin 1, Subscription pin 2).
 *
 * A subscription has no allergen list of its own: the kitchen reads the profile at generation and
 * swaps or skips a dish that crosses it. So the honest thing to show is that list, the dishes that
 * cross it, and the way to change it — rather than a second "leave out" list that went nowhere
 * (plans-16).
 *
 * The card: a shield tile, "Your allergy list" and "Change your allergy list" in its head; each
 * declared allergen as a red chip; then one of three feet. Clashes are an amber section naming each
 * dish with its photo, when it is, what it contains, and Change meal where the caller can go back
 * to the pick. "None crosses" is a green row. No dishes is "not checked", never "nothing clashes":
 * an empty sample is a plan that has not published its menu, and reading it as safe would be a
 * false all-clear.
 */
export function PlanAllergyNotice({
    meals,
    checked,
    returnTo,
    whenOf,
    onChangeMeal,
    testID,
}: PlanAllergyNoticeProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const names = useAllergenNames();
    const mine = useMyAllergenCodes();
    const { phase } = useSession();
    if (phase === 'anonymous' || phase === 'restoring') return null;

    const clashes = clashingMeals(meals, mine);

    return (
        <View
            testID={testID}
            role="group"
            aria-label={t('commerce:myAllergens.listTitle')}
            className="overflow-hidden rounded-[22px] border border-stroke-subtle bg-surface-raised"
        >
            <View testID={`${testID}-list`} className="flex-col">
                <View className="flex-row flex-wrap items-center gap-3 px-4 pb-3 pt-3.5">
                    <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-danger-subtle">
                        <Icon name="shield" size="md" className="text-danger-on-subtle" />
                    </View>
                    <View className="min-w-[160px] flex-1">
                        <RNText className="font-display text-base font-bold leading-5 text-content-primary text-start">
                            {t('commerce:myAllergens.listTitle')}
                        </RNText>
                        <RNText className="mt-0.5 text-sm text-content-secondary text-start">
                            {t('commerce:myAllergens.checkNote')}
                        </RNText>
                    </View>
                    <Pressable
                        testID={`${testID}-edit`}
                        role="button"
                        accessibilityRole="button"
                        onPress={() => {
                            router.push(withReturnTo(ALLERGY_LIST_HREF, returnTo) as never);
                        }}
                        className="h-9 items-center justify-center rounded-full border border-stroke bg-surface-raised px-3.5 hover:bg-surface-sunken"
                    >
                        <RNText className="text-sm font-semibold text-content-primary">
                            {t('commerce:myAllergens.edit')}
                        </RNText>
                    </Pressable>
                </View>
                <View className="flex-row flex-wrap gap-2 px-4 pb-3.5">
                    {mine.length === 0 ? (
                        <RNText className="text-sm text-content-secondary text-start">
                            {t('commerce:myAllergens.yourListEmpty')}
                        </RNText>
                    ) : (
                        mine.map((code) => (
                            <View
                                key={code}
                                className="h-8 flex-row items-center gap-1.5 rounded-full border border-danger-border bg-danger-subtle pe-3 ps-2"
                            >
                                <Icon name="alert" size="sm" className="text-danger-on-subtle" />
                                <RNText className="text-sm font-bold text-danger-on-subtle">
                                    {names([code])}
                                </RNText>
                            </View>
                        ))
                    )}
                </View>
            </View>

            {mine.length === 0 ? null : !checked || meals.length === 0 ? (
                <View
                    testID={`${testID}-unchecked`}
                    className="flex-row items-center gap-2.5 border-t border-stroke-subtle bg-surface-base px-4 py-3"
                >
                    <Icon name="infoCircle" size="md" className="text-content-secondary" />
                    <RNText className="shrink text-sm font-semibold text-content-secondary text-start">
                        {t('commerce:myAllergens.planUnchecked')}
                    </RNText>
                </View>
            ) : clashes.length === 0 ? (
                <View
                    testID={`${testID}-none`}
                    className="flex-row items-center gap-2.5 border-t border-stroke-subtle bg-surface-brand-subtle px-4 py-3"
                >
                    <Icon name="circleCheck" size="md" className="text-content-on-brand-subtle" />
                    <RNText className="shrink text-sm font-semibold text-content-on-brand-subtle text-start">
                        {t('commerce:myAllergens.planNone')}
                    </RNText>
                </View>
            ) : (
                <View
                    testID={`${testID}-clashes`}
                    role="alert"
                    className="border-t border-warning-border bg-warning-subtle px-4 pb-4 pt-3.5"
                >
                    <View className="flex-row items-center gap-2">
                        <Icon name="alert" size="md" className="text-warning-on-subtle" />
                        <RNText className="shrink text-sm font-bold leading-5 text-warning-on-subtle text-start">
                            {t('commerce:myAllergens.planTitle', { count: clashes.length })}
                        </RNText>
                    </View>
                    {clashes.map((entry) => (
                        <View
                            key={String(entry.meal.id)}
                            testID={`${testID}-dish-${String(entry.meal.id)}`}
                            className="mt-2.5 flex-row flex-wrap items-center gap-3 rounded-2xl bg-surface-raised p-2 pe-3 shadow-elevation-1"
                        >
                            <View className="h-[52px] w-[52px] overflow-hidden rounded-xl">
                                <EntityImage
                                    assetId={entry.meal.imagePlaceholderId}
                                    photoUrl={entry.meal.photoUrl}
                                    variant="card"
                                    seed={entry.meal.slug}
                                    label={entry.meal.name}
                                    decorative
                                    flush
                                    className="h-full w-full"
                                />
                            </View>
                            <View className="min-w-[120px] flex-1">
                                <RNText className="text-sm font-bold text-content-primary text-start">
                                    {entry.meal.name}
                                </RNText>
                                <RNText className="mt-0.5 text-xs text-content-secondary text-start">
                                    {whenOf?.(entry.meal) ?? t('commerce:myAllergens.onMenu')}
                                </RNText>
                            </View>
                            <View className="flex-row flex-wrap items-center gap-2.5">
                                <View className="h-6 flex-row items-center gap-1 rounded-full bg-warning-subtle px-2.5">
                                    <Icon
                                        name="alert"
                                        size="sm"
                                        className="text-warning-on-subtle"
                                    />
                                    <RNText className="text-xs font-bold text-warning-on-subtle">
                                        {t('commerce:myAllergens.containsShort', {
                                            allergens: names(entry.allergens),
                                        })}
                                    </RNText>
                                </View>
                                {onChangeMeal === undefined ? null : (
                                    <Pressable
                                        testID={`${testID}-change-${String(entry.meal.id)}`}
                                        role="button"
                                        accessibilityRole="button"
                                        onPress={() => {
                                            onChangeMeal(entry.meal);
                                        }}
                                        className="h-[34px] flex-row items-center gap-1.5 rounded-full bg-surface-inverse px-3 hover:opacity-90"
                                    >
                                        <Icon
                                            name="rotateCw"
                                            size="sm"
                                            className="text-content-inverse"
                                        />
                                        <RNText className="text-xs font-bold text-content-inverse">
                                            {t('commerce:myAllergens.changeMeal')}
                                        </RNText>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    ))}
                    <RNText className="mt-2.5 text-sm leading-[18px] text-warning-on-subtle text-start">
                        {t('commerce:myAllergens.planBody')}
                    </RNText>
                </View>
            )}
        </View>
    );
}

/** "Contains your allergen: Eggs" — drawn only when the meal crosses a declaration. */
export function YourAllergens({
    allergens,
    testID,
    className,
    variant = 'line',
}: YourAllergensProps) {
    const { t } = useTranslation();
    const names = useAllergenNames();
    const clashing = clashingAllergens(allergens, useMyAllergenCodes());

    if (clashing.length === 0) return null;

    const label = t('commerce:myAllergens.badge', {
        count: clashing.length,
        allergens: names(clashing),
    });

    if (variant === 'badge') {
        return (
            <View
                testID={testID}
                pointerEvents="none"
                accessibilityLabel={label}
                className={cx(
                    'h-7 flex-row items-center gap-1.5 self-start rounded-full bg-warning-subtle pe-2.5 ps-1.5 shadow-elevation-2',
                    className,
                )}
            >
                <View className="h-[18px] w-[18px] items-center justify-center rounded-full bg-warning-strong">
                    <Icon name="alert" size="sm" className="text-warning-on-strong" />
                </View>
                <RNText
                    numberOfLines={1}
                    className="shrink text-xs font-bold text-warning-on-subtle"
                >
                    {t('commerce:myAllergens.containsShort', { allergens: names(clashing) })}
                </RNText>
            </View>
        );
    }

    if (variant === 'tag') {
        return (
            <View
                testID={testID}
                accessibilityLabel={label}
                className={cx(
                    'h-[22px] flex-row items-center gap-1 self-start rounded-full bg-warning-subtle px-2',
                    className,
                )}
            >
                <Icon name="alert" size="sm" className="text-warning-on-subtle" />
                <RNText
                    numberOfLines={1}
                    className="shrink text-xs font-bold text-warning-on-subtle"
                >
                    {t('commerce:myAllergens.containsShort', { allergens: names(clashing) })}
                </RNText>
            </View>
        );
    }

    return (
        <View
            testID={testID}
            className={`flex-row items-center gap-2${className === undefined ? '' : ` ${className}`}`}
        >
            <View className="h-1.5 w-1.5 rounded-full bg-danger-border" />
            <RNText className="flex-1 text-xs font-semibold text-danger-on-subtle text-start">
                {t('commerce:myAllergens.badge', {
                    count: clashing.length,
                    allergens: names(clashing),
                })}
            </RNText>
        </View>
    );
}
