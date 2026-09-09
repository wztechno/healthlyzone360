<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\PackagingBasis;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a full replacement of a version's packaging.
 *
 * `packaging` is `present`, not `required`: an empty array says "this version
 * ships in nothing", which is a legitimate statement about a component that
 * goes into another recipe rather than into a box. `required` would reject it
 * as though the field had been forgotten, and on a set-replace surface those
 * two have to stay different requests.
 *
 * `line_number` is not a field, for the same reason it is not one on the
 * formulation: the array order is the sequence, so a client never has to keep
 * numbering in step with an insertion and two lines can never claim the same
 * position.
 *
 * ## What this request deliberately does not accept
 *
 * **A unit cost.** The price is the catalogue's, read off the packaging item
 * when the row is written. A client that could quote its own would be able to
 * make the sheet disagree with the catalogue it claims to be costing against.
 *
 * **A quantity, on two of the three bases.** `fills_yield` and `per_container`
 * compute their own — see {@see PackagingBasis} — and the service *refuses* a
 * quantity sent alongside them rather than ignoring it. Accepting a figure and
 * then discarding it is precisely the failure this whole slice began by
 * fixing, one family over.
 *
 * The `quantity` rule below is therefore permissive on purpose: it validates
 * the shape of a number, and the service decides whether a number was welcome
 * at all. Splitting that across the two layers would mean a client could learn
 * the rule from neither.
 */
class ReplaceRecipePackagingRequest extends FormRequest
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
            'packaging' => ['present', 'array', 'max:50'],

            // Existence is checked in the service, not here: the item must be
            // one *this organisation* can use — its own rows plus the platform
            // library — and a bare `exists` rule would happily accept another
            // tenant's identifier.
            'packaging.*.ingredient_id' => ['required', 'uuid'],
            'packaging.*.basis' => ['required', new Enum(PackagingBasis::class)],
            'packaging.*.quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'packaging.*.comment' => ['nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return list<array{ingredient_id: string, basis: string, quantity?: float|string|null, comment?: string|null}>
     */
    public function packaging(): array
    {
        /** @var list<array{ingredient_id: string, basis: string, quantity?: float|string|null, comment?: string|null}> $packaging */
        $packaging = $this->validated('packaging') ?? [];

        return $packaging;
    }
}
