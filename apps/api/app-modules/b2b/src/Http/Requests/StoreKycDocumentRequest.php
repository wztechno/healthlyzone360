<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\DocumentKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for uploading an identity or registration document.
 *
 * **The rules here are the cheap checks, not the real ones.** `max:10240`
 * refuses ten megabytes before PHP holds the bytes, and `file` refuses a
 * request that is not multipart at all — both are worth doing early. What
 * this class deliberately does **not** do is decide what the file *is*:
 * `mimes` and `mimetypes` rules trust the client's `Content-Type` or the
 * filename extension, and `KycDocumentService` sniffs the leading bytes and
 * accepts or refuses on that. Two opinions about the same file, one of them
 * the client's, is exactly the arrangement an upload endpoint must not have.
 *
 * `signed_agreement` is **not** an acceptable kind here. A countersigned
 * agreement is produced by the signing flow; accepting one from a client would
 * let an applicant supply their own idea of what they signed, which is the one
 * document on the list that must never be self-asserted. The allowed set is
 * read from `DocumentKind::isApplicantUploadable()` so the rule cannot drift
 * from the domain's own answer.
 *
 * `expires_on` is accepted for every kind and **ignored for the kinds that do
 * not expire** — the service consults `DocumentKind::expires()` and stores
 * null otherwise. Refusing it would mean a client had to know the expiry table
 * to send a valid request; storing it would mean a commercial registration
 * with an expiry date nobody set.
 */
class StoreKycDocumentRequest extends FormRequest
{
    /**
     * Authorisation is ownership, and ownership is the locator's
     * `applicant_user_id` check; a form request that also guessed would give
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
            'file' => ['required', 'file', 'max:10240'],
            'document_kind' => ['required', new Enum(DocumentKind::class), Rule::in($this->applicantUploadableKinds())],
            'expires_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * The upload itself.
     *
     * Read through `file()` rather than `validated()`: the validated bag
     * carries the framework's own representation of the part, and the service
     * wants the `UploadedFile` so it can reach the bytes on disk without
     * copying them through memory first.
     */
    public function document(): ?UploadedFile
    {
        $file = $this->file('file');

        return $file instanceof UploadedFile ? $file : null;
    }

    public function documentKind(): DocumentKind
    {
        /** @var string $kind */
        $kind = $this->validated('document_kind');

        return DocumentKind::from($kind);
    }

    public function expiresOn(): ?CarbonImmutable
    {
        $value = $this->validated('expires_on');

        return is_string($value) && $value !== ''
            ? CarbonImmutable::parse($value)->startOfDay()
            : null;
    }

    /**
     * @return list<string>
     */
    private function applicantUploadableKinds(): array
    {
        return array_values(array_map(
            static fn (DocumentKind $kind): string => $kind->value,
            array_filter(DocumentKind::cases(), static fn (DocumentKind $kind): bool => $kind->isApplicantUploadable()),
        ));
    }
}
