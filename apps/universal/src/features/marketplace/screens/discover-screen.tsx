import { Button, Callout, Inline } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { pathnameOf } from '../../../navigation/return-to.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { subscriptionDayPrice } from '../../catalogue/plan-balance.ts';
import { isLiveSubscription } from '../../catalogue/plan-subscriber-panel.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { formatMoney } from '../format.ts';
import { HomeHero, HomeSections } from '../home/home-sections.tsx';
import type { HomeOffer } from '../home/home-sections.tsx';
import { useHomeMeals } from '../home/use-home-meals.ts';
import { clearResumeIntent, useResumeIntent } from '../resume-intent.ts';

/**
 * Discover — the marketplace home, and HealthZone's `home` screen for everybody.
 *
 * It is the only home. `/` sends an anonymous visitor here and the landing kernel sends a signed-in
 * customer here (`ROUTE_PATHS.customerHome`); `/customer` forwards here too. Those three used to be
 * three screens drawing the same sections, which is how the site came to carry one page three times.
 *
 * The design's home top to bottom, through `../home/home-sections.tsx`: the canopy hero beside the
 * photograph, "Browse by category", the top-rated grid, and the offer band beside the
 * recommendation card.
 *
 * ## What a signed-in person's account adds
 *
 * Fitted into places the design already has, so the page keeps the design's shape:
 *
 * - **Where was I** — the resume notice for a marketplace page recorded before sign-in. Transient,
 *   actionable and only ever present right after signing in, so it sits above the hero, where a
 *   notice belongs, and leaves no trace once dismissed.
 * - **The hero's eyebrow** is the next subscription delivery when there is one — the design's
 *   delivery-slot fact, made true for this person. Its second button tracks their latest order
 *   (`HomeHero`); with none it is the other way into the catalogue, by kitchen.
 * - **The running subscription** takes the offer band. The band pitches plans; somebody already on
 *   one is better served by seeing theirs, and the band's button manages it. With no subscription
 *   the band is the plans offer again.
 * - **No account tiles.** The page used to close on tiles for subscriptions, profile and account.
 *   The header's account icon now opens the account page, subscriptions are a section of it, and
 *   staff reach their profile from their own header icon, so the tiles had nothing left to do.
 *
 * The cards carry figures and the band can carry a price, so a signed-in page keeps the medical
 * disclaimer at the foot, as every customer surface that prints nutrition does.
 *
 * ## The search field is in the chrome, not on the page
 *
 * It lives in `shell/marketplace-shell.tsx`, reachable from every marketplace screen.
 *
 * ## Add is on every card, for everybody
 *
 * `commerce/use-basket-add.tsx` asks an anonymous visitor the same question the meal page asks —
 * sign in or create an account — and the meal is added once they have.
 *
 * ## The resume notice is a fallback
 *
 * Signing in now finishes on the page it was started from (`?returnTo=`), and that clears the
 * intent, so the notice is left for the trip a return cannot make. It is never offered for the page
 * the person is already on — "pick up where you left off" pointing at this very page is a button
 * that does nothing (AUTH-13).
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const formatter = useFormatter();
    const { me } = useSession();
    const signedIn = me !== null;

    const basket = useBasketAdd({ labelKey: 'marketplace:nav.discover', testID: 'discover' });
    // Only the shown shelves — see `catalogue/shown-shelves.ts`.
    const meals = useHomeMeals({ shownShelvesOnly: true });
    const subscriptions = useSubscriptionsQuery(signedIn);
    const recorded = useResumeIntent();
    const resume = recorded !== null && pathnameOf(recorded.href) !== pathname ? recorded : null;

    // The plan the person is on — live, not merely "not cancelled", which also matched a
    // subscription that had run its full length.
    const activeSubscription = signedIn
        ? (subscriptions.data?.items ?? []).find(isLiveSubscription)
        : undefined;

    const nextDelivery =
        activeSubscription?.nextDeliveryDate === undefined ||
        activeSubscription.nextDeliveryDate === null
            ? null
            : formatter.formatDate(`${activeSubscription.nextDeliveryDate}T12:00:00.000Z`, {
                  day: 'numeric',
                  month: 'long',
              });

    const subscriptionOffer: HomeOffer | undefined =
        activeSubscription === undefined
            ? undefined
            : {
                  eyebrow: t('marketplace:consumer.subscription.eyebrow', {
                      state: t(`marketplace:subscriptionStates.${activeSubscription.state}`),
                  }),
                  title: activeSubscription.planName,
                  body: `${
                      nextDelivery === null
                          ? t('marketplace:consumer.subscription.noNextDelivery')
                          : t('marketplace:consumer.subscription.nextDelivery', {
                                date: nextDelivery,
                            })
                  } · ${t('marketplace:consumer.subscription.dayPrice', {
                      price: formatMoney(formatter, subscriptionDayPrice(activeSubscription)),
                  })}`,
                  action: {
                      testID: 'discover-subscription-manage',
                      label: t('marketplace:consumer.subscription.manage'),
                      onPress: () => {
                          router.push(
                              `/customer/subscriptions/${String(activeSubscription.id)}` as never,
                          );
                      },
                  },
              };

    return (
        <View testID="discover-screen" className="flex-col pb-11">
            {!signedIn || resume === null ? null : (
                <Callout
                    testID="discover-resume"
                    role="status"
                    tone="info"
                    className="mb-6"
                    title={t('marketplace:consumer.resume.title')}
                    body={t('marketplace:consumer.resume.body', {
                        destination: resume.name ?? t(resume.labelKey),
                    })}
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="discover-resume-continue"
                                size="sm"
                                label={t('marketplace:consumer.resume.continue')}
                                onPress={() => {
                                    const { href } = resume;
                                    clearResumeIntent();
                                    router.push(href as never);
                                }}
                            />
                            <Button
                                testID="discover-resume-dismiss"
                                size="sm"
                                variant="ghost"
                                label={t('marketplace:consumer.resume.dismiss')}
                                onPress={clearResumeIntent}
                            />
                        </Inline>
                    }
                />
            )}

            <HomeHero
                testID="discover-hero"
                meals={meals}
                eyebrow={
                    nextDelivery === null
                        ? undefined
                        : t('marketplace:consumer.subscription.nextDelivery', {
                              date: nextDelivery,
                          })
                }
                primaryTestID="discover-hero-meals"
                secondary={{
                    testID: 'discover-hero-kitchens',
                    label: t('marketplace:landing.browseKitchens'),
                    onPress: () => {
                        router.push('/kitchens');
                    },
                }}
            />

            <HomeSections
                testID="discover"
                meals={meals}
                onAdd={basket.add}
                offer={subscriptionOffer}
            />

            {signedIn ? <MedicalDisclaimer className="mt-11" /> : null}

            {basket.dialog}
        </View>
    );
}
