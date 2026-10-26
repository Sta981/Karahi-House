# Confirmed DEMO ticket handoff

Before this update, `/voice` sent an in-memory summary to the tab through `call_end`; the text endpoint returned a summary as JSON. Neither sent email or simulated SMS. The inactive phone webhook only logged summary kind and item count.

The new handoff runs only for an order summary after explicit read-back confirmation. Catering/inquiry, incomplete and `needs_review` summaries cannot trigger an order email. Nothing goes to the restaurant.

In the voice flow, the final read-back ends with **“Anything else?”**. Declining more items confirms that current, complete read-back; “yes” resumes ordering. A changed cart requires a new read-back. The legacy text API asks **“Is that correct?”** and requires yes. These are separate explicit engine modes; no/yes are never assigned opposite meanings within one question. The final voice goodbye finishes playback before the browser releases the mic; a synthesis failure does not emit a successful call-end marker.

1. Ticket creation validates items, required choices and prices against the current local menu.
2. The ticket is labelled `DEMO`, `pending_acceptance`, `staffAccepted: false`.
3. The browser receives a redacted ticket and notification receipt. Voice speech runs alongside email; only final call closure waits for the bounded attempt. The final text request waits for that attempt.
4. When explicitly enabled, a plain-text DEMO email goes through Resend to one configured owner test inbox. Disabled, not configured, sending, failed and provider accepted are distinct statuses. Provider acceptance is not proof of inbox delivery.
5. SMS is a preview labelled **SIMULATED SMS; NOT SENT**, always `sent: false`. No carrier API or phone recipient is configured.

## Environment names

```dotenv
DEMO_NOTIFICATIONS_ENABLED=
RESEND_API_KEY=
DEMO_NOTIFICATION_EMAIL=
```

All example values are empty. Set the enable flag explicitly to true locally; keys alone do not enable delivery. Use your own Resend signup inbox. The fixed sender is `Karahi House DEMO <onboarding@resend.dev>`; callers/API payloads cannot override sender/recipient. Resend restricts that sender to its account inbox ([official restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). No real SMS credentials are needed. Default voice still needs `DEEPGRAM_API_KEY`.

`npm run check:env` reports presence/enablement, never values. `.env.local` remains ignored. This update does not edit/enable your private configuration or send a real test email automatically.

## Storage and privacy

| Location | Retained data | Lifetime |
|---|---|---|
| Server RAM | Redacted structured ticket/receipt; at most 100 | Thirty minutes, eviction, or restart |
| Current tab | Redacted ticket and receipt | Session reset, reload or tab close |
| Explicit JSON download | Redacted ticket only | Your local file; delete under your retention policy |
| Resend and your inbox, only if enabled | Plain-text redacted email | External provider/inbox retention |

Callback numbers, including spelled-out digit sequences in names/notes, are redacted. The callback field is a marker or “not provided”. Ticket allowlists exclude audio, transcript/history and `transcriptHint`. Provider response bodies are not logged; failures expose only generic reason/status. Staff cannot make a real callback from this redacted ticket alone.

There is no disk ticket database, durable outbox, staff acceptance UI, delivery webhook or POS. Restart loses memory and may lose unfinished sending work. The inbox/tab may retain another copy. Text and voice sessions have independent identities. Repeated confirmation in a session reuses its memory receipt. Resend receives a stable idempotency key with a documented twenty-four-hour window ([official behavior](https://resend.com/docs/dashboard/emails/idempotency-keys)); this is not a production exactly-once guarantee across restarts.

Email has a five-second timeout and no automatic retry. Simulated SMS remains available if email fails/misses credentials. Text notifications require matching application Origin; equivalent direct-loopback hosts are accepted. Inactive legacy Twilio endpoints do not send notifications.

`npm run test:notifications` uses mocks, never a real inbox. It checks opt-in, recipient scope, duplicates, menu/price validation, redaction, failures, confirmation-only dispatch, Origin checks and audio before slow email completion. A real configured-inbox delivery test remains for the owner; do not claim arrival until visible there.
