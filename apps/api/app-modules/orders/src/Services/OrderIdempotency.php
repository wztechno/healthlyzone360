<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\IdempotencyKey;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Placing an order twice by accident, and what stops it.
 *
 * Order placement is the platform's **first genuinely non-idempotent
 * command** (master plan v2 §4.14): a double tap on a slow connection, a
 * mobile client retrying a request whose response was lost, or a proxy
 * replaying a POST all produce two orders for one intention, and the customer
 * finds out when two couriers arrive. The `idempotency_keys` table has existed
 * since the foundation for exactly this moment; this is its first consumer.
 *
 * **The guarantee is at the service, not at the middleware.** HTTP wiring —
 * reading the `Idempotency-Key` header, replaying the stored envelope — is the
 * integration wave's, and it is a thin layer over this. Putting the guarantee
 * here means it also holds for an order placed by a queued job, by a console
 * command, or by a future channel that has no HTTP request at all. A
 * middleware-only protection protects only what arrives through a middleware.
 *
 * **Claim first, place second.** The key row is inserted *before* the order
 * exists, so the unique index `(key, user_id, endpoint)` is what arbitrates a
 * genuine race rather than a check-then-act that two requests can both pass.
 * The three ways the claim can fail are three different answers:
 *
 *  * **Same key, same request, order already placed** → a replay. The stored
 *    envelope is returned and no second order is created. This is the case the
 *    whole apparatus exists for.
 *  * **Same key, same request, no order yet** → the first attempt is still in
 *    flight. Answered as a conflict, because the honest response is "ask
 *    again in a moment", not "here is a second order".
 *  * **Same key, different request** → the client has reused a key for
 *    something else. Refused outright: replaying the first order for a
 *    different basket would be worse than either duplicating or failing.
 *
 * **Only the envelope is stored** (plan §12): the order's identifier, number
 * and status. Never the request body, never an address, never a line. The
 * fingerprint is a hash, so the table records *that* two requests differed
 * without recording what either of them said.
 *
 * **A subject with no user is not protected, and says so.** The table's
 * `user_id` is `NOT NULL` and references `users`, which is right for every
 * caller that exists today and wrong for a guest, whose customer account has
 * no identity behind it. Rather than inventing a placeholder user or writing a
 * second key table, this service returns "unprotected" for that case and the
 * caller places the order without replay protection — the behaviour before
 * this class existed. G1 or PAY1 makes `user_id` nullable beside a subject
 * discriminator; until then the limitation is stated here rather than hidden
 * behind a key that silently protects nothing.
 */
