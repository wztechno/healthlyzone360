<?php

declare(strict_types=1);

use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Services\DocumentOwner;
use Healthy360\B2b\Services\KycDocumentService;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| Identity documents stay private, and the path stays inside the server
|--------------------------------------------------------------------------
|
| The single always-on net for B1's document handling (SPEED MODE: the wider
| suite is on the deferred list in the hand-over). It asserts the four claims
| the whole design rests on, because each one is invisible in review and
| catastrophic in production:
|
|  1. The `private` disk cannot mint a permanent URL — it declares none.
|  2. Bytes land on the private disk and nowhere else.
|  3. The object key is never serialised, whatever a presenter does.
|  4. What a file *claims* to be does not decide what it *is*.
|
| Plus the retention sweep, because a purge that deleted the row and left the
| object would be a data-protection failure that nothing else would notice.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);

    Storage::fake('private');
    Storage::fake('public');

    $this->applicant = B2bWorld::applicant();
    $this->application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);
    $this->owner = DocumentOwner::application($this->application);
    $this->documents = app(KycDocumentService::class);
});

it('configures the private disk with no URL at all', function (): void {
    // The structural reason `Storage::disk('private')->url()` is never the
    // route to a document: there is no URL to configure into existence. A
    // deployment that added one would fail here, which is the review trigger.
    $disk = config('filesystems.disks.private');

    expect($disk)->toBeArray()
        ->and($disk)->not->toHaveKey('url')
        ->and($disk['visibility'])->toBe('private')
        ->and($disk['throw'])->toBeTrue();
});

it('stores an accepted document on the private disk and nowhere else', function (): void {
    $document = $this->documents->store(
        B2bWorld::pdfUpload(),
        $this->owner,
        DocumentKind::CommercialRegistration,
        $this->applicant,
    );

    Storage::disk('private')->assertExists($document->path);

    expect($document->disk)->toBe('private')
        ->and($document->mime_type)->toBe('application/pdf')
        ->and($document->sha256)->toHaveLength(64)
        ->and($document->scan_status->isKnownSafe())->toBeFalse()
        // The uploader's filename is kept to read, never to locate: the path
        // is composed from a fresh identifier, so a traversal attempt or a
        // collision cannot reach the bucket.
        ->and($document->path)->not->toContain('registration.pdf')
        ->and(Storage::disk('public')->allFiles())->toBe([]);
});

it('never serialises the disk or the path', function (): void {
    $document = $this->documents->store(
        B2bWorld::pdfUpload(),
        $this->owner,
        DocumentKind::CommercialRegistration,
        $this->applicant,
    );

    $array = $document->toArray();
    $json = (string) json_encode($document);

    expect($array)->not->toHaveKey('path')
        ->and($array)->not->toHaveKey('disk')
        ->and($json)->not->toContain($document->path)
        ->and($json)->not->toContain('"disk"');

    // And after a round trip through the database, because a fresh instance is
    // what a presenter actually holds.
    $reloaded = KycDocument::query()->findOrFail($document->getKey());

    expect($reloaded->toArray())->not->toHaveKey('path')
        ->and($reloaded->toArray())->not->toHaveKey('disk');
});

it('believes the bytes rather than the upload when they disagree', function (): void {
    // A Windows executable renamed `.pdf` and posted as `application/pdf`.
    // Sniffing is not scanning — nothing here claims the file is safe — but a
    // file the platform cannot identify must never reach a reviewer's browser
    // while malware scanning is still gated (INT-008).
    $store = fn () => $this->documents->store(
        B2bWorld::disguisedExecutable(),
        $this->owner,
        DocumentKind::CommercialRegistration,
        $this->applicant,
    );

    expect($store)->toThrow(ApiException::class);

    expect(KycDocument::query()->count())->toBe(0)
        ->and(Storage::disk('private')->allFiles())->toBe([]);
});

it('returns the existing row when the same bytes arrive twice', function (): void {
    // A retried upload — a flaky connection, a double-tapped button — is one
    // document, not a duplicate the reviewer has to reconcile.
    $first = $this->documents->store(B2bWorld::pdfUpload(), $this->owner, DocumentKind::CommercialRegistration, $this->applicant);
    $second = $this->documents->store(B2bWorld::pdfUpload(), $this->owner, DocumentKind::CommercialRegistration, $this->applicant);

    expect($second->getKey())->toBe($first->getKey())
        ->and(KycDocument::query()->count())->toBe(1);
});

it('deletes the object as well as the row when retention runs out', function (): void {
    $document = $this->documents->store(
        B2bWorld::pdfUpload(),
        $this->owner,
        DocumentKind::CommercialRegistration,
        $this->applicant,
    );

    $path = $document->path;

    // Not yet due: the sweep must not take documents inside their window.
    expect($this->documents->purgeExpired())->toBe(0);
    Storage::disk('private')->assertExists($path);

    $document->forceFill(['purge_after' => now()->subDay()])->save();

    expect($this->documents->purgeExpired())->toBe(1);

    Storage::disk('private')->assertMissing($path);
    expect(KycDocument::query()->whereKey($document->getKey())->exists())->toBeFalse();
});
