<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * The world the catalogue suites are set in: two kitchens, the reference data
 * they need, and the ingredients whose allergen mappings the derivation reads.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `RecipeWorld` gives: Pest loads every test file in the suite into one
 * process, and four files declaring `catalogueTenant()` would be a fatal
 * redeclaration rather than a test failure.
 *
 * Deliberately **not** a full `$this->seed()`. These suites need measurement
 * units, diet classifications, organisation types and the permission
 * catalogue; they do not need the 213-row platform ingredient library, the
 * demo tenants or the consent definitions.
 */
final class CatalogueWorld
{
    /**
     * The permissions a kitchen manager holds over the catalogue. Named as a
     * constant so a test that wants a caller *without* one of them can
     * subtract rather than re-list.
     *
     * @var list<string>
     */
    public const array FULL_PERMISSIONS = [
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
        'catalogue.publish_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
        'recipe.publish_organisation',
    ];

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
     * test that omits `catalogue.publish_organisation` really is testing a
     * caller who cannot publish.
     *
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = self::FULL_PERMISSIONS): object
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

        $catalogue = Catalogue::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => 'default',
        ]);

        return (object) compact('organisation', 'user', 'role', 'catalogue');
    }

    /**
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
    }

    public static function unit(string $code = 'kg'): string
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
     * An ingredient carrying one allergen determination at a stated strength.
     *
     * The containment is a parameter because the union rule — strongest wins —
     * cannot be tested without being able to state two different strengths for
     * one class.
     */
    public static function mappedIngredient(
        Organisation $organisation,
        string $name,
        string $allergenCode,
        AllergenContainment $containment = AllergenContainment::Contains,
    ): Ingredient {
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'name_en' => $name,
        ]);

        IngredientAllergen::withoutTenancy()->create([
            'ingredient_id' => $ingredient->getKey(),
            'organisation_id' => $organisation->getKey(),
            'allergen_code' => self::allergen($allergenCode)->code,
            'containment' => $containment,
            'market_scope' => 'all',
            'source' => 'kitchen_declared',
            'verification_status' => 'verified',
        ]);

        return $ingredient;
    }

    /**
     * A draft product with one active pack, which is the smallest thing the
     * publish gate accepts.
     */
    public static function publishableProduct(object $tenant, string $nameEn = 'Harissa paste'): CatalogueItem
    {
        $item = CatalogueItem::factory()->create([
            'catalogue_id' => $tenant->catalogue->getKey(),
            'organisation_id' => $tenant->organisation->getKey(),
            'name_en' => $nameEn,
            'name_ar' => 'معجون الهريسة',
        ]);

        $variant = $item->variants()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'variant_type' => 'pack',
            'code' => 'jar-250g',
            'is_default' => true,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $variant->pack()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'pack_quantity' => '0.2500',
            'pack_unit_id' => self::unit('kg'),
        ]);

        return $item;
    }
}
