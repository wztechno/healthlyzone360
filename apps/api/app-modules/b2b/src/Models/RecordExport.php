<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\RecordExportStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A bundle of an organisation's own records — **shell; B2 builds them**.
 *
 * `disk` and `path` are hidden for exactly the reason they are on
 * `KycDocument`: an export is the most concentrated collection of one
 * company's data the platform will ever produce, and its object key must not
 * be serialisable by accident. The rule is copied deliberately rather than
 * inherited, because there is no shared parent and the next table that stores
 * bytes should copy it again.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $b2b_offboarding_id
 * @property RecordExportStatus $status
 * @property string $format
 * @property string|null $requested_by
 * @property CarbonImmutable $requested_at
 * @property CarbonImmutable|null $started_at
 * @property CarbonImmutable|null $completed_at
 * @property string|null $disk
 * @property string|null $path
 * @property int|null $byte_size
 * @property string|null $sha256
 * @property array<string, int>|null $row_counts
 * @property CarbonImmutable|null $expires_at
 * @property CarbonImmutable|null $downloaded_at
 * @property string|null $failure_reason
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'path', 'sha256')]
class RecordExport extends BaseModel
{
    /**
     * @var list<string>
     */
    protected $hidden = ['disk', 'path'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => RecordExportStatus::class,
            'row_counts' => 'array',
            'byte_size' => 'integer',
            'requested_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'downloaded_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return BelongsTo<B2bOffboarding, $this>
     */
    public function offboarding(): BelongsTo
    {
        return $this->belongsTo(B2bOffboarding::class, 'b2b_offboarding_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }
}
