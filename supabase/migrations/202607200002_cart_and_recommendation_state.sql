-- Keep discovery, a user-owned cart, checkout verification, and payment as
-- distinct states. Recommendations must never be mistaken for an order.
alter table public.purchase_intents drop constraint if exists purchase_intents_state_check;
alter table public.purchase_intents add constraint purchase_intents_state_check check (state in (
  'suggested', 'selected', 'confirmed', 'policy_authorized', 'approval_required', 'approval_authorized',
  'payment_submitted', 'payment_confirmed', 'order_confirmed', 'cancelled', 'expired', 'failed'
));

create index if not exists purchase_intents_session_cart_idx
  on public.purchase_intents(user_id, session_id, state, updated_at desc);
