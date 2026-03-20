# Plan de producto y migración — Rosaura Gestión (reservas)

Este documento resume **decisiones**, **objetivos**, **alcance de Fase 1** y **dirección técnica** acordados para que nuevas conversaciones (o colaboradores) tengan contexto sin releer el historial.

**Última actualización:** 20 de marzo de 2026 (cutoff cancelación en BD + doc ops §8.2)  
**Proyecto:** `rosaura-gestion` (React + Vite; históricamente Firestore para reservas; **Fase 1 migra reservas a Supabase**).

---

## 1. Visión y objetivos

- Sistema **usable en piloto real** para **cliente final** (reserva web) y **restaurante** (admin: mapa, mesas, lista, check-in, lista de espera).
- **Un solo local** hoy; **multitenant** a futuro — el modelo de datos debe llevar `tenant_id` desde el diseño.
- Ecosistema paralelo: **stock**, **gastos**, **POS integral** (pedidos, cocina, caja, reportes). La **información de reservas debe poder mostrarse en el POS** y el **POS puede escribir estados** (llegada, ocupación, cierre, no-show, etc.).
- **No hay fecha límite** explícita; prioridad: **hacerlo bien**.
- **Formato alineado con SQL** (Supabase/Postgres) para que, al conectar sistemas, el contrato sea homogéneo. **No** se requiere cruzar datos entre apps en el corto plazo.

---

## 2. Fuente de verdad

| Dominio | Fuente de verdad (objetivo Fase 1+) |
|--------|-------------------------------------|
| **Reservas, lista de espera, bloqueos/cupos de mesa, clientes de reserva** | **Supabase (Postgres)** |
| Otros módulos aún en el repo (ej. pedidos, productos) | Pueden seguir en **Firestore** temporalmente hasta migración posterior |

**Decisión explícita:** *“Migro reservas a Supabase en Fase 1”* — no mantener sync bidireccional Firestore ↔ Supabase como rutina para reservas. Conectar ambas bases de forma continua es posible técnicamente pero **añade complejidad y riesgo**; con el POS escribiendo en Supabase, **Postgres es el dueño** de las filas de reserva.

---

## 3. Reglas de negocio acordadas

### 3.1 Turnos y horarios

- Turnos de negocio fijos: **`mediodia`** y **`noche`**.
- **Slots de horario configurables** (no hardcodeados en múltiples archivos).
- **Configurable por negocio (tenant):**
  - **1 o 2 “olas” / rondas de reservas** dentro de cada turno (ej. dos bloques de slots en mediodía o en noche).
  - **Tiempo límite de estadía** (ej. 120 min): define cuándo la mesa vuelve a poder reservarse en el sentido operativo (ej. reserva 20:00 + 2 h → mesa disponible para otra reserva desde 22:00 según reglas de solape).

### 3.2 Mesas y conflictos

- **Conflicto real** modelado por **ventana temporal** `[starts_at, ends_at)` (o `starts_at` + `stay_minutes`), no solo “una mesa por turno entero” si hay olas y estadía limitada.
- **Bloqueos de mesas** (walk-in / no reservable): solo rol **admin**.

### 3.3 Lista de espera

- **Incluida en el piloto** — flujo admin + cliente debe quedar funcional, no placeholder “en desarrollo”.

### 3.4 Identificación de mesas (multitenant)

- **`id`** (UUID o bigserial): PK interna; referencias entre tablas (`reservations.table_id`).
- **`tenant_id`**: siempre presente; RLS en Supabase filtra por tenant.
- **`table_number`**: número visible en salón/mapa; **único por tenant** (o único por `tenant_id + zone_id` si hay zonas con numeración repetida).

El POS y la app deben usar **`id`** en API/BD y mostrar **`table_number`** en UI.

---

## 4. Estado del código (contexto de auditoría)

Problemas **bloqueantes** identificados en el código previo a migración (referencia para no repetirlos al reimplementar sobre Supabase):

