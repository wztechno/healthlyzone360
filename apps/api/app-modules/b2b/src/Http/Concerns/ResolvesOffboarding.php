<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Concerns;

use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Models\RecordExport;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * How the offboarding endpoints find the rows they are about.
 *
 * **No ownership scope, and that is not an omission.** Every route using this
 * sits behind `platform.context` and `b2b_offboarding.manage_platform`: the
 * caller is a platform operator acting on somebody else's company by
 * definition, so there is no "their own" to scope to. The isolation that
 * matters here is the *permission*, and it is enforced at the route rather than
 * re-implemented as a predicate that would have to be "true".
 *
 * That makes a plain 404 the right answer for a missing row, and it means
 * something different from what it means on a customer surface: not "not
 * yours", simply "no such wind-up".
 *
 * `recordExport()` is scoped to the offboarding in the path, which *is* a real
 * predicate: an export belongs to an organisation and may belong to a wind-up,
 * and a nested route that resolved the export by identifier alone would let a
 * caller read one company's bundle through another company's wind-up. The URL
 * would say one thing and the response would be another.
 */
trait ResolvesOffboarding
{
    /**
     * @throws ApiException
     */
    protected function offboarding(string $offboardingId): B2bOffboarding
    {
        $offboarding = B2bOffboarding::query()->whereKey($offboardingId)->first();

        if (! $offboarding instanceof B2bOffboarding) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $offboarding;
    }

    /**
     * One bundle, resolved *through* the wind-up that owns it.
     *
     * @throws ApiException
     */
    protected function recordExport(B2bOffboarding $offboarding, string $exportId): RecordExport
    {
        $export = RecordExport::query()
            ->where('b2b_offboarding_id', $offboarding->getKey())
            ->whereKey($exportId)
            ->first();

        if (! $export instanceof RecordExport) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $export;
    }
}
