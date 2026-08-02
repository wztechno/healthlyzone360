<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use App\Models\User;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Enums\DocumentReviewStatus;
use Healthy360\B2b\Enums\DocumentScanStatus;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\KycDocument;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<KycDocument>
 */
class KycDocumentFactory extends Factory
{
    /** @var class-string<KycDocument> */
    protected $model = KycDocument::class;

    /**
     * An application-owned document. The default owner is the application
     * because that is the only owner kind B1 exercises end to end; the
     * `forUser()` and `forOrganisation()` states exist so the exactly-one
     * CHECK can be tested from all three sides.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => null,
            'b2b_application_id' => B2bApplication::factory(),
            'organisation_id' => null,
            'document_kind' => DocumentKind::CommercialRegistration,
            'disk' => 'private',
            'path' => 'kyc/b2b_application/'.Str::uuid7().'/'.Str::uuid7().'.pdf',
            'original_filename' => 'registration.pdf',
            'mime_type' => 'application/pdf',
            'declared_mime_type' => 'application/pdf',
            'byte_size' => 2048,
            'sha256' => hash('sha256', Str::random(32)),
            'scan_status' => DocumentScanStatus::NotScanned,
            'uploaded_by' => User::factory(),
            'uploaded_at' => now(),
            'review_status' => DocumentReviewStatus::Pending,
            'purge_after' => now()->addDays(1825),
        ];
    }

    public function forApplication(B2bApplication $application): self
    {
        return $this->state(fn (): array => [
            'user_id' => null,
            'b2b_application_id' => $application->getKey(),
            'organisation_id' => null,
        ]);
    }

    public function ofKind(DocumentKind $kind): self
    {
        return $this->state(fn (): array => ['document_kind' => $kind]);
    }

    /** Past its retention window — what the weekly purge job is looking for. */
    public function dueForPurge(): self
    {
        return $this->state(fn (): array => ['purge_after' => now()->subDay()]);
    }
}
