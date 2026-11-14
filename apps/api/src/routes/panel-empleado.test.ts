import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw: arma la fixture fuera de cualquier contexto de empresa
// autenticado, mismo patrón que comisiones.test.ts/instrucciones.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { inicioDiaBogota } from "../lib/periodos.ts";
import { auth } from "./auth.ts";
import { panelEmpleado } from "./panel-empleado.ts";
import { comisiones } from "./comisiones.ts";

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

async function peticion(ruta: string, cookie: string) {
  const respuesta = await panelEmpleado.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null, texto };
}

async function configurarFijoPorPantalla(cookieAdmin: string, valor = "1000") {
  const respuesta = await comisiones.handle(
    new Request("http://local/comisiones/configuracion", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieAdmin },
      body: JSON.stringify({ modo: "FIJO_POR_PANTALLA", valor, umbralCantidad: 0, umbralAmbito: "TOTAL", umbralPeriodo: "DIA" }),
    }),
  );
  if (respuesta.status !== 201) throw new Error(`No se pudo configurar comisiones: ${await respuesta.text()}`);
}

interface FixtureEmpresa {
  empresaId: string;
  cookieAdmin: string;
  empleadoId: string;
  cookieEmpleado: string;
  empleado2Id: string;
  cookieEmpleado2: string;
  vendedorId: string;
  cookieVendedor: string;
  plataformaId: string;
  cuentaId: string;
  pantallaId: string;
  duracionId: string;
}

