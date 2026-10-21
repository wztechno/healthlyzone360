import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useDietaryProfileQuery } from '../../data/account-hooks.ts';
import { useSession } from '../../session/session-provider.tsx';

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
