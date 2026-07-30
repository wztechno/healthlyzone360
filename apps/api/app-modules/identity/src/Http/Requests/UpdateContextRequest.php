<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape-only validation for PUT /api/v1/me/context. Whether the identifiers
 * may actually be used is decided server-side by Tenancy\ContextValidator —
 * a well-formed identifier is not an authorised one.
 */
class UpdateContextRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'organisation_id' => ['required', 'uuid'],
            'branch_id' => ['nullable', 'uuid'],
        ];
    }
}
