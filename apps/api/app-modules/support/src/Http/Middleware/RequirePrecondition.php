<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Middleware;

use Closure;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route guard for the optimistic-concurrency contract (alias: precondition,
 * master plan v2 §4.13).
 *
 * A write to a lock-versioned resource must say which version it was written
 * against. Missing `If-Match` is **428**, not 409 and not 400: the client has
 * not lost a race — it never entered one — and RFC 9110 has a status that
 * says exactly that. Answering 400 would tell an honest client "your request
 * was malformed" when the request was fine and only the concurrency
 * discipline was missing.
 *
 * The middleware only proves that a validator was *supplied*. Whether it is
 * the current one is a question about the row, and is answered at the service
 * layer inside the same transaction as the write — a middleware that read the
 * row first would leave a window between the check and the update, which is
 * the exact race the header exists to close.
 *
 * `If-Match: *` is accepted per RFC 9110: it means "as long as the resource
 * exists", and the service's own existence check already answers that.
 */
class RequirePrecondition
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $ifMatch = $request->headers->get('If-Match');

        if ($ifMatch === null || trim($ifMatch) === '') {
            throw new ApiException(
                ErrorCode::RequestPreconditionRequired,
                details: ['required_headers' => ['If-Match']],
            );
        }

        return $next($request);
    }

    /**
     * The `lock_version` an `If-Match` header carries, or null when the header
     * is a wildcard or is not a Healthy360 validator.
     *
     * Entity tags are quoted and may be weak (`W/"3"`), and a client may send
     * a list; the first usable value wins, which is what a single-validator
     * resource means.
     */
    public static function lockVersion(Request $request): ?int
    {
        $header = $request->headers->get('If-Match');

        if ($header === null) {
            return null;
        }

        foreach (explode(',', $header) as $candidate) {
            $tag = trim($candidate);

            if (str_starts_with($tag, 'W/')) {
                $tag = substr($tag, 2);
            }

            $tag = trim($tag, '"');

            if (preg_match('/^\d+$/', $tag) === 1) {
                return (int) $tag;
            }
        }

        return null;
    }
}
