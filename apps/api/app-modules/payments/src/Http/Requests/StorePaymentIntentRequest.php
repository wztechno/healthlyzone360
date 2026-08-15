<?php

declare(strict_types=1);

namespace Healthy360\Payments\Http\Requests;

use Healthy360\Payments\Enums\PaymentMethodKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StorePaymentIntentRequest extends FormRequest
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
            'order_id' => ['required', 'uuid'],
            'method_kind' => ['required', Rule::enum(PaymentMethodKind::class)],
        ];
    }

    /**
     * @return array{order_id: string, method_kind: PaymentMethodKind}
     */
    public function payload(): array
    {
        /** @var array{order_id: string, method_kind: string} $validated */
        $validated = $this->validated();

        return [
            'order_id' => $validated['order_id'],
            'method_kind' => PaymentMethodKind::from($validated['method_kind']),
        ];
    }
}
