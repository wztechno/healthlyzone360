import { Button, Dialog, useToast } from '@healthy360/design-system';
import type { ApiFailure, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAddCartItemMutation } from '../../data/catalogue-hooks.ts';
import { toFailure } from '../../data/hooks.ts';
import { useFailureMessage } from '../../screens/form-helpers.ts';
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
 *
 * ## A refused add is said out loud (BUG-12)
 *
 * A grid's Add has nothing beside it to carry an error, so a refusal is a danger toast naming the
 * reason — a kitchen account with no customer account to shop as is the case that used to vanish.
 * A surface that reports beside its own control passes `reportsInline` and reads `failure`.
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
    /** The surface shows the failure itself (the meal page's callout), so no toast. */
    readonly reportsInline?: boolean | undefined;
}

export interface BasketAdd {
    /** Signed in: add and confirm. Signed out: open the guest-entry dialog. */
    /**
     * `quantity` defaults to one — a grid's Add. The meal page passes its stepper's count, so
     * "three of these" is one request, and a guest who chose three arrives at checkout with three.
     */
    readonly add: (meal: MarketplaceMeal, quantity?: number) => void;
    readonly pending: boolean;
    /** True when the last add failed, for a surface that reports it beside the control. */
    readonly errored: boolean;
    /** Why the last add failed; `null` when it did not. */
    readonly failure: ApiFailure | null;
    /** Render once per screen. It is `null` until a signed-out person presses Add. */
    readonly dialog: ReactNode;
}

interface PendingAdd {
    readonly meal: MarketplaceMeal;
    readonly quantity: number;
}

export function useBasketAdd({
    labelKey,
    testID,
    reportsInline = false,
}: UseBasketAddOptions): BasketAdd {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const toast = useToast();
    const failureMessage = useFailureMessage();
    const { me } = useSession();
    const addToBasket = useAddCartItemMutation();

    const signedIn = me !== null;
    const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

    const reportFailure = (error: unknown) => {
        if (reportsInline) return;
        toast.show({
            testID: 'basket-add-failed',
            tone: 'danger',
            message: t('catalogue:meal.addFailed', {
                reason: failureMessage(toFailure(error)) ?? t('errors:generic.body'),
            }),
        });
    };

    const add = (meal: MarketplaceMeal, quantity = 1) => {
        if (!signedIn) {
            setPendingAdd({ meal, quantity });
            return;
        }
        addToBasket.mutate(
            { mealId: meal.id, quantity },
            {
                onSuccess: (cart) => {
                    /*
                     * Confirmed by a toast carrying the new basket count. Adding from a grid gives
                     * no other feedback — the card does not change, and the basket pill is up in the
                     * chrome — so without it the press looks like it did nothing.
                     *
                     * It carries the way on, as HealthZone's does: a person who adds from a grid
                     * is usually one press from the basket, and the pill is across the page.
                     */
                    toast.show({
                        testID: 'basket-added',
                        tone: 'success',
                        message: t('catalogue:meal.addedToBasket', { items: cart.itemCount }),
                        action: {
                            label: t('common:action.viewBasket'),
                            testID: 'basket-added-view',
                            onPress: () => {
                                router.push('/customer/cart' as never);
                            },
                        },
                    });
                },
                onError: reportFailure,
            },
        );
    };

    const dialog = (
        <Dialog
            testID={`${testID}-guest-entry-dialog`}
            open={pendingAdd !== null}
            onClose={() => {
                setPendingAdd(null);
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
                            setPendingAdd(null);
                            recordResumeIntent({ href: pathname, labelKey });
                            router.push('/sign-in');
                        }}
                    />
                    <Button
                        testID={`${testID}-guest-continue`}
                        label={t('guest:entry.continueAsGuest')}
                        loading={addToBasket.isPending}
                        onPress={() => {
                            const pending = pendingAdd;
                            if (pending === null) return;
                            setPendingAdd(null);
                            addToBasket.mutate(
                                { mealId: pending.meal.id, quantity: pending.quantity },
                                {
                                    onSuccess: () => {
                                        router.push('/guest-checkout');
                                    },
                                    onError: reportFailure,
                                },
                            );
                        }}
                    />
                </>
            }
        />
    );

    return {
        add,
        pending: addToBasket.isPending,
        errored: addToBasket.isError,
        failure: toFailure(addToBasket.error),
        dialog,
    };
}
