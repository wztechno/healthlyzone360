<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Requests;

use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for asking to be let go of.
 *
 * `OpenClosureRequest` rather than `StoreClosureRequestRequest`, which is what
 * the naming convention would have produced for a resource already called a
 * *request*. The service's own verb is `open()`.
 *
 * **`scope` is required and has no default**, which is the one decision in this
 * file worth defending. A default would have to be either `marketing_opt_out`
 * — so a client with a bug silently downgrades an erasure somebody asked for —
 * or `full`, so a client with a bug erases somebody who asked only to stop
 * being emailed. Neither is a mistake this endpoint should be able to make on a
 * caller's behalf, and the two scopes are one screen with two buttons on the
 * customer's side, so a client always knows which was pressed.
 *
 * `reason_code` is the fixed vocabulary `ClosureReasonCode` declares, restated
 * here as `Rule::enum` so an unknown value is a field error a form can attach to
 * the right control rather than a 409 from the service. The CHECK constraint on
 * the column is the backstop.
 *
 * `reason_note` is optional prose and is the one free-text field in the
 * journey. It is capped, it is classified, it is never written into an audit
 * row — `ClosureService` is explicit about that — and it is deleted at
 * finalisation with everything else. It stays optional for every reason, not
 * only `Other`: insisting somebody explain themselves before they may leave is
 * a dark pattern wearing a form label.
 *
 * `delivery_channel` is optional and names where the passcode should go. SMS
 * and WhatsApp have no provider in this deployment (OQ-034), so asking for one
 * answers `otp.channel_unavailable` with the channels that would work — a
 * better dead end than silently sending an email to somebody waiting on a text.
 */
class OpenClosureRequest extends FormRequest
{
    /**
     * Ownership, not permission: the caller closes their own account and the
     * service reads the authenticated identity. There is nothing for a
     * permission code to be scoped to.
     *
     * The platform variant of this endpoint is gated by
     * `customer_account.close_platform` on the route, which is where an
     * authority that *is* somebody else's business belongs.
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
            'reason_code' => ['required', Rule::enum(ClosureReasonCode::class)],
            'reason_note' => ['nullable', 'string', 'max:2000'],
            'scope' => ['required', Rule::enum(ClosureScope::class)],
            'delivery_channel' => ['nullable', Rule::enum(OtpChannel::class)],
        ];
    }

    public function reasonCode(): ClosureReasonCode
    {
        /** @var string $value */
        $value = $this->validated('reason_code');

        return ClosureReasonCode::from($value);
    }

    public function scope(): ClosureScope
    {
        /** @var string $value */
        $value = $this->validated('scope');

        return ClosureScope::from($value);
    }

    public function deliveryChannel(): ?OtpChannel
    {
        /** @var string|null $value */
        $value = $this->validated('delivery_channel');

        return $value === null ? null : OtpChannel::from($value);
    }

    public function note(): ?string
    {
        /** @var string|null $value */
        $value = $this->validated('reason_note');

        return $value === null || trim($value) === '' ? null : trim($value);
    }
}
