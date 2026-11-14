import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture (empresas, usuarios, cargos)
// fuera de cualquier contexto de empresa autenticado, igual que
// horas-adicionales.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { usuarios } from "./usuarios.ts";
import { reportes } from "./reportes.ts";
import { inicioSemanaBogota } from "../lib/periodos.ts";

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
  router: typeof reportes | typeof usuarios,
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

const peticionReportes = (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) =>
  peticion(reportes, metodo, ruta, cookie, cuerpo);
const peticionUsuarios = (metodo: string, ruta: string, cookie: string, cuerpo?: unknown) =>
  peticion(usuarios, metodo, ruta, cookie, cuerpo);

/** YYYY-MM-DD de una fecha, en el calendario de Bogotá, para usar como query `semana`. */
function comoFechaBogota(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(fecha);
}

describe("Reportes semanales por cargo (F6.4)", () => {
  let empresaAId: string;
  let adminAId: string;
  let cookieAdminA: string;
  let cargoAId: string;
  let empleadoAId: string;
  let cookieEmpleadoA: string;
  let otroEmpleadoAId: string;
  let cookieOtroEmpleadoA: string;
  let vendedorAId: string;
  let cookieVendedorA: string;

  let empresaBId: string;
  let cookieAdminB: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  // Semana actual y anterior, en el calendario de Bogotá — editables. Dos
  // semanas atrás, cerrada. Se calculan en tiempo real (no fechas fijas)
  // porque la ventana editable depende del momento en que corre la prueba.
  const ahora = new Date();
  const semanaActual = inicioSemanaBogota(ahora);
  const semanaAnterior = new Date(semanaActual.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dosSemanasAtras = new Date(semanaActual.getTime() - 14 * 24 * 60 * 60 * 1000);

  const semanaActualQuery = comoFechaBogota(semanaActual);
  const semanaAnteriorQuery = comoFechaBogota(semanaAnterior);
  const dosSemanasAtrasQuery = comoFechaBogota(dosSemanasAtras);

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa reportes A (reportes.test)", prefijoCodigo: "RPA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);

    const cargoA = await prismaRaw.cargo.create({
      data: { empresaId: empresaAId, nombre: "Soporte técnico" },
    });
    cargoAId = cargoA.id;

    const adminAEmail = `admin-reportes-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    const adminA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    adminAId = adminA.id;
    cookieAdminA = await iniciarSesion(adminAEmail);

    const empleadoAEmail = `empleado-reportes-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(empleadoAEmail);
    const empleadoA = await prismaRaw.usuario.create({
      data: {
        empresaId: empresaAId,
        email: empleadoAEmail,
        passwordHash: hash,
        nombre: "Empleado A",
        rol: "EMPLEADO",
        cargoId: cargoAId,
      },
    });
    empleadoAId = empleadoA.id;
    cookieEmpleadoA = await iniciarSesion(empleadoAEmail);

    const otroEmpleadoAEmail = `otro-empleado-reportes-a-${randomUUID()}@test.local`;
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

    const vendedorAEmail = `vendedor-reportes-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(vendedorAEmail);
    const vendedorA = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedorAEmail, passwordHash: hash, nombre: "Vendedor A", rol: "VENDEDOR" },
    });
    vendedorAId = vendedorA.id;
    cookieVendedorA = await iniciarSesion(vendedorAEmail);

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa reportes B (reportes.test)", prefijoCodigo: "RPB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);

    const adminBEmail = `admin-reportes-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);
  });

  afterAll(async () => {
    await prismaRaw.reporteSemanal.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.cargo.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("un segundo PUT de la misma persona y semana actualiza el reporte existente, no crea otro", async () => {
    const primero = await peticionReportes("PUT", "/reportes/mio", cookieEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "Terminar ticket 42",
      fallas: "",
      oportunidades: "",
    });
    expect(primero.status).toBe(200);
    const id = primero.cuerpo.reporte.id;

    const segundo = await peticionReportes("PUT", "/reportes/mio", cookieEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "Terminar ticket 42 y 43",
      fallas: "Llegué tarde el martes",
      oportunidades: "",
    });
    expect(segundo.status).toBe(200);
    expect(segundo.cuerpo.reporte.id).toBe(id);
    expect(segundo.cuerpo.reporte.pendientes).toBe("Terminar ticket 42 y 43");

    const total = await prismaRaw.reporteSemanal.count({
      where: { usuarioId: empleadoAId, semanaInicio: semanaActual },
    });
    expect(total).toBe(1);
  });

  it("la semana actual y la anterior son editables; dos semanas atrás responde 409 SEMANA_CERRADA", async () => {
    const actual = await peticionReportes("PUT", "/reportes/mio", cookieOtroEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "Pendiente de esta semana",
      fallas: "",
      oportunidades: "",
    });
    expect(actual.status).toBe(200);

    const anterior = await peticionReportes("PUT", "/reportes/mio", cookieOtroEmpleadoA, {
      semana: semanaAnteriorQuery,
      pendientes: "Pendiente de la semana pasada",
      fallas: "",
      oportunidades: "",
    });
    expect(anterior.status).toBe(200);

    const cerrada = await peticionReportes("PUT", "/reportes/mio", cookieOtroEmpleadoA, {
      semana: dosSemanasAtrasQuery,
      pendientes: "Intento tardío",
      fallas: "",
      oportunidades: "",
    });
    expect(cerrada.status).toBe(409);
    expect(cerrada.cuerpo.error.codigo).toBe("SEMANA_CERRADA");
  });

  it("zona horaria: un reporte escrito a las 23:00 Bogotá del domingo pertenece a esa semana, no a la siguiente", async () => {
    // No se puede ejercitar por PUT (la fecha cae fuera de la ventana
    // editable), así que se prueba directamente la función de cómputo de
    // semana que usa la ruta (semanaInicioDeQuery en reportes.ts reutiliza
    // exactamente inicioSemanaBogota + inicioDeFechaBogota — mismo estilo
    // de prueba de frontera que estadisticas-ventas.test.ts).
    // 2032-05-02 (domingo) 23:00 Bogotá = 2032-05-03T04:00:00.000Z. La
    // semana que contiene ese domingo empieza el lunes 2032-04-26, no el
    // 2032-05-03 de la semana siguiente.
    const domingo2300Bogota = new Date("2032-05-03T04:00:00.000Z");
    expect(comoFechaBogota(inicioSemanaBogota(domingo2300Bogota))).toBe("2032-04-26");
  });

  it("usuarioId en el body apuntando a otra persona es ignorado: el reporte siempre se escribe a nombre de quien hace la petición, incluso si es ADMIN", async () => {
    const comoAdmin = await peticionReportes("PUT", "/reportes/mio", cookieAdminA, {
      usuarioId: empleadoAId,
      semana: semanaActualQuery,
      pendientes: "Reporte del admin",
      fallas: "",
      oportunidades: "",
    } as unknown as Record<string, unknown>);
    expect(comoAdmin.status).toBe(200);
    expect(comoAdmin.cuerpo.reporte.usuarioId).not.toBe(empleadoAId);

    const deEmpleado = await peticionReportes("GET", `/reportes/mio?semana=${semanaActualQuery}`, cookieEmpleadoA);
    expect(deEmpleado.cuerpo.reporte?.pendientes).not.toBe("Reporte del admin");
  });

  it("los tres campos vacíos responden 400 REPORTE_VACIO; dos vacíos y uno con texto es válido", async () => {
    const vacio = await peticionReportes("PUT", "/reportes/mio", cookieOtroEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "",
      fallas: "",
      oportunidades: "",
    });
    expect(vacio.status).toBe(400);
    expect(vacio.cuerpo.error.codigo).toBe("REPORTE_VACIO");

    const dosVacios = await peticionReportes("PUT", "/reportes/mio", cookieOtroEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "",
      fallas: "",
      oportunidades: "Mejorar tiempos de respuesta",
    });
    expect(dosVacios.status).toBe(200);
  });

  it("cargoId queda copiado al momento de escribir: cambiar el cargo del usuario después no modifica reportes ya guardados en semanas cerradas", async () => {
    const otroCargo = await prismaRaw.cargo.create({
      data: { empresaId: empresaAId, nombre: "Ventas (reportes.test)" },
    });

    const escrito = await peticionReportes("PUT", "/reportes/mio", cookieEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "Reporte con cargo original",
      fallas: "",
      oportunidades: "",
    });
    expect(escrito.status).toBe(200);
    expect(escrito.cuerpo.reporte.cargoId).toBe(cargoAId);

    const cambioCargo = await peticionUsuarios("PATCH", `/usuarios/${empleadoAId}/cargo`, cookieAdminA, {
      cargoId: otroCargo.id,
    });
    expect(cambioCargo.status).toBe(200);

    // La fila ya escrita no cambia sola por el cambio de cargo del usuario.
    const sinReescribir = await prismaRaw.reporteSemanal.findFirst({
      where: { usuarioId: empleadoAId, semanaInicio: semanaActual },
    });
    expect(sinReescribir?.cargoId).toBe(cargoAId);

    // Pero un PUT nuevo, dentro de la ventana editable, sí copia el cargo
    // vigente al momento de ese nuevo PUT (parte 1 del prompt: "copia del
    // cargo al momento de escribir" — cada escritura es un momento nuevo).
    const reescrito = await peticionReportes("PUT", "/reportes/mio", cookieEmpleadoA, {
      semana: semanaActualQuery,
      pendientes: "Reporte con cargo nuevo",
      fallas: "",
      oportunidades: "",
    });
    expect(reescrito.status).toBe(200);
    expect(reescrito.cuerpo.reporte.cargoId).toBe(otroCargo.id);

    await prismaRaw.usuario.update({ where: { id: empleadoAId }, data: { cargoId: cargoAId } });
    await prismaRaw.cargo.delete({ where: { id: otroCargo.id } });
  });

  it("un VENDEDOR recibe 403 en todas las rutas de /reportes (F6.4: revendedor externo, no reporta)", async () => {
    expect(
      (await peticionReportes("GET", `/reportes/mio?semana=${semanaActualQuery}`, cookieVendedorA)).status,
    ).toBe(403);
    expect(
      (
        await peticionReportes("PUT", "/reportes/mio", cookieVendedorA, {
          semana: semanaActualQuery,
          pendientes: "x",
          fallas: "",
          oportunidades: "",
        })
      ).status,
    ).toBe(403);
    expect((await peticionReportes("GET", `/reportes?semana=${semanaActualQuery}`, cookieVendedorA)).status).toBe(
      403,
    );
    expect(
      (await peticionReportes("GET", `/reportes/faltantes?semana=${semanaActualQuery}`, cookieVendedorA)).status,
    ).toBe(403);
  });

  it("un EMPLEADO recibe 403 en las rutas de administrador (GET /reportes y /reportes/faltantes)", async () => {
    expect((await peticionReportes("GET", `/reportes?semana=${semanaActualQuery}`, cookieEmpleadoA)).status).toBe(
      403,
    );
    expect(
      (await peticionReportes("GET", `/reportes/faltantes?semana=${semanaActualQuery}`, cookieEmpleadoA)).status,
    ).toBe(403);
  });

  it("GET /reportes agrupable por cargoId, y GET /reportes/faltantes lista a los EMPLEADO+ que no han reportado esa semana", async () => {
    // Usa la semana actual (ya tiene reportes de empleadoA y otroEmpleadoA
    // de pruebas previas, lo cual es correcto: ambos ya reportaron).
    const listado = await peticionReportes("GET", `/reportes?semana=${semanaActualQuery}`, cookieAdminA);
    expect(listado.status).toBe(200);
    const idsListado = listado.cuerpo.reportes.map((r: { usuarioId: string }) => r.usuarioId);
    expect(idsListado).toContain(empleadoAId);

    const porCargo = await peticionReportes(
      "GET",
      `/reportes?semana=${semanaActualQuery}&cargoId=${cargoAId}`,
      cookieAdminA,
    );
    expect(porCargo.status).toBe(200);
    expect(porCargo.cuerpo.reportes.every((r: { cargoId: string | null }) => r.cargoId === cargoAId)).toBe(true);

    const faltantes = await peticionReportes("GET", `/reportes/faltantes?semana=${semanaActualQuery}`, cookieAdminA);
    expect(faltantes.status).toBe(200);
    const idsFaltantes = faltantes.cuerpo.faltantes.map((f: { id: string }) => f.id);
    // empleadoA y otroEmpleadoA ya reportaron esta semana en pruebas previas.
    expect(idsFaltantes).not.toContain(empleadoAId);
    expect(idsFaltantes).not.toContain(otroEmpleadoAId);
    // vendedorA no reporta (no es EMPLEADO), así que tampoco debe listarse.
    expect(idsFaltantes).not.toContain(vendedorAId);
  });

  it("F6.7 Parte 0: un ADMIN activo sin reporte no aparece en /reportes/faltantes (rol: EMPLEADO exacto, no 'not VENDEDOR')", async () => {
    const faltantes = await peticionReportes("GET", `/reportes/faltantes?semana=${semanaActualQuery}`, cookieAdminA);
    expect(faltantes.status).toBe(200);
    const idsFaltantes = faltantes.cuerpo.faltantes.map((f: { id: string }) => f.id);
    expect(idsFaltantes).not.toContain(adminAId);
  });

  it("R1: un reporte de la empresa A nunca aparece en el listado ni en los faltantes de la empresa B", async () => {
    const listadoB = await peticionReportes("GET", `/reportes?semana=${semanaActualQuery}`, cookieAdminB);
    expect(listadoB.status).toBe(200);
    expect(listadoB.cuerpo.reportes).toEqual([]);

    const faltantesB = await peticionReportes("GET", `/reportes/faltantes?semana=${semanaActualQuery}`, cookieAdminB);
    expect(faltantesB.status).toBe(200);
    const idsFaltantesB = faltantesB.cuerpo.faltantes.map((f: { id: string }) => f.id);
    expect(idsFaltantesB).not.toContain(empleadoAId);
    expect(idsFaltantesB).not.toContain(otroEmpleadoAId);
  });
});
