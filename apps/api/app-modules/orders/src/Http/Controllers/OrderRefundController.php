<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use App\Models\User;
use Healthy360\Orders\Enums\OrderRefundKind;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderRefund;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderRefunds;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * GET and POST /api/v1/catalogue/orders/{order}/refunds, plus an owner's approve
 * and reject.
 *
 * One controller, as `KitchenOrderDeliveryController` is one: all four answer the
 * order's ledger. `index` and `store` take `order.supervise_organisation`; the two
 * decisions take `order.approve_refund_organisation`. No `If-Match`, because a
 * refund does not depend on what the screen drew: the cap is read under the lock.
 * `idempotency` stops a retried request paying out twice, which the cap alone
 * would allow until it ran out.
 */
final class OrderRefundController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderRefunds $refunds,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function index(string $order): JsonResponse
    {
        return $this->respond($this->locator->sellerOrder($order));
    }

    /**
     * @throws ApiException
     */
    public function store(Request $request, string $order): JsonResponse
    {
        /** @var array{kind: string, method: string, amount_minor: int, reason: string} $validated */
        $validated = $request->validate([
            'kind' => ['required', Rule::enum(OrderRefundKind::class)],
            'method' => ['required', Rule::enum(PaymentMethod::class)],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:300'],
        ]);

        $record = $this->locator->sellerOrder($order);

        // An owner's own refund needs nobody else's approval.
        $this->refunds->record(
            $record,
            OrderRefundKind::from($validated['kind']),
            PaymentMethod::from($validated['method']),
            $validated['amount_minor'],
            trim($validated['reason']),
            (string) $this->actor($request)->getKey(),
            Gate::allows('order.approve_refund_organisation'),
        );

        return $this->respond($record, 201);
    }

    /**
     * @throws ApiException
     */
    public function approve(Request $request, string $order, string $refund): JsonResponse
    {
        return $this->decide($request, $order, $refund, true);
    }

    /**
     * @throws ApiException
     */
    public function reject(Request $request, string $order, string $refund): JsonResponse
    {
        return $this->decide($request, $order, $refund, false);
    }

    /**
     * @throws ApiException
     */
    private function decide(Request $request, string $order, string $refund, bool $approved): JsonResponse
    {
        $record = $this->locator->sellerOrder($order);

        $this->refunds->decide($record, $refund, $approved, (string) $this->actor($request)->getKey());

        return $this->respond($record);
    }

    private function respond(Order $order, int $status = 200): JsonResponse
    {
        $entries = OrderRefund::query()->where('order_id', $order->getKey())->orderByDesc('requested_at')->orderByDesc('id')->get();

        return ApiResponse::data($this->presenter->refundLedger($this->refunds->position($order), $entries), status: $status);
    }

    /**
     * @throws ApiException
     */
    private function actor(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }
}
