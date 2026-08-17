<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Writing the kitchen's order book (§3.5, §6).
 *
 * Four operations and one rule underneath all of them: **the server decides what
 * a line says.** A request names a shelf and a quantity; the code, both names,
 * the unit and the supplier's own reference are read out of the database at
 * write time and frozen onto the row. §6 says the batch create "never trusts a
 * client-supplied unit or item label", and the same applies to the draft
 * replace — a client that could name a line could put anything at all on a
 * document a supplier reads.
 *
 * ## The batch is all-or-nothing, and the numbers are minted inside it
 *
 * One outer transaction wraps the whole batch: eleven suppliers' drafts commit
 * together or none of them do. A person who pressed Create once must not end up
 * with six of the eight orders they confirmed and no way to tell which two are
 * missing.
 *
 * Inside it, **each order's header row is inserted in its own nested
 * transaction**, which PostgreSQL and Laravel express as a `SAVEPOINT`. That is
 * the whole mechanism behind the number mint:
 *
 * - `PurchaseOrderNumbers` proposes a random number and pre-checks it, but the
 *   pre-check is an optimisation. The guarantee is
 *   `UNIQUE(organisation_id, number)`, because a read and a write with a gap
 *   between them is a race two concurrent batches would lose.
 * - A collision therefore surfaces as a **23505**, and in PostgreSQL any error
 *   aborts the enclosing transaction — every later statement fails with *current
 *   transaction is aborted* until something rolls back. The savepoint is what
 *   turns "the whole batch is dead" into "that one insert did not happen": it
 *   unwinds to the savepoint, a fresh number is minted, and the batch carries on.
 * - `DB::transaction($callback, $attempts)` does **not** help here. Its retry
 *   loop fires only for `causedByConcurrencyError` — deadlocks and serialisation
 *   failures — and a unique violation is neither, so it rethrows on the first
 *   attempt. The retry has to be written out, and it is.
 *
 * Only the header goes inside the savepoint. The lines are written after it, in
 * the outer transaction, so that the retry can only ever be triggered by the one
 * constraint it knows how to fix: `purchase_order_lines` has a unique index of
 * its own, and re-minting a number would not fix a shelf named twice.
 *
 * ## Cross-organisation identifiers are not found; wrong-state ones are conflicts
 *
 * A branch, a supplier or a stock item belonging to another kitchen is
 * `ResourceNotFound`, never a 403 and never a silent skip — "does this id exist"
 * is itself the answer a tenant is not entitled to, which is the rule
 * {@see SupplierItemLinkService} states and this follows.
 *
 * An **archived** supplier is different in kind: the id is well formed, it names
 * a real supplier in this kitchen's own book, and what refuses the operation is
 * its *state*. That is `ResourceConflict` with `details.reason = supplier_archived`
 * — the shape §6 mandates for transition refusals — rather than a 422, which
 * would tell a client its field was malformed when the field is perfectly fine.
 * The same code and the same reason on **create** as on **issue**, deliberately:
 * a draft that could never be issued is not a useful thing to have created, and
 * one refusal a client handles beats two it has to distinguish.
 *
 * ## Nothing here writes a supplier link
 *
 * §4: order creation never changes supplier links implicitly. The link is *read*
 * — that is where `supplier_item_ref` comes from — and never written. The
 * builder's **Remember this supplier for this item** is its own standalone
 * upsert, fired when the person chooses, precisely so that a configuration
 * change cannot hide inside a purchase.
 *
 * ## Audit metadata is identifiers and counts
 *
 * Never an amount — there are none on this table — and never a key containing
 * `code`, which `AuditRecorder` redacts blindly by substring. `number` is the
 * identifier recorded, which is also the one a person reading the trail can
 * match against a piece of paper.
 */
