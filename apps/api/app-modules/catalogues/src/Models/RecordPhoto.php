<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * Where a record's photo is stored. See the `record_photos` migrations.
 *
 * A row with no file (`path` null) is the kitchen saying "no picture": the record shows neither a
 * photo nor its stock picture.
 *
 * @property string $id
 * @property string $organisation_id
 * @property RecordPhotoSubject $subject_type
 * @property string $subject_id
 * @property string|null $disk
 * @property string|null $path
 * @property string|null $mime_type
 * @property int|null $byte_size
 * @property string|null $sha256
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

    /** False for a "no picture" row, which has nothing on a disk. */
    public function hasFile(): bool
    {
        return $this->disk !== null && $this->path !== null;
    }
}
