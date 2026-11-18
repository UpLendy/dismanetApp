import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture (empresas, usuarios) fuera de
// cualquier contexto de empresa autenticado, igual que cargos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { turnos } from "./turnos.ts";
import { usuarios } from "./usuarios.ts";
import { inicioDeFechaBogota } from "../lib/periodos.ts";

const CONTRASENA = "Clave#Segura123";

async function iniciarSesion(email: string): Promise<string> {
  const respuesta = await auth.handle(
    new Request("http://local/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: CONTRASENA }),
    }),
  );
  const setCookie = respuesta.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login falló para ${email}: ${await respuesta.text()}`);
  return setCookie.split(";")[0];
}

async function peticionTurnos(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await turnos.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

async function peticionUsuarios(metodo: string, ruta: string, cookie: string) {
  const respuesta = await usuarios.handle(new Request(`http://local${ruta}`, { method: metodo, headers: { cookie } }));
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

/** Instante Bogotá de `fechaISO` ("YYYY-MM-DD") más `horas` horas. */
function instanteBogota(fechaISO: string, horas: number): string {
  return new Date(inicioDeFechaBogota(fechaISO).getTime() + horas * 60 * 60 * 1000).toISOString();
}

describe("Turnos — calendario laboral (F6.2)", () => {
  let empresaAId: string;
  let cookieAdminA: string;
  let vendedorAId: string;
  let cookieVendedorA: string;
  let empleadoAId: string;
  let cookieEmpleadoA: string;

  let empresaBId: string;
  let cookieAdminB: string;
  let usuarioBId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];
  const idsTurnosParaLimpiar: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa turnos A (turnos.test)", prefijoCodigo: "TUA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);

    const adminAEmail = `admin-turnos-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    cookieAdminA = await iniciarSesion(adminAEmail);

    const vendedorAEmail = `vendedor-turnos-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(vendedorAEmail);
    const vendedorA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedorAEmail, passwordHash: hash, nombre: "Vendedor A", rol: "VENDEDOR" },
    });
    vendedorAId = vendedorA.id;
    cookieVendedorA = await iniciarSesion(vendedorAEmail);

    const empleadoAEmail = `empleado-turnos-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(empleadoAEmail);
    const empleadoA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: empleadoAEmail, passwordHash: hash, nombre: "Empleado A", rol: "EMPLEADO" },
    });
    empleadoAId = empleadoA.id;
    cookieEmpleadoA = await iniciarSesion(empleadoAEmail);

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa turnos B (turnos.test)", prefijoCodigo: "TUB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);

    const adminBEmail = `admin-turnos-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);

    const usuarioBEmail = `usuario-turnos-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(usuarioBEmail);
    const usuarioB = await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: usuarioBEmail, passwordHash: hash, nombre: "Usuario B", rol: "EMPLEADO" },
    });
    usuarioBId = usuarioB.id;
  });

  afterAll(async () => {
    await prismaRaw.turno.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("fin <= inicio es rechazado con 400 FIN_ANTES_DE_INICIO", async () => {
    const respuesta = await peticionTurnos(
      "POST",
      "/turnos",
      cookieAdminA,
      { usuarioId: vendedorAId, inicio: instanteBogota("2026-03-02", 8), fin: instanteBogota("2026-03-02", 8) },
    );
    expect(respuesta.status).toBe(400);
    expect(respuesta.cuerpo.error.codigo).toBe("FIN_ANTES_DE_INICIO");
  });

  it("una duración mayor a 24 horas es rechazada con 400 DURACION_MAXIMA", async () => {
    const respuesta = await peticionTurnos(
      "POST",
      "/turnos",
      cookieAdminA,
      { usuarioId: vendedorAId, inicio: instanteBogota("2026-03-02", 0), fin: instanteBogota("2026-03-03", 1) },
    );
    expect(respuesta.status).toBe(400);
    expect(respuesta.cuerpo.error.codigo).toBe("DURACION_MAXIMA");
  });

  it("dos turnos que se solapan para el mismo usuario responden 409 TURNO_SOLAPADO nombrando el turno que choca; el mismo horario para otro usuario es válido", async () => {
    const primero = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-05", 8),
      fin: instanteBogota("2026-03-05", 12),
    });
    expect(primero.status).toBe(201);
    idsTurnosParaLimpiar.push(primero.cuerpo.turno.id);

    const solapado = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-05", 10),
      fin: instanteBogota("2026-03-05", 14),
    });
    expect(solapado.status).toBe(409);
    expect(solapado.cuerpo.error.codigo).toBe("TURNO_SOLAPADO");
    expect(solapado.cuerpo.error.mensaje).toContain(primero.cuerpo.turno.id);

    // Mismo horario exacto, pero otro usuario: válido — dos personas
    // trabajando a la vez no es un solapamiento.
    const otroUsuario = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: empleadoAId,
      inicio: instanteBogota("2026-03-05", 8),
      fin: instanteBogota("2026-03-05", 12),
    });
    expect(otroUsuario.status).toBe(201);
    idsTurnosParaLimpiar.push(otroUsuario.cuerpo.turno.id);
  });

  it("un turno nocturno 22:00–06:00 pertenece (GET /turnos) al día Bogotá de su inicio, y sus horas se reparten entre los dos días según el recorte de /turnos/horas", async () => {
    const creado = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-10", 22),
      fin: instanteBogota("2026-03-11", 6),
    });
    expect(creado.status).toBe(201);
    idsTurnosParaLimpiar.push(creado.cuerpo.turno.id);

    // Día de inicio: aparece en el listado del 10, no en el del 11.
    const listadoDia10 = await peticionTurnos(
      "GET",
      "/turnos?desde=2026-03-10&hasta=2026-03-10",
      cookieAdminA,
    );
    expect(listadoDia10.cuerpo.turnos.some((t: { id: string }) => t.id === creado.cuerpo.turno.id)).toBe(true);

    const listadoDia11 = await peticionTurnos(
      "GET",
      "/turnos?desde=2026-03-11&hasta=2026-03-11",
      cookieAdminA,
    );
    expect(listadoDia11.cuerpo.turnos.some((t: { id: string }) => t.id === creado.cuerpo.turno.id)).toBe(false);

    // Horas recortadas: 2h para el día que termina (10), 6h para el que
    // empieza (11) — nunca 8h de un solo lado.
    const horasDia10 = await peticionTurnos("GET", "/turnos/horas?desde=2026-03-10&hasta=2026-03-10", cookieAdminA);
    const filaDia10 = horasDia10.cuerpo.horas.find((h: { usuarioId: string }) => h.usuarioId === vendedorAId);
    expect(filaDia10.horas).toBe(2);

    const horasDia11 = await peticionTurnos("GET", "/turnos/horas?desde=2026-03-11&hasta=2026-03-11", cookieAdminA);
    const filaDia11 = horasDia11.cuerpo.horas.find((h: { usuarioId: string }) => h.usuarioId === vendedorAId);
    expect(filaDia11.horas).toBe(6);

    const horasAmbosDias = await peticionTurnos(
      "GET",
      "/turnos/horas?desde=2026-03-10&hasta=2026-03-11",
      cookieAdminA,
    );
    const filaAmbosDias = horasAmbosDias.cuerpo.horas.find((h: { usuarioId: string }) => h.usuarioId === vendedorAId);
    expect(filaAmbosDias.horas).toBe(8);
  });

  it("un turno que empieza a las 23:00 Bogotá del último día del mes no se cuenta en el mes siguiente (mismo caso que estadisticas-ventas.test.ts)", async () => {
    const creado = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: empleadoAId,
      inicio: instanteBogota("2026-01-31", 23),
      fin: instanteBogota("2026-02-01", 0.5), // 00:30 Bogotá del 1 de febrero
    });
    expect(creado.status).toBe(201);
    idsTurnosParaLimpiar.push(creado.cuerpo.turno.id);

    const listadoEnero = await peticionTurnos("GET", "/turnos?desde=2026-01-01&hasta=2026-01-31", cookieAdminA);
    expect(listadoEnero.cuerpo.turnos.some((t: { id: string }) => t.id === creado.cuerpo.turno.id)).toBe(true);

    const listadoFebrero = await peticionTurnos("GET", "/turnos?desde=2026-02-01&hasta=2026-02-28", cookieAdminA);
    expect(listadoFebrero.cuerpo.turnos.some((t: { id: string }) => t.id === creado.cuerpo.turno.id)).toBe(false);
  });

  it("GET /turnos como EMPLEADO devuelve solo los propios aunque pida los de otro usuario por query", async () => {
    const turnoPropio = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: empleadoAId,
      inicio: instanteBogota("2026-03-20", 8),
      fin: instanteBogota("2026-03-20", 12),
    });
    expect(turnoPropio.status).toBe(201);
    idsTurnosParaLimpiar.push(turnoPropio.cuerpo.turno.id);

    const turnoDeOtro = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-20", 8),
      fin: instanteBogota("2026-03-20", 12),
    });
    expect(turnoDeOtro.status).toBe(201);
    idsTurnosParaLimpiar.push(turnoDeOtro.cuerpo.turno.id);

    const comoEmpleado = await peticionTurnos(
      "GET",
      `/turnos?desde=2026-03-20&hasta=2026-03-20&usuarioId=${vendedorAId}`,
      cookieEmpleadoA,
    );
    expect(comoEmpleado.status).toBe(200);
    const idsDevueltos = comoEmpleado.cuerpo.turnos.map((t: { id: string }) => t.id);
    expect(idsDevueltos).toContain(turnoPropio.cuerpo.turno.id);
    expect(idsDevueltos).not.toContain(turnoDeOtro.cuerpo.turno.id);
  });

  it("R1: un turno creado en la empresa A nunca aparece en el listado de la empresa B, y no se puede crear un turno con un usuarioId de otra empresa", async () => {
    const turnoDeA = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-25", 8),
      fin: instanteBogota("2026-03-25", 12),
    });
    expect(turnoDeA.status).toBe(201);
    idsTurnosParaLimpiar.push(turnoDeA.cuerpo.turno.id);

    const listadoB = await peticionTurnos("GET", "/turnos?desde=2026-03-25&hasta=2026-03-25", cookieAdminB);
    expect(listadoB.cuerpo.turnos.some((t: { id: string }) => t.id === turnoDeA.cuerpo.turno.id)).toBe(false);

    const conUsuarioDeOtraEmpresa = await peticionTurnos("POST", "/turnos", cookieAdminB, {
      usuarioId: vendedorAId,
      inicio: instanteBogota("2026-03-26", 8),
      fin: instanteBogota("2026-03-26", 12),
    });
    expect(conUsuarioDeOtraEmpresa.status).toBe(404);
    expect(conUsuarioDeOtraEmpresa.cuerpo.error.codigo).toBe("USUARIO_NO_ENCONTRADO");

    // usuarioBId existe, pero en la empresa B: el filtro de bloqueo lo
    // confirma, así que la creación sí procede.
    const conUsuarioDeB = await peticionTurnos("POST", "/turnos", cookieAdminB, {
      usuarioId: usuarioBId,
      inicio: instanteBogota("2026-03-26", 8),
      fin: instanteBogota("2026-03-26", 12),
    });
    expect(conUsuarioDeB.status).toBe(201);
    idsTurnosParaLimpiar.push(conUsuarioDeB.cuerpo.turno.id);
  });

  it("GET /usuarios: enTurno es true para un usuario con un turno en curso ahora, y false para uno con el turno ya terminado", async () => {
    const ahora = new Date();
    const enCurso = await prismaRaw.turno.create({
      data: {
        empresaId: empresaAId,
        usuarioId: vendedorAId,
        inicio: new Date(ahora.getTime() - 60 * 60 * 1000),
        fin: new Date(ahora.getTime() + 60 * 60 * 1000),
      },
    });
    const terminado = await prismaRaw.turno.create({
      data: {
        empresaId: empresaAId,
        usuarioId: empleadoAId,
        inicio: new Date(ahora.getTime() - 3 * 60 * 60 * 1000),
        fin: new Date(ahora.getTime() - 60 * 60 * 1000),
      },
    });
    idsTurnosParaLimpiar.push(enCurso.id, terminado.id);

    const listado = await peticionUsuarios("GET", "/usuarios", cookieAdminA);
    expect(listado.status).toBe(200);
    const filaEnCurso = listado.cuerpo.usuarios.find((u: { id: string }) => u.id === vendedorAId);
    const filaTerminado = listado.cuerpo.usuarios.find((u: { id: string }) => u.id === empleadoAId);
    expect(filaEnCurso.enTurno).toBe(true);
    expect(filaTerminado.enTurno).toBe(false);
  });
});
