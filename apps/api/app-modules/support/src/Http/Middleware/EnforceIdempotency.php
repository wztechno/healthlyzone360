<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Middleware;

use Closure;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\IdempotencyKey;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * `Idempotency-Key` at the HTTP boundary (master plan v2 §4.14, alias
 * `idempotency`).
 *
 * The rules are conventions.md's, made real:
 *
 *  * The key is scoped per endpoint **and per caller**. Two customers may use
 *    the word "1" without colliding, and the same customer may use it against
 *    two endpoints.
 *  * A repeat with the same key and the same **fingerprint** — sha256 over
 *    `METHOD|path|body` — replays the original envelope, status included, with
 *    `Idempotency-Replayed: true`. The command does not run twice.
 *  * A repeat with the same key and a *different* fingerprint answers 409
 *    `request.idempotency_key_reused`. The caller has reused a key that
 *    already means something else, and the fix is a new key.
 *
 * ## Why the claim is a database insert
 *
 * The row is written **before** the command runs, not after. Two concurrent
 * requests carrying one key both reach here; exactly one wins the unique
 * index, and the loser is a duplicate rather than a second execution. Deciding
 * afterwards would leave the window that matters — the seconds the command
 * takes — completely unguarded, which is precisely the window a double-tapped
 * checkout button lands in.
 *
 * A claim whose command then fails is **released**, so a genuine retry after a
 * server error is not refused as a replay of something that never happened.
 * Only a completed response is snapshotted.
 *
 * ## What is stored
 *
 * The fingerprint, never the body (plan §12), and the response *envelope* —
 * which is already the redacted, presenter-shaped view a client received.
 *
 * ## The subject
 *
 * The authenticated user if there is one; otherwise the guest customer account
 * resolved by `guest.session`, which is why this middleware runs *after* it.
 * A request with neither is passed straight through: an anonymous caller with
 * no durable identity has nothing to key a replay against, and inventing one
 * from an IP address would make two people behind one NAT share a guarantee.
 *
 * ## Where this sits relative to `OrderIdempotency`
 *
 * C1's service keeps its own claim, and deliberately: an order placed by a
 * queued job or a console command has no HTTP request and still must not
 * double-book. This middleware is the HTTP half — it answers the *replay* with
 * the original envelope, which a service that only guards execution cannot do,
 * because by then the response is gone.
 */
final class EnforceIdempotency
{
    /**
     * How long a key is remembered. A day is long enough to cover every
     * plausible client retry — including a phone that reconnects hours later —
     * and short enough that the table does not become a permanent log of every
     * command the platform has ever run.
     */
    public const int TTL_HOURS = 24;

