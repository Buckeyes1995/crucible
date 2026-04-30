import { redirect } from "next/navigation";
export default function OptimizerRedirect() {
  redirect("/benchmark?tab=optimizer");
}
