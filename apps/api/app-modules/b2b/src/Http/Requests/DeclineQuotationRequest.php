<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class DeclineQuotationRequest extends FormRequest
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
            'reason' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function reason(): ?string
    {
        /** @var array{reason?: string|null} $validated */
        $validated = $this->validated();

        return $validated['reason'] ?? null;
    }
}
