-- Confirmação administrativa SOMENTE de PIX direto efetivamente recebido.
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_direct_pix_order_admin(p_order_id uuid,p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_order public.orders%ROWTYPE; v_ref text;
BEGIN
 v_ref := pg_catalog.btrim(COALESCE(p_reference,''));
 IF p_order_id IS NULL OR pg_catalog.length(v_ref)<6 OR pg_catalog.length(v_ref)>200 THEN
   RAISE EXCEPTION 'Pedido ou referência de pagamento inválida';
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
 IF v_order.payment_method <> 'pix_whatsapp' THEN RAISE EXCEPTION 'Somente PIX direto pode ser confirmado manualmente'; END IF;
 IF v_order.order_status <> 'pending_payment' OR v_order.payment_status <> 'pending'
    OR v_order.payment_expires_at IS NULL OR v_order.payment_expires_at <= pg_catalog.now() THEN
   RAISE EXCEPTION 'Pedido não está pendente ou já venceu';
 END IF;
 UPDATE public.orders SET payment_status='approved',order_status='paid' WHERE id=p_order_id;
 INSERT INTO public.order_status_history(order_id,previous_status,new_status,notes)
 VALUES(p_order_id,'pending_payment','paid','PIX direto conferido manualmente. Referência: '||v_ref);
 RETURN pg_catalog.jsonb_build_object('order_id',p_order_id,'status','paid');
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_direct_pix_order_admin(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_direct_pix_order_admin(uuid,text) TO service_role;
COMMIT;
