import type {
    LocalisedText,
    PublishableStatus,
    RecipeSellerKind,
} from '@healthy360/api-client/contracts';
import { MealId, ProductId } from '@healthy360/domain-types';
import { useCallback } from 'react';

import {
    usePublishMealMutation,
    usePublishProductMutation,
    useUpdateMealMutation,
    useUpdateProductMutation,
} from '../../data/kitchen-admin-hooks.ts';
import { useRepositories } from '../../data/repository-provider.tsx';

/** One catalogue item that sells a recipe, as far as the recipe page writes it. */
export interface ListingSeller {
    readonly id: string;
    readonly itemType: RecipeSellerKind;
    readonly status: PublishableStatus;
    readonly name: LocalisedText;
}

/** The customer-facing text the recipe's Description tab owns. */
export interface ListingText {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
}

function sameText(a: LocalisedText, b: LocalisedText) {
    return a.en.trim() === b.en.trim() && (a.ar ?? '').trim() === (b.ar ?? '').trim();
}

/**
 * The recipe page writes its sellers' listings itself — there is no Selling tab any more.
 *
 * - `write` puts the recipe's name and description on every item that sells it, so the admin and
 *   the web shop read what the Description tab says. An item already saying it is left alone.
 * - `publish` puts every draft seller on sale. Where it sells is the Packs & prices tab's ticks, and
 *   the recipe's own Publish refuses until a place is ticked and priced, so a published recipe's
 *   items are ready to go on sale with it.
 *
 * Each write reads the item first, so it quotes the item's current lock version — the packs save
 * may have moved it a moment before. Both answer whether every write went through.
 */
export function useRecipeListingSync() {
    const repositories = useRepositories();
    const updateMeal = useUpdateMealMutation();
    const updateProduct = useUpdateProductMutation();
    const publishMeal = usePublishMealMutation();
    const publishProduct = usePublishProductMutation();

    const write = useCallback(
        async (sellers: readonly ListingSeller[], text: ListingText): Promise<boolean> => {
            try {
                for (const seller of sellers) {
                    if (seller.itemType === 'meal') {
                        const mealId = MealId.unsafe(seller.id);
                        const fresh = await repositories.kitchenAdmin.getMeal(mealId);
                        if (
                            sameText(fresh.name, text.name) &&
                            sameText(fresh.description, text.description)
                        ) {
                            continue;
                        }
                        await updateMeal.mutateAsync({
                            mealId,
                            request: {
                                lockVersion: fresh.meta.lockVersion,
                                name: text.name,
                                description: text.description,
                            },
                        });
                    } else {
                        const productId = ProductId.unsafe(seller.id);
                        const fresh = await repositories.kitchenAdmin.getProduct(productId);
                        if (
                            sameText(fresh.name, text.name) &&
                            sameText(fresh.description, text.description)
                        ) {
                            continue;
                        }
                        await updateProduct.mutateAsync({
                            productId,
                            request: {
                                lockVersion: fresh.meta.lockVersion,
                                name: text.name,
                                description: text.description,
                            },
                        });
                    }
                }
                return true;
            } catch {
                return false;
            }
        },
        [repositories, updateMeal, updateProduct],
    );

    const publish = useCallback(
        async (sellers: readonly ListingSeller[]): Promise<boolean> => {
            try {
                for (const seller of sellers) {
                    if (seller.status !== 'draft') continue;
                    if (seller.itemType === 'meal') {
                        const mealId = MealId.unsafe(seller.id);
                        const fresh = await repositories.kitchenAdmin.getMeal(mealId);
                        await publishMeal.mutateAsync({
                            mealId,
                            request: { lockVersion: fresh.meta.lockVersion },
                        });
                    } else {
                        const productId = ProductId.unsafe(seller.id);
                        const fresh = await repositories.kitchenAdmin.getProduct(productId);
                        await publishProduct.mutateAsync({
                            productId,
                            request: { lockVersion: fresh.meta.lockVersion },
                        });
                    }
                }
                return true;
            } catch {
                return false;
            }
        },
        [repositories, publishMeal, publishProduct],
    );

    return { write, publish };
}
