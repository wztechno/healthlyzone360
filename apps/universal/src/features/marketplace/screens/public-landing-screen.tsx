import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { HomeHero, HomeSections } from '../home/home-sections.tsx';
import { useHomeMeals } from '../home/use-home-meals.ts';

/**
 * The public landing page — `/` for an anonymous visitor.
 *
 * ## It is the storefront home
 *
 * HealthZone draws one customer home, and this page is that home: the same hero, categories, grid
 * and closing band as `/discover`, from `../home/home-sections.tsx`. The one thing particular to a
 * first visit is the hero's second button, which explains the product ("See how it works") where a
 * returning customer's tracks their order.
 *
 * ## What it gives away
 *
 * Doc 17, MKT-10: a landing page should give something before it asks for anything. What this one
 * gives is the catalogue — every meal, browsable and addable to a basket with no account (Add asks
 * a visitor whether to carry on as a guest or sign in, `commerce/use-basket-add.tsx`).
 *
 * ## What it no longer carries, and where those went
 *
 * The featured-kitchens shelf and the closing sign-up band are gone, because the design's home has
 * neither and both destinations are one press away in the chrome every page wears: "Kitchens" in
 * the header's navigation, and Register / Sign in on the header's trailing edge for exactly this
 * visitor (`shell/marketplace-shell.tsx`). Nothing that was reachable from here stopped being so.
 *
 * ## Why every link here resolves today
 *
 * A landing page is the one screen where a dead link is unrecoverable. The hero, the tiles, the
 * cards and the band point only at routes that exist in this build — meals, kitchens, plans, how
 * it works.
 */
export function PublicLandingScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.home', testID: 'landing' });
    const meals = useHomeMeals();

    return (
        <View testID="landing-screen" className="flex-col pb-11">
            <HomeHero
                testID="landing-hero"
                meals={meals}
                primaryTestID="landing-browse-meals"
                secondary={{
                    testID: 'landing-how-it-works',
                    label: t('marketplace:landing.howItWorks'),
                    onPress: () => {
                        router.push('/how-it-works');
                    },
                }}
            />

            <HomeSections testID="landing" meals={meals} onAdd={basket.add} />

            {basket.dialog}
        </View>
    );
}
