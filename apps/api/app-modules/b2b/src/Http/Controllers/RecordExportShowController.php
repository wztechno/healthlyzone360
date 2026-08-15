<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Http\Concerns\ReadsAccessPurpose;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\ExportService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/platform/b2b/offboardings/{offboarding}/exports/{export} — the
 * bundle, and a short-lived way to fetch it.
 *
 * **One endpoint for the status and the download, and the `purpose` parameter
 * is what separates them.** Sent without one, this is a read: the manifest, the
 * row counts, the digest, whether it is ready. Sent with one, it also mints a
 * fifteen-minute signed URL and records the access as a `Confidential` read
 * with the stated reason. That is a deliberate collapse of two routes into one
 * — a client polling for readiness would otherwise have to poll a status route
 * and then call a download route, and the second route would be the one whose
 * audit rows say "downloaded" for every poll.
 *
 * **The URL is in the envelope, never a 302.** A redirect would put an expiring
 * credential into browser history, the referrer chain and every proxy log on
 * the way to the bucket — the rule the KYC download states and the reason
 * neither endpoint returns one.
 *
 * **Fifteen minutes rather than the five a KYC document gets.** A bundle is a
 * large download over whatever connection the recipient has, and a URL that
 * expires mid-transfer is a failure the person cannot diagnose. Fifteen rather
 * than a day, because a signed URL is a bearer credential and every extra hour
 * is another hour it can be forwarded.
 *
 * **`purpose` is required when downloading** — an access with no stated reason
 * is the access an audit trail cannot explain afterwards — and the refusal is
 * `400 request.invalid` naming the parameter, never a 422: the request is
 * malformed and the bundle is not the thing that is wrong.
 *
 * A bundle that is still building, that failed, or whose window has closed is
 * `409 record_export.unavailable` with `details.status`. Not a 404: the caller
 * is looking at an export they may see and can already list, and a 404 would be
 * a lie about a row in front of them.
 */
final class RecordExportShowController
{
    use ReadsAccessPurpose;
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly ExportService $exports,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding, string $export): JsonResponse
    {
        $record = $this->offboarding($offboarding);
        $bundle = $this->recordExport($record, $export);

        $purpose = $request->query('purpose');

        if (! is_string($purpose) || trim($purpose) === '') {
            return ApiResponse::data(['export' => $this->presenter->export($bundle)]);
        }

        // Computed before the URL is minted, so the `expires_at` a client is
        // told is always at or before the moment the signature actually stops
        // working. A client that stops trusting the link a fraction early
        // retries; one that trusts it too long gets an opaque 403 from object
        // storage.
        $expiresAt = CarbonImmutable::now()
            ->addMinutes((int) config('b2b.exports.temporary_url_ttl_minutes', 15));

        $url = $this->exports->downloadUrl(
            $bundle,
            $this->currentUser($request),
            $this->accessPurpose($request),
        );

        return ApiResponse::data([
            'export' => $this->presenter->export($bundle->refresh(), $url, $expiresAt->toIso8601String()),
        ]);
    }
}
