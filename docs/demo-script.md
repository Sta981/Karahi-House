# Five-minute Karahi House client demo

This is a scripted development walkthrough, not a recognition-accuracy test. Expected answers below are deterministic replies with the voice engine's `anything_else` closing mode. STT may mishear a phrase; check the Roman transcript. Never claim that staff accepted an order. The legacy text API retains its separate “Is that correct?” / yes confirmation mode.

Open `/voice` and wear headphones. Nova-3 multilingual with English/Hindi hints is the default for mixed-language testing; select Nova-3 Indian English to repeat the older English-only configuration. This is not an accent-model winner claim. Show the build/configuration label and start with an empty cart. Use Ignore interruptions when presenting the order flow rather than barge-in.

Optional handoff environment names (private values only):

```dotenv
DEMO_NOTIFICATIONS_ENABLED=
RESEND_API_KEY=
DEMO_NOTIFICATION_EMAIL=
```

The enable flag must explicitly be true. Use your own Resend account inbox; its built-in test sender is restricted to that address ([official rule](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). No carrier account or real SMS is involved. Missing credentials must be presented as “email not configured”. Restart only after finishing an active call.

## Walkthrough

Speak one row at a time and wait for the full reply. The five minutes include time to explain and show the ticket.

| Time | Exact caller phrase / action | Expected agent answer |
|---|---|---|
| 0:00–0:20 | Click **Start microphone**. | Thanks for calling Karahi House. What would you like? |
| 0:20–0:40 | “one chicken lahori karahi” | Half or Full for Chicken Lahori Karahi? |
| 0:40–0:55 | “full” | Added 1 Chicken Lahori Karahi, Full. Noted. Anything else? |
| 0:55–1:15 | “two garlic naan” | Added 2 Garlic Naan Bread. Anything else? |
| 1:15–1:35 | “make it three” | Added 1 Garlic Naan Bread; 3 total. 3 Garlic Naan Bread total. Anything else? |
| 1:35–1:50 | “one mango lassi” | Added 1 Mango Lassi. Anything else? |
| 1:50–2:10 | “remove one mango lassi” | Removed 1 Mango Lassi, 0 left. Anything else? |
| 2:10–2:40 | “what do you have in desserts” | Falooda Ice Cream $7.99; Gulab Jamun $4.99; Kheer $4.99; Rasmalai $4.99. Want more? |
| 2:40–3:00 | “that's all” | Spice for the order: Extra Spicy, Spicy, Medium Spice, Mild Spice, No Spice? |
| 3:00–3:25 | “mild spice” | Changed 1 Chicken Lahori Karahi, Full to 1 Chicken Lahori Karahi, Full, Mild Spice. Changed 3 Garlic Naan Bread to 3 Garlic Naan Bread, Mild Spice. Mild Spice for the order. What name for pickup? |
| 3:25–4:10 | “Demo Guest” | Please check: 1 Chicken Lahori Karahi, Full, Mild Spice; 3 Garlic Naan Bread, Mild Spice. Subtotal $47.97; tax is not configured. Pickup, payment at pickup. Anything else? |
| 4:10–4:30 | Check the read-back, then say “no”. | Thanks for calling Karahi House. Your demo request is pending staff acceptance. |
| 4:30–5:00 | Show the DEMO ticket, email status and simulated SMS. Download the redacted JSON if desired. | The closing reply finishes, then the microphone releases. No extra caller phrase is needed to end. |

The correction sets the naan total to three, rather than adding three more. The dessert question adds no food. Whole-order spice waits until completion. The final cart has no Mango Lassi or dessert. After the read-back, “yes” means more ordering and never submits a ticket. “No”, “enough” and equivalent completion answers confirm no more items; corrections invalidate the old read-back. Missing choices/name and staff-review orders cannot use this shortcut.

## Expected ticket

| Item | Quantity | Size | Spice | Line total |
|---|---:|---|---|---:|
| Chicken Lahori Karahi | 1 | Full | Mild Spice | $36.00 |
| Garlic Naan Bread | 3 | No size choice | Mild Spice | $11.97 |
| **Subtotal** | | | | **$47.97** |

Notes are empty; name is Demo Guest. The ticket has `label: DEMO`, `demo: true`, `status: pending_acceptance`, `staffAccepted: false`, pickup/payment at pickup, and tax not configured. Callback is “not provided”; any supplied number is represented only as “[redacted]”.

The ticket stays in tab memory; its bounded server memory copy expires after thirty minutes or on restart. Downloading creates a local JSON file. Only when enabled/configured does the redacted ticket go to your test inbox; simulated SMS has `sent: false`. Provider acceptance is not inbox delivery or restaurant acceptance. No caller audio/transcript is attached or saved by notifications. See [delivery behavior](ticket-delivery.md).

## Recovery

If a transcript is wrong, show the transcript/cart and allow clarification. Do not present an unsafe addition as success. Avoid rapidly repeating a phrase over playback. Restart with an empty cart or demonstrate the same engine through text, explicitly labelling that fallback. This walkthrough is not an independent accent evaluation.

`npm run test:demo-script` checks this sequence, exact replies, modifiers, removal and subtotal. Cart disclosure/read-back can exceed the short-reply target.
