<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Renders every exception raised on an API request into the error envelope.
 *
 * Registered once in bootstrap/app.php, this is the only place a non-2xx API
 * body is produced. Anything it does not recognise becomes a 500
 * `server.internal_error` with a safe message — exception messages and stack
 * traces are never leaked, whatever APP_DEBUG says.
 */
final class ApiExceptionRenderer
{
    public function render(Throwable $e, Request $request): ?JsonResponse
    {
        if (! $this->rendersJson($request)) {
            return null;
        }

        // Carries its own fully-formed response (Fortify responses, form
        // request hooks). Letting Laravel unwrap it keeps that response.
        if ($e instanceof HttpResponseException) {
            return null;
        }

        $response = ApiResponse::error($this->toApiError($e));

        if ($e instanceof HttpExceptionInterface) {
            $response->withHeaders($this->safeHeaders($e->getHeaders()));
        }

        return $response;
    }

    private function toApiError(Throwable $e): ApiError
    {
        return match (true) {
            // `ApiException` implements this too, so one arm covers both the
            // deliberate API failure and a domain refusal that has declared
            // its own wire shape (see the interface).
            $e instanceof ProvidesApiError => $e->toApiError(),
            $e instanceof ValidationException => ApiError::make(
                ErrorCode::ValidationFailed,
                details: ['fields' => $e->errors()],
                status: $e->status,
            ),
            $e instanceof AuthenticationException => ApiError::make(ErrorCode::AuthUnauthenticated),
            $e instanceof ThrottleRequestsException => ApiError::make(ErrorCode::RateLimitExceeded),

            // An expired or tampered signed link (email verification). It is
            // a 403 like a permission denial, but a completely different
            // problem for the person holding the link, so it keeps its own
            // code rather than collapsing into authz.permission_denied.
            $e instanceof InvalidSignatureException => ApiError::make(ErrorCode::AuthInvalidSignature),
            $e instanceof HttpExceptionInterface => ApiError::make(
                $code = ErrorCode::forHttpStatus($e->getStatusCode()),
                $code->message(),
                status: $e->getStatusCode(),
            ),
            default => ApiError::make(ErrorCode::ServerInternalError),
        };
    }

    /**
     * Only headers that are part of the wire contract survive; framework
     * exceptions may carry `WWW-Authenticate` and similar values that would
     * change how a browser behaves on an API response.
     *
     * @param  array<string, string>  $headers
     * @return array<string, string>
     */
    private function safeHeaders(array $headers): array
    {
        $allowed = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'allow'];

        return array_filter(
            $headers,
            static fn (string $name): bool => in_array(strtolower($name), $allowed, true),
            ARRAY_FILTER_USE_KEY,
        );
    }

    private function rendersJson(Request $request): bool
    {
        return $request->is('api/*') || $request->expectsJson();
    }
}
