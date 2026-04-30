import { redirect } from "next/navigation";
export default function MetricsRedirect() { redirect("/analytics?tab=metrics"); }
