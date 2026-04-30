import { redirect } from "next/navigation";
export default function Benchmark2Redirect() {
  redirect("/benchmark?tab=run");
}
