import { redirect } from "next/navigation";
export default function BenchmarkDiffRedirect() {
  redirect("/benchmark?tab=diff");
}
