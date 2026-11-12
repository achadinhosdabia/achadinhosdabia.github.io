-- Preparação da reconciliação Mercado Pago: NÃO EXECUTAR ATÉ REVISAR/VALIDAR EM HOMOLOGAÇÃO.
-- A associação deve ser gravada na criação da cobrança; não inferir apenas do webhook.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mp_order_links (
  store_order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  mp_order_id text NOT NULL UNIQUE,
  external_reference text NOT NULL UNIQUE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  environment text NOT NULL CHECK (environment IN ('test','production')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mp_order_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mp_order_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.mp_order_links TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_verified_mp_payment(
  p_store_order_id uuid,
  p_mp_order_id text,
  p_external_reference text,
  p_amount_cents bigint,
  p_environment text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_link public.mp_order_links%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  -- A função só pode ser chamada por service_role, após verificação da API do provedor.
  IF p_store_order_id IS NULL OR p_mp_order_id IS NULL OR p_external_reference IS NULL
     OR p_amount_cents IS NULL OR p_environment NOT IN ('test','production') THEN
    RAISE EXCEPTION 'Dados de conciliação incompletos';
  END IF;
  SELECT * INTO v_link FROM public.mp_order_links
   WHERE store_order_id=p_store_order_id FOR UPDATE;
  IF NOT FOUND OR v_link.mp_order_id<>p_mp_order_id
     OR v_link.external_reference<>p_external_reference
     OR v_link.amount_cents<>p_amount_cents OR v_link.environment<>p_environment THEN
    RAISE EXCEPTION 'Vínculo de pagamento divergente';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_store_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.payment_method<>'mercado_pago'
     OR pg_catalog.round(v_order.total::numeric*100)::bigint<>p_amount_cents THEN
    RAISE EXCEPTION 'Pedido ou valor incompatível';
  END IF;
  IF v_order.payment_status='approved' AND v_order.order_status='paid' THEN
    RETURN false;
  END IF;
  IF v_order.payment_status<>'pending' OR v_order.order_status<>'pending_payment' THEN
    RAISE EXCEPTION 'Pedido não está pendente';
  END IF;
  UPDATE public.orders SET payment_status='approved',order_status='paid'
   WHERE id=p_store_order_id;
  INSERT INTO public.order_status_history(order_id,previous_status,new_status,notes)
   VALUES(p_store_order_id,'pending_payment','paid','Pagamento Mercado Pago verificado por serviço autorizado');
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_verified_mp_payment(uuid,text,text,bigint,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_verified_mp_payment(uuid,text,text,bigint,text)
 TO service_role;
COMMIT;
