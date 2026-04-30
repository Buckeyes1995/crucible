import { redirect } from "next/navigation";
export default function BenchmarkNewRedirect() {
  redirect("/benchmark?tab=run");
}
