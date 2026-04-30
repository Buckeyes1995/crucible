import { redirect } from "next/navigation";
export default function BenchmarkHistoryRedirect() {
  redirect("/benchmark?tab=history");
}
