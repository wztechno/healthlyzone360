<?php

declare(strict_types=1);

/**
 * Cross-origin access for the API (plan §14, docs/api/conventions.md).
 *
 * Laravel's shipped default allows every origin, which is fine for a bearer-only API and wrong the
 * moment credentials are involved: a wildcard origin and `Access-Control-Allow-Credentials: true`
 * are mutually exclusive, and the browser silently drops the response. The Expo clients live on a
 * different origin from the API in every environment, so the allow-list is explicit and driven by
 * FRONTEND_URLS.
 */

/**
 * @return list<string>
 */
$origins = static function (): array {
    $raw = (string) env('FRONTEND_URLS', (string) env('FRONTEND_URL', ''));

    $urls = array_filter(
        array_map(static fn (string $url): string => rtrim(trim($url), '/'),
            explode(',', $raw)),
        static fn (string $url): bool => $url !== '',
    );

    return array_values(array_unique($urls));
};

return [

    /*
     * `/api/*` is the resource API. `sanctum/csrf-cookie` is the first-party session handshake and
     * has to answer the same origins, or a future cookie client cannot obtain its CSRF token.
     */
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'up'],

    'allowed_methods' => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => $origins(),

    'allowed_origins_patterns' => [],

    /*
     * The Healthy360 request headers (docs/api/conventions.md §Headers) plus the standard set.
     * A header that is not listed here is stripped by the browser before the request is sent, so
     * this list and the conventions table have to stay in step.
     */
    'allowed_headers' => [
        'Accept',
        'Accept-Language',
        'Authorization',
        'Content-Type',
        'Origin',
        'X-Requested-With',
        'X-XSRF-TOKEN',
        'X-App-Mode',
        'X-Branch-Id',
        'X-Client-Platform',
        'X-Client-Request-Id',
        'X-Client-Version',
        'X-Organisation-Id',
        'Idempotency-Key',
        'If-Match',
    ],

    /*
     * Without this the correlation identifier is invisible to a cross-origin client, and a support
     * conversation about a failed request has nothing to key on. `Retry-After` is exposed for the
     * same reason: the rate-limit failure carries its wait in a header.
     */
    'exposed_headers' => [
        'X-Correlation-Id',
        'X-Client-Request-Id',
        'Retry-After',
    ],

    'max_age' => 3600,

    /*
     * True so the first-party cookie session works from the Expo web origin. Bearer clients send
     * `credentials: 'omit'` and are unaffected.
     */
    'supports_credentials' => true,

];
