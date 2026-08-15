<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<CorporateProgramme>
 */
class CorporateProgrammeFactory extends Factory
{
    /** @var class-string<CorporateProgramme> */
    protected $model = CorporateProgramme::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'kitchen_organisation_id' => Organisation::factory(),
            'b2b_agreement_id' => B2bAgreement::factory(),
            'code' => 'programme-'.mb_strtolower(Str::random(8)),
            'name_en' => 'Corporate wellness programme',
            'name_ar' => 'برنامج العافية المؤسسي',
            'status' => 'active',
            'lock_version' => 0,
        ];
    }

    public function archived(): self
    {
        return $this->state(fn (): array => ['status' => 'archived']);
    }
}
