<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Support\Enums\DataClassification;

/**
 * The only way a staff member reads somebody else's dietary profile.
 *
 * `DataClassification::SpecialCategory::requiresPurposeOfUse()` returns true,
 * and this class is what makes that requirement operational rather than
 * decorative: the purpose is a **required constructor argument of the read**,
 * so a caller cannot obtain the data without stating why. That is the same
 * design `AuditRecorder::recordAccess()` uses one layer down, for the same
 * reason — an access event that cannot say why it happened is not an audit
 * trail.
 *
 * **The customer's own reads do not come through here.** A person looking at
 * their own allergy list needs no purpose of use and generates no access
 * event; recording one per page view would bury the reads that matter under
 * thousands that do not. `DietaryProfileService::profileFor()` is the
 * self-service path.
 *
 * The returned shape carries codes and severities, never the free-text notes.
 * A kitchen deciding whether a meal is safe needs the classes and how serious
 * they are; what the customer wrote about their own health in a free-text box
 * is theirs, and there is no operational question it answers.
 */
final class DietaryProfileReader
{
    public function __construct(private readonly AuditRecorder $audit) {}

    /**
     * A staff-side view of a customer's declaration, audited.
     *
     * @return array{declared: bool, declares_no_allergens: bool, allergens: list<array{allergen_code: string, severity: string}>, exclusions: list<array{kind: string, subject: string}>}
     */
    public function read(CustomerAccount $account, PurposeOfUse $purpose, ?string $actorUserId = null): array
    {
        $profile = CustomerDietaryProfile::query()
            ->where('customer_account_id', $account->getKey())
            ->first();

        $this->audit->recordAccess(
            'customer.dietary_profile_read',
            $purpose,
            DataClassification::SpecialCategory,
            actorUserId: $actorUserId,
            subjectType: 'customer_account',
            subjectId: (string) $account->getKey(),
            metadata: ['declared' => $profile?->hasDeclared() ?? false],
        );

        if (! $profile instanceof CustomerDietaryProfile) {
            return ['declared' => false, 'declares_no_allergens' => false, 'allergens' => [], 'exclusions' => []];
        }

        return [
            'declared' => $profile->hasDeclared(),
            'declares_no_allergens' => $profile->declares_no_allergens,
            'allergens' => $this->allergens($profile),
            'exclusions' => $this->exclusions($profile),
        ];
    }

    /**
     * @return list<array{allergen_code: string, severity: string}>
     */
    private function allergens(CustomerDietaryProfile $profile): array
    {
        $allergens = [];

        $declarations = CustomerAllergenDeclaration::query()
            ->where('customer_dietary_profile_id', $profile->getKey())
            ->orderBy('allergen_code')
            ->get();

        foreach ($declarations as $declaration) {
            $allergens[] = [
                'allergen_code' => $declaration->allergen_code,
                'severity' => $declaration->severity->value,
            ];
        }

        return $allergens;
    }

    /**
     * @return list<array{kind: string, subject: string}>
     */
    private function exclusions(CustomerDietaryProfile $profile): array
    {
        $exclusions = [];

        $rows = CustomerFoodExclusion::query()
            ->where('customer_dietary_profile_id', $profile->getKey())
            ->orderBy('created_at')
            ->get();

        foreach ($rows as $exclusion) {
            $exclusions[] = [
                'kind' => $exclusion->kind->value,
                'subject' => $exclusion->subjectKind(),
            ];
        }

        return $exclusions;
    }
}
