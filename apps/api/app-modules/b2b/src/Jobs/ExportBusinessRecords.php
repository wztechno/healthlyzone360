<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use Healthy360\B2b\Enums\RecordExportStatus;
use Healthy360\B2b\Models\RecordExport;
use Healthy360\B2b\Services\ExportService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Assemble one company's records into a bundle.
 *
 * Queued rather than done in the request because building an export reads an
 * organisation's whole history — memberships, every agreement version, the
 * application, the KYC list, consents and the audit extract — hashes each
 * part, zips it and streams it to the private disk. A request that did that
 * would take as long as the company has been a customer.
 *
 * **Not idempotent by construction, idempotent by guard.** A retry that found
 * the export already `ready` would build a second bundle and leave the first
 * one's bytes in the bucket with nothing pointing at them, so the status is
 * checked first. A row in `failed` is deliberately *not* retried here either:
 * the failure is recorded with its reason, and re-requesting is a decision
 * somebody makes rather than something a queue does repeatedly.
 */
final class ExportBusinessRecords implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly string $exportId)
    {
        $this->onQueue('maintenance');
    }

    public function handle(ExportService $exports): void
    {
        $export = RecordExport::query()->whereKey($this->exportId)->first();

        if (! $export instanceof RecordExport) {
            return;
        }

        if ($export->status !== RecordExportStatus::Requested) {
            return;
        }

        $exports->build($export);
    }
}
