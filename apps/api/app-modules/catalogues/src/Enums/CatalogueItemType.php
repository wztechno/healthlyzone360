<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * Which kind of sellable thing a catalogue item is.
 *
 * The discriminator that lets products, meals and subscription plans share
 * one table, one price path, one availability table and one publication gate
 * (appendix D). What genuinely differs between them is nullable columns and
 * child tables, not the whole apparatus around them.
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

    /**
     * Which variant kind belongs to this item type.
     *
     * A product is bought in packs; a plan is bought in configurations. A
     * meal has neither — it is sold as itself — which is why this returns
     * null rather than inventing a third variant kind nobody would populate.
     */
    public function variantType(): ?VariantType
    {
        return match ($this) {
            self::Product => VariantType::Pack,
            self::SubscriptionPlan => VariantType::PlanConfiguration,
            self::Meal => null,
        };
    }
}
