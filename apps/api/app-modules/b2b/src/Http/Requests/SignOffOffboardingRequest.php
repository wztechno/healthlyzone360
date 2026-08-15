<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for the signatory's acceptance of a wind-up.
 *
 * The same shape `SignAgreementRequest` uses on the way in, because the two
 * acts are mirror images and the evidence a court would be shown is the same
 * kind of thing: who accepted, in what capacity, the wording they accepted, and
 * — for a wind-up with a settlement statement attached — the digest of the
 * document they saw.
 *
 * **`otp_challenge_id` is required and is not proof.** It names a challenge;
 * `OffboardingService::signOff()` then demands that the challenge exists,
 * carries purpose `b2b_signatory`, has been *consumed*, and belongs to the
 * person signing. All four failures answer identically, so a caller holding
 * somebody else's challenge identifier learns only that it did not work. There
 * is no `otp_verified` field and there never will be — `OffboardingSignoff`
 * sets that flag only through `proved()`, because a flag a caller can assert
 * records its own claim rather than an observation.
 *
 * `consent_statement` is the exact wording shown on screen, echoed back rather
 * than looked up server-side. That is deliberate: the evidence has to be what
 * the person actually read, and a server-side lookup would record what the
 * current template says instead of what was in front of them.
 *
 * `document_sha256` is optional, because a wind-up may have no document beyond
 * the agreement already on file. When present it is checked for shape only —
 * whether it matches anything is not a question this layer can answer without
 * inventing a document store the wind-up does not have.
 */
class SignOffOffboardingRequest extends FormRequest
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
            'signatory_name' => ['required', 'string', 'max:160'],
            'signatory_title' => ['required', 'string', 'max:120'],
            'consent_statement' => ['required', 'string', 'max:2000'],
            'document_sha256' => ['nullable', 'string', 'size:64', 'regex:/^[0-9a-f]{64}$/'],
            'otp_challenge_id' => ['required', 'uuid'],
        ];
    }
}
