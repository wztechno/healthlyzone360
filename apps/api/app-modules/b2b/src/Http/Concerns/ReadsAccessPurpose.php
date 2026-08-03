<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Concerns;

use Carbon\CarbonImmutable;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * The stated reason a document is being opened, and the window the link stays
 * open for.
 *
 * **`purpose` is a required query parameter on every download route**, and it
 * is required rather than defaulted for the reason `KycDocumentService`
 * declines to default it either: a document access with no stated reason is
 * the access an audit trail cannot explain afterwards, and an optional
 * argument is an argument every call site eventually omits. Making the client
 * say why is the only version of the rule that survives a new caller.
 *
 * The refusal is `400 request.invalid` naming the parameter, never a 422: this
 * is a malformed request rather than a failed business rule, and the document
 * is not the thing that is wrong.
 *
 * `temporaryUrlExpiry()` is computed **before** the URL is minted, so the
 * `expires_at` a client is told is always at or before the moment the signature
 * actually stops working. A client that stops trusting the link a fraction of a
 * second early retries; one that trusts it a fraction of a second too long gets
 * an opaque 403 from object storage.
 */
trait ReadsAccessPurpose
{
    /**
     * @throws ApiException
     */
    protected function accessPurpose(Request $request): string
    {
        $purpose = $request->query('purpose');

        if (! is_string($purpose) || trim($purpose) === '') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A document access has to say what it is for: send a non-empty `purpose`.',
                ['parameter' => 'purpose'],
            );
        }

        if (mb_strlen($purpose) > 160) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The stated purpose may be at most 160 characters.',
                ['parameter' => 'purpose'],
            );
        }

        return trim($purpose);
    }

    protected function temporaryUrlExpiry(): CarbonImmutable
    {
        return CarbonImmutable::now()->addMinutes((int) config('b2b.kyc.temporary_url_ttl_minutes', 5));
    }
}