    private const string REPLAY_HEADER = 'Idempotency-Replayed';

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next, ?string $endpoint = null): Response
    {
        $key = $request->header('Idempotency-Key');
        $subject = $this->subject($request);

        if (! is_string($key) || trim($key) === '' || $subject === null) {
            return $next($request);
        }

        $key = trim($key);
        $endpoint ??= $request->route()?->getName() ?? $request->path();
        $fingerprint = $this->fingerprint($request);

        $claim = $this->claim($key, $endpoint, $subject, $fingerprint);

        if ($claim['replay'] !== null) {
            return $this->replay($claim['replay']);
        }

        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            $this->release($claim['id']);

            throw $e;
        }

        $this->complete($claim['id'], $response);

        return $response;
    }

    /**
     * sha256 over method, path and raw body.
     *
     * The path rather than the full URL: a query string that changes the
     * meaning of a command endpoint would be a design mistake of its own, and
     * including it would make an appended tracking parameter look like a
     * different request.
     */
    private function fingerprint(Request $request): string
    {
        return hash('sha256', $request->getMethod().'|'.$request->path().'|'.$request->getContent());
    }

    /**
     * @return array{id: string|null, replay: array{status: int, snapshot: array<string, mixed>}|null}
     *
     * @throws ApiException
     */
    private function claim(string $key, string $endpoint, string $subject, string $fingerprint): array
    {
        $existing = $this->find($key, $endpoint, $subject);

        if ($existing instanceof IdempotencyKey) {
            return ['id' => null, 'replay' => $this->replayable($existing, $fingerprint)];
        }

        try {
            $row = new IdempotencyKey;
            $row->key = $key;
            $row->endpoint = $endpoint;
            $row->request_fingerprint = $fingerprint;
            $row->expires_at = now()->addHours(self::TTL_HOURS);
            $row->setAttribute($this->subjectColumn($subject), $this->subjectId($subject));
            $row->save();

            return ['id' => (string) $row->getKey(), 'replay' => null];
        } catch (QueryException) {
            // Lost the race for the unique index. The winner is either
            // in flight or finished; either way this request is a duplicate
            // and must not run the command.
            $winner = $this->find($key, $endpoint, $subject);

            if (! $winner instanceof IdempotencyKey) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This request could not be claimed. Retry in a moment.');
            }

            return ['id' => null, 'replay' => $this->replayable($winner, $fingerprint)];
        }
    }

    /**
     * @return array{status: int, snapshot: array<string, mixed>}
     *
     * @throws ApiException
     */
    private function replayable(IdempotencyKey $row, string $fingerprint): array
    {
        if (! hash_equals($row->request_fingerprint, $fingerprint)) {
            throw new ApiException(ErrorCode::RequestIdempotencyKeyReused, details: ['idempotency_key' => $row->key]);
        }

        if ($row->response_snapshot === null) {
            // Claimed but not finished: the first request is still running.
            // A 409 rather than a wait, because holding the connection open
            // would turn one slow command into two.
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'An identical request is still being processed. Retry in a moment.',
                ['idempotency' => ['reason' => 'in_flight']],
            );
        }

        return ['status' => (int) $row->response_status, 'snapshot' => $row->response_snapshot];
    }

    /**
     * @param  array{status: int, snapshot: array<string, mixed>}  $replay
     */
    private function replay(array $replay): JsonResponse
    {
        return (new JsonResponse($replay['snapshot'], $replay['status']))
            ->withHeaders([self::REPLAY_HEADER => 'true']);
    }

    private function complete(?string $id, Response $response): void
    {
        if ($id === null) {
            return;
        }

        $body = $response instanceof JsonResponse ? $response->getData(true) : null;

        // A non-envelope response (a download, a 204) is claimed but not
        // snapshotted: replaying "nothing" is not the same guarantee, and
        // pretending otherwise would be worse than declining to replay.
        if (! is_array($body) || $response->getStatusCode() >= 400) {
            $this->release($id);

            return;
        }

        IdempotencyKey::query()->whereKey($id)->update([
            'response_status' => (string) $response->getStatusCode(),
            'response_snapshot' => $body,
        ]);
    }

    private function release(?string $id): void
    {
        if ($id !== null) {
            IdempotencyKey::query()->whereKey($id)->delete();
        }
    }

    private function find(string $key, string $endpoint, string $subject): ?IdempotencyKey
    {
        return IdempotencyKey::query()
            ->where('key', $key)
            ->where('endpoint', $endpoint)
            ->where($this->subjectColumn($subject), $this->subjectId($subject))
            ->where('expires_at', '>', now())
            ->first();
    }

    /**
     * `user:<id>` or `account:<id>` — the two subject kinds the table now
     * carries, kept as one string so the middleware never has to hold a pair.
     */
    private function subject(Request $request): ?string
    {
        $user = $request->user();

        if ($user !== null) {
            return 'user:'.(string) $user->getAuthIdentifier();
        }

        $account = $request->attributes->get('guest_customer_account_id');

        return is_string($account) && $account !== '' ? 'account:'.$account : null;
    }

    private function subjectColumn(string $subject): string
    {
        return str_starts_with($subject, 'user:') ? 'user_id' : 'customer_account_id';
    }

    private function subjectId(string $subject): string
    {
        return substr($subject, strpos($subject, ':') + 1);
    }

    /**
     * Purge expired rows. Called by the maintenance schedule rather than on
     * the request path, so a client never pays for somebody else's cleanup.
     */
    public static function purgeExpired(): int
    {
        return DB::table('idempotency_keys')->where('expires_at', '<=', now())->delete();
    }
}
