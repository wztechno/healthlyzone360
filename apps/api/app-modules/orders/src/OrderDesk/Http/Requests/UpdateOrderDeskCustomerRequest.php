<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Closure;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for correcting a customer the desk can sell to — a misheard name, a
 * number with two digits swapped.
 *
 * Both fields are optional and at least one is required: a correction names what
 * it corrects. The phone rule is the create endpoint's, asked of the same
 * normaliser, so a number the desk could not have written down cannot be written
 * in by editing either.
 */
class UpdateOrderDeskCustomerRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware plus the controller's
     * scoping check.
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
            'display_name' => ['required_without:phone', 'filled', 'string', 'max:255'],
            'phone' => ['required_without:display_name', 'filled', 'string', 'max:255', $this->normalisablePhone()],
        ];
    }

    /**
     * Only what was sent: an absent field is left as it is.
     *
     * @return array{display_name?: string, phone?: string}
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        $payload = [];

        if (array_key_exists('display_name', $validated)) {
            $payload['display_name'] = trim((string) $validated['display_name']);
        }

        if (array_key_exists('phone', $validated)) {
            $payload['phone'] = trim((string) $validated['phone']);
        }

        return $payload;
    }

    /**
     * The new number in the canonical form the registry stores, or null when no
     * number was sent. Callable only after validation.
     */
    public function normalisedPhone(): ?string
    {
        $phone = $this->validated('phone');

        if (! is_string($phone)) {
            return null;
        }

        try {
            return app(ContactValueNormaliser::class)->normalise(ContactChannel::Phone, $phone);
        } catch (InvalidContactValue) {
            return trim($phone);
        }
    }

    private function normalisablePhone(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value)) {
                $fail('Enter the number in international format, starting with a plus and the country code.');

                return;
            }

            try {
                app(ContactValueNormaliser::class)->normalise(ContactChannel::Phone, $value);
            } catch (InvalidContactValue $refusal) {
                $fail($refusal->getMessage());
            }
        };
    }
}
