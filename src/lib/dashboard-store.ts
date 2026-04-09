import fs from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";
import * as XLSX from "xlsx";

const DATA_DIR = path.join(process.cwd(), "data");
const SALES_DB_PATH = path.join(DATA_DIR, "sales-db.json");
const SALES_DB_BLOB_PATH = "dashboard/sales-db.json";

const LEGACY_SEED_FILES = [
  { unit: "Aguas Claras", regex: /Aguas Claras_31-03/i },
  { unit: "Joquei Clube", regex: /J.*quei\s+31-03/i },
  { unit: "Itororo", regex: /Itoror.+31-03/i },
] as const;

const BRAZILIAN_MONTH = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
});

const BRAZILIAN_DATE = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
});

export type UnitName = (typeof LEGACY_SEED_FILES)[number]["unit"];
export type PaymentCategory = "avista" | "prazo";

export type SaleRecord = {
  id: string;
  customer: string;
  unit: UnitName;
  saleDate: string;
  monthKey: string;
  monthLabel: string;
  planLabel: string;
  paymentMethod: string;
  paymentCategory: PaymentCategory;
  pointsCredited: number;
  expectedAmount: number;
  expectedUpfrontAmount: number;
  expectedInstallmentAmount: number;
  installmentReceived: number;
  installmentRemaining: number;
  installmentAmount: number;
  installmentsPaid: number;
  sourceFile: string;
  notes: string[];
};

type MonthlySummary = {
  monthKey: string;
  monthLabel: string;
  sales: number;
  points: number;
  revenue: number;
  upfront: number;
  installmentExpected: number;
  installmentReceived: number;
  installmentRemaining: number;
};

type GroupSummary = {
  label: string;
  sales: number;
  points: number;
  revenue: number;
  upfront: number;
  installmentExpected: number;
  installmentReceived: number;
  installmentRemaining: number;
};

export type SourceFileMeta = {
  unit: UnitName;
  fileName: string;
  kind: "seed" | "upload";
  importedAt: string;
};

type SalesDatabase = {
  sales: SaleRecord[];
  sourceFiles: SourceFileMeta[];
  updatedAt: string;
};

export type DashboardData = {
  generatedAt: string;
  totals: {
    sales: number;
    points: number;
    revenue: number;
    upfront: number;
    installmentExpected: number;
    installmentReceived: number;
    installmentRemaining: number;
    averageTicket: number;
    pendingRatio: number;
  };
  monthlyTable: MonthlySummary[];
  paymentBreakdown: GroupSummary[];
  unitBreakdown: GroupSummary[];
  notes: string[];
  sourceFiles: SourceFileMeta[];
  sales: SaleRecord[];
};

function shouldUseBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function streamToString(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk))),
  );
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseCurrency(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeaderKey(value: unknown) {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function excelDateToDate(value: unknown) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) {
      return new Date(parts.y, parts.m - 1, parts.d);
    }
  }

  const text = String(value ?? "").trim();
  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return new Date(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1]));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

function formatMonth(date: Date) {
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return {
    monthKey,
    monthLabel: BRAZILIAN_MONTH.format(date).replace(".", ""),
  };
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function differenceInDays(start: Date, end: Date) {
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.floor((utcEnd - utcStart) / 86_400_000));
}

function inferInstallmentsPaid(saleDate: Date, asOfDate: Date) {
  const days = differenceInDays(saleDate, asOfDate);
  return Math.max(0, Math.floor((days + 15) / 30));
}

