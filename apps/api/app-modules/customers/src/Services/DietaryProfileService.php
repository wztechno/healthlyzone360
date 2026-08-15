<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Enums\FoodExclusionKind;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Support\Enums\DataClassification;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * The customer's own account of what they eat — written by them, for them.
 *
 * This is the **store of record** for the allergy declaration (appendix E).
 * The onboarding wizard pre-fills from it and writes back to it, and the meal
 * configurator prefers it over anything a person typed into a basket. One
 * answer in one place: a customer who declared a sesame allergy in their
 * account must not have to declare it again in a configurator, and a
 * configurator that held its own copy would eventually disagree with the
 * account.
 *
 * **Declaring is an act, and the act is recorded.** `declare()` stamps
 * `declared_at` whether or not any allergens were named, because "I have none"
 * is an answer. Nothing else sets that column — an allergen row added without
 * going through here would leave the profile looking unanswered, which is why
 * the writes are one method rather than three.
 *
 * The audit event records **counts and codes, never the notes**. How many
 * allergens somebody declared is operational; what they wrote in the free-text
 * box is special-category content, and an audit table is not where it belongs.
 */
final class DietaryProfileService
{
    public function __construct(private readonly AuditRecorder $audit) {}

    public function profileFor(CustomerAccount $account): CustomerDietaryProfile
    {
        $profile = CustomerDietaryProfile::query()
            ->where('customer_account_id', $account->getKey())
            ->first();

        if ($profile instanceof CustomerDietaryProfile) {
            return $profile;
        }

        return CustomerDietaryProfile::query()->create([
            'customer_account_id' => $account->getKey(),
            'declared_at' => null,
            'declares_no_allergens' => false,
            'created_by' => $account->user_id,
        ]);
    }

    /**
     * Record a complete declaration, replacing whatever was there.
     *
     * Replace rather than merge, and deliberately: a person removing an
     * allergy from the list means they no longer have it, and a merge would
     * make removal impossible through the ordinary path. The whole set is
     * therefore submitted every time, and the transaction makes "the old set
     * is gone and the new one is in" indivisible — a half-applied allergy list
     * is the one state this table must never be observed in.
     *
     * @param  list<array{allergen_code: string, severity?: string, notes?: string|null}>  $allergens
     * @param  list<array{kind?: string, ingredient_id?: string|null, diet_classification_id?: string|null, free_text?: string|null}>  $exclusions
     */
    public function declare(
        CustomerAccount $account,
        array $allergens,
        array $exclusions = [],
        ?string $dietClassificationId = null,
        ?string $religiousRequirement = null,
        ?string $notes = null,
        ?string $actorUserId = null,
    ): CustomerDietaryProfile {
        return DB::transaction(function () use (
            $account,
            $allergens,
            $exclusions,
            $dietClassificationId,
            $religiousRequirement,
            $notes,
            $actorUserId,
        ): CustomerDietaryProfile {
            $profile = $this->profileFor($account);
            $now = now();

            $profile->forceFill([
                'declared_at' => $now,
                'declares_no_allergens' => $allergens === [],
                'diet_classification_id' => $dietClassificationId,
                'religious_requirement' => $religiousRequirement,
                'notes' => $notes,
                'updated_by' => $actorUserId,
            ])->save();

            CustomerAllergenDeclaration::query()->where('customer_dietary_profile_id', $profile->getKey())->delete();
            CustomerFoodExclusion::query()->where('customer_dietary_profile_id', $profile->getKey())->delete();

            foreach ($allergens as $allergen) {
                CustomerAllergenDeclaration::query()->create([
                    'customer_dietary_profile_id' => $profile->getKey(),
                    'allergen_code' => $allergen['allergen_code'],
                    'severity' => AllergenSeverity::from($allergen['severity'] ?? AllergenSeverity::Allergy->value),
                    'notes' => $allergen['notes'] ?? null,
                    'declared_at' => $now,
                    'created_by' => $actorUserId,
                ]);
            }

            foreach ($exclusions as $exclusion) {
                $this->assertSingleSubject($exclusion);

                CustomerFoodExclusion::query()->create([
                    'customer_dietary_profile_id' => $profile->getKey(),
                    'kind' => FoodExclusionKind::from($exclusion['kind'] ?? FoodExclusionKind::Dislike->value),
                    'ingredient_id' => $exclusion['ingredient_id'] ?? null,
                    'diet_classification_id' => $exclusion['diet_classification_id'] ?? null,
                    'free_text' => $exclusion['free_text'] ?? null,
                    'declared_at' => $now,
                    'created_by' => $actorUserId,
                ]);
            }

            $this->audit->record(
                'customer.dietary_declaration_recorded',
                actorUserId: $actorUserId,
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: [
                    'classification' => DataClassification::SpecialCategory->value,
                    // `allergen_classes`, never `*_code`: the audit redactor
                    // matches `code` as a substring (OQ-036) and would blank
                    // the value, leaving a record that something was declared
                    // and refusing to say what.
                    'allergen_classes' => array_map(
                        static fn (array $allergen): string => $allergen['allergen_code'],
                        $allergens,
                    ),
                    'declares_no_allergens' => $allergens === [],
                    'exclusion_count' => count($exclusions),
                ],
                purposeOfUse: 'self_service',
            );

            return $profile->refresh();
        });
    }

    /**
     * @param  array{ingredient_id?: string|null, diet_classification_id?: string|null, free_text?: string|null}  $exclusion
     */
    private function assertSingleSubject(array $exclusion): void
    {
        $named = count(array_filter([
            $exclusion['ingredient_id'] ?? null,
            $exclusion['diet_classification_id'] ?? null,
            $exclusion['free_text'] ?? null,
        ], static fn (mixed $value): bool => $value !== null && $value !== ''));

        if ($named !== 1) {
            // The database CHECK would catch this, but a constraint violation
            // surfaces as a driver exception with no useful field attached.
            throw new InvalidArgumentException('A food exclusion must name exactly one of an ingredient, a diet classification or free text.');
        }
    }
}
