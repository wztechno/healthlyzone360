<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for withdrawing a kitchen from trading.
 *
 * One optional field, and it is optional on purpose. Requiring a reason would
 * produce reasons — "n/a", "see ticket", "asked to" — and a column full of
 * those is worse than a column full of nulls, because it looks like it has
 * been filled in. The operator who has something to say says it; the audit
 * entry records the decision either way.
 *
 * Prose, not a code. See the migration that added the column for why a reason
 * vocabulary would not survive contact with the things people actually need to
 * write here.
 */
class SuspendKitchenOrganisationRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` and `platform.context`
     * middleware; a form request that also guessed would give two answers to
     * one question.
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
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function reason(): ?string
    {
        $reason = $this->validated('reason');

        return is_string($reason) && trim($reason) !== '' ? trim($reason) : null;
    }
}
