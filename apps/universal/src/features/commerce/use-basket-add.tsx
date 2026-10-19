import { Button, Dialog, useToast } from '@healthy360/design-system';
import type { ApiFailure, Cart, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import { queryKeys } from '../../data/query-keys.ts';
import { useRepositories } from '../../data/repository-provider.tsx';
import { withReturnTo } from '../../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth } from '../../navigation/use-return-to.ts';
import { useFailureMessage } from '../../screens/form-helpers.ts';
import { useSession } from '../../session/session-provider.tsx';
import { recordResumeIntent } from '../marketplace/resume-intent.ts';
import { writePendingAdd } from './pending-add.ts';

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
 * ## Signed out: the choice comes after the press, and the press is kept
 *
 * An anonymous visitor who has decided what they want is at the moment of highest intent, and
 * hiding Add from them is where most of them stop. So Add is offered to everybody and the question
 * comes *after* the press: sign in, or create an account. There is no "continue as a guest" any
 * more — a basket needs a verified session (BUG-19), so that button could only ever fail with "your
 * session has ended" to somebody who never had one (AUTH-06).
 *
 * Whichever they pick, the meal and the quantity are written down first (`pending-add.ts`) and the
 * page they are on rides along as `?returnTo=`. Signing in (or registering and confirming the
 * address) brings them back to that page, and the marketplace chrome adds the meal once, with the
 * usual "Added" toast (`shell/marketplace-shell.tsx`, `usePendingAddReplay`). Nothing is added
 * before then: a basket cannot exist without the session, which is what the old comment here got
 * wrong (AUTH-01).
 *
 * ## The session's phase, not `me`
 *
 * "Signed in" used to be `me !== null`, which is wrong in both directions (AUTH-09): during a
 * restore `me` is null, so a signed-in person was asked to sign in; and an unconfirmed account has
 * a `me`, so it skipped straight to a request the server refuses. So the add branches on the phase:
 *
 * | phase                        | Add                                                         |
 * | ---------------------------- | ----------------------------------------------------------- |
 * | `restoring`                  | waits — `pending` is true, so the control shows its spinner |
 * | `anonymous`                  | the sign-in question above                                   |
 * | `authenticated` (unverified) | keeps the add, and opens email confirmation with a return   |
 * | `contextPending`, `ready`    | adds                                                        |
 *
 * ## One kitchen per basket (browse-03)
 *
 * A basket is open on one kitchen's channel, so the add names the meal's kitchen and an empty
 * basket elsewhere is simply opened at the right kitchen instead. A basket that already *holds*
 * another kitchen's meals is the person's to decide about: "Start a new basket?" keeps it, or
 * empties it and opens the new kitchen's. No endpoint empties a basket — a cart is never deleted,
 * it expires — so starting over removes its lines one by one, then adds.
 *
 * ## The resume intent names where you were, not where the meal lives
 *
 * The current page, query included, rather than the meal's own route: somebody who pressed Add on
 * `/meals?diet=vegan` and chose to sign in wants the filtered grid back, not the record of one dish
 * they never opened.
 *
 * ## A refused add is said out loud (BUG-12)
 *
 * A grid's Add has nothing beside it to carry an error, so a refusal is a danger toast naming the
 * reason — a kitchen account with no customer account to shop as is the case that used to vanish.
 * A surface that reports beside its own control passes `reportsInline` and reads `failure`. A
 * refusal the person can act on — the session ended, the address is not confirmed — is a toast with
 * the way forward on every surface, because an inline callout has nowhere to put a button.
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

/**
 * What an add needs to know about a meal: which one, and whose. A `MarketplaceMeal` is one; so is a
 * pending add being replayed after a sign-in, which kept only these two.
 */
export interface BasketMeal {
    readonly id: MarketplaceMeal['id'];
    readonly kitchenId?: KitchenId | undefined;
}

export interface BasketAdd {
    /**
     * Adds and confirms, or asks first — see the table above. `quantity` defaults to one, a grid's
     * Add. The meal page passes its stepper's count, so "three of these" is one request, and somebody
     * who chose three before signing in finds three in the basket afterwards.
     */
    readonly add: (meal: BasketMeal, quantity?: number) => void;
    /** An add is in flight, or the session is still restoring and cannot take one yet. */
    readonly pending: boolean;
    /** True when the last add failed, for a surface that reports it beside the control. */
    readonly errored: boolean;
    /** Why the last add failed; `null` when it did not. */
    readonly failure: ApiFailure | null;
    /** Render once per screen. Nothing shows until an add needs a question answered. */
    readonly dialog: ReactNode;
}

/** The kitchen a basket is open on — its channel's, else its lines'. `null` when nothing says. */
export function basketKitchenOf(cart: Cart | undefined): KitchenId | null {
    if (cart === undefined) return null;
    return cart.kitchenId ?? cart.items[0]?.kitchenId ?? null;
}

/** Whether adding this meal to this basket would mix two kitchens' meals in one basket. */
function holdsAnotherKitchen(cart: Cart | undefined, meal: BasketMeal): boolean {
    if (cart === undefined || cart.items.length === 0 || meal.kitchenId === undefined) return false;
    const kitchen = basketKitchenOf(cart);
    return kitchen !== null && kitchen !== meal.kitchenId;
}

interface AddVariables {
    readonly meal: BasketMeal;
    readonly quantity: number;
    /** Empty the basket first — the person chose "Start a new basket". */
    readonly startOver?: boolean | undefined;
}

/**
 * The add itself.
 *
 * It reads the basket the chrome already holds rather than opening one per add — the identifier is
 * in the cache, and `POST /carts` plus a lookup for every line already in it is a round trip per
 * line (the reason `catalogue-hooks.ts`'s add stopped doing it). It opens one only when it must:
 * nothing is cached yet, or the cached basket is an empty one at another kitchen. Then it names the
 * meal's kitchen, so the server opens that kitchen's basket rather than one the meal would be
 * refused from (browse-03). A basket whose kitchen is not known — a world that does not model
 * channels — is used as it is, as it always was.
 */
function useBasketAddMutation(): UseMutationResult<Cart, unknown, AddVariables> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ meal, quantity, startOver = false }: AddVariables) => {
            const known = queryClient.getQueryData<Cart>(queryKeys.commerce.cart());

            if (startOver && known !== undefined) {
                // One at a time: each removal answers with the basket as it now stands, and nothing
                // is gained by racing a handful of deletes against one another.
                for (const line of known.items) {
                    await repositories.commerce.removeCartItem(known.id, line.id);
                }
            }

            const basketKitchen = basketKitchenOf(known);
            const reusable =
                known !== undefined &&
                !startOver &&
                (meal.kitchenId === undefined ||
                    basketKitchen === null ||
                    basketKitchen === meal.kitchenId);

            const cartId = reusable
                ? known.id
                : (
                      await repositories.commerce.getCart(
                          meal.kitchenId === undefined ? {} : { kitchenId: meal.kitchenId },
                      )
                  ).id;
            return repositories.commerce.addCartItem(cartId, { mealId: meal.id, quantity });
        },
        onSuccess: (cart) => {
            // Written rather than invalidated: the screen reports the new item count in the same
            // frame it shows the confirmation, and a refetch would only land after it.
            queryClient.setQueryData(queryKeys.commerce.cart(), cart);
        },
    });
}

