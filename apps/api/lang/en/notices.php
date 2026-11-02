<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Operational notices (en) — App\Mail\NoticeMessage
|--------------------------------------------------------------------------
|
| Quotation life (B2bQuotationNotices) and the weekly stock check
| (StockSufficiencyCheckRunner). Short on purpose: each says what happened
| and links to the one screen where it is acted on.
|
*/

return [
    'order' => [
        'action' => 'See your order',
        'confirmed' => [
            'heading' => ':kitchen confirmed your order :number',
            'body' => 'The kitchen has your order and will start on it in time for your delivery.',
        ],
        'out_for_delivery' => [
            'heading' => 'Your order :number is on its way',
            'body' => 'Your order has left :kitchen and is coming to you now.',
        ],
        'delivered' => [
            'heading' => 'Your order :number was delivered',
            'body' => 'Thank you for ordering from :kitchen. Enjoy your meal.',
        ],
        'cancelled' => [
            'heading' => 'Your order :number was cancelled',
            'body' => ':kitchen cancelled this order. If you have any questions, please contact the kitchen.',
        ],
        'delivery_failed' => [
            'heading' => 'We could not deliver your order :number',
            'body' => 'The driver could not reach you. :kitchen will contact you about what happens next.',
        ],
    ],

    'quotation' => [
        'submitted' => [
            'heading' => 'New quotation request :reference from :buyer',
            'lines' => '{1} :count line to price.|[2,*] :count lines to price.',
            'delivery' => 'First delivery requested for :date.',
            'recurring' => 'The buyer wants this on a standing weekly schedule.',
            'note' => 'Their note: :note',
            'action' => 'Price the request',
        ],
        'quoted' => [
            'heading' => 'Your quotation :reference is priced',
            'total' => 'Quoted total: :total.',
            'expires' => 'The price holds until :date.',
            'action' => 'Review and accept',
        ],
        'accepted' => [
            'heading' => ':buyer accepted quotation :reference',
            'orders' => '{1} One order placed, for :date.|[2,*] :count weekly orders placed, the first for :date.',
            'action' => 'Open the order calendar',
        ],
        'declined' => [
            'heading' => ':buyer declined quotation :reference',
            'reason' => 'Their reason: :reason',
            'action' => 'Open quotations',
        ],
    ],
    'b2b_application' => [
        'information_requested' => [
            'heading' => 'We need a little more for your business application :reference',
            'action' => 'Update your application',
        ],
        'approved' => [
            'heading' => 'Your business application :reference is approved',
            'next' => 'We are preparing your trading agreement. You will get another email when it is ready to sign.',
            'action' => 'See your application',
        ],
        'declined' => [
            'heading' => 'Your business application :reference was not approved',
            'action' => 'See the reason',
        ],
        'agreement_sent' => [
            'heading' => 'Your trading agreement for :reference is ready to sign',
            'seller' => 'You will buy from :seller.',
            'action' => 'Read and sign',
        ],
        'provisioned' => [
            'heading' => 'Your business account for :company is open',
            'next' => 'You can order now, and invite your colleagues from the account settings.',
            'action' => 'Open your workspace',
        ],
    ],
    'b2b_invitation' => [
        'heading' => 'You have been invited to :company on Healthy360',
        'intro' => ':company now buys through Healthy360. Accept the invitation to order for the company and follow its deliveries.',
        'expiry' => 'Accepting requires signing in with this email address. The link expires in a few days.',
        'action' => 'Accept the invitation',
    ],
    'stock' => [
        'heading' => '{1} Weekly stock check: :count item short for :from – :to|[2,*] Weekly stock check: :count items short for :from – :to',
        'line' => ':name — short :short :unit, buy :buy :unit',
        'more' => '…and :count more.',
        'holes' => '{1} :count day has demand nobody could work out (a missing recipe or menu).|[2,*] :count days have demand nobody could work out (a missing recipe or menu).',
        'action' => 'Open the buy list',
    ],
    'staff_alert' => [
        'action' => 'Open kitchen orders',
        'total' => 'Order total: :total.',
        'unaccepted_manager' => [
            'heading' => 'Order :number has not been accepted',
            'line' => 'It has passed its alert time and nobody in the kitchen has accepted it.',
            'sms' => 'Healthy360: order :number has not been accepted. Please check the kitchen.',
        ],
        'unaccepted_owner' => [
            'heading' => 'Order :number is still not accepted',
            'line' => 'Your managers were alerted and the order is still waiting.',
            'sms' => 'Healthy360: order :number is still not accepted after your managers were alerted.',
        ],
        'allergy_order' => [
            'heading' => 'New order :number has an allergy on it',
            'line' => 'Read the allergy details on the order before it is cooked.',
        ],
        'late_cancel' => [
            'heading' => 'Order :number was cancelled after cooking started',
            'line' => 'Check what was already made for it.',
        ],
        'delivery_failed' => [
            'heading' => 'Delivery failed for order :number',
            'line' => 'The order needs a decision from you.',
        ],
        'no_cash_collected' => [
            'heading' => 'No cash was collected for order :number',
            'line' => 'The driver delivered it without collecting any cash. Follow it up with the driver.',
        ],
        'refund_approval' => [
            'heading' => 'A refund on order :number needs your approval',
            'line' => 'It is above your kitchen limit. Open the order to approve or reject it.',
        ],
    ],
];
