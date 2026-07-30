<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

use Healthy360\Support\Correlation\CorrelationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * The single construction point for every Healthy360 API body
 * (docs/api/conventions.md).
 *
 * Success: {"data": ..., "meta": {...}} — meta always carries at least the
 * correlation identifier, so clients and support tooling can rely on it.
 * Error:   {"error": {"code", "message", "details", "correlation_id"}}.
 *
 * The documented envelope exceptions are 204 responses (noContent()), file
 * downloads, streaming responses and the health check.
 */
final class ApiResponse
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public static function data(mixed $data, array $meta = [], int $status = 200): JsonResponse
    {
        return new JsonResponse([
            'data' => $data,
            'meta' => self::meta($meta),
        ], $status);
    }

    public static function error(ApiError $error): JsonResponse
    {
        return new JsonResponse([
            'error' => [
                'code' => $error->code->value,
                'message' => $error->message,
                'details' => (object) $error->details,
                'correlation_id' => self::correlation()->correlationId(),
            ],
        ], $error->status);
    }

    public static function noContent(): Response
    {
        return new Response('', 204);
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    private static function meta(array $meta): array
    {
        return ['correlation_id' => self::correlation()->correlationId()] + $meta;
    }

    private static function correlation(): CorrelationContext
    {
        return app(CorrelationContext::class);
    }
}