1. Llamadas incorrectas a `createReservation` en `App.jsx` (firma `(data, options)` vs objeto mezclado).
2. `CheckInService` vs `updateReservationCheckIn` en `firebase.js` — contratos incompatibles.
3. Suscripción de reservas solo al día “hoy” → admin no ve otras fechas con datos reales.
4. Ocupación de mesas sin dimensión horaria coherente con olas + estadía (lógica a reemplazar por modelo con `starts_at`/`ends_at`).
5. Reglas Firestore débiles (lectura pública de reservas/clientes, colecciones abiertas) — **no aplicable a reservas** tras migración; **RLS en Supabase** debe sustituir esto para el dominio migrado.
6. Bloqueos duplicados: Firestore `mesas_cupos` vs `localStorage` en `App.jsx` — unificar en **una** fuente (Supabase).
7. `handleUpdateReservation`: slots async mal usados; validación de horario incorrecta.
8. Lista de espera: API de asignación incorrecta + `confirmWaitingReservation` sin persistir `mesaAsignada` como correspondía.
9. `Reservas.jsx`: `clearAllTableAssignments` sin import; posible ruta errónea de `require` para `toggleTableBlock`.

**Lección:** la nueva capa de datos debe ser **única**, con **servicios delgados** y **pruebas manuales E2E** por flujo.

---

## 5. Fases de trabajo

### Fase 1 — Imprescindible (incluye migración reservas a Supabase)

1. **Esquema Supabase:** tablas, índices, constraints (`UNIQUE (tenant_id, table_number)`, unicidad lógica de solapes en mesa donde aplique).
2. **RLS:** políticas por `tenant_id`; permisos diferenciados para **anon** (crear reserva / consulta limitada), **staff**, y escritura del **POS** (JWT staff o backend con service role — nunca exponer service role en cliente público).
3. **Config por tenant:** slots, olas (1–2 por turno), `stay_minutes` / duración; almacenado en tablas o JSON versionado según diseño.
4. **Capa en el frontend:** cliente Supabase (`@supabase/supabase-js`), variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; módulos tipo `services/reservationsRepository.ts` / `.js` que reemplacen las llamadas Firestore del dominio reserva.
5. **Flujos completos reimplementados o adaptados:**
   - Creación (cliente + admin) con **una sola firma de servicio** y validaciones centralizadas.
   - Listado y tiempo real por **fecha de trabajo** (y turno), no solo “hoy”.
   - Edición y validación de horario/slots coherente con el modelo de datos.
   - Cancelación (preferir `status` + timestamps vs solo borrado físico).
   - Check-in / mesa real / estados que el POS también pueda actualizar.
   - Asignación manual y automática de mesa usando `table_id` y reglas de solape.
   - Lista de espera: confirmar/rechazar/notificar con persistencia correcta.
   - Bloqueos de mesa solo admin, una sola tabla/colección lógica en Supabase.
6. **Desacople:** reducir lógica gigante en `App.jsx` hacia hooks/servicios donde sea razonable durante la migración.
7. **Seguridad:** revisar que ningún dato sensible quede legible sin política adecuada.

### Fase 2 — Importante (post-piloto o overlap controlado)

- Pulir estados explícitos (`no_show`, `completed`, etc.) y auditoría mínima (`reservation_events` o similar).
- Optimizar búsqueda por código de reserva (índice en `reservation_code` o similar).
- Script **one-off** de migración de datos históricos Firestore → Supabase si hace falta.
- Unificar constantes duplicadas (horarios, mensajes) en config servida por BD o módulo único.

### Fase 3 — Mejora futura

- Edge Functions / backend para transacciones complejas (asignación atómica, anti-carrera).
- Integración profunda con POS (mismo proyecto Supabase o API interna).
- Multitenant activado (varios `tenant_id`, onboarding de locales).
- Reporting SQL pesado ya natural en Postgres.

---

