import { redirect } from "next/navigation";
export default function HealthRedirect() {
  redirect("/observability?tab=health");
}
