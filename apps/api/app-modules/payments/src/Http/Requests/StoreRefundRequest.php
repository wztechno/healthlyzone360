<?php

declare(strict_types=1);

namespace Healthy360\Payments\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class StoreRefundRequest extends FormRequest
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
            'amount_minor' => ['required', 'integer', 'min:1'],
        ];
    }

    public function amountMinor(): int
    {
        return (int) $this->validated('amount_minor');
    }
}
