<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;

/**
 * One .xlsx of at most 5 MB, sent as `file` in a multipart body.
 *
 * The extension is checked, not the sniffed type: an .xlsx is a zip, and finfo
 * reports it as `application/zip`. The content check is the reader's own open,
 * which refuses anything that is not a workbook with a 422 on `file`.
 */
final class ImportSpreadsheetRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
     */
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
            'file' => ['required', 'file', 'extensions:xlsx', 'max:5120'],
        ];
    }

    public function spreadsheet(): UploadedFile
    {
        /** @var UploadedFile $file */
        $file = $this->file('file');

        return $file;
    }
}
