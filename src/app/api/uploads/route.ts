import { NextResponse } from "next/server";
import { appendUploadedWorkbook, type UnitName } from "@/lib/dashboard-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUnitName(value: string): value is UnitName {
  return value === "Aguas Claras" || value === "Joquei Clube" || value === "Itororo";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const unit = String(formData.get("unit") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Nenhum arquivo foi enviado." }, { status: 400 });
    }

    if (!isUnitName(unit)) {
      return NextResponse.json({ error: "Unidade invalida para importacao." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await appendUploadedWorkbook({
      unit,
      fileName: file.name,
      buffer,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel importar a planilha.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
