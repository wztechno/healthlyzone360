<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The readiness evaluator refused a publication.
 *
 * `details.reasons` carries **every** blocker, not the first one found. A
 * gate that reveals one problem per attempt turns a five-minute fix into five
 * round trips, and the version being published is the one thing in this
 * domain a kitchen is most impatient about.
 *
 * Each reason is `{reason, …context}` — a stable machine key plus whatever
 * identifies the offending rows, so a client can highlight the exact lines
 * rather than printing a sentence.
 */
final class PublishBlocked extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::CataloguePublishBlocked,
            'This recipe version is not ready to be published.',
            ['reasons' => $reasons],
        );
    }

    /**
     * The same refusal, built from what `RecipeVersionReadiness` returns.
     *
     * The evaluator speaks `{code, detail, context}` — the shape the readiness
     * endpoint serves, where a nested context keeps a new reason's structure
     * from changing the shape of a reason. The publish refusal has spoken
     * `{reason, …context}` since K1.2 and clients parse it, so the flattening
     * happens here rather than by moving the wire underneath them. One
     * evaluator, two serialisations, and this is the only place that knows the
     * older one.
     *
     * `detail` is dropped on purpose. A publish refusal is read by a client
     * that already renders its own copy for each reason it knows; carrying a
     * second English sentence would invite two vocabularies for one refusal.
     *
     * @param  list<array{code: string, detail: string, context: array<string, mixed>}>  $reasons
     */
    public static function fromReadiness(array $reasons): self
    {
        return new self(array_map(
            static fn (array $reason): array => ['reason' => $reason['code']] + $reason['context'],
            $reasons,
        ));
    }
}
