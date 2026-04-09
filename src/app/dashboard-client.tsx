"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardData, UnitName } from "@/lib/dashboard-store";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("pt-BR");

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatInteger(value: number) {
  return integerFormatter.format(value);
}

function widthPercent(value: number, max: number) {
  if (max <= 0) {
    return "0%";
  }

  return `${Math.max(10, (value / max) * 100)}%`;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className={`rounded-[28px] border p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] ${tone}`}>
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <h2 className="mt-4 text-3xl font-semibold text-slate-950">{value}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{hint}</p>
    </article>
  );
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [activeView, setActiveView] = useState<"operacao" | "comissionamento">("operacao");
  const [unitFilter, setUnitFilter] = useState("Todas");
  const [monthFilter, setMonthFilter] = useState("Todos");
  const [paymentFilter, setPaymentFilter] = useState("Todos");
  const [categoryFilter, setCategoryFilter] = useState("Todos");
  const [search, setSearch] = useState("");
  const [uploadUnit, setUploadUnit] = useState<UnitName>("Aguas Claras");
  const [uploadMessage, setUploadMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const unitOptions = useMemo(
    () => ["Todas", ...Array.from(new Set(data.sales.map((sale) => sale.unit))).sort((a, b) => a.localeCompare(b, "pt-BR"))],
    [data.sales],
  );
  const monthOptions = useMemo(
    () => ["Todos", ...Array.from(new Set(data.sales.map((sale) => `${sale.monthKey}|${sale.monthLabel}`)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((entry) => entry.split("|")[1])],
    [data.sales],
  );
  const paymentOptions = useMemo(
    () => ["Todos", ...Array.from(new Set(data.sales.map((sale) => sale.paymentMethod))).sort((a, b) => a.localeCompare(b, "pt-BR"))],
    [data.sales],
  );

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.sales.filter((sale) => {
      if (unitFilter !== "Todas" && sale.unit !== unitFilter) return false;
      if (monthFilter !== "Todos" && sale.monthLabel !== monthFilter) return false;
      if (paymentFilter !== "Todos" && sale.paymentMethod !== paymentFilter) return false;
      if (categoryFilter !== "Todos" && sale.paymentCategory !== categoryFilter) return false;
      if (
        term &&
        !`${sale.id} ${sale.customer} ${sale.planLabel} ${sale.paymentMethod}`.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [categoryFilter, data.sales, monthFilter, paymentFilter, search, unitFilter]);

  const summary = useMemo(() => {
    const totals = filteredSales.reduce(
      (acc, sale) => {
        acc.sales += 1;
        acc.points += sale.pointsCredited;
        acc.revenue += sale.expectedAmount;
        acc.upfront += sale.expectedUpfrontAmount;
        acc.installmentExpected += sale.expectedInstallmentAmount;
        acc.installmentReceived += sale.installmentReceived;
        acc.installmentRemaining += sale.installmentRemaining;
        return acc;
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

    const averageTicket = totals.sales ? totals.revenue / totals.sales : 0;
    const pendingRatio = totals.installmentExpected
      ? (totals.installmentRemaining / totals.installmentExpected) * 100
      : 0;

    const monthlyMap = new Map<string, { monthKey: string; monthLabel: string; sales: number; points: number; revenue: number; upfront: number; installmentRemaining: number }>();
    const paymentMap = new Map<string, { label: string; sales: number; revenue: number }>();
    const unitMap = new Map<string, { label: string; sales: number; revenue: number; pending: number }>();

    for (const sale of filteredSales) {
      const month = monthlyMap.get(sale.monthKey) ?? {
        monthKey: sale.monthKey,
        monthLabel: sale.monthLabel,
        sales: 0,
        points: 0,
        revenue: 0,
        upfront: 0,
        installmentRemaining: 0,
      };
      month.sales += 1;
      month.points += sale.pointsCredited;
      month.revenue += sale.expectedAmount;
      month.upfront += sale.expectedUpfrontAmount;
      month.installmentRemaining += sale.installmentRemaining;
      monthlyMap.set(sale.monthKey, month);

      const payment = paymentMap.get(sale.paymentMethod) ?? {
        label: sale.paymentMethod,
        sales: 0,
        revenue: 0,
      };
      payment.sales += 1;
      payment.revenue += sale.expectedAmount;
      paymentMap.set(sale.paymentMethod, payment);

      const unit = unitMap.get(sale.unit) ?? {
        label: sale.unit,
        sales: 0,
        revenue: 0,
        pending: 0,
      };
      unit.sales += 1;
      unit.revenue += sale.expectedAmount;
      unit.pending += sale.installmentRemaining;
      unitMap.set(sale.unit, unit);
    }

    return {
      totals: {
        ...totals,
        averageTicket,
        pendingRatio,
      },
      monthly: Array.from(monthlyMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
      payments: Array.from(paymentMap.values()).sort((a, b) => b.revenue - a.revenue),
      units: Array.from(unitMap.values()).sort((a, b) => b.revenue - a.revenue),
    };
  }, [filteredSales]);

  const maxMonthlyRevenue = Math.max(...summary.monthly.map((item) => item.revenue), 0);
  const maxPaymentRevenue = Math.max(...summary.payments.map((item) => item.revenue), 0);

  const commission = useMemo(() => {
    const rows = filteredSales.map((sale) => {
      const monthlyValue = sale.expectedAmount / 12;
      const isImmediate =
        sale.paymentMethod === "A vista" ||
        sale.paymentMethod === "Misto" ||
        sale.paymentMethod === "Cartao de credito";

      const firstMonthCommission = isImmediate
        ? monthlyValue * 0.35
        : sale.paymentCategory === "prazo"
          ? monthlyValue * 0.2
          : 0;
      const seventhMonthCommission = isImmediate
        ? 0
        : sale.paymentCategory === "prazo"
          ? monthlyValue * 0.1
          : 0;

      return {
        ...sale,
        monthlyValue,
        firstMonthCommission,
        seventhMonthCommission,
        totalCommission: firstMonthCommission + seventhMonthCommission,
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.monthlyValue += row.monthlyValue;
        acc.firstMonthCommission += row.firstMonthCommission;
        acc.seventhMonthCommission += row.seventhMonthCommission;
        acc.totalCommission += row.totalCommission;
        return acc;
      },
      {
        monthlyValue: 0,
        firstMonthCommission: 0,
        seventhMonthCommission: 0,
        totalCommission: 0,
      },
    );

    const monthlyMap = new Map<
      string,
      { monthKey: string; monthLabel: string; sales: number; monthlyValue: number; firstMonthCommission: number; seventhMonthCommission: number; totalCommission: number }
    >();

    for (const row of rows) {
      const current = monthlyMap.get(row.monthKey) ?? {
        monthKey: row.monthKey,
        monthLabel: row.monthLabel,
        sales: 0,
        monthlyValue: 0,
        firstMonthCommission: 0,
        seventhMonthCommission: 0,
        totalCommission: 0,
      };

      current.sales += 1;
      current.monthlyValue += row.monthlyValue;
      current.firstMonthCommission += row.firstMonthCommission;
      current.seventhMonthCommission += row.seventhMonthCommission;
      current.totalCommission += row.totalCommission;
      monthlyMap.set(row.monthKey, current);
    }

    return {
      rows,
      totals,
      monthly: Array.from(monthlyMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
    };
  }, [filteredSales]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setIsUploading(true);
    setUploadMessage("");

    try {
      const results: string[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("unit", uploadUnit);
        formData.append("file", file);

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });

        const payload = (await response.json()) as {
          error?: string;
          added?: number;
          skipped?: number;
          parsed?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Falha ao importar o arquivo.");
        }

        results.push(
          `${file.name}: ${payload.added ?? 0} adicionadas, ${payload.skipped ?? 0} repetidas.`,
        );
      }

      setUploadMessage(results.join(" "));
      router.refresh();
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Erro no upload.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.85),_transparent_32%),linear-gradient(160deg,#fff7ed_0%,#fef3c7_20%,#eff6ff_55%,#f8fafc_100%)]">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[36px] border border-white/60 bg-[linear-gradient(135deg,#020617_0%,#0f172a_50%,#0f766e_100%)] px-6 py-8 text-white shadow-[0_30px_100px_rgba(15,23,42,0.28)] sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[1.35fr_0.95fr]">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-amber-200">Dashboard Interativo</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Explore vendas, pontos e recebiveis com filtros em tempo real.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Ajuste unidade, mes, pagamento e tipo de recebimento para ler a operacao do jeito que fizer mais sentido na analise.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 backdrop-blur">
              <div className="grid gap-4 sm:grid-cols-2">
                <FilterSelect label="Unidade" value={unitFilter} onChange={setUnitFilter} options={unitOptions} />
                <FilterSelect label="Mes" value={monthFilter} onChange={setMonthFilter} options={monthOptions} />
                <FilterSelect label="Pagamento" value={paymentFilter} onChange={setPaymentFilter} options={paymentOptions} />
                <FilterSelect
                  label="Categoria"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={["Todos", "avista", "prazo"]}
                />
              </div>
              <label className="mt-4 grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Busca</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cliente, titulo ou plano"
                  className="rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-sky-400"
                />
              </label>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                {formatInteger(filteredSales.length)} vendas encontradas • Atualizado em {data.generatedAt}
              </div>
              <div className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Upload de planilha</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                  <FilterSelect
                    label="Base"
                    value={uploadUnit}
                    onChange={(value) => setUploadUnit(value as UnitName)}
                    options={["Aguas Claras", "Joquei Clube", "Itororo"]}
                  />
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Arquivo</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      multiple
                      disabled={isUploading}
                      onChange={(event) => void handleUpload(event.target.files)}
                      className="rounded-2xl border border-white/15 bg-black/10 px-3 py-3 text-sm text-slate-200 file:mr-3 file:rounded-full file:border-0 file:bg-sky-400 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-950"
                    />
                  </label>
                </div>
                <p className="mt-3 text-sm text-slate-300">
                  Envie arquivos com a mesma estrutura da unidade escolhida. Registros repetidos por titulo da venda nao entram novamente.
                </p>
                {uploadMessage ? (
                  <p className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-sm text-white">{uploadMessage}</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Vendas Totais" value={formatInteger(summary.totals.sales)} hint={`${formatCurrency(summary.totals.averageTicket)} de ticket medio esperado.`} tone="border-white/55 bg-white/80" />
          <StatCard title="Pontos Creditados" value={formatInteger(summary.totals.points)} hint="Volume filtrado de pontos creditados." tone="border-white/55 bg-white/80" />
          <StatCard title="Faturamento" value={formatCurrency(summary.totals.revenue)} hint={`${formatCurrency(summary.totals.upfront)} em recebimento imediato.`} tone="border-white/55 bg-white/80" />
          <StatCard title="Saldo Pendente" value={formatCurrency(summary.totals.installmentRemaining)} hint={`${summary.totals.pendingRatio.toFixed(1)}% do a prazo ainda aberto.`} tone="border-white/55 bg-white/80" />
        </section>

        <section className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveView("operacao")}
            className={`rounded-full px-5 py-3 text-sm font-medium transition ${
              activeView === "operacao"
                ? "bg-slate-950 text-white shadow-lg"
                : "bg-white text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
            }`}
          >
            Visao operacional
          </button>
          <button
            type="button"
            onClick={() => setActiveView("comissionamento")}
            className={`rounded-full px-5 py-3 text-sm font-medium transition ${
              activeView === "comissionamento"
                ? "bg-slate-950 text-white shadow-lg"
                : "bg-white text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
            }`}
          >
            Aba de comissionamento
          </button>
        </section>

        {activeView === "operacao" ? (
          <>
        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Quebra mensal</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Vendas e faturamento por mes</h2>
              </div>
              <p className="text-sm text-slate-500">A barra cresce conforme o faturamento esperado.</p>
            </div>
            <div className="mt-6 space-y-4">
              {summary.monthly.map((month) => (
                <div key={month.monthKey} className="rounded-[24px] bg-slate-50/90 p-4 transition hover:bg-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{month.monthLabel}</p>
                      <p className="text-sm text-slate-500">{formatInteger(month.sales)} vendas | {formatInteger(month.points)} pontos</p>
                    </div>
                    <p className="text-lg font-semibold text-slate-900">{formatCurrency(month.revenue)}</p>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#f97316,#facc15,#22c55e,#0ea5e9)]" style={{ width: widthPercent(month.revenue, maxMonthlyRevenue) }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">A vista: {formatCurrency(month.upfront)}</span>
                    <span className="rounded-full bg-white px-3 py-1">Pendente: {formatCurrency(month.installmentRemaining)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Recebiveis</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Radar financeiro do filtro atual</h2>
            <div className="mt-6 grid gap-4">
              <div className="rounded-[24px] bg-gradient-to-br from-amber-100 to-orange-50 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-amber-700">A prazo</p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{formatCurrency(summary.totals.installmentExpected)}</p>
              </div>
              <div className="rounded-[24px] bg-gradient-to-br from-rose-100 to-white p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-rose-700">Falta receber</p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{formatCurrency(summary.totals.installmentRemaining)}</p>
              </div>
              <div className="rounded-[24px] bg-gradient-to-br from-emerald-100 to-white p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">A vista</p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{formatCurrency(summary.totals.upfront)}</p>
              </div>
              <div className="rounded-[24px] bg-gradient-to-br from-sky-100 to-white p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-sky-700">Ja recebido</p>
                <p className="mt-3 text-3xl font-semibold text-slate-950">{formatCurrency(summary.totals.installmentReceived)}</p>
              </div>
            </div>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Pagamento</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Faturamento por tipo</h2>
            <div className="mt-6 space-y-4">
              {summary.payments.map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="font-medium text-slate-700">{item.label}</p>
                    <p className="text-slate-500">{formatInteger(item.sales)} vendas | {formatCurrency(item.revenue)}</p>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#0891b2,#14b8a6)]" style={{ width: widthPercent(item.revenue, maxPaymentRevenue) }} />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Unidades</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Comparativo por unidade</h2>
            <div className="mt-6 space-y-4">
              {summary.units.map((unit) => (
                <div key={unit.label} className="rounded-[24px] bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{unit.label}</p>
                      <p className="text-sm text-slate-500">{formatInteger(unit.sales)} vendas</p>
                    </div>
                    <p className="text-lg font-semibold text-slate-950">{formatCurrency(unit.revenue)}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">Pendente: {formatCurrency(unit.pending)}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Vendas filtradas</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Detalhamento para navegacao rapida</h2>
            </div>
            <p className="text-sm text-slate-500">Mostrando as 12 vendas mais recentes do filtro atual.</p>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-sm text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Data</th>
                  <th className="pb-2 pr-4 font-medium">Titulo</th>
                  <th className="pb-2 pr-4 font-medium">Cliente</th>
                  <th className="pb-2 pr-4 font-medium">Unidade</th>
                  <th className="pb-2 pr-4 font-medium">Pagamento</th>
                  <th className="pb-2 pr-4 font-medium">Pontos</th>
                  <th className="pb-2 pr-4 font-medium">Valor</th>
                  <th className="pb-2 font-medium">Pendente</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales
                  .slice()
                  .sort((a, b) => b.saleDate.localeCompare(a.saleDate))
                  .slice(0, 12)
                  .map((sale) => (
                    <tr key={sale.id} className="bg-slate-50 text-sm text-slate-700">
                      <td className="rounded-l-2xl px-4 py-4">{new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-4 font-medium text-slate-900">{sale.id}</td>
                      <td className="px-4 py-4">{sale.customer}</td>
                      <td className="px-4 py-4">{sale.unit}</td>
                      <td className="px-4 py-4">{sale.paymentMethod}</td>
                      <td className="px-4 py-4">{formatInteger(sale.pointsCredited)}</td>
                      <td className="px-4 py-4">{formatCurrency(sale.expectedAmount)}</td>
                      <td className="rounded-r-2xl px-4 py-4">{formatCurrency(sale.installmentRemaining)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
          <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Arquivos base</p>
            <div className="mt-4 grid gap-3">
              {data.sourceFiles.map((source) => (
                <div key={source.unit} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{source.unit}:</span> {source.fileName}
                </div>
              ))}
            </div>
          </article>

          {data.notes.length > 0 ? (
            <article className="rounded-[32px] border border-amber-200 bg-amber-50/90 p-6">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-700">Observacoes</p>
              <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-700">
                {data.notes.map((note) => (
                  <li key={note}>- {note}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </section>
          </>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Base mensal"
                value={formatCurrency(commission.totals.monthlyValue)}
                hint="Soma das mensalidades base calculadas como venda dividida por 12."
                tone="border-white/55 bg-white/80"
              />
              <StatCard
                title="Comissao 1a mensalidade"
                value={formatCurrency(commission.totals.firstMonthCommission)}
                hint="35% no a vista/cartao e 20% nas vendas a prazo."
                tone="border-white/55 bg-white/80"
              />
              <StatCard
                title="Comissao 7a mensalidade"
                value={formatCurrency(commission.totals.seventhMonthCommission)}
                hint="10% da 7a mensalidade para vendas a prazo."
                tone="border-white/55 bg-white/80"
              />
              <StatCard
                title="Comissao total"
                value={formatCurrency(commission.totals.totalCommission)}
                hint="Total potencial de comissionamento do recorte filtrado."
                tone="border-white/55 bg-white/80"
              />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Comissao por mes</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Resumo mensal de comissionamento</h2>
                <div className="mt-6 space-y-4">
                  {commission.monthly.map((month) => (
                    <div key={month.monthKey} className="rounded-[24px] bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-slate-900">{month.monthLabel}</p>
                          <p className="text-sm text-slate-500">{formatInteger(month.sales)} vendas</p>
                        </div>
                        <p className="text-lg font-semibold text-slate-950">{formatCurrency(month.totalCommission)}</p>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                        <p>Base: {formatCurrency(month.monthlyValue)}</p>
                        <p>1a mensalidade: {formatCurrency(month.firstMonthCommission)}</p>
                        <p>7a mensalidade: {formatCurrency(month.seventhMonthCommission)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Regras aplicadas</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Como a comissao foi calculada</h2>
                <div className="mt-6 grid gap-4">
                  <div className="rounded-[24px] bg-emerald-50 p-5">
                    <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">A vista, misto e cartao</p>
                    <p className="mt-3 text-base leading-7 text-slate-700">
                      Venda dividida por 12 para achar a mensalidade e 35% aplicados sobre a 1a mensalidade.
                    </p>
                  </div>
                  <div className="rounded-[24px] bg-amber-50 p-5">
                    <p className="text-sm uppercase tracking-[0.2em] text-amber-700">Boleto e recorrente</p>
                    <p className="mt-3 text-base leading-7 text-slate-700">
                      Venda dividida por 12, com 20% na 1a mensalidade e 10% na 7a mensalidade.
                    </p>
                  </div>
                  <div className="rounded-[24px] bg-sky-50 p-5">
                    <p className="text-sm uppercase tracking-[0.2em] text-sky-700">Itororo</p>
                    <p className="mt-3 text-base leading-7 text-slate-700">
                      Boleto e recorrente foram removidos da analise, conforme sua regra de negocio.
                    </p>
                  </div>
                </div>
              </article>
            </section>

            <section className="rounded-[32px] border border-slate-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Detalhamento</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Comissao por venda</h2>
                </div>
                <p className="text-sm text-slate-500">Mostrando as 12 vendas mais recentes do filtro atual.</p>
              </div>
              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-sm text-slate-500">
                      <th className="pb-2 pr-4 font-medium">Data</th>
                      <th className="pb-2 pr-4 font-medium">Titulo</th>
                      <th className="pb-2 pr-4 font-medium">Pagamento</th>
                      <th className="pb-2 pr-4 font-medium">Mensalidade base</th>
                      <th className="pb-2 pr-4 font-medium">1a mensalidade</th>
                      <th className="pb-2 pr-4 font-medium">7a mensalidade</th>
                      <th className="pb-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commission.rows
                      .slice()
                      .sort((a, b) => b.saleDate.localeCompare(a.saleDate))
                      .slice(0, 12)
                      .map((sale) => (
                        <tr key={`${sale.unit}-${sale.id}`} className="bg-slate-50 text-sm text-slate-700">
                          <td className="rounded-l-2xl px-4 py-4">{new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                          <td className="px-4 py-4 font-medium text-slate-900">{sale.id}</td>
                          <td className="px-4 py-4">{sale.paymentMethod}</td>
                          <td className="px-4 py-4">{formatCurrency(sale.monthlyValue)}</td>
                          <td className="px-4 py-4">{formatCurrency(sale.firstMonthCommission)}</td>
                          <td className="px-4 py-4">{formatCurrency(sale.seventhMonthCommission)}</td>
                          <td className="rounded-r-2xl px-4 py-4">{formatCurrency(sale.totalCommission)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
