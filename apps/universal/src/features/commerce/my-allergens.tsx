import { Button, Callout } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useDietaryProfileQuery } from '../../data/account-hooks.ts';
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
    /** The plan's published dishes — its sample week — as far as they have loaded. */
    readonly meals: readonly MarketplaceMeal[];
    /** False while the dishes are still loading, so an empty list is not read as "nothing clashes". */
    readonly checked: boolean;
    /** Where the allergy editor returns to. */
    readonly returnTo: string;
    readonly testID: string;
}

/**
 * The person's allergy list beside what a plan would do with it.
 *
 * A subscription has no allergen list of its own: the kitchen reads the profile at generation and
 * swaps or skips a dish that crosses it. So the honest thing to show, on the plan page, in the
 * set-up and on the subscription, is that list, the dishes of this plan that cross it, and the way
 * to change it — rather than a second "leave out" list that went nowhere (plans-16).
 */
export function PlanAllergyNotice({ meals, checked, returnTo, testID }: PlanAllergyNoticeProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const names = useAllergenNames();
    const mine = useMyAllergenCodes();
    const { phase } = useSession();
    if (phase === 'anonymous' || phase === 'restoring') return null;

    const clashes = clashingMeals(meals, mine);
    const edit = (
        <Button
            testID={`${testID}-edit`}
            variant="quiet"
            size="sm"
            label={t('commerce:myAllergens.edit')}
            onPress={() => {
                router.push(withReturnTo(ALLERGY_LIST_HREF, returnTo) as never);
            }}
        />
    );

    return (
        <View testID={testID} className="flex-col gap-2">
            <RNText
                testID={`${testID}-list`}
                className="self-start text-base text-content-primary text-start"
            >
                {mine.length === 0
                    ? t('commerce:myAllergens.yourListEmpty')
                    : t('commerce:myAllergens.yourList', { allergens: names(mine) })}
            </RNText>
            {/* No dishes is "not checked", never "nothing clashes": an empty sample is a plan that
                has not published its menu, and reading it as safe would be a false all-clear. */}
            {mine.length === 0 ? null : !checked || meals.length === 0 ? (
                <RNText
                    testID={`${testID}-unchecked`}
                    className="self-start text-sm text-content-secondary text-start"
                >
                    {t('commerce:myAllergens.planUnchecked')}
                </RNText>
            ) : clashes.length === 0 ? (
                <RNText
                    testID={`${testID}-none`}
                    className="self-start text-sm text-content-secondary text-start"
                >
                    {t('commerce:myAllergens.planNone')}
                </RNText>
            ) : (
                <Callout
                    testID={`${testID}-clashes`}
                    role="alert"
                    tone="warning"
                    icon="warning"
                    title={t('commerce:myAllergens.planTitle', { count: clashes.length })}
                    body={[
                        ...clashes.map((entry) =>
                            t('commerce:myAllergens.mealWithAllergens', {
                                meal: entry.meal.name,
                                allergens: names(entry.allergens),
                            }),
                        ),
                        t('commerce:myAllergens.planBody'),
                    ].join('\n')}
                />
            )}
            <View className="self-start">{edit}</View>
        </View>
    );
}

/** "Contains your allergen: Eggs" — drawn only when the meal crosses a declaration. */
export function YourAllergens({ allergens, testID, className }: YourAllergensProps) {
    const { t } = useTranslation();
    const names = useAllergenNames();
    const clashing = clashingAllergens(allergens, useMyAllergenCodes());

    if (clashing.length === 0) return null;

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
