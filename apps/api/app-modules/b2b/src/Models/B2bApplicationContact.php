<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\ApplicationContactRole;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A person an applicant company named. Transcribed paperwork, not a verified
 * destination — see the migration for why this is not a contact point.
 *
 * @property string $id
 * @property string $b2b_application_id
 * @property ApplicationContactRole $role
 * @property string $name
 * @property string|null $title
 * @property string|null $email
 * @property string|null $phone
 * @property string|null $notes
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'name', 'email', 'phone')]
class B2bApplicationContact extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => ApplicationContactRole::class,
        ];
    }

    /**
     * @return BelongsTo<B2bApplication, $this>
     */
    public function application(): BelongsTo
    {
        return $this->belongsTo(B2bApplication::class, 'b2b_application_id');
    }
}
