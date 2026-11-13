import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture (empresas, usuarios) fuera de
// cualquier contexto de empresa autenticado, igual que turnos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { turnos } from "./turnos.ts";
import { festivos } from "./festivos.ts";
import { horasAdicionales } from "./horas-adicionales.ts";
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

async function peticion(
  router: typeof horasAdicionales | typeof turnos | typeof festivos,
  metodo: string,
  ruta: string,
  cookie: string,
  cuerpo?: unknown,
) {
  const respuesta = await router.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

const peticionHoras = (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) =>
  peticion(horasAdicionales, metodo, ruta, cookie, cuerpo);
const peticionTurnos = (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) =>
  peticion(turnos, metodo, ruta, cookie, cuerpo);
const peticionFestivos = (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) =>
  peticion(festivos, metodo, ruta, cookie, cuerpo);

/** Instante Bogotá de `fechaISO` ("YYYY-MM-DD") más `horas` horas. */
function instanteBogota(fechaISO: string, horas: number): string {
  return new Date(inicioDeFechaBogota(fechaISO).getTime() + horas * 60 * 60 * 1000).toISOString();
}

describe("Horas adicionales — registro de planta, no nómina (F6.3)", () => {
  let empresaAId: string;
  let cookieAdminA: string;
  let empleadoAId: string;
  let cookieEmpleadoA: string;
  let otroEmpleadoAId: string;
  let cookieOtroEmpleadoA: string;
  let vendedorAId: string;
  let cookieVendedorA: string;

  let empresaBId: string;
  let cookieAdminB: string;
  let empleadoBId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa horas A (horas-adicionales.test)", prefijoCodigo: "HAA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);

    const adminAEmail = `admin-horas-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    cookieAdminA = await iniciarSesion(adminAEmail);

    const empleadoAEmail = `empleado-horas-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(empleadoAEmail);
    const empleadoA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: empleadoAEmail, passwordHash: hash, nombre: "Empleado A", rol: "EMPLEADO" },
    });
    empleadoAId = empleadoA.id;
    cookieEmpleadoA = await iniciarSesion(empleadoAEmail);

    const otroEmpleadoAEmail = `otro-empleado-horas-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(otroEmpleadoAEmail);
    const otroEmpleadoA = await prismaRaw.usuario.create({
      data: {
        empresaId: empresaAId,
        email: otroEmpleadoAEmail,
        passwordHash: hash,
        nombre: "Otro Empleado A",
        rol: "EMPLEADO",
      },
    });
    otroEmpleadoAId = otroEmpleadoA.id;
    cookieOtroEmpleadoA = await iniciarSesion(otroEmpleadoAEmail);

    const vendedorAEmail = `vendedor-horas-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(vendedorAEmail);
    const vendedorA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedorAEmail, passwordHash: hash, nombre: "Vendedor A", rol: "VENDEDOR" },
    });
    vendedorAId = vendedorA.id;
    cookieVendedorA = await iniciarSesion(vendedorAEmail);

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa horas B (horas-adicionales.test)", prefijoCodigo: "HAB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);

    const adminBEmail = `admin-horas-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);

    const empleadoBEmail = `empleado-horas-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(empleadoBEmail);
    const empleadoB = await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: empleadoBEmail, passwordHash: hash, nombre: "Empleado B", rol: "EMPLEADO" },
    });
    empleadoBId = empleadoB.id;
  });

  afterAll(async () => {
    await prismaRaw.horaAdicional.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.turno.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.festivo.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("una hora adicional que se solapa con un turno propio responde 409 SOLAPA_CON_TURNO nombrando el turno; el mismo horario de otro usuario es válido", async () => {
    const turno = await peticionTurnos("POST", "/turnos", cookieAdminA, {
      usuarioId: empleadoAId,
      inicio: instanteBogota("2026-04-06", 8),
      fin: instanteBogota("2026-04-06", 12),
    });
    expect(turno.status).toBe(201);

    const solapada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-06", 9),
      fin: instanteBogota("2026-04-06", 11),
    });
    expect(solapada.status).toBe(409);
    expect(solapada.cuerpo.error.codigo).toBe("SOLAPA_CON_TURNO");
    expect(solapada.cuerpo.error.mensaje).toContain(turno.cuerpo.turno.id);

    const otroUsuario = await peticionHoras("POST", "/horas-adicionales", cookieOtroEmpleadoA, {
      inicio: instanteBogota("2026-04-06", 9),
      fin: instanteBogota("2026-04-06", 11),
    });
    expect(otroUsuario.status).toBe(201);
  });

  it("una hora adicional que se solapa con otra hora adicional propia no rechazada responde 409 SOLAPA_CON_HORA_ADICIONAL; una vez rechazada, deja de bloquear", async () => {
    const primera = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-13", 14),
      fin: instanteBogota("2026-04-13", 16),
    });
    expect(primera.status).toBe(201);

    const solapada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-13", 15),
      fin: instanteBogota("2026-04-13", 17),
    });
    expect(solapada.status).toBe(409);
    expect(solapada.cuerpo.error.codigo).toBe("SOLAPA_CON_HORA_ADICIONAL");
    expect(solapada.cuerpo.error.mensaje).toContain(primera.cuerpo.horaAdicional.id);

    const rechazada = await peticionHoras(
      "PATCH",
      `/horas-adicionales/${primera.cuerpo.horaAdicional.id}/rechazar`,
      cookieAdminA,
    );
    expect(rechazada.status).toBe(200);
    expect(rechazada.cuerpo.horaAdicional.estado).toBe("RECHAZADA");

    const yaNoSolapa = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-13", 15),
      fin: instanteBogota("2026-04-13", 17),
    });
    expect(yaNoSolapa.status).toBe(201);
  });

  it("un bloque de 20:00 del sábado a 02:00 del domingo reparte 4 horas ordinarias (sábado) y 2 dominicales (domingo), aunque el domingo no esté en la tabla Festivo", async () => {
    const creada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-04", 20), // sábado
      fin: instanteBogota("2026-04-05", 2), // domingo
    });
    expect(creada.status).toBe(201);

    const aprobada = await peticionHoras(
      "PATCH",
      `/horas-adicionales/${creada.cuerpo.horaAdicional.id}/aprobar`,
      cookieAdminA,
    );
    expect(aprobada.status).toBe(200);

    const resumen = await peticionHoras(
      "GET",
      "/horas-adicionales/resumen?desde=2026-04-04&hasta=2026-04-05",
      cookieAdminA,
    );
    expect(resumen.status).toBe(200);
    const fila = resumen.cuerpo.resumen.find((f: { usuarioId: string }) => f.usuarioId === empleadoAId);
    expect(fila.ordinarias).toBe(4);
    expect(fila.dominicalesFestivas).toBe(2);
  });

  it("un festivo cargado en la tabla Festivo clasifica como dominical/festiva un día entero que no es domingo", async () => {
    const festivo = await peticionFestivos("POST", "/festivos", cookieAdminA, {
      fecha: "2026-07-20", // lunes
      nombre: "Festivo de prueba (horas-adicionales.test)",
    });
    expect(festivo.status).toBe(201);

    const creada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-07-20", 8),
      fin: instanteBogota("2026-07-20", 12),
    });
    expect(creada.status).toBe(201);
    await peticionHoras("PATCH", `/horas-adicionales/${creada.cuerpo.horaAdicional.id}/aprobar`, cookieAdminA);

    const resumen = await peticionHoras(
      "GET",
      "/horas-adicionales/resumen?desde=2026-07-20&hasta=2026-07-20",
      cookieAdminA,
    );
    const fila = resumen.cuerpo.resumen.find((f: { usuarioId: string }) => f.usuarioId === empleadoAId);
    expect(fila.ordinarias).toBe(0);
    expect(fila.dominicalesFestivas).toBe(4);
  });

  it("fin <= inicio y una duración mayor a 24 horas son rechazadas con 400", async () => {
    const finIgualInicio = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-20", 8),
      fin: instanteBogota("2026-04-20", 8),
    });
    expect(finIgualInicio.status).toBe(400);
    expect(finIgualInicio.cuerpo.error.codigo).toBe("FIN_ANTES_DE_INICIO");

    const masDe24Horas = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-21", 0),
      fin: instanteBogota("2026-04-22", 1),
    });
    expect(masDe24Horas.status).toBe(400);
    expect(masDe24Horas.cuerpo.error.codigo).toBe("DURACION_MAXIMA");
  });

  it("editar o borrar una hora adicional ya aprobada responde 409 HORA_ADICIONAL_NO_PENDIENTE", async () => {
    const creada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-04-27", 8),
      fin: instanteBogota("2026-04-27", 10),
    });
    expect(creada.status).toBe(201);
    const id = creada.cuerpo.horaAdicional.id;
    await peticionHoras("PATCH", `/horas-adicionales/${id}/aprobar`, cookieAdminA);

    const editar = await peticionHoras("PATCH", `/horas-adicionales/${id}`, cookieEmpleadoA, { motivo: "cambio" });
    expect(editar.status).toBe(409);
    expect(editar.cuerpo.error.codigo).toBe("HORA_ADICIONAL_NO_PENDIENTE");

    const borrar = await peticionHoras("DELETE", `/horas-adicionales/${id}`, cookieEmpleadoA);
    expect(borrar.status).toBe(409);
    expect(borrar.cuerpo.error.codigo).toBe("HORA_ADICIONAL_NO_PENDIENTE");
  });

  it("un EMPLEADO no puede registrar horas a nombre de otro usuario vía body.usuarioId, ni ver las de otro vía query.usuarioId", async () => {
    const registrada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      usuarioId: otroEmpleadoAId,
      inicio: instanteBogota("2026-05-04", 8),
      fin: instanteBogota("2026-05-04", 10),
    });
    expect(registrada.status).toBe(201);
    expect(registrada.cuerpo.horaAdicional.usuarioId).toBe(empleadoAId);

    const deOtro = await peticionHoras("POST", "/horas-adicionales", cookieAdminA, {
      usuarioId: otroEmpleadoAId,
      inicio: instanteBogota("2026-05-04", 14),
      fin: instanteBogota("2026-05-04", 16),
    });
    expect(deOtro.status).toBe(201);

    const listado = await peticionHoras(
      "GET",
      `/horas-adicionales?desde=2026-05-04&hasta=2026-05-04&usuarioId=${otroEmpleadoAId}`,
      cookieEmpleadoA,
    );
    expect(listado.status).toBe(200);
    const ids = listado.cuerpo.horasAdicionales.map((h: { id: string }) => h.id);
    expect(ids).toContain(registrada.cuerpo.horaAdicional.id);
    expect(ids).not.toContain(deOtro.cuerpo.horaAdicional.id);
  });

  it("un EMPLEADO recibe 403 al intentar aprobar, rechazar o consultar el resumen", async () => {
    const creada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-05-11", 8),
      fin: instanteBogota("2026-05-11", 10),
    });
    expect(creada.status).toBe(201);
    const id = creada.cuerpo.horaAdicional.id;

    expect((await peticionHoras("PATCH", `/horas-adicionales/${id}/aprobar`, cookieEmpleadoA)).status).toBe(403);
    expect((await peticionHoras("PATCH", `/horas-adicionales/${id}/rechazar`, cookieEmpleadoA)).status).toBe(403);
    expect(
      (await peticionHoras("GET", "/horas-adicionales/resumen?desde=2026-05-11&hasta=2026-05-11", cookieEmpleadoA))
        .status,
    ).toBe(403);
  });

  it("un VENDEDOR recibe 403 en todas las rutas de /horas-adicionales (F6.3: planta, no revendedores)", async () => {
    expect(
      (await peticionHoras("GET", "/horas-adicionales?desde=2026-05-12&hasta=2026-05-12", cookieVendedorA)).status,
    ).toBe(403);
    expect(
      (
        await peticionHoras("POST", "/horas-adicionales", cookieVendedorA, {
          inicio: instanteBogota("2026-05-12", 8),
          fin: instanteBogota("2026-05-12", 10),
        })
      ).status,
    ).toBe(403);
    expect(
      (await peticionHoras("GET", "/horas-adicionales/resumen?desde=2026-05-12&hasta=2026-05-12", cookieVendedorA))
        .status,
    ).toBe(403);
  });

  it("/resumen cuenta solo las APROBADA en las horas, y reporta aparte cuántas están PENDIENTE", async () => {
    const pendiente = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-05-18", 10),
      fin: instanteBogota("2026-05-18", 12),
    });
    expect(pendiente.status).toBe(201);

    const aprobada = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-05-18", 14),
      fin: instanteBogota("2026-05-18", 16),
    });
    expect(aprobada.status).toBe(201);
    await peticionHoras("PATCH", `/horas-adicionales/${aprobada.cuerpo.horaAdicional.id}/aprobar`, cookieAdminA);

    const resumen = await peticionHoras(
      "GET",
      "/horas-adicionales/resumen?desde=2026-05-18&hasta=2026-05-18",
      cookieAdminA,
    );
    const fila = resumen.cuerpo.resumen.find((f: { usuarioId: string }) => f.usuarioId === empleadoAId);
    // Solo las 2 horas de la APROBADA; la PENDIENTE no suma a ordinarias.
    expect(fila.ordinarias).toBe(2);
    expect(fila.dominicalesFestivas).toBe(0);
    expect(fila.pendientes).toBe(1);
  });

  it("R1: una hora adicional creada en la empresa A nunca aparece en el listado de la empresa B, y no se puede crear con un usuarioId de otra empresa", async () => {
    const deA = await peticionHoras("POST", "/horas-adicionales", cookieEmpleadoA, {
      inicio: instanteBogota("2026-05-25", 8),
      fin: instanteBogota("2026-05-25", 10),
    });
    expect(deA.status).toBe(201);

    const listadoB = await peticionHoras(
      "GET",
      "/horas-adicionales?desde=2026-05-25&hasta=2026-05-25",
      cookieAdminB,
    );
    expect(listadoB.cuerpo.horasAdicionales.some((h: { id: string }) => h.id === deA.cuerpo.horaAdicional.id)).toBe(
      false,
    );

    const conUsuarioDeOtraEmpresa = await peticionHoras("POST", "/horas-adicionales", cookieAdminB, {
      usuarioId: empleadoAId,
      inicio: instanteBogota("2026-05-26", 8),
      fin: instanteBogota("2026-05-26", 10),
    });
    expect(conUsuarioDeOtraEmpresa.status).toBe(404);
    expect(conUsuarioDeOtraEmpresa.cuerpo.error.codigo).toBe("USUARIO_NO_ENCONTRADO");

    const conUsuarioDeB = await peticionHoras("POST", "/horas-adicionales", cookieAdminB, {
      usuarioId: empleadoBId,
      inicio: instanteBogota("2026-05-26", 8),
      fin: instanteBogota("2026-05-26", 10),
    });
    expect(conUsuarioDeB.status).toBe(201);
  });
});
