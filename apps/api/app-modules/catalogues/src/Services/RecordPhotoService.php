<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Catalogues\Models\RecordPhoto;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * A kitchen's own photo of a record — stored, replaced, removed, and turned into a link (BUG-14).
 *
 * The link is `GET /api/v1/media/photos/{id}`: same origin as the app, public, and named by the
 * row's id, so a customer card and an admin list read the same bytes. Each upload is a new row id,
 * so a replaced photo is a new URL and the old one can be cached for good.
 *
 * Links are looked up a whole subject at a time and kept for the request, so a list of a hundred
 * records costs one query, not a hundred.
 */
final class RecordPhotoService
{
    /** @var array<string, array<string, string>> subject → subject id → photo id */
    private array $loaded = [];

    public function __construct(private readonly TenantContext $context) {}

    /**
     * Store `$file` as the record's photo, replacing any earlier one.
     *
     * The caller has already proved the record exists in this organisation.
     */
    public function store(RecordPhotoSubject $subject, string $subjectId, UploadedFile $file): RecordPhoto
    {
        $disk = $this->disk();
        $extension = $this->extensionFor((string) $file->getMimeType());
        $directory = sprintf('record-photos/%s/%s/%s', $this->context->organisationId(), $subject->value, $subjectId);
        $name = Str::uuid7()->toString().'.'.$extension;
        $path = $directory.'/'.$name;

        Storage::disk($disk)->putFileAs($directory, $file, $name, ['visibility' => 'private']);

        $previous = $this->find($subject, $subjectId);

        $photo = DB::transaction(function () use ($previous, $subject, $subjectId, $disk, $path, $file): RecordPhoto {
            $previous?->delete();

            return RecordPhoto::query()->create([
                'subject_type' => $subject,
                'subject_id' => $subjectId,
                'disk' => $disk,
                'path' => $path,
                'mime_type' => (string) $file->getMimeType(),
                'byte_size' => (int) $file->getSize(),
                'sha256' => (string) hash_file('sha256', $file->getRealPath()),
                'uploaded_by' => $this->context->userId(),
            ]);
        });

        if ($previous !== null) {
            Storage::disk($previous->disk)->delete($previous->path);
        }

        unset($this->loaded[$subject->value]);

        return $photo;
    }

    /** Remove the record's photo, if it has one. */
    public function remove(RecordPhotoSubject $subject, string $subjectId): void
    {
        $photo = $this->find($subject, $subjectId);

        if ($photo === null) {
            return;
        }

        $photo->delete();
        Storage::disk($photo->disk)->delete($photo->path);

        unset($this->loaded[$subject->value]);
    }

    /** The record's photo link, or `null` when it has none. */
    public function urlFor(RecordPhotoSubject $subject, ?string $subjectId): ?string
    {
        if ($subjectId === null) {
            return null;
        }

        if (! isset($this->loaded[$subject->value])) {
            /** @var array<string, string> $ids */
            $ids = RecordPhoto::withoutTenancy()
                ->where('subject_type', $subject->value)
                ->pluck('id', 'subject_id')
                ->all();
            $this->loaded[$subject->value] = $ids;
        }

        $photoId = $this->loaded[$subject->value][$subjectId] ?? null;

        return $photoId === null ? null : route('media.photos.show', ['photo' => $photoId]);
    }

    public function link(RecordPhoto $photo): string
    {
        return route('media.photos.show', ['photo' => $photo->getKey()]);
    }

    private function find(RecordPhotoSubject $subject, string $subjectId): ?RecordPhoto
    {
        return RecordPhoto::query()
            ->where('subject_type', $subject->value)
            ->where('subject_id', $subjectId)
            ->first();
    }

    private function disk(): string
    {
        return (string) config('filesystems.record_photos_disk', 'local');
    }

    private function extensionFor(string $mime): string
    {
        return match ($mime) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg',
        };
    }
}
