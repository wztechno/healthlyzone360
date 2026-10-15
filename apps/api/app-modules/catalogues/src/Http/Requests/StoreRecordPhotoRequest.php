<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;

/**
 * One photo for a record (BUG-14): a JPEG, PNG or WebP of at most 5 MB, sent as `photo` in a
 * multipart body. The type is checked from the file's own bytes (`mimes` sniffs the content), not
 * from its name.
 */
final class StoreRecordPhotoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'photo' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ];
    }

    public function photo(): UploadedFile
    {
        /** @var UploadedFile $file */
        $file = $this->file('photo');

        return $file;
    }
}
