<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for approving a B2B application.
 *
 * Both fields are optional, and the asymmetry with a decline is deliberate: a
 * refusal has to tell the applicant something they can act on, whereas an
 * approval is self-explanatory and demanding a sentence would produce
 * "approved" typed four hundred times.
 *
 * The two notes are **not the same note**. `internal_note` is the reviewer's
 * record of why — a credit judgement, a doubt worth remembering — and is never
 * served to the applicant; `applicant_message` is what the company reads. One
 * field serving both would eventually put a credit assessment in front of the
 * customer it assesses.
 *
 * Nothing here creates the organisation. Approval records the decision;
 * provisioning is a separate endpoint behind a separate permission, because
 * an approval can be revisited and a tenant cannot be un-created.
 */
class ApproveApplicationRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
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
            'internal_note' => ['nullable', 'string', 'max:2000'],
            'applicant_message' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array{internal_note: string|null, applicant_message: string|null}
     */
    public function payload(): array
    {
        $internal = $this->validated('internal_note');
        $applicant = $this->validated('applicant_message');

        return [
            'internal_note' => is_string($internal) && trim($internal) !== '' ? $internal : null,
            'applicant_message' => is_string($applicant) && trim($applicant) !== '' ? $applicant : null,
        ];
    }
}
