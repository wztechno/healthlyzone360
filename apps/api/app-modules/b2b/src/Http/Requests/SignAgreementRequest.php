<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a click-wrap signature on a corporate agreement.
 *
 * Every field here is **evidence**, and the rules are shaped by what a dispute
 * would need rather than by what a form is convenient to fill.
 *
 * `document_sha256` is the digest of the exact bytes the signatory was shown,
 * and the regex insists on sixty-four hexadecimal characters because anything
 * else is not a digest — a truncated or base64 value would be recorded, would
 * look plausible, and would prove nothing when it mattered.
 *
 * `consent_statement` is the wording verbatim rather than a version number.
 * A version is a pointer into a table somebody may later edit; the sentence
 * itself is what the person read, and it is the only form of it that survives
 * a redesign of the consent copy.
 *
 * `challenge_id` and `code` are the passcode half. The controller spends the
 * code before anything is written, and `AgreementService::sign()` then
 * independently demands a *consumed* `b2b_signatory` challenge belonging to
 * the person signing — a caller cannot assert its own proof, which is why
 * `SigningEvidence::$otpVerified` is false on everything this endpoint builds.
 *
 * There is no `signature_ip_hash` or `signature_user_agent_hash` field, and
 * there must not be: those are observations of the request, taken by the
 * server, and a client-supplied corroboration is not corroboration.
 */
class SignAgreementRequest extends FormRequest
{
    /**
     * Authorisation is ownership plus a proven passcode, and both are checked
     * where they can be enforced; a form request that also guessed would give
     * two answers to one question.
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
            'challenge_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'max:16'],
            'signatory_name' => ['required', 'string', 'max:160'],
            'signatory_title' => ['required', 'string', 'max:120'],
            'document_sha256' => ['required', 'string', 'regex:/^[0-9a-f]{64}$/i'],
            'consent_statement' => ['required', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array{
     *     challenge_id: string,
     *     code: string,
     *     signatory_name: string,
     *     signatory_title: string,
     *     document_sha256: string,
     *     consent_statement: string
     * }
     */
    public function payload(): array
    {
        /** @var array{challenge_id: string, code: string, signatory_name: string, signatory_title: string, document_sha256: string, consent_statement: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
