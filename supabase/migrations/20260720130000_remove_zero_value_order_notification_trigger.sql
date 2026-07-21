-- Remove the short-lived insert trigger from existing databases. It fires
-- before create_order calculates the final order total and can create a 0-value
-- notification snapshot.
drop trigger if exists queue_line_order_created_notification_after_insert on public.orders;
drop function if exists public.queue_line_order_created_notification();
