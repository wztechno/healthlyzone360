<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for withdrawing a catalogue item.
 *
 * One optional field. A reason is not required — a kitchen withdrawing a
 * seasonal line owes nobody an explanation — but where one is given it belongs
 * in the audit trail, because "why did this disappear" is the first question
 * asked six months later.
 */
class RetireCatalogueItemRequest extends FormRequest
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
            'reason' => ['nullable', 'string', 'max:200'],
        ];
    }
}
