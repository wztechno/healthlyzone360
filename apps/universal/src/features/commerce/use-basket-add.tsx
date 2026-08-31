import { Button, Dialog, useToast } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAddCartItemMutation } from '../../data/catalogue-hooks.ts';
import { useSession } from '../../session/session-provider.tsx';
import { recordResumeIntent } from '../marketplace/resume-intent.ts';

/**
 * "Add to basket", wherever it is pressed.
 *
 * ## Why a hook rather than a prop on the card
 *
 * Adding a meal is three behaviours, not one: the mutation, the confirmation, and what happens when
 * the person is not signed in. Until now only two surfaces implemented all three — the meal page,
 * and the discover grid, which implemented the third by *hiding Add from guests altogether*. Every
 * other grid had no Add at all. Putting it in a hook is what lets five grids and the meal page offer
 * the same control without six copies of the guest decision, one of which was already different.
 *
 * ## The guest path is the whole point
 *
 * An anonymous visitor who has decided what they want is at the moment of highest intent, and
 * answering it with "make an account first" is where most of them stop. So Add is offered to
 * everybody and the choice comes *after* the press: carry on as a guest, or sign in — and signing in
 * stays visible rather than being replaced, because somebody who already has an account is better
 * served by it (their addresses and past orders are there).
 *
 * The meal goes into the basket before either route. The basket is not part of the guest session —
 * it exists before one is started and survives one expiring — so the guest checkout opens on a
 * basket that already holds what the person just chose rather than an empty one they must fill
 * again.
 *
 * ## The resume intent names where you were, not where the meal lives
 *
 * `usePathname` rather than the meal's own route: somebody who pressed Add on `/meals` and chose to
 * sign in wants the grid back, not the record of one dish they never opened.
 */
export interface UseBasketAddOptions {
    /**
     * i18n key naming the *kind* of place to come back to after signing in, e.g.
     * `catalogue:nav.meals`. See `marketplace/resume-intent.ts`.
     */
    readonly labelKey: string;
    /**
     * Prefix for the dialog's test identifiers, so a surface keeps the handles its suites already
     * point at (`meal-detail-guest-entry-dialog` and its two buttons).
     */
    readonly testID: string;
}

export interface BasketAdd {
    /** Signed in: add and confirm. Signed out: open the guest-entry dialog. */
    readonly add: (meal: MarketplaceMeal) => void;
    readonly pending: boolean;
    /** True when the last add failed, for a surface that reports it beside the control. */
    readonly errored: boolean;
    /** Render once per screen. It is `null` until a signed-out person presses Add. */
    readonly dialog: ReactNode;
}

export function useBasketAdd({ labelKey, testID }: UseBasketAddOptions): BasketAdd {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const toast = useToast();
    const { me } = useSession();
    const addToBasket = useAddCartItemMutation();

    const signedIn = me !== null;
    const [pendingMeal, setPendingMeal] = useState<MarketplaceMeal | null>(null);

    const add = (meal: MarketplaceMeal) => {
        if (!signedIn) {
            setPendingMeal(meal);
            return;
        }
        addToBasket.mutate(
            { mealId: meal.id, quantity: 1 },
            {
                onSuccess: (cart) => {
                    /*
                     * Confirmed by a toast carrying the new basket count. Adding from a grid gives
                     * no other feedback — the card does not change, and the basket pill is up in the
                     * chrome — so without it the press looks like it did nothing.
                     */
                    toast.show({
                        testID: 'basket-added',
                        tone: 'success',
                        message: t('catalogue:meal.addedToBasket', { items: cart.itemCount }),
                    });
                },
            },
        );
    };

    const dialog = (
        <Dialog
            testID={`${testID}-guest-entry-dialog`}
            open={pendingMeal !== null}
            onClose={() => {
                setPendingMeal(null);
            }}
            title={t('guest:entry.title')}
            description={t('guest:entry.body')}
            actions={
                <>
                    <Button
                        testID={`${testID}-guest-sign-in`}
                        variant="secondary"
                        label={t('guest:entry.signIn')}
                        onPress={() => {
                            setPendingMeal(null);
                            recordResumeIntent({ href: pathname, labelKey });
                            router.push('/sign-in');
                        }}
                    />
                    <Button
                        testID={`${testID}-guest-continue`}
                        label={t('guest:entry.continueAsGuest')}
                        loading={addToBasket.isPending}
                        onPress={() => {
                            const meal = pendingMeal;
                            if (meal === null) return;
                            setPendingMeal(null);
                            addToBasket.mutate(
                                { mealId: meal.id, quantity: 1 },
                                {
                                    onSuccess: () => {
                                        router.push('/guest-checkout');
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        />
    );

    return { add, pending: addToBasket.isPending, errored: addToBasket.isError, dialog };
}
