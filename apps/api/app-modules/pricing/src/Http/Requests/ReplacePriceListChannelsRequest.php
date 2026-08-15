<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a price list's channel assignments.
 *
 * `channels` is `present`, not `required`: an empty array detaches the list
 * from every channel, which is how a tariff is withdrawn — and the step
 * `archive` insists on first.
 *
 * `priority` is optional. Left out, it comes from the array order, which is
 * what a merchandiser is actually stating when they list the negotiated sheet
 * above the standing tariff.
 */
class ReplacePriceListChannelsRequest extends FormRequest
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
            'channels' => ['present', 'array', 'max:50'],
            'channels.*.sales_channel_id' => ['required', 'uuid'],
            'channels.*.priority' => ['nullable', 'integer'],
        ];
    }

    /**
     * @return list<array{sales_channel_id: string, priority?: int|string|null}>
     */
    public function assignments(): array
    {
        /** @var list<array{sales_channel_id: string, priority?: int|string|null}> $channels */
        $channels = $this->validated('channels') ?? [];

        return $channels;
    }
}