## 6. Modelo de datos orientativo (Supabase)

Ajustar nombres/columnas al estilo del resto de proyectos del usuario; estructura conceptual:

| Entidad | Rol |
|--------|-----|
| `tenants` | Local / negocio (hoy puede ser 1 fila fija). |
| `tables` | `id`, `tenant_id`, `table_number`, `capacity`, `zone` opcional, `active`. |
| `customers` | Opcional; o datos de contacto en reserva si MVP lo simplifica. Unicidad lógica por teléfono normalizado + `tenant_id` deseable. |
| `reservations` | `tenant_id`, `table_id` nullable hasta asignar, `starts_at`, `ends_at`, `turno`, `wave`/`session`, `party_size`, `status`, `reservation_code`, datos contacto, `source`, `created_at`, `updated_at`, `created_by` opcional. |
| `waitlist` | Cola por fecha/turno; transición a `reservations` al confirmar. |
| `table_blocks` o `venue_day_settings` | Bloqueos por fecha+turno; opcionalmente JSON de configuración de slots/olas/estadía. |
| `reservation_events` (opcional Fase 2) | Auditoría: quién/cuándo/qué cambió. |

**Índices típicos:** `(tenant_id, starts_at)`, `(tenant_id, fecha)` si se denormaliza fecha local, `(tenant_id, reservation_code)`, FKs a `tables`.

---

## 7. Arquitectura mínima del módulo de reservas (objetivo)

- **Creación:** validar tenant, turno cerrado, cutoff online (si aplica), slot permitido, solape de mesa si ya asignada, cupos si se modelan por slot.
- **Edición:** mismas validaciones; recalcular `ends_at` si cambia horario o estadía.
- **Cancelación:** `status = cancelled` + `cancelled_at` (recomendado).
- **Check-in / POS:** actualizar campos de estado y opcionalmente `table_id` real; respetar RLS.
- **Asignación:** manual desde mapa + automática con misma función de “mesa libre en ventana”.
- **Lista de espera:** operaciones atómicas idealmente en transacción RPC/Function; mínimo piloto: flujo ordenado en cliente con reglas claras.
- **Bloqueos:** solo admin; lectura compartida para cálculo de disponibilidad.
- **Tiempo real:** suscripción Supabase a cambios en `reservations` filtrados por fecha (y tenant).

---

## 8. Checklist técnica de implementación (para tachar)

- [x] Migraciones SQL versionadas en `supabase/migrations/` (esquema piloto + RLS + seed tenant/mesas/config slots).
- [x] Tablas: `tenants`, `restaurant_tables`, `reservations`, `waitlist`, `tenant_reservation_config`, `venue_day_table_blocks`.
- [x] RLS habilitado (piloto single-tenant `pilot_tenant_id()`): anon lista de espera + RPC sin PII; **anon no inserta** en `reservations` salvo `create_public_reservation`; `authenticated` CRUD; lectura bloqueos/config/mesas para cupos).
- [x] Variables documentadas en `.env.example` (`VITE_SUPABASE_*`, `VITE_DEFAULT_TENANT_ID`, staff, timezone).
- [x] `@supabase/supabase-js` + `date-fns-tz` instalados.
- [x] Cliente singleton `src/lib/supabaseClient.js`; contexto `src/lib/defaultTenantId.js`.
- [x] Capa `src/shared/data/reservationsDataLayer.js` + `supabaseReservationRepository.js` (Firestore ya no usado desde `App.jsx` para reservas/waitlist/bloqueos).
- [x] `App.jsx`: suscripción por `adminWorkDate` (sincronizada desde Reservas); slots vía config BD + RPC pública; bloqueos en Supabase (sin `localStorage`).
- [x] Check-in vía `performReservationCheckIn` (solape temporal por mesa); listo para extender POS con mismos campos.
- [x] `tableManagementService`: filtro opcional por solape temporal; asignación con `assignTableToNewReservation` async + config estadía.
- [x] Lista de espera en admin cableada (confirmar / rechazar / contactar) sin placeholders “en desarrollo”.
- [ ] E2E manual en entorno real con proyecto Supabase enlazado + usuario staff en Auth (§8.2; ejecutar localmente tras `supabase db push`).
- [x] Sección “Supabase local / enlazar proyecto” en este doc (§8.1).
- [x] UX cliente §13: **progressive disclosure** en una sola vista (`reserva-flow`); post-reserva **.ics + Google Calendar + compartir WhatsApp**; debounce fecha 300ms en slider.
- [x] Self-service §13: consulta por **código** + **teléfono** vía RPC `search_reservations_by_phone`; cancelación **`cancel_public_reservation`** (código + teléfono; antelación mínima desde **`tenants.client_cancel_min_hours_before_start`**, default 2 h; fallback en cliente `CLIENT_CANCEL_MIN_HOURS_BEFORE_START`).
- [x] Endurecer respuestas RPC públicas (`20250320160000_anon_rpc_narrow_returns.sql`): búsqueda por teléfono y cancelación **sin** JSON `cliente` ni columnas de contacto innecesarias.
- [ ] Roadmap notificaciones (WhatsApp API / email): documentado; integración real fuera del mínimo salvo decisión.

