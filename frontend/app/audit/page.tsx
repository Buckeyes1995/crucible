import { redirect } from "next/navigation";
export default function AuditRedirect() {
  redirect("/observability?tab=audit");
}
