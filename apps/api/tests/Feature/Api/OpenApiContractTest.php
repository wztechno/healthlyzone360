<?php

declare(strict_types=1);

use Healthy360\Support\Api\ErrorCode;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Symfony\Component\Yaml\Yaml;

/*
|--------------------------------------------------------------------------
| OpenAPI ↔ application parity
|--------------------------------------------------------------------------
|
| The OpenAPI document is the contract the universal client is generated from
| (ADR-0005), which is worth nothing if it drifts from the application. These
| tests fail in both directions: an endpoint that is not described, and a
| description with no endpoint behind it.
|
*/

/**
 * Routes that legitimately live outside /api/v1 and outside the contract.
 * Anything else must be described.
 *
 * @var list<string>
 */
const CONTRACT_EXEMPT_ROUTES = [
    // Service banner.
    'GET /',
    'HEAD /',

    // Framework health check — a documented envelope exception.
    'GET /up',
    'HEAD /up',

    // Modular-package spike probe (ADR-0001).
    'GET /support/ping',
    'HEAD /support/ping',

    // Sanctum's CSRF cookie. Part of the first-party session handshake, not
    // of the versioned resource API; described under the sessionCookie
    // security scheme instead.
    'GET /sanctum/csrf-cookie',
    'HEAD /sanctum/csrf-cookie',

    // Laravel's public-disk file serving — a documented envelope exception
    // (file downloads).
    'GET /storage/{path}',
    'HEAD /storage/{path}',
    'PUT /storage/{path}',
];

/**
 * The bundled document — the artefact clients are generated from, so it is
 * the one the application is checked against.
 *
 * @return array<string, mixed>
 */
function openApiDocument(): array
{
    $path = base_path('openapi/dist/healthy360.v1.yaml');

    expect(file_exists($path))->toBeTrue(
        'The bundled OpenAPI document is missing. Run: composer api:bundle',
    );

    /** @var array<string, mixed> */
    return Yaml::parseFile($path);
}

/**
 * Every documented operation as "METHOD /path", with the server base path
 * from the document restored.
 *
 * @return list<string>
 */
function documentedOperations(): array
{
    $document = openApiDocument();

    /** @var array<string, array<string, mixed>> $paths */
    $paths = $document['paths'] ?? [];

    $operations = [];

    foreach ($paths as $path => $operationsForPath) {
        foreach (array_keys($operationsForPath) as $method) {
            $operations[] = strtoupper((string) $method).' /api/v1'.$path;
        }
    }

    sort($operations);

    return $operations;
}

/**
 * Every route the application actually serves under /api/v1, in the same
 * shape. HEAD is Laravel's automatic companion to GET and is not described
 * separately.
 *
 * @return list<string>
 */
function registeredApiRoutes(): array
{
    $routes = [];

    foreach (Route::getRoutes() as $route) {
        /** @var RoutingRoute $route */
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        foreach ($route->methods() as $method) {
            if ($method === 'HEAD') {
                continue;
            }

            $routes[] = $method.' /'.$route->uri();
        }
    }

    sort($routes);

    return $routes;
}

it('describes every endpoint the application serves', function (): void {
    expect(array_values(array_diff(registeredApiRoutes(), documentedOperations())))->toBe([]);
});

it('serves every endpoint the document describes', function (): void {
    expect(array_values(array_diff(documentedOperations(), registeredApiRoutes())))->toBe([]);
});

it('accounts for every route outside the contract explicitly', function (): void {
    $unaccounted = [];

    foreach (Route::getRoutes() as $route) {
        /** @var RoutingRoute $route */
        $uri = $route->uri();

        // Horizon ships its own dashboard routes and is not part of the
        // public API contract.
        if (str_starts_with($uri, 'api/v1/') || str_starts_with($uri, 'horizon')) {
            continue;
        }

        foreach ($route->methods() as $method) {
            $signature = $method.' /'.ltrim($uri, '/');

            if (! in_array($signature, CONTRACT_EXEMPT_ROUTES, true)) {
                $unaccounted[] = $signature;
            }
        }
    }

    expect($unaccounted)->toBe([]);
});

it('documents exactly the error codes the application can emit', function (): void {
    $document = openApiDocument();

    /** @var list<string> $documented */
    $documented = $document['components']['schemas']['ErrorCode']['enum'] ?? [];

    $implemented = array_map(static fn (ErrorCode $code): string => $code->value, ErrorCode::cases());

    sort($documented);
    sort($implemented);

    expect($documented)->toBe($implemented);
});

it('keeps the bundled document in step with its source', function (): void {
    $source = Yaml::parseFile(base_path('openapi/healthy360.v1.yaml'));

    expect($source['info']['version'])->toBe(openApiDocument()['info']['version'])
        ->and(array_keys((array) $source['paths']))->toBe(array_keys((array) openApiDocument()['paths']));
});
