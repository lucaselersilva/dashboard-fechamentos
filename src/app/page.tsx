import { DashboardClient } from "@/app/dashboard-client";
import { getDashboardData } from "@/lib/dashboard-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();

  return <DashboardClient data={data} />;
}