function normalizePayment(rawValue: unknown) {
  const normalized = normalizeText(rawValue);

  if (normalized === "A VISTA") return { label: "A vista", category: "avista" as const };
  if (normalized === "PIX") return { label: "Pix", category: "avista" as const };
  if (normalized === "CARTAO CREDITO" || normalized === "CARTAO DE CREDITO") {
    return { label: "Cartao de credito", category: "avista" as const };
  }
  if (
    normalized === "RECORRENTE" ||
    normalized === "CARTAO RECORRENTE" ||
    normalized === "CRED RECORRENTE"
  ) {
    return { label: "Recorrente", category: "prazo" as const };
  }
  if (normalized === "BOLETO" || normalized === "BOLETO BANCARIO") {
    return { label: "Boleto", category: "prazo" as const };
  }
  if (normalized === "DESC FOLHA") {
    return { label: "Desconto em folha", category: "prazo" as const };
  }
  if (normalized === "MISTO") {
    return { label: "Misto", category: "avista" as const };
  }

  return {
    label: rawValue ? String(rawValue).trim() : "Nao informado",
    category: "avista" as const,
  };
}

function shouldIncludeSale(record: Pick<SaleRecord, "unit" | "paymentMethod">) {
  if (record.unit !== "Itororo") {
    return true;
  }

  return record.paymentMethod !== "Boleto" && record.paymentMethod !== "Recorrente";
}

