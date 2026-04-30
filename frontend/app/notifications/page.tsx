import { redirect } from "next/navigation";
export default function NotificationsRedirect() {
  redirect("/observability?tab=alerts");
}
