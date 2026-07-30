<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Factories;

use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\Language;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Organisation>
 */
class OrganisationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->company();

        return [
            'organisation_type_id' => OrganisationType::factory(),
            'name' => $name,
            'slug' => Str::slug($name).'-'.Str::lower(Str::random(6)),
            'country_code' => Country::factory(),
            'default_currency_code' => Currency::factory(),
            'default_language_code' => Language::factory(),
            'status' => OrganisationStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function suspended(): static
    {
        return $this->state(fn (array $attributes) => ['status' => OrganisationStatus::Suspended]);
    }

    public function pending(): static
    {
        return $this->state(fn (array $attributes) => ['status' => OrganisationStatus::Pending]);
    }
}