final readonly class OrderIdempotency
{
    /**
     * The scope. Keys are namespaced per endpoint so that a client reusing one
     * key across two different commands cannot have the second one answered
     * with the first one's result.
     */
    public const string ENDPOINT = 'orders.place';

    /**
     * How long a key is honoured. A day is long enough to cover any retry a
     * client or a network will attempt and short enough that the table is a
     * replay guard rather than an archive of orders.
     */
    public const int TTL_HOURS = 24;

    /**
     * Claim the key, or discover what happened the last time it was used.
     *
     * @param  string|null  $key  the client's idempotency key; null means no protection was asked for
     * @param  string|null  $userId  the identity behind the customer account; null for a guest
     * @param  string  $fingerprint  a hash of the salient request, from `fingerprint()`
     * @return array{claimed: bool, replay: array<string, mixed>|null}
     *                                                                 `claimed` is true when the caller now owns the key and must call
     *                                                                 `complete()` or `release()`; `replay` carries the original envelope
     *
     * @throws ApiException
     */
    public function claim(?string $key, ?string $userId, string $fingerprint): array
    {
        if ($key === null || $key === '' || $userId === null) {
            return ['claimed' => false, 'replay' => null];
        }

        try {
            // Inside its own transaction, which is a **savepoint** when the
            // caller already has one open. Losing the race is an expected
            // outcome here, not a fault, and in PostgreSQL a failed statement
            // poisons the whole transaction it ran in — so without the
            // savepoint a second identical request would take the surrounding
            // work down with it instead of being answered with a replay.
            DB::transaction(function () use ($key, $userId, $fingerprint): void {
                IdempotencyKey::query()->create([
                    'key' => $key,
                    'user_id' => $userId,
                    'endpoint' => self::ENDPOINT,
                    'request_fingerprint' => $fingerprint,
                    'expires_at' => CarbonImmutable::now()->addHours(self::TTL_HOURS),
                    'created_at' => CarbonImmutable::now(),
                ]);
            });

            return ['claimed' => true, 'replay' => null];
        } catch (QueryException $exception) {
            if (! $this->isUniqueViolation($exception)) {
                throw $exception;
            }
        }

        $existing = IdempotencyKey::query()
            ->where('key', $key)
            ->where('user_id', $userId)
            ->where('endpoint', self::ENDPOINT)
            ->first();

        if (! $existing instanceof IdempotencyKey) {
            // The row was removed between the failed insert and this read —
            // an expiry sweep, most plausibly. Treat it as unprotected rather
            // than as a conflict: the client asked for protection and the
            // platform could not give it, which is a worse outcome to turn
            // into an error than into a plain placement.
            return ['claimed' => false, 'replay' => null];
        }

        if ($existing->request_fingerprint !== $fingerprint) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This idempotency key has already been used for a different request.',
                ['idempotency' => ['reason' => 'fingerprint_mismatch']],
            );
        }

        if ($existing->response_snapshot === null) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'An order is already being placed with this key. Try again in a moment.',
                ['idempotency' => ['reason' => 'in_flight']],
            );
        }

        return ['claimed' => false, 'replay' => $existing->response_snapshot];
    }

    /**
     * Record what the claimed key produced.
     *
     * The envelope and nothing else: enough for a replay to answer with the
     * same order, and not enough to reconstruct the request.
     */
    public function complete(?string $key, ?string $userId, Order $order): void
    {
        if ($key === null || $key === '' || $userId === null) {
            return;
        }

        IdempotencyKey::query()
            ->where('key', $key)
            ->where('user_id', $userId)
            ->where('endpoint', self::ENDPOINT)
            ->update([
                'response_status' => '201',
                'response_snapshot' => [
                    'order_id' => (string) $order->getKey(),
                    'order_number' => $order->order_number,
                    'status' => $order->status->value,
                ],
            ]);
    }

    /**
     * Give the key back when the placement failed.
     *
     * Without this, a refused order — an address nobody delivers to, a
     * withdrawn article — would burn the key, and the customer's corrected
     * retry would be answered with the in-flight conflict above. A key
     * protects against duplicating a *success*; it must not lock in a failure.
     */
    public function release(?string $key, ?string $userId): void
    {
        if ($key === null || $key === '' || $userId === null) {
            return;
        }

        IdempotencyKey::query()
            ->where('key', $key)
            ->where('user_id', $userId)
            ->where('endpoint', self::ENDPOINT)
            ->whereNull('response_snapshot')
            ->delete();
    }

    /**
     * A stable hash of what makes this placement the placement it is.
     *
     * A hash rather than the values, because the table must be able to say
     * "that was a different request" without holding a copy of either request.
     * Canonicalised by sorting keys, so two clients that serialise the same
     * intention in a different order are not told they disagree.
     *
     * @param  array<string, scalar|null>  $request
     */
    public function fingerprint(array $request): string
    {
        ksort($request);

        return hash('sha256', (string) json_encode($request, JSON_THROW_ON_ERROR));
    }

    /**
     * PostgreSQL's unique-violation SQLSTATE. Matched on the state rather than
     * on the message, which is localised and version-dependent.
     */
    private function isUniqueViolation(QueryException $exception): bool
    {
        return $exception->getCode() === '23505';
    }

    /**
     * Run a closure with the key claimed, releasing it if the closure throws.
     *
     * Exposed so the placement service reads as one statement rather than as
     * four lines of bookkeeping around the thing it is actually doing.
     *
     * @template T of Order
     *
     * @param  callable(): T  $place
     * @return array{order: T|null, replay: array<string, mixed>|null}
     *
     * @throws ApiException
     */
    public function around(?string $key, ?string $userId, string $fingerprint, callable $place): array
    {
        $claim = $this->claim($key, $userId, $fingerprint);

        if ($claim['replay'] !== null) {
            return ['order' => null, 'replay' => $claim['replay']];
        }

        try {
            $order = $place();
        } catch (Throwable $throwable) {
            // The claim was written before the placement opened its
            // transaction, so it survives the rollback that removed the
            // half-built order — which is precisely why it has to be released
            // here rather than left for an expiry sweep a day later.
            if ($claim['claimed']) {
                $this->release($key, $userId);
            }

            throw $throwable;
        }

        if ($claim['claimed']) {
            $this->complete($key, $userId, $order);
        }

        return ['order' => $order, 'replay' => null];
    }
}
