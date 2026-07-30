<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Middleware;

use Closure;
use Healthy360\Support\Correlation\CorrelationContext;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Symfony\Component\HttpFoundation\Response;

/**
 * Stamps every API request with a server-generated UUIDv7 correlation
 * identifier (plan §12, docs/api/conventions.md).
 *
 * The identifier is returned as X-Correlation-Id, embedded in success `meta`
 * and error envelopes, and pushed into the log context so every line written
 * during the request carries it. An optional client-supplied
 * X-Client-Request-Id is sanitised, logged and echoed back, but is never
 * trusted as the correlation identifier — a client must not be able to
 * collide or forge server-side correlation.
 *
 * Runs first in the API middleware group so error responses produced further
 * down the stack still receive the headers on the way out.
 */
final class AssignCorrelationId
{
    private const int CLIENT_REQUEST_ID_MAX_LENGTH = 128;

    public function __construct(
        private readonly CorrelationContext $context,
        private readonly IdentifierService $identifiers,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $correlationId = $this->identifiers->generate();
        $clientRequestId = $this->sanitise($request->header('X-Client-Request-Id'));

        $this->context->assign($correlationId);
        $this->context->setClientRequestId($clientRequestId);

        Context::add('correlation_id', $correlationId);

        if ($clientRequestId !== null) {
            Context::add('client_request_id', $clientRequestId);
        }

        $response = $next($request);

        $response->headers->set('X-Correlation-Id', $correlationId);

        if ($clientRequestId !== null) {
            $response->headers->set('X-Client-Request-Id', $clientRequestId);
        }

        return $response;
    }

    /**
     * Client identifiers are opaque, but they end up in logs and response
     * headers, so control characters and unbounded lengths are stripped.
     */
    private function sanitise(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $clean = trim((string) preg_replace('/[^\x20-\x7E]/', '', $value));

        if ($clean === '') {
            return null;
        }

        return mb_substr($clean, 0, self::CLIENT_REQUEST_ID_MAX_LENGTH);
    }
}
