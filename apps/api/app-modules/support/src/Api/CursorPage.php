<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

use DateTimeInterface;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Contracts\Database\Query\Builder as BuilderContract;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/**
 * Keyset ("cursor") pagination for Healthy360 collections — the pagination
 * style `docs/api/conventions.md` mandates, and the first implementation of it.
 *
 * Offset pagination is not used: a catalogue is written to while it is being
 * walked, and `LIMIT/OFFSET` silently skips and repeats rows when that
 * happens. A keyset over `(created_at, id)` cannot: the pair is unique and
 * immutable, so page N+1 always starts exactly where page N stopped, whatever
 * was inserted in between.
 *
 * The cursor is base64url of `<iso8601-created_at>|<id>`. It is opaque by
 * contract — clients echo it back and never construct one — but it is
 * deliberately *not* encrypted: it carries no secret, and an opaque blob a
 * support engineer holding a bug report cannot read is a cost with no benefit.
 * A cursor that does not decode is a client bug and is answered
 * `400 request.invalid`, never silently treated as "start from the
 * beginning", which would make a broken client look like a working one.
 *
 * **The caller runs the query.** `constrain()` shapes it and `page()` shapes
 * the result; the `get()` in between belongs to the endpoint. An Eloquent
 * builder loses its model type when it passes through a generic parameter, so
 * a paginator that fetched on the caller's behalf would hand back an untyped
 * collection and push every list endpoint into unchecked mapping. Three lines
 * at the call site buy a typed one, and every subtle rule — the codec, the
 * keyset predicate, the limit bounds, the extra row, the meta shape — still
 * lives here and is tested here.
 */
final class CursorPage
{
    public const int DEFAULT_LIMIT = 25;

    public const int MAX_LIMIT = 100;

    /**
     * Apply the caller's cursor and the keyset ordering, and ask for one row
     * beyond the page — the only honest way to answer `has_more` without a
     * second `COUNT` that would disagree with the page under concurrent
     * writes.
     *
     * @param  EloquentBuilder<covariant Model>  $query
     *
     * @throws ApiException
     */
    public static function constrain(EloquentBuilder $query, int $limit, ?string $cursor): void
    {
        $model = $query->getModel();
        $createdAt = $model->qualifyColumn($model->getCreatedAtColumn() ?? 'created_at');
        $key = $model->qualifyColumn($model->getKeyName());

        if ($cursor !== null) {
            [$afterCreatedAt, $afterId] = self::decode($cursor);

            $query->where(function (EloquentBuilder $scoped) use ($createdAt, $key, $afterCreatedAt, $afterId): void {
                $scoped->where($createdAt, '>', $afterCreatedAt)
                    ->orWhere(function (BuilderContract $tie) use ($createdAt, $key, $afterCreatedAt, $afterId): void {
                        $tie->where($createdAt, '=', $afterCreatedAt)->where($key, '>', $afterId);
                    });
            });
        }

        $query->reorder();
        $query->orderBy($createdAt)->orderBy($key)->limit($limit + 1);
    }

    /**
     * Trim the extra row off and describe the page.
     *
     * @template TItem of Model
     *
     * @param  EloquentCollection<int, TItem>  $rows  the result of a query passed through constrain()
     * @return array{items: EloquentCollection<int, TItem>, meta: array{count: int, next_cursor: string|null, has_more: bool}}
     */
    public static function page(EloquentCollection $rows, int $limit): array
    {
        $hasMore = $rows->count() > $limit;
        $items = $hasMore ? $rows->take($limit) : $rows;
        $last = $items->last();

        return [
            'items' => $items,
            'meta' => [
                'count' => $items->count(),
                'next_cursor' => $hasMore && $last !== null ? self::encode($last) : null,
                'has_more' => $hasMore,
            ],
        ];
    }

    /**
     * @throws ApiException
     */
    public static function limit(Request $request): int
    {
        $raw = $request->query('limit');

        if ($raw === null || $raw === '') {
            return self::DEFAULT_LIMIT;
        }

        if (! is_string($raw) || preg_match('/^\d+$/', $raw) !== 1) {
            throw self::invalid('limit', 'The limit must be a whole number between 1 and '.self::MAX_LIMIT.'.');
        }

        $limit = (int) $raw;

        if ($limit < 1 || $limit > self::MAX_LIMIT) {
            throw self::invalid('limit', 'The limit must be a whole number between 1 and '.self::MAX_LIMIT.'.');
        }

        return $limit;
    }

    /**
     * @throws ApiException
     */
    public static function cursor(Request $request): ?string
    {
        $raw = $request->query('cursor');

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw)) {
            throw self::invalid('cursor', 'The cursor is not a cursor this endpoint issued.');
        }

        // Decoded eagerly, so a malformed cursor fails before any query runs.
        self::decode($raw);

        return $raw;
    }

    public static function encode(Model $model): string
    {
        $createdAt = $model->getAttribute($model->getCreatedAtColumn() ?? 'created_at');
        $timestamp = $createdAt instanceof DateTimeInterface ? $createdAt->format('Y-m-d\TH:i:s.uP') : '';

        return self::base64UrlEncode($timestamp.'|'.((string) $model->getKey()));
    }

    /**
     * @return array{0: string, 1: string}
     *
     * @throws ApiException
     */
    public static function decode(string $cursor): array
    {
        $decoded = self::base64UrlDecode($cursor);

        if ($decoded === null || substr_count($decoded, '|') !== 1) {
            throw self::invalid('cursor', 'The cursor is not a cursor this endpoint issued.');
        }

        [$createdAt, $id] = explode('|', $decoded, 2);

        // The exact shape `encode()` emits, not merely something `strtotime()`
        // would accept: "yesterday" parses happily and is not a cursor this
        // endpoint ever issued.
        if ($id === '' || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}$/', $createdAt) !== 1) {
            throw self::invalid('cursor', 'The cursor is not a cursor this endpoint issued.');
        }

        return [$createdAt, $id];
    }

    public static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $value): ?string
    {
        if (preg_match('/^[A-Za-z0-9\-_]+$/', $value) !== 1) {
            return null;
        }

        $padded = str_pad(strtr($value, '-_', '+/'), (int) (ceil(strlen($value) / 4) * 4), '=');
        $decoded = base64_decode($padded, true);

        return $decoded === false ? null : $decoded;
    }

    private static function invalid(string $parameter, string $message): ApiException
    {
        return new ApiException(ErrorCode::RequestInvalid, $message, ['parameter' => $parameter]);
    }
}