final readonly class PurchaseOrderService
{
    /** bcmath scale, matching `decimal(14,4)` on `purchase_order_lines.quantity`. */
    private const int SCALE = 4;

    /** Exclusive upper bound of `decimal(14,4)` — ten integer digits. */
    private const string MAX_QUANTITY = '10000000000';

    /** Suppliers in one batch. A builder screen that produced more is a bug, not a busy kitchen. */
    private const int MAX_ORDERS = 20;

    /** Lines on one order. Long enough for a weekly wholesale run, short enough to print. */
    private const int MAX_LINES = 200;

    /** Number mints attempted per order before the batch fails loudly. */
    private const int MAX_NUMBER_ATTEMPTS = 3;

    public function __construct(
        private PurchaseOrderNumbers $numbers,
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * One draft per supplier, created together or not at all, returned in
     * request order.
     *
     * Request order rather than creation order or number order, and they are the
     * same list here only because nothing reorders it: the caller confirmed a
     * grouping preview and the response has to line up with what they looked at,
     * row for row.
     *
     * @param  list<array{supplier_id: string, lines: list<array{stock_item_id: string, quantity: string}>}>  $orders
     * @return list<PurchaseOrder>
     *
     * @throws ApiException
     */
    public function createBatch(string $organisationId, string $branchId, array $orders): array
    {
        $this->branch($branchId);

        if ($orders === [] || count($orders) > self::MAX_ORDERS) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A batch creates between one and '.self::MAX_ORDERS.' purchase orders.',
                ['parameter' => 'orders'],
            );
        }

        // Every identifier resolved and every quantity read before a single row
        // is written, so a batch that is going to be refused is refused without
        // having opened a transaction at all.
        $prepared = [];

        foreach ($orders as $order) {
            $supplier = $this->supplier($order['supplier_id']);

            if ($supplier->isArchived()) {
                throw $this->archived($supplier);
            }

            $prepared[] = [
                'supplier' => $supplier,
                'lines' => $this->resolveLines($supplier, $order['lines']),
            ];
        }

        /** @var list<PurchaseOrder> $created */
        $created = DB::transaction(function () use ($organisationId, $branchId, $prepared): array {
            $rows = [];

            foreach ($prepared as $order) {
                /** @var Supplier $supplier */
                $supplier = $order['supplier'];
                /** @var list<array<string, mixed>> $lines */
                $lines = $order['lines'];

                $record = $this->insertHeader($organisationId, $branchId, (string) $supplier->getKey());
                $this->writeLines($record, $lines);

                $this->audit->record(
                    'procurement.purchase_order_created',
                    actorUserId: $this->context->userId(),
                    subjectType: 'purchase_order',
                    subjectId: (string) $record->getKey(),
                    metadata: [
                        'number' => $record->number,
                        'supplier_id' => (string) $supplier->getKey(),
                        'branch_id' => $branchId,
                        'line_count' => count($lines),
                    ],
                );

                $rows[] = $record;
            }

            return $rows;
        });

        return $created;
    }

    /**
     * Rewrite a draft's notes, its lines, or both.
     *
     * Presence-keyed like every other partial write in this module: an omitted
     * key is left alone, `notes: null` clears the note. `lines` is a **full
     * replace** — the body is the whole desired set — and every line is
     * re-snapshotted from the database rather than carried over, so a shelf
     * renamed since the draft was created is renamed on the draft too. That is
     * correct precisely because a draft has not been handed to anybody yet;
     * issuing is the moment the wording stops moving.
     *
     * @param  array{notes?: string|null, lines?: list<array{stock_item_id: string, quantity: string}>}  $attributes
     *
     * @throws ApiException
     */
    public function updateDraft(PurchaseOrder $order, array $attributes): PurchaseOrder
    {
        $this->requireDraft($order);

        $lines = null;

        if (array_key_exists('lines', $attributes)) {
            $supplier = $this->supplier((string) $order->supplier_id);
            $lines = $this->resolveLines($supplier, $attributes['lines']);
        }

        DB::transaction(function () use ($order, $attributes, $lines): void {
            if (array_key_exists('notes', $attributes)) {
                $notes = $attributes['notes'];
                $trimmed = $notes === null ? null : trim($notes);
                $order->notes = $trimmed === '' ? null : $trimmed;
                $order->save();
            }

            if ($lines === null) {
                return;
            }

            // Delete then write, rather than diff: the request states the whole
            // set, and a diff would have to invent an identity for a line the
            // client does not name. Inside the transaction, so a replace that
            // failed halfway cannot leave an order shorter than either version.
            PurchaseOrderLine::query()->where('purchase_order_id', $order->getKey())->delete();
            $this->writeLines($order, $lines);
        });

        $this->audit->record(
            'procurement.purchase_order_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'purchase_order',
            subjectId: (string) $order->getKey(),
            metadata: [
                'number' => $order->number,
                'notes_changed' => array_key_exists('notes', $attributes),
                'line_count' => $lines === null ? null : count($lines),
            ],
        );

        return $order->refresh();
    }

    /**
     * Freeze the document and record who it was addressed to.
     *
     * Two things happen and both are the point. The status moves `draft →
     * issued`, after which {@see PurchaseOrderStatus::linesAreEditable()} refuses
     * every further edit — the supplier is holding a copy, and an order that
     * could still change would make their copy a fiction. And
     * `recipient_snapshot` captures the supplier exactly as it stands *now*, so
     * a reprint in June reproduces the document handed over in February even
     * though the supplier has since moved premises and replaced its sales rep.
     *
     * An archived supplier is refused here as §3.1 requires. It is also refused
     * at create, so reaching this refusal means the supplier was archived while
     * the draft sat — which is exactly the case worth refusing.
     *
     * @throws ApiException
     */
    public function issue(PurchaseOrder $order): PurchaseOrder
    {
        if (! $order->status->canTransitionTo(PurchaseOrderStatus::Issued)) {
            throw $this->conflict($order, 'purchase_order_not_draft', 'Only a draft purchase order can be issued.');
        }

        $supplier = $this->supplier((string) $order->supplier_id);

        if ($supplier->isArchived()) {
            throw $this->archived($supplier);
        }

        $order->status = PurchaseOrderStatus::Issued;
        $order->issued_at = now();
        $order->recipient_snapshot = $this->recipientSnapshot($supplier);
        $order->save();

        $this->audit->record(
            'procurement.purchase_order_issued',
            actorUserId: $this->context->userId(),
            subjectType: 'purchase_order',
            subjectId: (string) $order->getKey(),
            metadata: [
                'number' => $order->number,
                'supplier_id' => (string) $supplier->getKey(),
                'branch_id' => (string) $order->branch_id,
            ],
        );

        return $order;
    }

    /**
     * Stop an order that has not been delivered against.
     *
     * Deletes nothing (§3.5): the row, its lines and its snapshot all stay, and
     * `issued_at` is deliberately left in place — cancelling an issued order
     * does not un-issue it, and a reprint of a cancelled order should still show
     * when it went out.
     *
     * **An order with a delivery against it cannot be cancelled** (§3.5), and
     * that is checked here rather than left to the status. The enum already
     * refuses `partially_received → cancelled`, which covers the ordinary case;
     * this guard covers the edge the enum cannot see — a receipt exists and the
     * status has not caught up — and it runs **first**, so that when both apply
     * the caller gets the reason that explains the situation rather than the one
     * that merely restates the status.
     *
     * @throws ApiException
     */
    public function cancel(PurchaseOrder $order): PurchaseOrder
    {
        if (GoodsReceipt::query()->where('purchase_order_id', $order->getKey())->exists()) {
            throw $this->conflict(
                $order,
                'purchase_order_received_against',
                'Something has already been delivered against this order, so it cannot be cancelled as though nothing happened.',
            );
        }

        if (! $order->status->canTransitionTo(PurchaseOrderStatus::Cancelled)) {
            throw $this->conflict(
                $order,
                'purchase_order_not_cancellable',
                'Only a draft or issued purchase order can be cancelled.',
            );
        }

        $order->status = PurchaseOrderStatus::Cancelled;
        $order->cancelled_at = now();
        $order->save();

        $this->audit->record(
            'procurement.purchase_order_cancelled',
            actorUserId: $this->context->userId(),
            subjectType: 'purchase_order',
            subjectId: (string) $order->getKey(),
            metadata: [
                'number' => $order->number,
                'supplier_id' => (string) $order->supplier_id,
                'branch_id' => (string) $order->branch_id,
            ],
        );

        return $order;
    }

    /* ── writing ─────────────────────────────────────────────────────────── */

    /**
     * Insert one order header with a freshly minted number, re-minting on the
     * one collision the database can raise here.
     *
     * See the class docblock for why this is a nested transaction and why the
     * lines are not inside it. The SQLSTATE is matched rather than the message,
     * for the reason `OrderIdempotency` gives: an error message is a locale and
     * a server version away from changing, and `23505` is neither.
     *
     * @throws ApiException
     */
    private function insertHeader(string $organisationId, string $branchId, string $supplierId): PurchaseOrder
    {
        for ($attempt = 1; $attempt <= self::MAX_NUMBER_ATTEMPTS; $attempt++) {
            $number = $this->numbers->next($organisationId);

            try {
                /** @var PurchaseOrder $order */
                $order = DB::transaction(fn (): PurchaseOrder => PurchaseOrder::query()->create([
                    'organisation_id' => $organisationId,
                    'branch_id' => $branchId,
                    'supplier_id' => $supplierId,
                    'number' => $number,
                    'status' => PurchaseOrderStatus::Draft,
                ]));

                return $order;
            } catch (QueryException $exception) {
                // 23505 on `(organisation_id, number)` — somebody else minted the
                // same eight characters between the pre-check and the insert.
                // An expected outcome, not a fault. Any other SQLSTATE is a real
                // failure and swallowing it would turn a broken foreign key into
                // a batch that silently created nothing.
                if ($exception->getCode() !== '23505' || $attempt === self::MAX_NUMBER_ATTEMPTS) {
                    throw $exception;
                }
            }
        }

        throw new RuntimeException('Could not allocate a purchase order number after '.self::MAX_NUMBER_ATTEMPTS.' attempts.');
    }

    /**
     * @param  list<array<string, mixed>>  $lines  already resolved by resolveLines()
     */
    private function writeLines(PurchaseOrder $order, array $lines): void
    {
        foreach ($lines as $line) {
            PurchaseOrderLine::query()->create($line + ['purchase_order_id' => $order->getKey()]);
        }
    }

    /* ── resolving what a line says ──────────────────────────────────────── */

    /**
     * Turn `{stock_item_id, quantity}` requests into rows, with every display
     * field read from the database.
     *
     * One query for the shelves, one for the Arabic names on each side and one
     * for the supplier's references — never one per line. A weekly order of
     * ninety shelves must cost a handful of reads, which is the same rule
     * {@see LastPurchasePriceQuery} and {@see OrderProposalService} are built
     * around.
     *
     * `display_order` is the request's own sequence. The builder hands over the
     * grouping a person read top to bottom, and the printed sheet has to be
     * recognisably the same list.
     *
     * @param  list<array{stock_item_id: string, quantity: string}>  $lines
     * @return list<array<string, mixed>>
     *
     * @throws ApiException
     */
    private function resolveLines(Supplier $supplier, array $lines): array
    {
        if ($lines === [] || count($lines) > self::MAX_LINES) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'An order carries between one and '.self::MAX_LINES.' lines.',
                ['parameter' => 'lines'],
            );
        }

        $wanted = array_map(static fn (array $line): string => $line['stock_item_id'], $lines);

        if (count(array_unique($wanted)) !== count($wanted)) {
            // The unique index would refuse it anyway; refusing here names the
            // problem instead of surfacing a raw constraint violation.
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'An order names each item once.',
                ['parameter' => 'lines'],
            );
        }

        /** @var Collection<string, StockItem> $stockItems */
        $stockItems = StockItem::query()
            ->whereKey($wanted)
            ->get()
            ->keyBy(static fn (StockItem $item): string => (string) $item->getKey());

        $arabicNames = $this->arabicNames($stockItems);
        $references = $this->supplierReferences($supplier, $wanted);

        $rows = [];

        foreach ($lines as $index => $line) {
            $stockItem = $stockItems->get($line['stock_item_id']);

            // Not found rather than forbidden: a shelf belonging to another
            // kitchen and a shelf that never existed are the same answer.
            if (! $stockItem instanceof StockItem) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            $key = (string) $stockItem->getKey();

            $rows[] = [
                'stock_item_id' => $key,
                'quantity' => $this->quantity((string) $line['quantity']),
                'unit_id' => $stockItem->unit_id,
                'unit_code' => $stockItem->unit_code,
                'item_code' => $stockItem->code,
                'item_name_en' => $stockItem->name_en,
                'item_name_ar' => $arabicNames[$key] ?? null,
                // Read from the link, never sent by the client: it is the
                // supplier's own catalogue reference and the whole reason to
                // print it is that the supplier recognises it.
                'supplier_item_ref' => $references[$key] ?? null,
                // The column exists for a later slice's per-line remark. Nothing
                // writes it yet, and a client field that quietly did nothing
                // would be worse than its absence.
                'notes' => null,
                'display_order' => $index,
            ];
        }

        return $rows;
    }

    /**
     * The Arabic name for each shelf, or nothing.
     *
     * `stock_items` carry `name_en` only, so the Arabic half of a bilingual
     * document is resolved from **the entity that named the shelf**: the
     * catalogue item when the row is product-backed (its `name_en` is the
     * product's), otherwise the backing ingredient. There is no cross-entity
     * fallback — a product shelf always keeps an anchor `ingredient_id` for
     * costing, and the anchor names the raw good rather than the product, so
     * borrowing its Arabic would caption one thing in English and another in
     * Arabic on the same printed line.
     *
     * `null` is an honest answer and the column is nullable for it. Falling back
     * to the English name would put English text under an Arabic heading on a
     * printed sheet, which is worse than a blank.
     *
     * @param  Collection<string, StockItem>  $stockItems
     * @return array<string, string>
     */
    private function arabicNames(Collection $stockItems): array
    {
        $ingredientIds = $stockItems->pluck('ingredient_id')->filter()->unique()->values()->all();
        $catalogueItemIds = $stockItems->pluck('catalogue_item_id')->filter()->unique()->values()->all();

        /** @var array<string, string> $byIngredient */
        $byIngredient = $ingredientIds === []
            ? []
            : Ingredient::query()->whereKey($ingredientIds)->pluck('name_ar', 'id')->all();

        /** @var array<string, string> $byCatalogueItem */
        $byCatalogueItem = $catalogueItemIds === []
            ? []
            : CatalogueItem::query()->whereKey($catalogueItemIds)->pluck('name_ar', 'id')->all();

        $names = [];

        foreach ($stockItems as $key => $stockItem) {
            $name = $stockItem->catalogue_item_id !== null
                ? ($byCatalogueItem[$stockItem->catalogue_item_id] ?? null)
                : ($stockItem->ingredient_id === null ? null : ($byIngredient[$stockItem->ingredient_id] ?? null));

            if ($name !== null && $name !== '') {
                $names[(string) $key] = $name;
            }
        }

        return $names;
    }

    /**
     * The supplier's own catalogue reference per shelf, from the saved link.
     *
     * A shelf this supplier has no link for simply has none — ordering a one-off
     * from somebody who does not normally sell it is ordinary (§4), and the
     * order sheet carries the kitchen's own code in that case.
     *
     * @param  list<string>  $stockItemIds
     * @return array<string, string>
     */
    private function supplierReferences(Supplier $supplier, array $stockItemIds): array
    {
        /** @var array<string, string> $references */
        $references = SupplierStockItem::query()
            ->where('supplier_id', $supplier->getKey())
            ->whereIn('stock_item_id', $stockItemIds)
            ->whereNotNull('supplier_item_ref')
            ->pluck('supplier_item_ref', 'stock_item_id')
            ->all();

        return $references;
    }

    /**
     * Who this order was addressed to, at the instant of issue (§3.5).
     *
     * Everything a printed sheet names: the supplier's bilingual name, its
     * address, the terms and lead time it quoted, the general office line, and
     * every named contact with the primary first. Frozen because the document is
     * a record of what was handed over, not a live view of the supplier.
     *
     * The key `code` is used here without hesitation, and the reason is worth
     * stating because the module's other services avoid it: `AuditRecorder`
     * redacts any **audit metadata** key containing `code` as a substring, which
     * is why `supplier_item_ref` is named as it is. This is a JSON column on a
     * business record, not audit metadata — nothing redacts it, and the field
     * has to print as the supplier's own reference for them to recognise it.
     *
     * @return array<string, mixed>
     */
    private function recipientSnapshot(Supplier $supplier): array
    {
        $contacts = SupplierContact::query()
            ->where('supplier_id', $supplier->getKey())
            ->orderByDesc('is_primary')
            ->orderBy('display_order')
            ->orderBy('name')
            ->get();

        return [
            'supplier_id' => (string) $supplier->getKey(),
            'code' => $supplier->code,
            'name_en' => $supplier->name_en,
            'name_ar' => $supplier->name_ar,
            'address' => $supplier->address,
            'payment_terms' => $supplier->payment_terms,
            'lead_time_days' => $supplier->lead_time_days,
            'contact_email' => $supplier->contact_email,
            'contact_phone' => $supplier->contact_phone,
            'contacts' => $contacts->map(static fn (SupplierContact $contact): array => [
                'name' => $contact->name,
                'role_title' => $contact->role_title,
                'email' => $contact->email,
                'phone' => $contact->phone,
                'whatsapp_phone' => $contact->whatsapp_phone,
                'is_primary' => $contact->is_primary,
            ])->all(),
        ];
    }

    /* ── lookups and refusals ────────────────────────────────────────────── */

    /**
     * @throws ApiException
     */
    private function branch(string $branchId): OrganisationBranch
    {
        $branch = OrganisationBranch::query()->whereKey($branchId)->first();

        if ($branch === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $branch;
    }

    /**
     * @throws ApiException
     */
    private function supplier(string $supplierId): Supplier
    {
        $supplier = Supplier::query()->whereKey($supplierId)->first();

        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $supplier;
    }

    /**
     * @throws ApiException
     */
    private function requireDraft(PurchaseOrder $order): void
    {
        if (! $order->status->linesAreEditable()) {
            throw $this->conflict(
                $order,
                'purchase_order_not_draft',
                'Only a draft purchase order can be edited.',
            );
        }
    }

    private function conflict(PurchaseOrder $order, string $reason, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ResourceConflict,
            $message,
            ['reason' => $reason, 'status' => $order->status->value],
        );
    }

    private function archived(Supplier $supplier): ApiException
    {
        return new ApiException(
            ErrorCode::ResourceConflict,
            'That supplier is archived. Restore it, or choose another.',
            ['reason' => 'supplier_archived', 'supplier_id' => (string) $supplier->getKey()],
        );
    }

    /**
     * A quantity the column can hold, as a decimal string.
     *
     * The regex is stricter than `is_numeric` on purpose: `1e3` and `0x10` are
     * both numeric to PHP and neither is a quantity a person typed into a
     * kitchen form. bcmath then answers the two questions the CHECK constraint
     * asks — above zero, and inside `decimal(14,4)` — before the database has
     * to.
     *
     * This is a backstop rather than the user-facing refusal: the controller's
     * validation names the offending line, which is what somebody staring at a
     * table of forty rows needs. Reaching here means a caller bypassed it.
     *
     * @return numeric-string
     *
     * @throws ApiException
     */
    private function quantity(string $raw): string
    {
        $trimmed = trim($raw);

        // Both halves are real guards. `is_numeric` is the semantic question and
        // is also what narrows the string for bcmath, which returns a confident
        // zero for anything it cannot read rather than erroring — the trap
        // `OrderProposalService` and `InventoryService` both keep this check for.
        // The regex is the stricter shape: `1e3` and `+2` are numeric to PHP and
        // neither is a quantity anybody typed into a kitchen form.
        if (! is_numeric($trimmed) || preg_match('/^\d+(\.\d{1,4})?$/', $trimmed) !== 1) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A quantity is a decimal with at most four decimal places.',
                ['parameter' => 'quantity'],
            );
        }

        if (bccomp($trimmed, '0', self::SCALE) <= 0 || bccomp($trimmed, self::MAX_QUANTITY, self::SCALE) >= 0) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A quantity is above zero and below '.self::MAX_QUANTITY.'.',
                ['parameter' => 'quantity'],
            );
        }

        return bcadd($trimmed, '0', self::SCALE);
    }
}
