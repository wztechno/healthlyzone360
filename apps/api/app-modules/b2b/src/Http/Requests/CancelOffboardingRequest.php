<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for calling a wind-up off.
 *
 * Required prose, for the same reason the waiver's is: `OffboardingService::cancel()`
 * refuses an empty one, and "why did we stop offboarding Acme" is a question
 * somebody asks when Acme is still trading eighteen months later.
 *
 * Cancelling is legal right up to the moment memberships start ending and not
 * afterwards. "Cancelling" a revocation would mean silently re-granting access
 * somebody deliberately removed, which is a different act needing a different
 * door — so a late attempt is `409 offboarding.refused` with
 * `allowed_transitions` naming what is actually still possible.
 */
class CancelOffboardingRequest extends FormRequest
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
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ];
    }
}
