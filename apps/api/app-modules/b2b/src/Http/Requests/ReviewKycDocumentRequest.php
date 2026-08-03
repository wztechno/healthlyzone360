<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\DocumentRejectionReason;
use Healthy360\B2b\Enums\DocumentReviewStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a reviewer's verdict on a document.
 *
 * `verdict` is restricted to the two values a human may actually give.
 * `pending` is where a document starts and `superseded` is what happens to an
 * accepted one when a newer scan replaces it — neither is a decision, and
 * accepting them here would let a reviewer un-review a document by posting the
 * state it was already in.
 *
 * `rejection_reason` is `required_if` rather than merely optional, so the
 * refusal arrives as a field-level message on the field that is missing. The
 * service enforces the same rule and is the one that cannot be bypassed; this
 * one is what makes the error readable. **A rejection has to say why**, because
 * the reason is the half the applicant is shown and "please re-upload, it was
 * illegible" is actionable where a reviewer's private note is not.
 *
 * `note` is that private note. It is stored on the row and served only to the
 * platform surface.
 */
class ReviewKycDocumentRequest extends FormRequest
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
            'verdict' => [
                'required',
                new Enum(DocumentReviewStatus::class),
                Rule::in([DocumentReviewStatus::Accepted->value, DocumentReviewStatus::Rejected->value]),
            ],
            'rejection_reason' => [
                'nullable',
                'required_if:verdict,'.DocumentReviewStatus::Rejected->value,
                new Enum(DocumentRejectionReason::class),
            ],
            'note' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function verdict(): DocumentReviewStatus
    {
        /** @var string $verdict */
        $verdict = $this->validated('verdict');

        return DocumentReviewStatus::from($verdict);
    }

    public function rejectionReason(): ?DocumentRejectionReason
    {
        $reason = $this->validated('rejection_reason');

        return is_string($reason) && $reason !== '' ? DocumentRejectionReason::tryFrom($reason) : null;
    }

    public function note(): ?string
    {
        $note = $this->validated('note');

        return is_string($note) && trim($note) !== '' ? trim($note) : null;
    }
}
