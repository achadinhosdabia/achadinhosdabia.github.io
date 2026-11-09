-- Cancelamento manual seguro: somente pedidos aguardando pagamento.
-- Executar no SQL Editor antes de publicar admin-cancel-order.
BEGIN;
CREATE OR REPLACE FUNCTION public.cancel_store_order_admin(p_order_id uuid, p_reason text DEFAULT 'Cancelamento administrativo')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_released integer;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Pedido obrigatório'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_order.order_status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('order_id', p_order_id, 'status', 'already_cancelled');
  END IF;
  IF v_order.order_status <> 'pending_payment' OR v_order.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'Apenas pedidos aguardando pagamento podem ser cancelados por esta operação';
  END IF;
  UPDATE public.orders SET
    order_status = 'cancelled',
    payment_status = 'cancelled',
    cancelled_at = pg_catalog.now(),
    cancellation_reason = pg_catalog.left(pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(p_reason), ''), 'Cancelamento administrativo'), 250)
  WHERE id = p_order_id;
  SELECT public.release_order_stock(p_order_id) INTO v_released;
  INSERT INTO public.order_status_history(order_id, previous_status, new_status, notes)
  VALUES (p_order_id, 'pending_payment', 'cancelled', 'Cancelamento administrativo');
  RETURN pg_catalog.jsonb_build_object('order_id', p_order_id, 'status', 'cancelled', 'released_reservations', v_released);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_store_order_admin(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_store_order_admin(uuid,text) TO service_role;
COMMIT;
