<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * The world the recipe suites are set in: two kitchens, the reference data
 * they need, and ingredients whose allergen determination the publish gate
 * cares about.
 *
 * A fixture class rather than Pest helper functions, because Pest loads every
 * test file in the suite into one process and three files declaring
 * `recipeTenant()` would be a fatal redeclaration rather than a test failure.
 * The tenancy module's `RuntimeRole` is the precedent.
 *
 * Deliberately **not** `$this->seed()`. The recipe suites need measurement
 * units, organisation types and the permission catalogue; they do not need the
 * 215-row platform ingredient library, the demo tenant or the consent
 * definitions, and seeding all of it on every one of ~40 tests is minutes of
 * wall clock spent proving nothing. Allergen classes come from the factory, so
 * a test that cares about a class can name the one it created.
 */
final class RecipeWorld
{
    /**
     * A kitchen organisation built on seeded reference data.
     *
     * Not `Organisation::factory()` unadorned: that factory invents a country,
     * a currency and a language, and inventing an ISO code on top of the ones
     * the seeder already wrote is a primary-key collision waiting to happen.
     */
    public static function organisation(): Organisation
    {
        return Organisation::factory()->create([
            'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
            'country_code' => 'LB',
            'default_currency_code' => 'USD',
            'default_language_code' => 'en',
        ]);
    }

    /**
     * A tenant whose user holds the named permissions and nothing else, so a
     * test that omits `recipe.publish_organisation` really is testing a caller
     * who cannot publish.
     *
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = [
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
        'recipe.publish_organisation',
    ]): object
    {
        $organisation = self::organisation();
        $user = User::factory()->create(['email' => $email]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'user_id' => $user->getKey(),
        ]);

        $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

        foreach ($permissions as $code) {
            RolePermission::factory()->create([
                'organisation_id' => $organisation->getKey(),
                'role_id' => $role->getKey(),
                'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
            ]);
        }

        MembershipRole::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        return (object) compact('organisation', 'user', 'role');
    }

    /**
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
    }

    public static function unit(string $code = 'g'): string
    {
        return (string) MeasurementUnit::query()->where('code', $code)->sole()->getKey();
    }

    public static function allergen(string $code): Allergen
    {
        return Allergen::query()->find($code) ?? Allergen::factory()->create([
            'code' => $code,
            'name_en' => ucfirst(str_replace('_', ' ', $code)),
        ]);
    }

    /**
     * An ingredient that carries an explicit allergen determination — the
     * shape the publish gate accepts.
     */
    public static function mappedIngredient(Organisation $organisation, string $name, string $allergenCode): Ingredient
    {
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'name_en' => $name,
        ]);

        IngredientAllergen::withoutTenancy()->create([
            'ingredient_id' => $ingredient->getKey(),
            'organisation_id' => $organisation->getKey(),
            'allergen_code' => self::allergen($allergenCode)->code,
            'containment' => AllergenContainment::Contains,
            'market_scope' => 'all',
            'source' => 'kitchen_declared',
            'verification_status' => 'verified',
        ]);

        return $ingredient;
    }

    /**
     * An ingredient with no mapping rows at all and no verification — the
     * "nobody has assessed this" case the publish gate refuses. Silence is not
     * a statement of absence.
     */
    public static function unmappedIngredient(Organisation $organisation, string $name): Ingredient
    {
        return Ingredient::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'name_en' => $name,
            'verification_status' => IngredientVerificationStatus::Unverified,
        ]);
    }

    /**
     * An ingredient checked and found to carry nothing. Zero mapping rows,
     * but `verified` — which is how the absence was recorded.
     */
    public static function verifiedCleanIngredient(Organisation $organisation, string $name): Ingredient
    {
        return Ingredient::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'name_en' => $name,
            'verification_status' => IngredientVerificationStatus::Verified,
        ]);
    }

    /**
     * The burghul/pita case (appendix D risk R1): the source workbook tags it
     * allergen-free while its own allergen key does not, so it is recorded as
     * a contradiction awaiting a human rather than resolved silently.
     */
    public static function quarantinedIngredient(Organisation $organisation, string $name): Ingredient
    {
        return Ingredient::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'name_en' => $name,
            'verification_status' => IngredientVerificationStatus::RequiresReview,
        ]);
    }
}
