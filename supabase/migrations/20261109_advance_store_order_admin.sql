-- Fluxo administrativo de pedidos pagos: paid -> preparing -> shipped -> delivered.
-- Não confirma pagamentos. Somente service_role pode executar.
BEGIN;
CREATE OR REPLACE FUNCTION public.advance_store_order_admin(
  p_order_id uuid,
  p_action text,
  p_tracking_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next text;
  v_tracking text;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Pedido obrigatório'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_order.payment_status <> 'approved' THEN
    RAISE EXCEPTION 'Pedido sem pagamento aprovado';
  END IF;
  IF p_action = 'prepare' AND v_order.order_status = 'paid' THEN
    v_next := 'preparing';
  ELSIF p_action = 'ship' AND v_order.order_status = 'preparing' THEN
    v_next := 'shipped';
  ELSIF p_action = 'deliver' AND v_order.order_status = 'shipped' THEN
    v_next := 'delivered';
  ELSE
    RAISE EXCEPTION 'Transição de status não permitida';
  END IF;
  IF p_action = 'ship' THEN
    v_tracking := pg_catalog.btrim(COALESCE(p_tracking_code, ''));
    IF pg_catalog.length(v_tracking) < 5 OR pg_catalog.length(v_tracking) > 100 THEN
      RAISE EXCEPTION 'Código de rastreamento inválido';
    END IF;
  END IF;
  UPDATE public.orders
     SET order_status = v_next,
         tracking_code = CASE WHEN p_action = 'ship' THEN v_tracking ELSE tracking_code END
   WHERE id = p_order_id;
  INSERT INTO public.order_status_history(order_id,previous_status,new_status,notes)
  VALUES (p_order_id,v_order.order_status,v_next,
          CASE WHEN p_action = 'ship' THEN 'Envio registrado pelo administrador' ELSE 'Status atualizado pelo administrador' END);
  RETURN pg_catalog.jsonb_build_object('order_id',p_order_id,'status',v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_store_order_admin(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.advance_store_order_admin(uuid,text,text) TO service_role;
COMMIT;
