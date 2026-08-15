<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\KycDocumentFactory;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Enums\DocumentRejectionReason;
use Healthy360\B2b\Enums\DocumentReviewStatus;
use Healthy360\B2b\Enums\DocumentScanStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An identity, registration or licensing document, on the private disk.
 *
 * **`disk` and `path` are hidden, and that is a security control rather than a
 * tidiness preference.** Array and JSON casts of this model are what a
 * presenter, a log line, an audit metadata bag and a debugging `dd()` all
 * reach for, and any one of them leaking the object key turns "you need a
 * signed URL" into "you need the bucket name". Hiding them at the model means
 * the leak has to be written deliberately — `getAttribute('path')` — rather
 * than happening by default. The B1 suite asserts it.
 *
 * There is deliberately **no `url()` method and no accessor that builds one**.
 * `KycDocumentService::temporaryUrl()` is the only route to the bytes, it
 * expires, and it records who asked.
 *
 * Classified `Confidential`. Not `SpecialCategory`: these are identity and
 * commercial documents, not health data, and inflating the classification
 * would blunt the distinction the clinical modules will need. The handling is
 * strict for reasons of its own, stated in the migration.
 *
 * @property string $id
 * @property string|null $user_id
 * @property string|null $b2b_application_id
 * @property string|null $organisation_id
 * @property DocumentKind $document_kind
 * @property string $disk
 * @property string $path
 * @property string $original_filename
 * @property string $mime_type
 * @property string|null $declared_mime_type
 * @property int $byte_size
 * @property string $sha256
 * @property DocumentScanStatus $scan_status
 * @property string|null $uploaded_by
 * @property CarbonImmutable $uploaded_at
 * @property DocumentReviewStatus $review_status
 * @property string|null $reviewed_by
 * @property CarbonImmutable|null $reviewed_at
 * @property DocumentRejectionReason|null $rejection_reason
 * @property string|null $review_note
 * @property CarbonImmutable|null $expires_on
 * @property CarbonImmutable $purge_after
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'path', 'original_filename', 'sha256')]
class KycDocument extends BaseModel
{
    /** @use HasFactory<KycDocumentFactory> */
    use HasFactory;

    /**
     * Never serialised. The object key is the one attribute on this model that
     * turns knowledge of a row into access to a passport scan.
     *
     * @var list<string>
     */
    protected $hidden = ['disk', 'path'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'document_kind' => DocumentKind::class,
            'review_status' => DocumentReviewStatus::class,
            'rejection_reason' => DocumentRejectionReason::class,
            'scan_status' => DocumentScanStatus::class,
            'byte_size' => 'integer',
            'uploaded_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'expires_on' => 'immutable_date',
            'purge_after' => 'immutable_datetime',
        ];
    }

    /**
     * Which of the three owner columns is set. Never a stored `owner_type` —
     * the database checks exactly one is present, so this is derived from the
     * truth rather than kept alongside it.
     */
    public function ownerKind(): string
    {
        return match (true) {
            $this->b2b_application_id !== null => 'b2b_application',
            $this->organisation_id !== null => 'organisation',
            default => 'user',
        };
    }

    /** Whether the document's own validity date has passed. */
    public function hasExpired(?CarbonImmutable $on = null): bool
    {
        return $this->expires_on !== null && $this->expires_on->lessThan($on ?? CarbonImmutable::now());
    }

    /**
     * @return BelongsTo<B2bApplication, $this>
     */
    public function application(): BelongsTo
    {
        return $this->belongsTo(B2bApplication::class, 'b2b_application_id');
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class, 'organisation_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
