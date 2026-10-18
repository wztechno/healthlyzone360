<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\RecordPhoto;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * GET /api/v1/media/photos/{photo} — the bytes of a record's photo (BUG-14).
 *
 * Public, because a customer's shop shows these and an `<img>` sends no token. What it exposes is
 * a picture a kitchen chose to put on its own record, named by an unguessable id. Each upload is a
 * new id, so the response is cached as immutable.
 */
final class RecordPhotoShowController
{
    public function __invoke(string $photo): Response
    {
        // Not an id at all is the same answer as an id nobody holds, rather than a query error.
        $record = Str::isUuid($photo) ? RecordPhoto::withoutTenancy()->whereKey($photo)->first() : null;

        // A "no picture" row has no file to serve.
        if ($record === null || ! $record->hasFile() || ! Storage::disk((string) $record->disk)->exists((string) $record->path)) {
            abort(404);
        }

        return Storage::disk((string) $record->disk)->response((string) $record->path, null, [
            'Content-Type' => $record->mime_type,
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
