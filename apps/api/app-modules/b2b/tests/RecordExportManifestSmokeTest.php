<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Enums\RecordExportStatus;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Services\ExportService;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| An export says what it contains, and does not contain the passports
|--------------------------------------------------------------------------
|
| The one always-on net for B2's record export (SPEED MODE; the wider suite is
| on the deferred list in the hand-over). Four claims, each invisible in review
| and each serious if it silently stops being true:
|
|  1. The bundle lands on the **private** disk and its digest is the digest of
|     the bytes that landed.
|  2. The manifest names every file with its own digest and row count, so a
|     recipient can verify one part without the whole.
|  3. Identity documents are listed as **metadata and digests**, never as
|     files. A ZIP full of passports travelling by signed URL would undo every
|     control the KYC path has.
|  4. What is absent is **declared**. An export that quietly lacked an orders
|     file would look complete to somebody who did not know to expect one.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);

    Storage::fake('private');
    Storage::fake('public');

    $this->world = B2bWorld::provisionedWorld();
    $this->organisation = $this->world['organisation'];
    $this->operator = B2bWorld::reviewer();
    $this->exports = app(ExportService::class);
});

it('builds a fingerprinted bundle on the private disk whose manifest describes every part', function (): void {
    B2bWorld::member($this->organisation, User::factory()->create(['email' => 'member@acme.test']));

    KycDocument::factory()
        ->forApplication($this->world['application'])
        ->ofKind(DocumentKind::CommercialRegistration)
        ->create();

    // QUEUE_CONNECTION is `sync` under test, so the build job runs here.
    $export = $this->exports->request($this->organisation, $this->operator)->refresh();

    expect($export->status)->toBe(RecordExportStatus::Ready)
        ->and($export->disk)->toBe('private')
        ->and($export->sha256)->toHaveLength(64)
        ->and($export->expires_at)->not->toBeNull();

    Storage::disk('private')->assertExists($export->path);
    expect(Storage::disk('public')->allFiles())->toBe([]);

    // The digest on the row is the digest of the bytes that landed, not of
    // something assembled in memory and hoped to be identical.
    $bytes = Storage::disk('private')->get($export->path);
    expect(hash('sha256', (string) $bytes))->toBe($export->sha256);

    $manifest = $export->manifest;

    expect($manifest)->toBeArray()
        ->and($manifest['organisation_id'])->toBe((string) $this->organisation->getKey());

    $filenames = array_column($manifest['files'], 'file');

    expect($filenames)->toContain(
        'organisation.json',
        'memberships.json',
        'agreements.json',
        'application.json',
        'locations.json',
        'kyc-documents.json',
        'consent-grants.json',
        'audit-log.json',
    );

    foreach ($manifest['files'] as $file) {
        expect($file['sha256'])->toHaveLength(64)
            ->and($file['byte_size'])->toBeGreaterThan(0);
    }

    // Row counts are the honesty column B1 added the field for.
    expect($manifest['row_counts']['memberships'])->toBe(1)
        ->and($manifest['row_counts']['agreements'])->toBe(1)
        ->and($manifest['row_counts']['kyc_documents'])->toBe(1);

    // What is missing is named, with reasons — never quietly omitted.
    $absent = array_column($manifest['absent'], 'record_kind');
    expect($absent)->toContain('orders', 'invoices', 'payments', 'kyc_document_files');
});

it('lists identity documents by digest and never puts their bytes in the bundle', function (): void {
    $document = KycDocument::factory()
        ->forApplication($this->world['application'])
        ->ofKind(DocumentKind::CommercialRegistration)
        ->create();

    $export = $this->exports->request($this->organisation, $this->operator)->refresh();

    $archive = new ZipArchive;
    $localCopy = tempnam(sys_get_temp_dir(), 'h360exporttest');
    file_put_contents((string) $localCopy, (string) Storage::disk('private')->get($export->path));
    $archive->open((string) $localCopy);

    $entries = [];
    for ($i = 0; $i < $archive->numFiles; $i++) {
        $entries[] = (string) $archive->getNameIndex($i);
    }

    $kycEntry = (string) $archive->getFromName('kyc-documents.json');
    $manifestEntry = (string) $archive->getFromName('manifest.json');
    $archive->close();
    @unlink((string) $localCopy);

    // Nothing in the archive is a document. Every entry is a JSON description.
    expect($entries)->toHaveCount(9)
        ->and(array_filter($entries, static fn (string $name): bool => ! str_ends_with($name, '.json')))->toBe([]);

    $listed = json_decode($kycEntry, true);

    expect($listed)->toHaveCount(1)
        ->and($listed[0]['sha256'])->toBe($document->sha256)
        ->and($listed[0]['document_kind'])->toBe(DocumentKind::CommercialRegistration->value)
        // The object key is the one attribute that turns knowledge of a row
        // into access to a passport scan. It is not in the bundle, and neither
        // is the disk it lives on.
        ->and($listed[0])->not->toHaveKey('path')
        ->and($listed[0])->not->toHaveKey('disk');

    expect($manifestEntry)->not->toContain($document->path)
        ->and($kycEntry)->not->toContain($document->path);
});
