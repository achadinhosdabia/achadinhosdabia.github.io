-- Achadinhos da BIA: proteção contra pedidos duplicados.
-- REVISAR antes de executar no Supabase. Nenhum pedido é criado por esta migração.
-- A chave UUID identifica uma tentativa lógica de compra; repetir a chave
-- devolve o mesmo pedido, sem descontar estoque novamente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_order_idempotency (
  request_key uuid PRIMARY KEY,
  payload_hash text NOT NULL,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.store_order_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.store_order_idempotency TO service_role;
ALTER TABLE public.store_order_idempotency ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_store_order_idempotent(
  p_request_key uuid,
  p_customer jsonb,
  p_items jsonb,
  p_shipping jsonb,
  p_payment_method text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_hash text;
  v_saved record;
  v_response jsonb;
BEGIN
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória';
  END IF;

  -- Bloqueio transacional: duas chamadas simultâneas com a mesma chave
  -- são serializadas antes de consultar ou criar o pedido.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_key::text, 0)
  );

  v_hash := pg_catalog.md5(
    pg_catalog.jsonb_build_array(
      p_customer, p_items, p_shipping, p_payment_method
    )::text
  );

  SELECT payload_hash, response
    INTO v_saved
    FROM public.store_order_idempotency
   WHERE request_key = p_request_key;

  IF FOUND THEN
    IF v_saved.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'Chave de pedido reutilizada com dados diferentes';
    END IF;
    RETURN v_saved.response;
  END IF;

  v_response := public.create_store_order(
    p_customer, p_items, p_shipping, p_payment_method
  );

  INSERT INTO public.store_order_idempotency (
    request_key, payload_hash, order_id, response
  ) VALUES (
    p_request_key, v_hash,
    (v_response->>'order_id')::uuid, v_response
  );

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_store_order_idempotent(
  uuid, jsonb, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order_idempotent(
  uuid, jsonb, jsonb, jsonb, text
) TO service_role;

COMMIT;
