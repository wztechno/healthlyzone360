<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $subject_type one of 'goods_receipt', 'production_order'
 * @property string $subject_id the id of the subject record
 * @property string $status one of 'pending', 'passed', 'hold', 'released'
 * @property string|null $notes
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class QualityCheck extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
