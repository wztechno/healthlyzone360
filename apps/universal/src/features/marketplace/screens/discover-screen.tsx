import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { HomeHero, HomeSections } from '../home/home-sections.tsx';
import { useHomeMeals } from '../home/use-home-meals.ts';

/**
 * Discover — the marketplace's storefront, and HealthZone's `home` screen for everybody.
 *
 * The header's "Discover" opens this page, signed in or not, and it is the design's home top to
 * bottom: the canopy hero beside the photograph, "Browse by category", the top-rated grid, and the
 * offer band beside the recommendation card. The parts are shared with `/` (an anonymous visitor's
 * landing) and `/customer` (the signed-in home) through `../home/home-sections.tsx`, which records
 * each substitution against the design's sample data.
 *
 * ## The hero's second button
 *
 * The design's "Track order #4821" when the person has an order — the hero reads their latest one.
 * A visitor, or somebody with no orders yet, gets the other way into the catalogue: by kitchen.
 *
 * ## The search field is in the chrome, not on the page
 *
 * It lives in `shell/marketplace-shell.tsx`, reachable from every marketplace screen.
 *
 * ## Add is on every card, for everybody
 *
 * `commerce/use-basket-add.tsx` asks an anonymous visitor the same question the meal page asks:
 * carry on as a guest, or sign in.
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.discover', testID: 'discover' });
    // Frozen only, for now — see `catalogue/shown-shelves.ts`.
    const meals = useHomeMeals({ shownShelvesOnly: true });

    return (
        <View testID="discover-screen" className="flex-col pb-11">
            <HomeHero
                testID="discover-hero"
                meals={meals}
                primaryTestID="discover-hero-meals"
                secondary={{
                    testID: 'discover-hero-kitchens',
                    label: t('marketplace:landing.browseKitchens'),
                    onPress: () => {
                        router.push('/kitchens');
                    },
                }}
            />

            <HomeSections testID="discover" meals={meals} onAdd={basket.add} />

            {basket.dialog}
        </View>
    );
}
