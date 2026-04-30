import { redirect } from "next/navigation";
export default function LogsRedirect() {
  redirect("/observability?tab=logs");
}
