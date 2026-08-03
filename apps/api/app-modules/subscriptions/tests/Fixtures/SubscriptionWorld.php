<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Tests\Fixtures;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Subscriptions\Services\NewSubscription;

/**
 * A kitchen that sells a subscription plan, and a customer who may buy it.
 *
 * Built **on** `CheckoutWorld` rather than beside it, for the reason that
 * fixture gives about `PricingWorld`: the orderable world — a priced channel, a
 * served address, an activated customer — is already solved there, and a second
 * copy would drift the first time an activation requirement changed. What is
 * added here is the plan itself: a `subscription_plan` item, one configuration
 * cell of its matrix, a fixed-day duration assigned to that cell, and a price
 * against the cell.
 *
 * A fixture class rather than Pest helper functions, for the reason every other
 * module world gives: Pest loads every test file into one process, and two
 * files declaring `subscriptionTenant()` would be a fatal redeclaration.
 */
final class SubscriptionWorld
{
    /**
     * A complete subscribable world.
     *
     * `$perDayMinor` is the tariff's per-day price *before* any duration
     * discount; `$discountPercent` is what the run takes off, and NULL is the
     * default because NULL is what an unstated discount means everywhere else.
     */
    public static function build(
        string $email = 'subscriber@kitchen.test',
        int $perDayMinor = 2000,
        ?string $discountPercent = null,
        int $days = 20,
    ): object {
        $world = CheckoutWorld::build($email);

        $plan = CatalogueItem::factory()->subscriptionPlan()->published()->create([
            'catalogue_id' => $world->tenant->catalogue->getKey(),
            'organisation_id' => $world->organisation->getKey(),
            'name_en' => 'Balanced 2 meals a day',
            'name_ar' => 'وجبتان يومياً',
        ]);

        $profile = SubscriptionPlanProfile::factory()->create([
            'catalogue_item_id' => $plan->getKey(),
            'organisation_id' => $world->organisation->getKey(),
            // This world's plan *is* a Free Selection one — the choices endpoint
            // is exercised against it — so the flag says so. It was left at the
            // column default while nothing read it; the quote now serves it, and
            // a fixture whose flag contradicted its own behaviour would make the
            // quote look wrong when it was right.
            'allows_free_selection' => true,
        ]);

        $configuration = CatalogueItemVariant::factory()->planConfiguration()->create([
            'catalogue_item_id' => $plan->getKey(),
            'organisation_id' => $world->organisation->getKey(),
            'code' => 'lunch-dinner-standard',
        ]);

        PlanVariantProfile::factory()->create([
            'catalogue_item_variant_id' => $configuration->getKey(),
            'organisation_id' => $world->organisation->getKey(),
            'catalogue_item_id' => $plan->getKey(),
        ]);

        $duration = PlanDuration::factory()->days($days)->create([
            'organisation_id' => $world->organisation->getKey(),
        ]);

        PlanVariantDuration::factory()->create([
            'catalogue_item_variant_id' => $configuration->getKey(),
            'organisation_id' => $world->organisation->getKey(),
            'plan_duration_id' => $duration->getKey(),
            'discount_percent' => $discountPercent,
            'is_available' => true,
        ]);

        CheckoutWorld::offer($world->channel, $plan, $configuration);
        PricingWorld::price($world->priceList, $plan, $configuration, $perDayMinor);

        return (object) array_merge((array) $world, compact('plan', 'profile', 'configuration', 'duration'));
    }

    /**
     * The request a customer's checkout would build.
     *
     * @param  list<int>  $weekdays  ISO; every day by default, so a test asserting about
     *                               balance arithmetic does not also have to reason about the calendar
     */
    public static function request(
        object $world,
        array $weekdays = [1, 2, 3, 4, 5, 6, 7],
        bool $noSubstitutions = false,
        ?CarbonImmutable $startFrom = null,
    ): NewSubscription {
        return new NewSubscription(
            account: $world->customer->account,
            address: $world->customer->address,
            salesChannelId: (string) $world->channel->getKey(),
            branchId: (string) $world->branch->getKey(),
            catalogueItemId: (string) $world->plan->getKey(),
            catalogueItemVariantId: (string) $world->configuration->getKey(),
            planDurationId: (string) $world->duration->getKey(),
            weekdays: $weekdays,
            deliveryWindowCode: null,
            noSubstitutions: $noSubstitutions,
            startFrom: $startFrom,
        );
    }

    /**
     * Give the world's customer a declared allergy.
     *
     * `CheckoutWorld::readyCustomer()` creates a profile that declares *no*
     * allergens, which is what makes them orderable; this replaces that answer
     * with a real declaration, because a declaration beside "I have none" is a
     * contradiction and the safety service reads the rows.
     */
    public static function declareAllergen(object $world, string $allergenCode): CustomerAllergenDeclaration
    {
        $profile = CustomerDietaryProfile::query()
            ->where('customer_account_id', $world->customer->account->getKey())
            ->firstOrFail();

        $profile->declares_no_allergens = false;
        $profile->save();

        return CustomerAllergenDeclaration::query()->create([
            'customer_dietary_profile_id' => $profile->getKey(),
            'allergen_code' => $allergenCode,
            'severity' => AllergenSeverity::Allergy,
            'declared_at' => CarbonImmutable::now(),
        ]);
    }
}
