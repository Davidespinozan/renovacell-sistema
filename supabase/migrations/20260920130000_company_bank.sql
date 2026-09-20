-- R-58: la ventana de transferencia no decía a qué cuenta depositar (estaba escrito
-- "a la cuenta de Renovacell" sin CLABE/banco/beneficiario). Se agregan los datos bancarios
-- a company_settings para capturarlos en Configuración y mostrarlos en el modal de pago.
-- Solo columnas nuevas (nullable); no toca datos existentes. RLS ya existente (admin escribe).
alter table public.company_settings add column if not exists banco   text;
alter table public.company_settings add column if not exists clabe   text;
alter table public.company_settings add column if not exists cuenta  text;
alter table public.company_settings add column if not exists titular text;
