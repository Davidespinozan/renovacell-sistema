// PENDIENTES QUE ABREN YA FILTRADOS (27 nov 2026, «sistema sencillo por rol»): un renglón de la bandeja («CFDI por emitir»,
// «Por cobrar», «Reembolsos por resolver»…) abría su pantalla sin filtrar y había que volver a buscar. El renglón deja
// aquí el filtro con el que la pantalla debe abrir; la pantalla lo toma UNA vez al montarse. Si nadie lo pidió, abre
// como siempre.
const pedidos: Record<string, string> = {}
export const pedirFiltro = (pantalla: string, filtro: string): void => { pedidos[pantalla] = filtro }
export const tomarFiltro = (pantalla: string): string | null => { const f = pedidos[pantalla] ?? null; delete pedidos[pantalla]; return f }