interface Asked {
    readonly meal: BasketMeal;
    readonly quantity: number;
}

interface Conflict extends Asked {
    /** The kitchen the basket already holds meals from, when the lines say. */
    readonly kitchenName: string | undefined;
}

export function useBasketAdd({
    labelKey,
    testID,
    reportsInline = false,
}: UseBasketAddOptions): BasketAdd {
    const { t } = useTranslation();
    const router = useRouter();
    const here = useCurrentHref();
    const goToAuth = useGoToAuth();
    const toast = useToast();
    const failureMessage = useFailureMessage();
    const { phase } = useSession();
    const queryClient = useQueryClient();
    const addToBasket = useBasketAddMutation();

    // The sign-in question, and the "Start a new basket?" one. Each holds the add it is about.
    const [asked, setAsked] = useState<Asked | null>(null);
    const [conflict, setConflict] = useState<Conflict | null>(null);

    /** Keep the add and go to authenticate, coming back to this page. */
    const authenticateFor = (
        href: '/sign-in' | '/register' | '/verify-email',
        { meal, quantity }: Asked,
    ) => {
        writePendingAdd({ mealId: meal.id, quantity, kitchenId: meal.kitchenId });
        if (href === '/verify-email') {
            router.push(withReturnTo(href, here) as never);
            return;
        }
        recordResumeIntent({ href: here, labelKey });
        goToAuth(href);
    };

    const reportFailure = (error: unknown, choice: Asked) => {
        const failure = toFailure(error);
        const reason = failure?.code;

        // A refusal with a way forward: say so, and offer it — whatever the surface.
        if (reason === 'auth.unauthenticated' || reason === 'auth.email_unverified') {
            const signIn = reason === 'auth.unauthenticated';
            toast.show({
                testID: 'basket-add-failed',
                tone: 'danger',
                message: t('catalogue:meal.addFailed', {
                    reason: failureMessage(failure) ?? t('errors:generic.body'),
                }),
                action: {
                    label: signIn ? t('common:action.signIn') : t('auth:verifyEmail.title'),
                    testID: 'basket-add-failed-action',
                    onPress: () => {
                        authenticateFor(signIn ? '/sign-in' : '/verify-email', choice);
                    },
                },
            });
            return;
        }

        if (reportsInline) return;

        // `cart.line_refused` blames "something in your basket". When the basket holds another
        // kitchen's meals, that is exactly what happened, and saying which is the useful version.
        const otherKitchen =
            reason === 'cart.line_refused' &&
            holdsAnotherKitchen(
                queryClient.getQueryData<Cart>(queryKeys.commerce.cart()),
                choice.meal,
            );
        toast.show({
            testID: 'basket-add-failed',
            tone: 'danger',
            message: t('catalogue:meal.addFailed', {
                reason: otherKitchen
                    ? t('errors:cart.otherKitchen')
                    : (failureMessage(failure) ?? t('errors:generic.body')),
            }),
        });
    };

    const commit = (choice: Asked, startOver = false) => {
        addToBasket.mutate(
            { meal: choice.meal, quantity: choice.quantity, startOver },
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
                        message: t('catalogue:meal.addedToBasket', { count: cart.itemCount }),
                        action: {
                            label: t('common:action.viewBasket'),
                            testID: 'basket-added-view',
                            onPress: () => {
                                router.push('/customer/cart' as never);
                            },
                        },
                    });
                },
                onError: (error) => {
                    reportFailure(error, choice);
                },
            },
        );
    };

    const add = (meal: BasketMeal, quantity = 1) => {
        const choice: Asked = { meal, quantity };
        switch (phase) {
            case 'restoring':
                // Not knowable yet; `pending` keeps the control busy until it is.
                return;
            case 'anonymous':
                setAsked(choice);
                return;
            case 'authenticated':
                // Signed in, address not confirmed: the server would refuse the basket. Keep the
                // add and go to confirm, coming back here — where the chrome adds it.
                authenticateFor('/verify-email', choice);
                return;
            default:
                break;
        }

        const cached = queryClient.getQueryData<Cart>(queryKeys.commerce.cart());
        if (holdsAnotherKitchen(cached, meal)) {
            setConflict({ ...choice, kitchenName: cached?.items[0]?.kitchenName });
            return;
        }
        commit(choice);
    };

    const dialog = (
        <>
            <Dialog
                testID={`${testID}-guest-entry-dialog`}
                open={asked !== null}
                onClose={() => {
                    setAsked(null);
                }}
                title={t('guest:entry.title')}
                actions={
                    <>
                        <Button
                            testID={`${testID}-guest-register`}
                            variant="secondary"
                            label={t('guest:entry.register')}
                            onPress={() => {
                                if (asked === null) return;
                                setAsked(null);
                                authenticateFor('/register', asked);
                            }}
                        />
                        <Button
                            testID={`${testID}-guest-sign-in`}
                            label={t('guest:entry.signIn')}
                            onPress={() => {
                                if (asked === null) return;
                                setAsked(null);
                                authenticateFor('/sign-in', asked);
                            }}
                        />
                    </>
                }
            />
            <Dialog
                testID={`${testID}-basket-conflict`}
                open={conflict !== null}
                onClose={() => {
                    setConflict(null);
                }}
                title={t('commerce:basketConflict.title')}
                {...(conflict?.kitchenName === undefined
                    ? {}
                    : {
                          description: t('commerce:basketConflict.body', {
                              kitchen: conflict.kitchenName,
                          }),
                      })}
                actions={
                    <>
                        <Button
                            testID={`${testID}-basket-conflict-keep`}
                            variant="secondary"
                            label={t('commerce:basketConflict.keep')}
                            onPress={() => {
                                setConflict(null);
                            }}
                        />
                        <Button
                            testID={`${testID}-basket-conflict-replace`}
                            label={t('commerce:basketConflict.replace')}
                            onPress={() => {
                                if (conflict === null) return;
                                setConflict(null);
                                commit(conflict, true);
                            }}
                        />
                    </>
                }
            />
        </>
    );

    return {
        add,
        pending: addToBasket.isPending || phase === 'restoring',
        errored: addToBasket.isError,
        failure: toFailure(addToBasket.error),
        dialog,
    };
}
