<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

use Healthy360\Catalogues\Models\CatalogueItem;

/**
 * Which kind of sellable thing a catalogue item is.
 *
 * The discriminator that lets products, meals and subscription plans share
 * one table, one price path, one availability table and one publication gate
 * (appendix D). What genuinely differs between them is nullable columns and
 * child tables, not the whole apparatus around them.
 *
 * `FrozenMeal` is a *type* and `sells_from_finished_stock` is a *behaviour*,
 * and the two are not the same question. A frozen meal is its own family — its
 * own listing, its own pack variants — and it always sells from finished stock.
 * A prepared salad made in advance sells from finished stock too and is still a
 * meal, so it sets the flag rather than acquiring a type. Giving each production
 * style its own enum member would have grown this column one case at a time
 * while leaving "was this made in advance?" implicit; see
 * {@see CatalogueItem::sellsFromFinishedStock()},
 * which is the one predicate the consumption path branches on.
 *
 * The frontend contract keeps three separate branded identifiers
 * (`ProductId`, `MealId`, `SubscriptionPlanId`) precisely so they cannot be
 * transposed at the one place it matters most — pricing. That is a *type*
 * distinction on the wire, not a storage one, and this column is what a
 * presenter reads to decide which brand a client should see.
 */
enum CatalogueItemType: string
{
    case Product = 'product';
    case Meal = 'meal';
    case SubscriptionPlan = 'subscription_plan';
    case Sauce = 'sauce';
    case Dressing = 'dressing';
    case FrozenMeal = 'frozen_meal';

    /**
     * Which variant kind belongs to this item type.
     *
     * A product is bought in packs — and so are sauces, dressings and frozen
     * meals, which sell in B2B and B2C pack sizes exactly like any other
     * packaged good. A plan is bought in configurations. A meal has neither — it
     * is sold as itself — which is why this returns null rather than inventing a
     * third variant kind nobody would populate.
     */
    public function variantType(): ?VariantType
    {
        return match ($this) {
            self::Product, self::Sauce, self::Dressing, self::FrozenMeal => VariantType::Pack,
            self::SubscriptionPlan => VariantType::PlanConfiguration,
            self::Meal => null,
        };
    }

    /**
     * Whether a sale of this type draws finished stock rather than exploding a
     * recipe, given the item's own opt-in flag (PROD1).
     *
     * The type→behaviour half of the rule, kept here so the **validator** and the
     * **model** read one copy of it. {@see CatalogueItem::sellsFromFinishedStock()}
     * answers the same question about a hydrated row; this answers it about a
     * type and a flag, which is what a write has in its hands before there is a
     * row to ask.
     *
     * Products, sauces, dressings and frozen meals are always the second kind —
     * what they were before the column existed, and why they are listed rather
     * than made to carry a flag. A subscription plan is neither: its zero-food
     * day line consumes nothing, and the real lines generated beside it do the
     * consuming.
     */
    public function sellsFromFinishedStock(bool $flag): bool
    {
        return match ($this) {
            self::Product, self::Sauce, self::Dressing, self::FrozenMeal => true,
            self::SubscriptionPlan => false,
            self::Meal => $flag,
        };
    }
}