function readSheetRowsFromBuffer(buffer: Buffer, sheetName: string, headerRowIndex: number) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`A aba ${sheetName} nao foi encontrada no arquivo enviado.`);
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
    header: 1,
    defval: "",
  });

  const headers = rows[headerRowIndex].map((cell) => normalizeHeaderKey(cell));
  return rows.slice(headerRowIndex + 1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function buildAguasClarasFromBuffer(buffer: Buffer, fileName: string, asOfDate: Date): SaleRecord[] {
  const rows = readSheetRowsFromBuffer(buffer, "Fechamento", 1);

  return rows
    .filter((row) => String(row.TITULO ?? "").trim())
    .map((row) => {
      const saleDate = excelDateToDate(row.DTVENDA);
      const { monthKey, monthLabel } = formatMonth(saleDate);
      const planType = normalizeText(row.TIPO_DO_PLANO);
      const payment = normalizePayment(row.PLANO);
      const expectedAmount = planType === "FAMILIAR" ? 1198 : 598;
      const pointsCredited = planType === "FAMILIAR" ? 18000 : 9000;
      const installmentAmount = planType === "FAMILIAR" ? 99.9 : 49.9;
      const rawInstallmentsPaid = parseCurrency(row.N_PARCELAS);
      const installmentsPaid =
        payment.category === "prazo"
          ? rawInstallmentsPaid || inferInstallmentsPaid(saleDate, asOfDate)
          : 0;
      const installmentReceived =
        payment.category === "prazo"
          ? Math.min(
              expectedAmount,
              parseCurrency(row.R_TOTAL_PARCELAS) || installmentsPaid * installmentAmount,
            )
          : 0;

      return {
        id: String(row.TITULO).trim(),
        customer: String(row.EM_PODER ?? "").trim(),
        unit: "Aguas Claras",
        saleDate: toIsoDate(saleDate),
        monthKey,
        monthLabel,
        planLabel: planType === "FAMILIAR" ? "Familiar" : "Duo",
        paymentMethod: payment.label,
        paymentCategory: payment.category,
        pointsCredited,
        expectedAmount,
        expectedUpfrontAmount: payment.category === "avista" ? expectedAmount : 0,
        expectedInstallmentAmount: payment.category === "prazo" ? expectedAmount : 0,
        installmentReceived,
        installmentRemaining:
          payment.category === "prazo" ? Math.max(expectedAmount - installmentReceived, 0) : 0,
        installmentAmount: payment.category === "prazo" ? installmentAmount : 0,
        installmentsPaid,
        sourceFile: fileName,
        notes: [],
      };
    });
}

function buildJoqueiFromBuffer(buffer: Buffer, fileName: string, asOfDate: Date): SaleRecord[] {
  const rows = readSheetRowsFromBuffer(buffer, "Planilha2", 1);

  return rows
    .filter((row) => String(row.TITULO ?? "").trim())
    .map((row) => {
      const saleDate = excelDateToDate(row.DATA);
      const { monthKey, monthLabel } = formatMonth(saleDate);
      const payment = normalizePayment(row.NOMEPLANO);
      const expectedAmount = 598;
      const rawInstallmentsPaid = parseCurrency(row.N_DE_PARCELAS);
      const installmentsPaid =
        payment.category === "prazo"
          ? rawInstallmentsPaid || inferInstallmentsPaid(saleDate, asOfDate)
          : 0;
      const installmentReceived =
        payment.category === "prazo"
          ? Math.min(
              expectedAmount,
              parseCurrency(row.R_PARCELADO_JA_RECEBIDO) ||
                parseCurrency(row.R_TOTAL_PARCELAS) ||
                installmentsPaid * 49.9,
            )
          : 0;

      return {
        id: String(row.TITULO).trim(),
        customer: String(row.EM_PODER ?? "").trim(),
        unit: "Joquei Clube",
        saleDate: toIsoDate(saleDate),
        monthKey,
        monthLabel,
        planLabel: "9000 pontos",
        paymentMethod: payment.label,
        paymentCategory: payment.category,
        pointsCredited: 9000,
        expectedAmount,
        expectedUpfrontAmount: payment.category === "avista" ? expectedAmount : 0,
        expectedInstallmentAmount: payment.category === "prazo" ? expectedAmount : 0,
        installmentReceived,
        installmentRemaining:
          payment.category === "prazo" ? Math.max(expectedAmount - installmentReceived, 0) : 0,
        installmentAmount: payment.category === "prazo" ? 49.9 : 0,
        installmentsPaid,
        sourceFile: fileName,
        notes:
          payment.label === "Misto"
            ? ["Vendas mistas foram classificadas como recebimento a vista."]
            : [],
      };
    });
}

function buildItororoFromBuffer(buffer: Buffer, fileName: string, asOfDate: Date): SaleRecord[] {
  const rows = readSheetRowsFromBuffer(buffer, "Fechamento", 1);

  return rows
    .filter((row) => String(row.TITULO ?? "").trim())
    .map((row) => {
      const saleDate = excelDateToDate(row.DATA);
      const { monthKey, monthLabel } = formatMonth(saleDate);
      const payment = normalizePayment(row.NOMEPLANO);
      const expectedAmount = 598;
      const installmentsPaid =
        payment.category === "prazo" ? inferInstallmentsPaid(saleDate, asOfDate) : 0;
      const installmentReceived =
        payment.category === "prazo" ? Math.min(expectedAmount, installmentsPaid * 49.9) : 0;

      return {
        id: String(row.TITULO).trim(),
        customer: String(row.EM_PODER ?? "").trim(),
        unit: "Itororo",
        saleDate: toIsoDate(saleDate),
        monthKey,
        monthLabel,
        planLabel: "9000 pontos",
        paymentMethod: payment.label,
        paymentCategory: payment.category,
        pointsCredited: 9000,
        expectedAmount,
        expectedUpfrontAmount: payment.category === "avista" ? expectedAmount : 0,
        expectedInstallmentAmount: payment.category === "prazo" ? expectedAmount : 0,
        installmentReceived,
        installmentRemaining:
          payment.category === "prazo" ? Math.max(expectedAmount - installmentReceived, 0) : 0,
        installmentAmount: payment.category === "prazo" ? 49.9 : 0,
        installmentsPaid,
        sourceFile: fileName,
        notes:
          payment.category === "prazo"
            ? [
                "Itororo nao informa parcelas pagas por venda; o dashboard estima as parcelas com base nos dias corridos desde a data da venda.",
              ]
            : [],
      };
    });
}

export function parseWorkbookBuffer(params: {
  unit: UnitName;
  fileName: string;
  buffer: Buffer;
  asOfDate?: Date;
}) {
  const asOfDate = params.asOfDate ?? new Date();

  const parsed =
    params.unit === "Aguas Claras"
      ? buildAguasClarasFromBuffer(params.buffer, params.fileName, asOfDate)
      : params.unit === "Joquei Clube"
        ? buildJoqueiFromBuffer(params.buffer, params.fileName, asOfDate)
        : buildItororoFromBuffer(params.buffer, params.fileName, asOfDate);

  return parsed.filter(shouldIncludeSale);
}

async function readDatabaseFile() {
  if (shouldUseBlobStorage()) {
    const result = await get(SALES_DB_BLOB_PATH, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }

    return JSON.parse(await streamToString(result.stream)) as SalesDatabase;
  }

  if (!fs.existsSync(SALES_DB_PATH)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(SALES_DB_PATH, "utf-8")) as SalesDatabase;
}

async function writeDatabaseFile(database: SalesDatabase) {
  if (shouldUseBlobStorage()) {
    await put(SALES_DB_BLOB_PATH, JSON.stringify(database, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  ensureDataDir();
  fs.writeFileSync(SALES_DB_PATH, JSON.stringify(database, null, 2), "utf-8");
}

async function seedDatabaseFromLegacyFiles(): Promise<SalesDatabase> {
  ensureDataDir();
  const importedAt = new Date().toISOString();
  const directoryEntries = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];

  const sourceFiles = LEGACY_SEED_FILES.flatMap((seed) => {
    const fileName = directoryEntries.find((entry) => seed.regex.test(entry.normalize("NFC")));
    return fileName
      ? [
          {
            unit: seed.unit,
            fileName,
            kind: "seed" as const,
            importedAt,
          },
        ]
      : [];
  });

  const sales = sourceFiles.flatMap((source) => {
    const buffer = fs.readFileSync(path.join(DATA_DIR, source.fileName));
    return parseWorkbookBuffer({
      unit: source.unit,
      fileName: source.fileName,
      buffer,
    });
  });

  const database: SalesDatabase = {
    sales,
    sourceFiles,
    updatedAt: importedAt,
  };

  await writeDatabaseFile(database);
  return database;
}

async function getDatabase() {
  return (await readDatabaseFile()) ?? (await seedDatabaseFromLegacyFiles());
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function groupSales<T extends string>(
  sales: SaleRecord[],
  getKey: (sale: SaleRecord) => T,
  getLabel: (key: T) => string = (key) => key,
) {
  const map = new Map<T, GroupSummary>();

  for (const sale of sales) {
    const key = getKey(sale);
    const current = map.get(key) ?? {
      label: getLabel(key),
      sales: 0,
      points: 0,
      revenue: 0,
      upfront: 0,
      installmentExpected: 0,
      installmentReceived: 0,
      installmentRemaining: 0,
    };

    current.sales += 1;
    current.points += sale.pointsCredited;
    current.revenue += sale.expectedAmount;
    current.upfront += sale.expectedUpfrontAmount;
    current.installmentExpected += sale.expectedInstallmentAmount;
    current.installmentReceived += sale.installmentReceived;
    current.installmentRemaining += sale.installmentRemaining;
    map.set(key, current);
  }

  return Array.from(map.values()).map((entry) => ({
    ...entry,
    revenue: roundCurrency(entry.revenue),
    upfront: roundCurrency(entry.upfront),
    installmentExpected: roundCurrency(entry.installmentExpected),
    installmentReceived: roundCurrency(entry.installmentReceived),
    installmentRemaining: roundCurrency(entry.installmentRemaining),
  }));
}

export async function appendUploadedWorkbook(params: {
  unit: UnitName;
  fileName: string;
  buffer: Buffer;
}) {
  const database = await getDatabase();
  const parsedSales = parseWorkbookBuffer(params);
  const importedAt = new Date().toISOString();

  const existingKeys = new Set(database.sales.map((sale) => `${sale.unit}::${sale.id}`));
  const batchKeys = new Set<string>();
  const uniqueSales = parsedSales.filter((sale) => {
    const key = `${sale.unit}::${sale.id}`;
    if (existingKeys.has(key) || batchKeys.has(key)) {
      return false;
    }
    batchKeys.add(key);
    return true;
  });

  const nextDatabase: SalesDatabase = {
    sales: [...database.sales, ...uniqueSales].sort((a, b) => a.saleDate.localeCompare(b.saleDate)),
    sourceFiles: [
      ...database.sourceFiles,
      {
        unit: params.unit,
        fileName: params.fileName,
        kind: "upload",
        importedAt,
      },
    ],
    updatedAt: importedAt,
  };

  await writeDatabaseFile(nextDatabase);

  return {
    parsed: parsedSales.length,
    added: uniqueSales.length,
    skipped: parsedSales.length - uniqueSales.length,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const database = await getDatabase();
  const sales = database.sales.filter(shouldIncludeSale);
  const monthlyMap = new Map<string, MonthlySummary>();

  for (const sale of sales) {
    const current = monthlyMap.get(sale.monthKey) ?? {
      monthKey: sale.monthKey,
      monthLabel: sale.monthLabel,
      sales: 0,
      points: 0,
      revenue: 0,
      upfront: 0,
      installmentExpected: 0,
      installmentReceived: 0,
      installmentRemaining: 0,
    };

    current.sales += 1;
    current.points += sale.pointsCredited;
    current.revenue += sale.expectedAmount;
    current.upfront += sale.expectedUpfrontAmount;
    current.installmentExpected += sale.expectedInstallmentAmount;
    current.installmentReceived += sale.installmentReceived;
    current.installmentRemaining += sale.installmentRemaining;
    monthlyMap.set(sale.monthKey, current);
  }

  const monthlyTable = Array.from(monthlyMap.values())
    .map((entry) => ({
      ...entry,
      revenue: roundCurrency(entry.revenue),
      upfront: roundCurrency(entry.upfront),
      installmentExpected: roundCurrency(entry.installmentExpected),
      installmentReceived: roundCurrency(entry.installmentReceived),
      installmentRemaining: roundCurrency(entry.installmentRemaining),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const paymentBreakdown = groupSales(sales, (sale) => sale.paymentMethod).sort(
    (a, b) => b.revenue - a.revenue,
  );
  const unitBreakdown = groupSales(sales, (sale) => sale.unit).sort((a, b) => b.revenue - a.revenue);

  const totals = sales.reduce(
    (accumulator, sale) => {
      accumulator.sales += 1;
      accumulator.points += sale.pointsCredited;
      accumulator.revenue += sale.expectedAmount;
      accumulator.upfront += sale.expectedUpfrontAmount;
      accumulator.installmentExpected += sale.expectedInstallmentAmount;
      accumulator.installmentReceived += sale.installmentReceived;
      accumulator.installmentRemaining += sale.installmentRemaining;
      return accumulator;
    },
    {
      sales: 0,
      points: 0,
      revenue: 0,
      upfront: 0,
      installmentExpected: 0,
      installmentReceived: 0,
      installmentRemaining: 0,
    },
  );

  const pendingRatio =
    totals.installmentExpected > 0
      ? roundCurrency((totals.installmentRemaining / totals.installmentExpected) * 100)
      : 0;

  const notes = Array.from(new Set(sales.flatMap((sale) => sale.notes)));

  return {
    generatedAt: BRAZILIAN_DATE.format(new Date(database.updatedAt)),
    totals: {
      sales: totals.sales,
      points: totals.points,
      revenue: roundCurrency(totals.revenue),
      upfront: roundCurrency(totals.upfront),
      installmentExpected: roundCurrency(totals.installmentExpected),
      installmentReceived: roundCurrency(totals.installmentReceived),
      installmentRemaining: roundCurrency(totals.installmentRemaining),
      averageTicket: totals.sales ? roundCurrency(totals.revenue / totals.sales) : 0,
      pendingRatio,
    },
    monthlyTable,
    paymentBreakdown,
    unitBreakdown,
    notes,
    sourceFiles: database.sourceFiles,
    sales,
  };
}
