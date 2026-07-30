<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/auth/token — the native-client credential exchange.
 *
 * A device name and platform are mandatory: a token that cannot be attributed
 * to a device cannot be listed or revoked, which would defeat device
 * management entirely.
 */
class IssueTokenRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:255'],
            'platform' => ['required', 'string', Rule::in(['ios', 'android', 'web'])],
            'app_version' => ['nullable', 'string', 'max:64'],
            'two_factor_code' => ['nullable', 'string', 'max:32'],
            'recovery_code' => ['nullable', 'string', 'max:64'],
        ];
    }
}
