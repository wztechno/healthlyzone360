<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Requests;

use Healthy360\Orders\Enums\PaymentMethod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for recording that money arrived against an order.
 *
 * **There is no `currency_code` field, and that is a decision rather than an
 * omission.** The receipt is denominated in the order's own currency, taken
 * from the order by the controller: a receipt in another currency is not a
 * receipt for this order, it is a conversion nobody performed and a figure that
 * cannot be summed against `orders.total_minor` to answer whether the order has
 * been paid. Accepting the field would mean either validating it against the
 * order — a round trip to be told what the server already knows — or trusting
 * it, and a trusted mismatch is a kitchen's takings quietly wrong in two
 * currencies at once.
 *
 * **`amount_minor` is `min:1` while the column's CHECK admits zero.** The two
 * are not in disagreement; they are answering different questions. The CHECK
 * refuses a *negative* figure, because giving money back is the payments
 * module's act in the payments module's table, and it permits zero because a
 * zero-amount row is harmless to sum. This endpoint is stricter because a
 * receipt is **evidence**: somebody standing at a counter asserting that no
 * money changed hands has not recorded a payment, they have recorded a
 * keystroke, and the row would show up in a day's takings as a payment event
 * worth nothing. If a nil balance genuinely needs settling, that is an order
 * with a zero total and no receipt at all.
 *
 * **`method` is validated against the whole enum, not against the order's own
 * `payment_method`.** See `OrderPaymentReceiptStoreController` — the divergence
 * between what was intended and what arrived is the fact this table exists to
 * record.
 *
 * `reference` and `notes` are both `Confidential` on the model, which is why
 * they are bounded here rather than left as open text: a transfer identifier
 * points at a real transaction between two named parties, and a free-text note
 * written at a counter is exactly where somebody puts a customer's name.
 */
class StorePaymentReceiptRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request that
     * also guessed would give two answers to one question.
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
            'method' => ['required', new Enum(PaymentMethod::class)],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reference' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:300'],
        ];
    }

    /**
     * @return array{method: string, amount_minor: int, reference: string|null, notes: string|null}
     */
    public function payload(): array
    {
        /** @var array{method: string, amount_minor: int|string, reference?: string|null, notes?: string|null} $validated */
        $validated = $this->validated();

        return [
            'method' => $validated['method'],
            'amount_minor' => (int) $validated['amount_minor'],
            'reference' => $this->stated($validated['reference'] ?? null),
            'notes' => $this->stated($validated['notes'] ?? null),
        ];
    }

    /**
     * An empty string is not a shorter reference, it is an absent one. Storing
     * it as typed would make "no transfer identifier" and "a transfer
     * identifier nobody could read" the same row to every query that goes
     * looking for the first.
     */
    private function stated(?string $value): ?string
    {
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