async function crearFixture(etiqueta: string): Promise<FixtureEmpresa> {
  const prefijo = randomUUID().slice(0, 3).toUpperCase();
  const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

  const empresa = await prismaRaw.empresa.create({
    data: { nombre: `Empresa panel ${etiqueta}`, prefijoCodigo: prefijo },
  });
  const empresaId = empresa.id;

  const adminEmail = `admin-panel-${randomUUID()}@test.local`;
  const admin = await prismaRaw.usuario.create({
    data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
  });
  const cookieAdmin = await iniciarSesion(adminEmail);

  const empleadoEmail = `empleado-panel-${randomUUID()}@test.local`;
  const empleado = await prismaRaw.usuario.create({
    data: { empresaId, email: empleadoEmail, passwordHash: hash, nombre: "Empleado Uno", rol: "EMPLEADO" },
  });
  const cookieEmpleado = await iniciarSesion(empleadoEmail);

  const empleado2Email = `empleado2-panel-${randomUUID()}@test.local`;
  const empleado2 = await prismaRaw.usuario.create({
    data: { empresaId, email: empleado2Email, passwordHash: hash, nombre: "Empleado Dos", rol: "EMPLEADO" },
  });
  const cookieEmpleado2 = await iniciarSesion(empleado2Email);

  const vendedorEmail = `vendedor-panel-${randomUUID()}@test.local`;
  const vendedor = await prismaRaw.usuario.create({
    data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
  });
  const cookieVendedor = await iniciarSesion(vendedorEmail);

  const plataforma = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Netflix (${prefijo})`, capacidadPantallas: 50, usaPerfilPin: false },
  });
  const cuenta = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: plataforma.id, correo: `netflix-${randomUUID()}@test.local`, password: "cifrado", capacidadPantallas: 50 },
  });
  const pantalla = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
  const duracion = await prismaRaw.duracion.create({
    data: { empresaId, nombre: `30 días (${prefijo})`, cantidad: 30, unidad: "DIAS" },
  });

  void admin;
  return {
    empresaId,
    cookieAdmin,
    empleadoId: empleado.id,
    cookieEmpleado,
    empleado2Id: empleado2.id,
    cookieEmpleado2,
    vendedorId: vendedor.id,
    cookieVendedor,
    plataformaId: plataforma.id,
    cuentaId: cuenta.id,
    pantallaId: pantalla.id,
    duracionId: duracion.id,
  };
}

async function borrarFixture(empresaId: string) {
  await prismaRaw.instruccionVisualizacion.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccionCumplimiento.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccionArchivo.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccion.deleteMany({ where: { empresaId } });
  await prismaRaw.reporteSemanal.deleteMany({ where: { empresaId } });
  await prismaRaw.configuracionComision.deleteMany({ where: { empresaId } });
  await prismaRaw.turno.deleteMany({ where: { empresaId } });
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
  await prismaRaw.duracion.deleteMany({ where: { empresaId } });
  await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

const MS_HORA = 60 * 60 * 1000;
const MS_DIA = 24 * MS_HORA;
const DESPLAZAMIENTO_BOGOTA_MS = 5 * MS_HORA;

function inicioDiaBogotaHaceDias(diasAtras: number): Date {
  return inicioDiaBogota(new Date(Date.now() - diasAtras * MS_DIA));
}

/** "YYYY-MM-DD" (calendario Bogotá) del día de hace `diasAtras` días. */
function fechaISOBogota(diasAtras: number): string {
  const ficticio = new Date(inicioDiaBogotaHaceDias(diasAtras).getTime() - DESPLAZAMIENTO_BOGOTA_MS);
  const anio = ficticio.getUTCFullYear();
  const mes = String(ficticio.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(ficticio.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function horaBogota(diasAtras: number, hora: number): Date {
  return new Date(inicioDiaBogotaHaceDias(diasAtras).getTime() + hora * MS_HORA);
}

async function crearTurno(empresaId: string, usuarioId: string, inicio: Date, fin: Date) {
  return prismaRaw.turno.create({ data: { empresaId, usuarioId, inicio, fin } });
}

async function crearVentaConPantallas(
  f: FixtureEmpresa,
  vendedorId: string,
  cantidadPantallas: number,
  fechaVenta: Date,
) {
  const vencimiento = new Date(fechaVenta.getTime() + 30 * MS_DIA);
  const venta = await prismaRaw.venta.create({
    data: {
      empresaId: f.empresaId,
      vendedorId,
      codigoCompra: `COM-${randomUUID().slice(0, 8)}`,
      tipoVenta: "UNIDAD",
      duracionId: f.duracionId,
      esExterna: false,
      anulada: false,
      nombreItem: "Item de prueba",
      nombreDuracion: "30 días",
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      nombreTipoCliente: "Nuevo",
      precioSugerido: String(cantidadPantallas * 1000),
      precioVenta: String(cantidadPantallas * 1000),
      costo: "300",
      utilidad: String(cantidadPantallas * 1000 - 300),
      fechaVenta,
      fechaVencimientoMax: vencimiento,
      mensajeGenerado: "Mensaje de prueba",
    },
  });
  for (let i = 0; i < cantidadPantallas; i++) {
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId: f.empresaId,
        ventaId: venta.id,
        pantallaId: f.pantallaId,
        cuentaId: f.cuentaId,
        plataformaId: f.plataformaId,
        nombrePlataforma: "Netflix",
        passwordCuenta: "cifrado",
        duracionId: f.duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: vencimiento,
      },
    });
  }
  return venta;
}

async function crearInstruccionPublicada(f: FixtureEmpresa, titulo: string, semanaInicio: Date) {
  return prismaRaw.instruccion.create({
    data: { empresaId: f.empresaId, titulo, semanaInicio, cargoId: null, publicada: true, creadaPorId: f.vendedorId },
  });
}

describe("Panel individual del empleado (F6.9)", () => {
  describe("Composición de las cuatro secciones y aislamiento entre empleados", () => {
    let f: FixtureEmpresa;

    beforeAll(async () => {
      f = await crearFixture("COMPONE");
      await configurarFijoPorPantalla(f.cookieAdmin);
    });

    afterAll(async () => {
      await borrarFixture(f.empresaId);
    });

    it("las cuatro secciones traen lo propio del usuario, nunca lo de otro empleado", async () => {
      const dia = 10;
      await crearTurno(f.empresaId, f.empleadoId, horaBogota(dia, 0), horaBogota(dia, 8));
      await crearTurno(f.empresaId, f.empleado2Id, horaBogota(dia, 0), horaBogota(dia, 8));
      await crearVentaConPantallas(f, f.empleadoId, 2, horaBogota(dia, 10));
      await crearVentaConPantallas(f, f.empleado2Id, 5, horaBogota(dia, 11));

      const respuesta = await peticion(
        `/panel-empleado?desde=${fechaISOBogota(dia)}&hasta=${fechaISOBogota(dia)}`,
        f.cookieEmpleado,
      );
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.usuario.id).toBe(f.empleadoId);
      expect(respuesta.cuerpo.ventas.numeroVentas).toBe(1);
      expect(respuesta.cuerpo.ventas.pantallasVendidas).toBe(2);
      expect(respuesta.cuerpo.ventas.totalVendido).toBe("2000");
    });
  });

  describe("Metas: turno+pozo cumplida, turno sin pozo incumplida, sin turno no cuenta (Parte 1)", () => {
    let f: FixtureEmpresa;

    beforeAll(async () => {
      f = await crearFixture("METAS");
      await configurarFijoPorPantalla(f.cookieAdmin);
    });

    afterAll(async () => {
      await borrarFixture(f.empresaId);
    });

    it("cumplida con pozo, incumplida sin pozo, y un día sin turno no entra en ninguna", async () => {
      const diaConPozo = 20;
      const diaSinPozo = 19;
      const diaAjeno = 18; // el equipo vende, pero el empleado NO tuvo turno ese día.

      await crearTurno(f.empresaId, f.empleadoId, horaBogota(diaConPozo, 0), horaBogota(diaConPozo, 8));
      await crearVentaConPantallas(f, f.vendedorId, 1, horaBogota(diaConPozo, 10));

      await crearTurno(f.empresaId, f.empleadoId, horaBogota(diaSinPozo, 0), horaBogota(diaSinPozo, 8));
      // sin venta ese día: el equipo no generó pozo.

      await crearVentaConPantallas(f, f.vendedorId, 1, horaBogota(diaAjeno, 10));
      // venta sin que el empleado tuviera turno ese día.

      const respuesta = await peticion(
        `/panel-empleado?desde=${fechaISOBogota(diaConPozo)}&hasta=${fechaISOBogota(diaAjeno)}`,
        f.cookieEmpleado,
      );
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.metas.cumplidas).toBe(1);
      expect(respuesta.cuerpo.metas.incumplidas).toBe(1);
      expect(respuesta.cuerpo.metas.dias.length).toBe(2); // el día ajeno no cuenta en ninguna.
    });
  });

  describe("R4: el JSON crudo del empleado no filtra costo, utilidad, margen ni el pozo total", () => {
    let f: FixtureEmpresa;

    beforeAll(async () => {
      f = await crearFixture("R4PANEL");
      await configurarFijoPorPantalla(f.cookieAdmin);
    });

    afterAll(async () => {
      await borrarFixture(f.empresaId);
    });

    it("el texto crudo de la respuesta no contiene costo/utilidad/margen/pozoTotal", async () => {
      const dia = 30;
      await crearTurno(f.empresaId, f.empleadoId, horaBogota(dia, 0), horaBogota(dia, 8));
      await crearVentaConPantallas(f, f.empleadoId, 3, horaBogota(dia, 10));

      const respuesta = await peticion(
        `/panel-empleado?desde=${fechaISOBogota(dia)}&hasta=${fechaISOBogota(dia)}`,
        f.cookieEmpleado,
      );
      expect(respuesta.status).toBe(200);
      expect(respuesta.texto).not.toContain("costo");
      expect(respuesta.texto).not.toContain("utilidad");
      expect(respuesta.texto).not.toContain("margen");
      expect(respuesta.texto).not.toContain("pozoTotal");
      expect(respuesta.texto).not.toContain("pozoSinRepartir");
    });
  });

  describe("Ignora usuarioId ajeno por query, roles, R1 y panel vacío", () => {
    let f: FixtureEmpresa;
    let fB: FixtureEmpresa;

    beforeAll(async () => {
      f = await crearFixture("ROLES-A");
      fB = await crearFixture("ROLES-B");
    });

    afterAll(async () => {
      await borrarFixture(f.empresaId);
      await borrarFixture(fB.empresaId);
    });

    it("GET /panel-empleado ignora un usuarioId ajeno pasado por query y devuelve siempre el propio", async () => {
      const respuesta = await peticion(`/panel-empleado?usuarioId=${f.empleado2Id}`, f.cookieEmpleado);
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.usuario.id).toBe(f.empleadoId);
    });

    it("GET /panel-empleado/:usuarioId como EMPLEADO recibe 403", async () => {
      const respuesta = await peticion(`/panel-empleado/${f.empleado2Id}`, f.cookieEmpleado);
      expect(respuesta.status).toBe(403);
    });

    it("un VENDEDOR recibe 403 en las dos rutas", async () => {
      expect((await peticion("/panel-empleado", f.cookieVendedor)).status).toBe(403);
      expect((await peticion(`/panel-empleado/${f.empleadoId}`, f.cookieVendedor)).status).toBe(403);
    });

    it("un empleado sin ventas, sin turnos y sin pendientes recibe un panel vacío válido", async () => {
      const respuesta = await peticion("/panel-empleado?desde=2020-01-01&hasta=2020-01-02", f.cookieEmpleado2);
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.ventas.numeroVentas).toBe(0);
      expect(respuesta.cuerpo.ventas.pantallasVendidas).toBe(0);
      expect(respuesta.cuerpo.ventas.totalVendido).toBe("0");
      expect(respuesta.cuerpo.comision.configurada).toBe(false);
      expect(respuesta.cuerpo.comision.totalCerrado).toBe("0");
      expect(respuesta.cuerpo.comision.provisional).toBeNull();
      expect(respuesta.cuerpo.metas.cumplidas).toBe(0);
      expect(respuesta.cuerpo.metas.incumplidas).toBe(0);
      expect(respuesta.cuerpo.metas.dias).toEqual([]);
      expect(respuesta.cuerpo.pendientes.instrucciones).toEqual([]);
    });

    it("R1: un ADMIN de la empresa A no puede pedir el panel de un usuario de la empresa B (404)", async () => {
      const respuesta = await peticion(`/panel-empleado/${fB.empleadoId}`, f.cookieAdmin);
      expect(respuesta.status).toBe(404);
    });

    it("un ADMIN sí puede pedir el panel de un empleado de su propia empresa", async () => {
      const respuesta = await peticion(`/panel-empleado/${f.empleadoId}`, f.cookieAdmin);
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.usuario.id).toBe(f.empleadoId);
    });
  });

  describe("Pendientes: reporte semanal e instrucciones (F6.4/F6.7)", () => {
    let f: FixtureEmpresa;

    beforeAll(async () => {
      f = await crearFixture("PENDIENTES");
    });

    afterAll(async () => {
      await borrarFixture(f.empresaId);
    });

    it("una instrucción publicada sin cumplir aparece pendiente; al completarla, desaparece", async () => {
      const instruccion = await crearInstruccionPublicada(f, "Instrucción de prueba", inicioDiaBogota(new Date()));

      const antes = await peticion("/panel-empleado", f.cookieEmpleado);
      expect(antes.status).toBe(200);
      expect(antes.cuerpo.pendientes.instrucciones.some((i: { id: string }) => i.id === instruccion.id)).toBe(true);

      await prismaRaw.instruccionCumplimiento.create({
        data: { empresaId: f.empresaId, instruccionId: instruccion.id, usuarioId: f.empleadoId },
      });

      const despues = await peticion("/panel-empleado", f.cookieEmpleado);
      expect(despues.cuerpo.pendientes.instrucciones.some((i: { id: string }) => i.id === instruccion.id)).toBe(false);
    });

    it("sin reporte semanal de la semana en curso, reporteSemanalPendiente es true; tras crearlo, false", async () => {
      const antes = await peticion("/panel-empleado", f.cookieEmpleado2);
      expect(antes.cuerpo.pendientes.reporteSemanalPendiente).toBe(true);

      const lunesActual = (() => {
        const hoy = new Date();
        const ficticio = new Date(hoy.getTime() - DESPLAZAMIENTO_BOGOTA_MS);
        const diaSemana = ficticio.getUTCDay();
        const offset = diaSemana === 0 ? 6 : diaSemana - 1;
        ficticio.setUTCHours(0, 0, 0, 0);
        ficticio.setUTCDate(ficticio.getUTCDate() - offset);
        return new Date(ficticio.getTime() + DESPLAZAMIENTO_BOGOTA_MS);
      })();

      await prismaRaw.reporteSemanal.create({
        data: {
          empresaId: f.empresaId,
          usuarioId: f.empleado2Id,
          cargoId: null,
          semanaInicio: lunesActual,
          pendientes: "Nada",
          fallas: "Nada",
          oportunidades: "Nada",
        },
      });

      const despues = await peticion("/panel-empleado", f.cookieEmpleado2);
      expect(despues.cuerpo.pendientes.reporteSemanalPendiente).toBe(false);
    });
  });
});