### 8.1 Supabase local y despliegue de esquema

1. Instalar [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` o binario).
2. En la raíz del repo: `supabase login` y `supabase link --project-ref <ref>` (el ref aparece en Project Settings → General).
3. Aplicar migraciones al proyecto enlazado: `supabase db push` (ejecuta SQL en `supabase/migrations/` en orden).
4. Opcional — Postgres local: `supabase start` levanta stack Docker; `supabase db reset` recrea desde migraciones + seed del SQL.
5. Variables en `.env` (no commitear secretos): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEFAULT_TENANT_ID` alineado al seed, credenciales staff (`VITE_SUPABASE_STAFF_*` o `VITE_SUPABASE_STAFF_REFRESH_TOKEN`).

### 8.2 E2E manual sugerido (checklist)

Ejecutar en **proyecto Supabase enlazado** + staff en Auth (ver §8.1). Tras `supabase db push`, validar:

- [ ] Cliente: nueva reserva (anon) → confirmación con código; ver fila en Supabase Table Editor (`reservations`).
- [ ] Cliente: lista de espera cuando no hay cupo/slot.
- [ ] Cliente: búsqueda por teléfono → lista sin datos de contacto en la respuesta JSON (solo columnas operativas); cancelación online con dígitos guardados en sesión de búsqueda o teléfono de la reserva (código).
- [ ] Admin: login Firebase + sesión Supabase staff; crear/editar/cancelar reserva; bloqueos de mesa; lista de espera confirmar/rechazar **por fecha y turno** (selector de turno).
- [ ] Realtime: dos pestañas admin mismo `business_date` y ver actualización al crear/cancelar.
- [ ] Políticas: usuario **anon** no puede `INSERT` directo en `reservations` (solo RPC `create_public_reservation`).

**Nota:** Los ítems siguen en **pendiente de ejecución manual** hasta que alguien los marque en entorno real; no se automatizan en CI en este repo.

**Operativa / seguridad (sin código en repo):** para RPC públicas (`create_public_reservation`, búsquedas, cancelación), en producción conviene **rate-limit** en API Gateway / **WAF** (por IP) o **Supabase Edge Function** delante; opcional **CAPTCHA** en formulario de reserva. No sustituye RLS: limita abuso y costo. Documentado como checklist de despliegue, no como migración automática.

## 12. Estado de implementación (Fase 1 — código)

**Hecho en repo**

- SQL: `supabase/migrations/20250320120000_reservations_domain.sql` (comentarios de políticas anon vs `authenticated`); `20250320140000_create_public_reservation_rpc.sql`; `20250320150000_client_self_service_rpcs.sql`; **`20250320160000_anon_rpc_narrow_returns.sql`** — endurece respuestas RPC públicas; **`20250320170000_tenant_cancel_cutoff_hours.sql`** — columna `tenants.client_cancel_min_hours_before_start` y `cancel_public_reservation` lee horas desde BD (0–168):
  - `search_reservations_by_phone`: devuelve **columnas operativas** (id, código, fecha, turno, horario, personas, ventana temporal, mesa, estado) **sin** JSON `cliente` (email/teléfono/nombre no salen por RPC).
  - `cancel_public_reservation`: devuelve **confirmación mínima** (código, estado, fechas, horario, personas, ventana temporal) **sin** datos de contacto.
  - **Sin cambio intencional** en `search_reservation_by_code` ni `create_public_reservation`: quien tiene el **código** o acaba de crear la reserva recibe fila completa para UX de confirmación (riesgo acotado: código de 6 caracteres + política de negocio).
- Frontend: repositorio Supabase (`phoneSearchRowToLegacy` / `cancelPublicRowToLegacy`), mapeo acorde; **ClientView** guarda dígitos de la última búsqueda por teléfono para **cancelación RPC** cuando la respuesta no incluye teléfono; **ReservationDetails** oculta nombre en búsqueda por teléfono y desactiva «Modificar» en ese modo.
- **Admin (mar 2026, §13.9):** lista de espera filtrada por **turno** además de fecha; limpieza de logs de depuración; hora de check-in compatible **ISO** (Supabase) y Firestore legacy; comentarios alineados a Supabase.
- UX reserva web: vista **`reserva-flow`** (progressive disclosure); autogestión por código o teléfono; cancelación online por RPC. **Cutoff cancelación:** configurable en **`tenants.client_cancel_min_hours_before_start`**; UI y alertas usan `fetchPilotTenantClientSettings()`. **Cambiar el valor en prod:** Table Editor / SQL con rol que bypass RLS (no hay política `UPDATE` en `tenants` para `authenticated` en Fase 1). **Deuda:** rate-limit RPC públicas (Edge/WAF/captcha) — ver §8.2 nota operativa.
- Staff: doble sesión Firebase (UI roles) + Supabase Auth (`VITE_SUPABASE_STAFF_*`) para satisfacer RLS; `PrivateRoute` y login revalidan sesión Supabase.

**Pendiente / decisión**

- Migración one-off Firestore → Postgres: **no priorizada** — arranque en frío en Postgres acordado por el equipo.
- **Hecho (mar 2026):** creación web vía RPC `create_public_reservation` (validación de slot, ventana temporal, cliente mínimo, asignación de mesa en servidor o sin mesa si no hay cupo físico); revocado `INSERT` anon directo en `reservations`.
- Staff sin password en `.env`: opción documentada `VITE_SUPABASE_STAFF_REFRESH_TOKEN` + `setSession` vía `/auth/v1/token?grant_type=refresh_token` (rotar si se expone).
- **Checklist §8.2 E2E manual:** pendiente de ejecución en entorno real (marcar ítems al validar). El agente puede validar migraciones con `supabase db push --dry-run` enlazado; las pruebas funcionales requieren staff Auth + datos reales.
- **`search_reservation_by_code`:** sigue devolviendo fila completa (incl. `cliente` JSON) para UX de “tengo el código”; riesgo acotado (código 6 chars + búsqueda acotada). Endurecer (solo columnas operativas) implicaría ajustar UI de confirmación; trade-off documentado, sin cambio en esta iteración.
- **Siguiente mejora:** GiST/exclusión o RPC transaccional para carreras finas en check-in/asignación concurrente (Fase 3 parcial); check-in sigue en cliente con validación de solape.

---

### 12.1 Superficie anon (resumen RPC / RLS)

| RPC | Rol | Notas |
|-----|-----|--------|
| `create_public_reservation` | `anon` | INSERT vía SECURITY DEFINER; sin INSERT directo en tabla. |
| `search_reservation_by_code` | `anon`, `authenticated` | Devuelve fila de reserva activa futura por código (UX «mis reservas»). |
| `search_reservations_by_phone` | `anon`, `authenticated` | Hasta 5 filas; **sin PII** en columnas devueltas (migración `20250320160000`). |
| `cancel_public_reservation` | `anon`, `authenticated` | Código + 8 dígitos teléfono; **respuesta acotada** (migración `20250320160000`). |
| `list_reservations_for_date_turn` | `anon`, `authenticated` | Agregados operativos sin contacto. |

RLS: tablas con políticas por `tenant_id` / `pilot_tenant_id()`; detalle en comentarios dentro de `20250320120000_reservations_domain.sql`.

---

## 9. Archivos históricos clave del repo (referencia)

| Área | Archivos (Firestore legacy; a sustituir o aislar para reservas) |
|------|-------------------------------------------------------------------|
| Agregado masivo Firebase | `src/firebase.js` |
| Lógica reservas | `src/shared/services/reservationService.js` |
| Mesas / mapa | `src/shared/services/tableManagementService.js`, `src/utils/tablesLayout.js` |
| Admin reservas | `src/apps/admin/pages/Reservas/Reservas.jsx` |
| App orquestación | `src/App.jsx` |
| Check-in | `src/shared/services/CheckInService.js` |
| Reglas (solo lo no migrado) | `firestore.rules` |

Los nuevos puntos de entrada para reservas deberían vivir en **servicios + repositorios Supabase**, no repartidos sin criterio.

---

## 10. Preguntas abiertas (resolver durante implementación)

- ¿JWT de staff unificado entre esta app y el POS o service role solo en backend del POS?
- **Consulta pública de reserva:** ¿RPC con `reservation_code` + últimos dígitos de teléfono vs OTP por WhatsApp/SMS en fase posterior?
- **Email en formulario cliente:** ¿opcional en piloto (solo teléfono + nombre) o obligatorio para automatizaciones? — Ver §13.
- ~~¿Migración de datos históricos desde Firestore necesaria para el piloto o arranque en frío?~~ **Cerrado:** arranque en frío; sin script one-off salvo pedido explícito.

---

## 11. Cómo usar este doc en nuevos chats

Sugerencia de mensaje inicial:

> Leé `docs/PLAN_PRODUCTO_Y_MIGRACION_SUPABASE.md` (especialmente §13 y §14) y continuamos con [UX cliente / admin / RPC / …].

Para arrancar un agente de implementación, usar el **prompt completo** en §14 o el archivo `docs/PROMPT_AGENTE_FASE2_UX_Y_PRODUCTO.md` si existe (misma intención).

---

## 13. Decisiones de producto / UX / operación (marzo 2026)

Resumen acordado por el equipo para alinear diseño y roadmap técnico.

### 13.1 Datos y migración

- **No migrar** histórico desde Firestore hacia Postgres: **base limpia** en Supabase para reservas.
- **Campos comensal (objetivo):** nombre, **teléfono verificable** (canal WhatsApp / coherente con operación actual), comentarios. **Nombre completo** preferible en **un solo campo** salvo requisito legal de separar apellido.
- **Email:** valor para automatizaciones baratas y “mis reservas” por correo; **no cerrado** — puede ser **opcional** en piloto y **teléfono** como identificador principal para consulta/cambios.

### 13.2 Experiencia de reserva (cliente web, prioridad móvil)

- **Una sola pantalla / vista continua:** no navegar a “pantallas” sueltas; al completar cada elección, **se revela el siguiente bloque** (progressive disclosure / acordeón guiado). Objetivo: sensación de **un solo paso** manteniendo la posibilidad de **validar en backend** antes de mostrar el siguiente paso (horarios disponibles, cupos, personas, etc.).
- Mantener coherencia con reglas ya documentadas: turnos `mediodia`/`noche`, slots desde config, ventanas temporales, lista de espera cuando no hay cupo.

### 13.3 Lista de espera y contacto

- **Lista de espera** obligatoria en el producto (no placeholder).
- Ofrecer **mensaje directo al restaurante** (enlace o canal acordado) además del flujo de cola formal.

### 13.4 Post-reserva (confirmación)

- Mostrar **código de reserva + detalle** claro (fecha, hora, personas, mesa si aplica).
- **Añadir al calendario** (.ics o enlaces Google/Apple según alcance): **deseable** como mejora de valor percibido.
- **Compartir por WhatsApp:** texto prearmado con el resumen (para avisar a un acompañante o reenviar datos); no bloquea el MVP si se implementa después.

### 13.5 Idioma y roles

- **Bilingüe (ES + EN u otro):** fase posterior; preparar copy en un solo lugar (`constants`/i18n-ready) cuando se toque UI de cliente.
- **Mozo:** solo **check-in y lectura** en el alcance deseado — no paridad con admin en gestión de reservas/configuración.

### 13.6 Notificaciones e integraciones (roadmap, no bloquean UX base)

- Explorar **email/SMS** según costo; **API de WhatsApp Business** es atractiva: mismo canal que el cliente ya usa, confirmaciones homogéneas, y **futuro**: bot que cree reservas desde conversación y **respuestas desde la app de reservas** sin cambiar de pestaña.
- Implementación concreta de proveedores queda **fuera del mínimo** de la iteración UX salvo decisión explícita.

### 13.7 Autenticación staff y `.env`

- Las credenciales **`VITE_SUPABASE_STAFF_*`** son el mecanismo **actual** para que el SPA obtenga un JWT `authenticated` tras login Firebase y cumpla RLS.
- **No es la forma ideal a largo plazo** (password o refresh en cliente). Evolución recomendada: token emitido por **backend/Edge Function**, magic link, u otro flujo sin secretos en el bundle. Documentado para no confundir “obligatorio para siempre” con “piloto”.

### 13.8 Consulta, cambios y cancelación por el cliente

- **Código** sigue siendo el identificador principal mostrado al usuario.
- Por **pérdida del código:** permitir **búsqueda/recuperación por número de teléfono** (normalizado) y flujo de **cambios** vía **WhatsApp** o UI según prioridad.
- **Cancelación:** el **cliente debe poder cancelar en autogestión** sin aprobación del restaurante (salvo reglas de antelación mínima definidas en negocio — implementar como constante/config).

### 13.9 Prioridad de trabajo (orden explícito)

1. **Simplificar y pulir UX del flujo cliente** (una pantalla, revelado progresivo, validaciones eficientes).
2. **Pulir admin** (operación diaria estable, menos fricción).
3. **Documentación + endurecer superficie anon** (RPC bien acotadas, RLS revisada, sin PII innecesaria en respuestas públicas).

### 13.10 Diseño visual

- Por ahora: **base funcional** y **homogeneizar** estilo dentro de lo existente.
- **Diseño fino** (p. ej. Google Stitch) **después** de estabilizar flujos; luego **implementar** el resultado en el repo.

---

## 14. Prompt para agente — implementación siguiente iteración

Copiar el bloque siguiente en un **nuevo chat de agente** (o guardar como `docs/PROMPT_AGENTE_FASE2_UX_Y_PRODUCTO.md` y adjuntar). Ajustar solo si el alcance cambia.

```text
Eres un ingeniero de software senior (React 19 + Vite, Supabase/Postgres). Tu objetivo es implementar de forma **correcta, prolija y eficiente** la siguiente iteración del producto descrita en el repositorio.

## Contexto obligatorio
1. Lee íntegramente `docs/PLAN_PRODUCTO_Y_MIGRACION_SUPABASE.md`, en particular las secciones **§13 (decisiones de producto/UX)** y **§12 (estado actual)**.
2. No reintroduzcas Firestore para el dominio de reservas: la fuente de verdad es **Supabase** (`src/shared/data/reservationsDataLayer.js`, `supabaseReservationRepository.js`, `reservationService.js`).
3. Respeta **RLS** y el patrón actual: creación pública vía **RPC** (`create_public_reservation`), no INSERT anon directo en tablas sensibles.
4. Prioridad explícita del equipo: (1) **UX cliente** → (2) **admin** → (3) **docs + seguridad anon**.

## Objetivo de producto (cliente)
- Flujo de reserva **mobile-first**, **una sola vista continua**: en lugar de “pasos” que cambian de pantalla completa, usar **progressive disclosure** — cada elección (fecha, turno, personas, horario, etc.) **revela** el siguiente bloque en el mismo scroll/vista, manteniendo sensación de “un solo paso”.
- Entre bloques, el frontend debe poder **consultar el backend** (slots, cupos, disponibilidad) **antes** de mostrar opciones inválidas; evitar llamadas redundantes (cache breve en estado local, debounce en selección de fecha, una sola fuente de verdad para `tenant` y `business_date`/`timezone`).
- Mantener: lista de espera cuando no hay cupo; opción de **contacto directo** al restaurante (enlace o acción clara).
- Post-reserva: **código + detalle**; preparar o implementar **añadir al calendario**; “compartir por WhatsApp” como mejora (mensaje de texto con resumen).

## Objetivo de producto (datos y self-service)
- Formulario: al menos **nombre completo** (un campo), **teléfono** normalizado para WhatsApp, **comentarios**. Email **opcional** salvo que el plan técnico actual requiera otra cosa — documentar la decisión en el PR/commit message.
- Planificar UI/RPC para **consulta por código** y **recuperación por teléfono**; **cancelación self-service** por el cliente con reglas de negocio (cutoff) centralizadas en constantes o config BD.
- **Mozo:** sin ampliar permisos más allá de **check-in + lectura** (alinear con rutas y RLS existentes).

## Calidad y eficiencia del sistema
- **Eficiencia:** minimizar round-trips a Supabase en el flujo cliente; combinar lecturas donde el esquema lo permita; no duplicar lógica de slots que ya vive en RPC/config.
- **Seguridad:** no exponer PII de otras reservas; cualquier búsqueda por teléfono debe ser **RPC acotada** + rate-limit considerado (aunque sea documentado como deuda si no hay infraestructura aún).
- **Consistencia:** reutilizar `src/shared/constants`, `timeValidation` / utilidades de zona horaria ya presentes; no hardcodear turnos duplicados.
- **Código:** cambios mínimos necesarios; no refactors masivos no pedidos; seguir estilo del repo.

## Entregables concretos
1. Cambios en UI cliente (`src/apps/client/...`, `ClientView` / rutas relacionadas) alineados al progressive disclosure.
2. Ajustes en `App.jsx` / estado solo si hace falta para props y suscripciones; preferir hooks locales o contexto existente.
3. Si hace falta nuevo contrato con BD: **migración SQL** en `supabase/migrations/` + políticas RLS actualizadas + comentarios en SQL.
4. Actualizar `docs/PLAN_PRODUCTO_Y_MIGRACION_SUPABASE.md` §12 con lo hecho y checklist §8.
5. Probar manualmente: crear reserva, lista de espera, confirmación con código, y (si se implementa) cancelación/consulta.

## Fuera de alcance salvo indicación explícita
- Integración real con API de WhatsApp Business, proveedor SMS o email transaccional (solo dejar hooks/UI o documentar roadmap).
- Rediseño visual completo tipo Stitch — solo preparar componentes para ser re-skinneados después.

Al terminar, resume archivos tocados, decisiones de RPC/RLS, y deuda técnica breve.
```

---

*Documento generado para contexto compartido del equipo y asistentes; actualizarlo cuando cambien decisiones de arquitectura o alcance.*
