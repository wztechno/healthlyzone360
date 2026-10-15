<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * Where a record's photo is stored. See the `record_photos` migration.
 *
 * @property string $id
 * @property string $organisation_id
 * @property RecordPhotoSubject $subject_type
 * @property string $subject_id
 * @property string $disk
 * @property string $path
 * @property string $mime_type
 * @property int $byte_size
 * @property string $sha256
 * @property string|null $uploaded_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class RecordPhoto extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'subject_type' => RecordPhotoSubject::class,
            'byte_size' => 'integer',
        ];
    }
}
